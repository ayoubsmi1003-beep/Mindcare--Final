import { alexa } from "@/i18n/alexa";
import { creerBoucleVoixLocale, type TourVoix, type TrameVoix } from "@/shared/alexa/voice-loop";
import { encoderPCM16 } from "@/shared/jarvis/pcm";
import { envoyerTourAlexa } from "./alexa-turn";
import { db } from "./db";
import { abonnerLecture, arreterLecture, enveloppeLecture, estLectureInterrompue, lireAccuse, lireReponse, prechargerAccuse } from "./jarvis-voix";
import { installerConversationVoix, type VueVoix } from "./jarvis-reveil";
import { prendreMicro, type PriseMicro } from "./micro-partage";
import { abonnerPatientActif, patientActifCourant } from "./patient-actif";
import { navigateAlexa } from "./alexa-navigation";
import { dialogue } from "@/i18n/alexa-dialogue";
import { planRequest } from "@/shared/alexa/request-plan";
import type { AlexaProposal } from "@/shared/alexa/turn";
import { lectureInterdite, setLoopBusy } from "./voice-activity";
import type { Result } from "./result";
import { creerTracesVoix, type MarqueVoix } from "@/shared/alexa/voice-trace";

/**
 * Voice timing traces (timestamps only, never text), readable for diagnosis
 * and by the automated voice scenarios as `window.__mindcareVoiceTraces`.
 */
const tracesVoix = creerTracesVoix(() => performance.now());
let attenteSilence = false;
export function marquerVoix(marque: MarqueVoix): void {
  if (marque === "stop") attenteSilence = true;
  tracesVoix.marquer(marque);
}
abonnerLecture((active) => { if (!active && attenteSilence) { attenteSilence = false; tracesVoix.marquer("silence"); } });
declare global { interface Window { __mindcareVoiceTraces?: Pick<ReturnType<typeof creerTracesVoix>, "traces" | "rapport"> } }
if (typeof window !== "undefined") window.__mindcareVoiceTraces = { traces: tracesVoix.traces, rapport: tracesVoix.rapport };

const proposalSubscribers=new Set<(proposal:AlexaProposal,text:string,patientId:string|null,signal:AbortSignal)=>Promise<void>>();
export function abonnerPropositionVoixLocale(handler:(proposal:AlexaProposal,text:string,patientId:string|null,signal:AbortSignal)=>Promise<void>):()=>void {
  proposalSubscribers.add(handler);return ()=>{proposalSubscribers.delete(handler);};
}

