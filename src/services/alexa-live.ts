import { alexaLive } from "@/i18n/alexa-live";
import { EvenementLive } from "@/shared/jarvis/live";
import { encoderPCM16 } from "@/shared/jarvis/pcm";
import { db } from "./db";
import { prendreMicro, type PriseMicro } from "./micro-partage";
import { abonnerPatientActif, patientActifCourant } from "./patient-actif";
import { log } from "./log";
import type { EtatVoix, VueVoix } from "./jarvis-reveil";

type Abonne = (v: VueVoix) => void;
const subscribers = new Set<Abonne>();
let view: VueVoix = { etat: "desactive", raison: null, reveilArme: false, sourceParole: null };
interface Session {
  control: AbortController; context: AudioContext; prise: PriseMicro | null;
  input: MediaStreamAudioSourceNode | null; capture: AudioWorkletNode | null;
  mute: GainNode | null; id: string | null; reader: ReadableStreamDefaultReader<Uint8Array> | null;
  unsubscribe: () => void; timer: ReturnType<typeof setTimeout> | undefined;
  sources: Set<AudioBufferSourceNode>; playAt: number; queuedRequests: number;
  sends: Promise<void>; turnFinished: boolean;
}
let current: Session | null = null, level = 0;
function state(etat: EtatVoix, raison: string | null = null) {
  view = { etat, raison, reveilArme: false, sourceParole: etat === "parole" ? "cloud" : null };
  for (const subscriber of subscribers) subscriber(view);
  log.info("alexa.live.ui", { context: etat });
}
export function abonnerLive(subscriber: Abonne): () => void {
  subscribers.add(subscriber); subscriber(view); return () => { subscribers.delete(subscriber); };
}
export function vueLive(): VueVoix { return view; }
export function niveauLive(): number { return level; }
export function liveActif(): boolean { return current !== null; }
function stopPlayback(s: Session) {
  for (const source of s.sources) { source.onended = null; try { source.stop(); } catch { /* Already ended. */ } source.disconnect(); }
  s.sources.clear(); s.playAt = s.context.currentTime;
}
export function arreterLive(): void {
  const s = current; current = null; level = 0;
  if (s) {
    clearTimeout(s.timer); s.unsubscribe(); s.control.abort();
    if (s.capture) { s.capture.port.onmessage = null; s.capture.port.close(); s.capture.disconnect(); }
    s.input?.disconnect(); s.mute?.disconnect(); stopPlayback(s);
    s.prise?.rendre(); void s.reader?.cancel().catch(() => {}); void s.context.close().catch(() => {});
    if (s.id) void db().invokeFunction("jarvis-live", { action: "stop", sessionId: s.id });
  }
  state("desactive"); log.info("alexa.live.cleanup");
}
function fail(s: Session, message = alexaLive.indisponible) {
  if (current !== s) return;
  arreterLive(); state("erreur", message);
}
function watchdog(s: Session, ms: number) {
  clearTimeout(s.timer); s.timer = setTimeout(() => fail(s), ms);
}
function encode(bytes: Uint8Array): string {
  let text = ""; for (const byte of bytes) text += String.fromCharCode(byte); return btoa(text);
}
function play(s: Session, data: string) {
  const raw = atob(data);
  if (!raw.length || raw.length % 2 || s.context.state !== "running") throw new Error("live-audio");
  const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0)), pcm = new DataView(bytes.buffer);
  const buffer = s.context.createBuffer(1, raw.length / 2, 24000), channel = buffer.getChannelData(0);
  for (let i = 0; i < channel.length; i++) channel[i] = pcm.getInt16(i * 2, true) / 32768;
  const start = Math.max(s.playAt, s.context.currentTime + 0.015);
  if (start - s.context.currentTime > 45) throw new Error("live-audio-backlog");
  const source = s.context.createBufferSource(); source.buffer = buffer; source.connect(s.context.destination);
  s.sources.add(source); s.playAt = start + buffer.duration; s.turnFinished = false;
  source.onended = () => {
    s.sources.delete(source); source.disconnect();
    if (current === s && s.sources.size === 0 && s.turnFinished) state("ecoute", alexaLive.ecoute);
  };
  source.start(start); clearTimeout(s.timer);
  state("parole", alexaLive.parole); log.info("alexa.live.audioPlayed", { count: bytes.length });
}
async function consume(s: Session, stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader(); s.reader = reader;
  const decoder = new TextDecoder(); let pending = "";
  try {
    for (;;) {
      const chunk = await reader.read(); if (chunk.done) break;
      if (current !== s) return;
      pending += decoder.decode(chunk.value, { stream: true });
      if (pending.length > 1_100_000) throw new Error("live-message-size");
      let end: number;
      while ((end = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, end).trim(); pending = pending.slice(end + 1); if (!line) continue;
        const event = EvenementLive.parse(JSON.parse(line) as unknown);
        switch (event.type) {
          case "ready": s.id = event.sessionId; clearTimeout(s.timer); state("ecoute", alexaLive.ecoute); break;
          case "thinking": if (s.sources.size === 0) { state("traitement", alexaLive.reflexion); watchdog(s, 30_000); } break;
          case "audio": play(s, event.data); break;
          case "turn_complete": s.turnFinished = true; clearTimeout(s.timer); if (s.sources.size === 0) state("ecoute", alexaLive.ecoute); break;
          case "interrupted": stopPlayback(s); clearTimeout(s.timer); state("ecoute", alexaLive.ecoute); break;
          case "error": fail(s); return;
          case "closed": arreterLive(); return;
        }
      }
    }
    // An error envelope, abrupt network close or truncated event is a visible failure.
    if (current === s) fail(s);
  } catch { fail(s); }
  finally { reader.releaseLock(); }
}

