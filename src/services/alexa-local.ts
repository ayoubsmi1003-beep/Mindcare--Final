import { alexa } from "@/i18n/alexa";
import { creerBoucleVoixLocale, type TourVoix, type TrameVoix } from "@/shared/alexa/voice-loop";
import { encoderPCM16 } from "@/shared/jarvis/pcm";
import { envoyerTourAlexa } from "./alexa-turn";
import { db } from "./db";
import { abonnerLecture, arreterLecture, lireTexte } from "./jarvis-voix";
import type { VueVoix } from "./jarvis-reveil";
import { prendreMicro, type PriseMicro } from "./micro-partage";
import { abonnerPatientActif, patientActifCourant } from "./patient-actif";
import { navigateAlexa } from "./alexa-navigation";
import { dialogue } from "@/i18n/alexa-dialogue";
import { planRequest } from "@/shared/alexa/request-plan";

const subscribers = new Set<(view: VueVoix) => void>();
const turnSubscribers = new Set<(turn: TourVoix) => void>();
let view: VueVoix = { etat: "desactive", raison: null, reveilArme: false, sourceParole: null };
let scopeUnsubscribe: (() => void) | null = null;
let level = 0;
let captureGeneration = 0, preparingCapture: AbortController | null = null;
let workerLifecycle = Promise.resolve();
function controlWorker(action: "prepare" | "stop", signal?: AbortSignal) {
  const request = workerLifecycle.then(() => db().invokeFunction("jarvis-voice-session", { action }, signal ?? (action === "stop" ? AbortSignal.timeout(4_000) : undefined)));
  workerLifecycle = request.then(() => {}, () => {});
  return request;
}

function base64(bytes: Uint8Array): string {
  let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary);
}

/** One explicit click owns capture; PCM stays in RAM and travels only to the local API. */
async function ouvrirCapture(receive: (frame: TrameVoix) => void): Promise<() => void> {
  let context: AudioContext | null = null, prise: PriseMicro | null = null;
  let source: MediaStreamAudioSourceNode | null = null, capture: AudioWorkletNode | null = null, mute: GainNode | null = null;
  const preparing = new AbortController();
  const ownGeneration = ++captureGeneration; preparingCapture = preparing;
  let released = false;
  const ended = () => arreterVoixLocale();
  const close = () => {
    if (released) return; released = true;
    preparing.signal.removeEventListener("abort", close); preparing.abort();
    if (capture) { capture.port.onmessage = null; capture.port.close(); capture.disconnect(); capture = null; }
    source?.disconnect(); mute?.disconnect();
    for (const track of prise?.flux.getTracks() ?? []) track.removeEventListener("ended", ended);
    prise?.rendre(); prise = null; void context?.close().catch(() => {}); context = null;
    if (preparingCapture === preparing) preparingCapture = null;
    if (ownGeneration === captureGeneration) void controlWorker("stop");
  };
  preparing.signal.addEventListener("abort", close, { once: true });
  try {
    context = new AudioContext({ latencyHint: "interactive" });
    const resume = context.resume();
    const prepared = controlWorker("prepare", AbortSignal.any([preparing.signal, AbortSignal.timeout(30_000)]));
    const access = await prendreMicro(); if (!access.ok) throw new Error("microphone");
    if (released) { access.data.rendre(); throw new Error("cancelled"); }
    prise = access.data; await resume; preparing.signal.throwIfAborted();
    const worker = await prepared; preparing.signal.throwIfAborted();
    if (!worker.ok) throw new Error("local-worker");
    for (const track of prise.flux.getTracks()) track.addEventListener("ended", ended);
    await context.audioWorklet.addModule("/audio/alexa-local-capture.js");
    preparing.signal.throwIfAborted();
    source = context.createMediaStreamSource(prise.flux);
    capture = new AudioWorkletNode(context, "alexa-local-capture");
    mute = context.createGain(); mute.gain.value = 0;
    capture.port.onmessage = (event: MessageEvent<unknown>) => {
      if (event.data instanceof Float32Array && context) {
        let power = 0; for (const sample of event.data) power += sample * sample;
        level += (Math.min(1, Math.sqrt(power / event.data.length) * 8) - level) * 0.25;
        receive({ samples: event.data, sampleRate: context.sampleRate });
      }
    };
    source.connect(capture); capture.connect(mute); mute.connect(context.destination);
    if (preparingCapture === preparing) preparingCapture = null;
    return close;
  } catch (cause) { close(); throw cause; }
}