const subscribers = new Set<(view: VueVoix) => void>();
const turnSubscribers = new Set<(turn: TourVoix) => void>();
let view: VueVoix = { etat: "desactive", raison: null, reveilArme: false, sourceParole: null };
let scopeUnsubscribe: (() => void) | null = null;
let level = 0;
let preparingCapture: AbortController | null = null;
let workerLifecycle = Promise.resolve();
function controlWorker(action: "prepare", signal?: AbortSignal) {
  const request = workerLifecycle.then(() => db().invokeFunction("jarvis-voice-session", { action }, signal));
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
  preparingCapture = preparing;
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
    // The models stay resident: closing the conversation never unloads them (reload = 15-40 s).
  };
  preparing.signal.addEventListener("abort", close, { once: true });
  try {
    context = new AudioContext({ latencyHint: "interactive" });
    const resume = context.resume();
    // Large-v3-turbo + first Kokoro load + real inference health can exceed
    // two minutes on an 8 GB CPU-only machine. Do not cut the microphone off
    // while the local worker is still legitimately initializing.
    const prepared = controlWorker("prepare", AbortSignal.any([preparing.signal, AbortSignal.timeout(300_000)]));
    // The live-transcript recognizer lives in the wake worker: warm it now. A failure only hides the live text.
    void db().invokeFunction("jarvis-wake", { action: "start" }, preparing.signal).catch(() => {});
    const admission=await prepared; if(!admission.ok)throw new Error("voice-admission");
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

/** Runs one read of the single speech queue. Rejects "cancelled" on STOP/barge-in, "tts" on a real failure. */
async function jouerLocalement(read: (annulee: () => boolean) => Promise<Result<true>>, signal: AbortSignal, playing: () => void): Promise<void> {
  if (signal.aborted) throw new Error("cancelled");
  const abort = () => arreterLecture();
  signal.addEventListener("abort", abort, { once: true });
  const unsubscribe = abonnerLecture((active) => { if (active) playing(); });
  try {
    const result = await read(() => signal.aborted);
    if (!result.ok) throw new Error(signal.aborted || estLectureInterrompue(result.error) ? "cancelled" : "tts");
  } finally { signal.removeEventListener("abort", abort); unsubscribe(); }
}
const lireLocalement = (text: string, signal: AbortSignal, playing: () => void) => jouerLocalement((a) => lireReponse(text, a), signal, playing);

const apercuSubscribers = new Set<(texte: string | null) => void>();
let apercu: string | null = null;
/** The doctor's words while she speaks (live, provisional); `null` when none. */
export function abonnerApercuVoix(subscriber: (texte: string | null) => void): () => void {
  apercuSubscribers.add(subscriber); subscriber(apercu); return () => { apercuSubscribers.delete(subscriber); };
}

const loop = creerBoucleVoixLocale({
  ouvrir: ouvrirCapture,
  partiel: async (samples, rate, reset, signal) => {
    if (reset) {
      const r = await db().invokeFunction("jarvis-wake", { action: "partial-reset" }, signal);
      if (!r.ok) throw new Error("partial");
    }
    const r = await db().invokeFunction<{ texte: string }>("jarvis-wake", { action: "partial", pcmBase64: base64(encoderPCM16([samples], rate)) }, signal);
    if (!r.ok || typeof r.data.texte !== "string") throw new Error("partial");
    return r.data.texte;
  },
  trace: marquerVoix,
  apercu: (texte) => { apercu = texte; for (const subscriber of apercuSubscribers) subscriber(texte); },
  transcrire: async (samples, rate, signal) => {
    const runId = crypto.randomUUID(), utteranceId = crypto.randomUUID();
    const result = await db().invokeFunction<{ texte: string; runId: string; utteranceId: string }>("jarvis-voice-in", {
      pcmBase64: base64(encoderPCM16([samples], rate)), sampleRate: 16000, runId, utteranceId, langue: "fr",
    }, signal);
    // Silence or nothing intelligible (a cough, a fragment) is not a voice failure:
    // the conversation keeps listening instead of closing the microphone.
    if (!result.ok && result.error.code === "regle-metier") return { texte: "", utteranceId };
    if (!result.ok || result.data.runId !== runId || result.data.utteranceId !== utteranceId) throw new Error("stt");
    return {texte:result.data.texte,utteranceId};
  },
  repondre: async (text, signal, onSentence,clientTurnId) => {
    const result=await envoyerTourAlexa(text,signal,{onSentence,clientTurnId});signal.throwIfAborted();
    if(result.proposal)for(const handler of proposalSubscribers){signal.throwIfAborted();await handler(result.proposal,text,result.patientId,signal);}
    return result;
  },
  navigate: navigateAlexa,
  speechLimitNotice: text => dialogue(planRequest(text, null).language).speechLimit,
  lire: lireLocalement,
  accuse: (signal, playing) => jouerLocalement((a) => lireAccuse(alexa.reveilAccuse, a), signal, playing),
  echoReference: enveloppeLecture,
  couper: arreterLecture,
  phase: (etat, error) => {
    // Le registre partagé voit la boucle directe comme un propriétaire du
    // micro : sans cela, une dictée de champ pourrait en ouvrir un second.
    // `erreur` n'est PAS une capture : le micro est déjà refermé.
    setLoopBusy(
      etat !== "desactive" && etat !== "erreur",
    );
    if (etat === "desactive") { scopeUnsubscribe?.(); scopeUnsubscribe = null; level = 0; }
    const raison = error === "capture" ? alexa.voixLocale : error === "stt" ? alexa.stt
      : error === "tts" ? alexa.tts : error ? alexa.interrompu
      : etat === "reveille" ? (parReveil ? alexa.reveilAccuse : alexa.voixPreparation) : etat === "ecoute" ? alexa.voixEcoute
      : etat === "voixDetectee" ? alexa.voixDetectee : etat === "transcription" ? alexa.voixTranscription
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
  preparingCapture?.abort(); preparingCapture = null;
  loop.arreter(); setLoopBusy(false);
}
export function niveauVoixLocale(): number { return level; }
/** A typed answer while the voice conversation is open: spoken by the loop, which then listens again. */
export function parlerVoixLocale(texte: string): Promise<"fini" | "interrompu" | "echec" | "occupe"> { return loop.parler(texte); }
export async function demarrerVoixLocale(options?: { readonly conversation?: boolean }): Promise<void> {
  if (loop.active()) return;
  // ⚠️ UN SEUL PROPRIÉTAIRE. Une capture du réveil, une dictée de champ ou une
  // synthèse déjà en cours interdit d'ouvrir la boucle : deux prises sur le
  // même micro corrompent la transcription, et la seconde enregistrerait la
  // voix d'Alexa.
  if (lectureInterdite()) return;
  const id = patientActifCourant()?.id ?? null;
  scopeUnsubscribe?.();
  scopeUnsubscribe = abonnerPatientActif((patient) => { if ((patient?.id ?? null) !== id) arreterVoixLocale(); });
  parReveil = options?.conversation === true;
  await loop.demarrer(options);
}
let parReveil = false;

/**
 * Hands-free: loads Whisper + Kokoro and caches the acknowledgement BEFORE the
 * first "Alexa", so the wake answer is immediate and the first command does
 * not pay a model load. Failures stay visible on the first real turn.
 */
export async function preparerVoixReveil(): Promise<boolean> {
  const prepared = await controlWorker("prepare", AbortSignal.timeout(300_000)).catch(() => null);
  if (!prepared?.ok) return false;
  return prechargerAccuse(alexa.reveilAccuse);
}

/**
 * "Alexa" in standby opens a conversation here and resolves when it ends
 * (quiet follow-up window, STOP of the microphone, error): the wake detector
 * then resumes. Registered on the wake machine, which never imports this module.
 */
installerConversationVoix(async () => {
  if (loop.active() || lectureInterdite()) return;
  await demarrerVoixLocale({ conversation: true });
  if (!loop.active()) return;
  await new Promise<void>((resolve) => {
    let done = false, unsubscribe: (() => void) | null = null;
    unsubscribe = abonnerVoixLocale((v) => {
      if (done || (v.etat !== "desactive" && v.etat !== "erreur")) return;
      done = true; unsubscribe?.(); resolve();
    });
    if (done) unsubscribe();
  });
});
export function basculerVoixLocale(): void { if (loop.active()) arreterVoixLocale(); else void demarrerVoixLocale(); }