/** Direct microphone PCM → existing same-origin port → Gemini → native PCM playback. */
export async function demarrerLive(): Promise<void> {
  if (current !== null) return;
  let context: AudioContext;
  try { context = new AudioContext({ latencyHint: "interactive" }); }
  catch { state("erreur", alexaLive.micro); return; }
  // Resume is invoked during the original click, before any permission/network await.
  const resumed = context.resume();
  const s: Session = { control: new AbortController(), context, prise: null, input: null, capture: null,
    mute: null, id: null, reader: null, unsubscribe: () => {}, timer: undefined, sources: new Set(),
    playAt: 0, queuedRequests: 0, sends: Promise.resolve(), turnFinished: false };
  current = s; state("reveille", alexaLive.connexion); watchdog(s, 30_000);
  log.info("alexa.live.activation");
  try {
    await resumed;
    const access = await prendreMicro();
    if (!access.ok) { fail(s, alexaLive.micro); return; }
    if (current !== s) { access.data.rendre(); return; }
    s.prise = access.data; log.info("alexa.live.microphoneGranted");
    await context.audioWorklet.addModule("/audio/alexa-live-capture.js");
    if (current !== s) return;
    s.input = context.createMediaStreamSource(s.prise.flux); s.capture = new AudioWorkletNode(context, "alexa-live-capture");
    s.mute = context.createGain(); s.mute.gain.value = 0;
    s.input.connect(s.capture); s.capture.connect(s.mute); s.mute.connect(context.destination);
    s.capture.port.onmessage = (message: MessageEvent<unknown>) => {
      if (current !== s || !s.id || !(message.data instanceof Float32Array)) return;
      const samples = message.data;
      level = Math.min(1, Math.sqrt(samples.reduce((sum, n) => sum + n * n, 0) / samples.length) * 8);
      if (++s.queuedRequests > 8) { fail(s); return; }
      const pcmBase64 = encode(encoderPCM16([samples], context.sampleRate));
      s.sends = s.sends.then(async () => {
        if (current !== s) return;
        const result = await db().invokeFunction("jarvis-live", { action: "audio", sessionId: s.id, pcmBase64 },
          AbortSignal.any([s.control.signal, AbortSignal.timeout(4_000)]));
        if (!result.ok) fail(s);
      }).catch(() => fail(s)).finally(() => { s.queuedRequests--; });
    };
    log.info("alexa.live.captureReady");
    const initialPatientId = patientActifCourant()?.id ?? null;
    const result = await db().invokeFunctionStream("jarvis-live", { action: "start", currentPatientId: initialPatientId }, s.control.signal);
    if (current !== s) { if (result.ok) await result.data.cancel(); return; }
    if (!result.ok) { fail(s); return; }
    void consume(s, result.data);
    let previous = initialPatientId;
    s.unsubscribe = abonnerPatientActif((patient) => {
      const id = patient?.id ?? null; if (id === previous) return; previous = id;
      stopPlayback(s);
      s.sends = s.sends.then(async () => {
        if (current !== s || !s.id) return;
        const r = await db().invokeFunction("jarvis-live", { action: "context", sessionId: s.id, currentPatientId: id }, s.control.signal);
        if (!r.ok) fail(s);
      }).catch(() => fail(s));
    });
  } catch { fail(s); }
}
export function basculerLive(): void { if (current) arreterLive(); else void demarrerLive(); }