async function lireLocalement(text: string, signal: AbortSignal, playing: () => void): Promise<void> {
  if (signal.aborted) throw new Error("cancelled");
  let seen = false, unsubscribe = () => {};
  let resolveEnd!: () => void, rejectEnd!: (cause: Error) => void;
  const end = new Promise<void>((resolve, reject) => { resolveEnd = resolve; rejectEnd = reject; });
  // The rejection is observed immediately, including cancellation while TTS is still preparing.
  void end.catch(() => {});
  const abort = () => { arreterLecture(); rejectEnd(new Error("cancelled")); };
  signal.addEventListener("abort", abort, { once: true });
  unsubscribe = abonnerLecture((active, source) => {
    if (active && source === "local") { seen = true; playing(); }
    else if (active) { arreterLecture(); rejectEnd(new Error("local-only")); }
    else if (seen) resolveEnd();
  });
  try {
    const result = await lireTexte(text);
    if (!result.ok || signal.aborted) throw new Error("tts");
    await end;
  } finally { signal.removeEventListener("abort", abort); unsubscribe(); }
}

const loop = creerBoucleVoixLocale({
  ouvrir: ouvrirCapture,
  transcrire: async (samples, rate, signal) => {
    const runId = crypto.randomUUID(), utteranceId = crypto.randomUUID();
    const result = await db().invokeFunction<{ texte: string; runId: string; utteranceId: string }>("jarvis-voice-in", {
      pcmBase64: base64(encoderPCM16([samples], rate)), sampleRate: 16000, runId, utteranceId, langue: "auto",
    }, signal);
    if (!result.ok || result.data.runId !== runId || result.data.utteranceId !== utteranceId) throw new Error("stt");
    return result.data.texte;
  },
  repondre: (text, signal, onSentence) => envoyerTourAlexa(text, signal, { onSentence }),
  navigate: navigateAlexa,
  speechLimitNotice: text => dialogue(planRequest(text, null).language).speechLimit,
  lire: lireLocalement,
  couper: arreterLecture,
  phase: (etat, error) => {
    if (etat === "desactive") { scopeUnsubscribe?.(); scopeUnsubscribe = null; level = 0; }
    const raison = error === "capture" ? alexa.voixLocale : error === "stt" ? alexa.stt
      : error === "tts" ? alexa.tts : error ? alexa.interrompu
      : etat === "reveille" ? alexa.voixPreparation : etat === "ecoute" ? alexa.voixEcoute
      : etat === "traitement" ? alexa.voixReflexion : etat === "parole" ? alexa.voixParole : null;
    view = { etat, raison, reveilArme: false, sourceParole: etat === "parole" ? "local" : null };
    for (const subscriber of subscribers) subscriber(view);
  },
  tour: (turn) => {
    const safe = turn.error ? { ...turn, reponse: turn.error === "stt" ? alexa.stt : turn.error === "tts" ? alexa.tts : alexa.interrompu }
      : turn.speechLimited && turn.reponse ? { ...turn, reponse: `${turn.reponse}\n${dialogue(planRequest(turn.texte, null).language).speechLimit}` } : turn;
    for (const subscriber of turnSubscribers) subscriber(safe);
  },
});

export function abonnerVoixLocale(subscriber: (view: VueVoix) => void): () => void {
  subscribers.add(subscriber); subscriber(view); return () => { subscribers.delete(subscriber); };
}
export function abonnerTourVoixLocale(subscriber: (turn: TourVoix) => void): () => void {
  turnSubscribers.add(subscriber); return () => { turnSubscribers.delete(subscriber); };
}
export function arreterVoixLocale(): void {
  const wasActive = loop.active(); captureGeneration++; preparingCapture?.abort(); preparingCapture = null;
  loop.arreter(); if (wasActive) void controlWorker("stop");
}
export function niveauVoixLocale(): number { return level; }
export async function demarrerVoixLocale(): Promise<void> {
  if (loop.active()) return;
  const id = patientActifCourant()?.id ?? null;
  scopeUnsubscribe?.();
  scopeUnsubscribe = abonnerPatientActif((patient) => { if ((patient?.id ?? null) !== id) arreterVoixLocale(); });
  await loop.demarrer();
}
export function basculerVoixLocale(): void { if (loop.active()) arreterVoixLocale(); else void demarrerVoixLocale(); }
