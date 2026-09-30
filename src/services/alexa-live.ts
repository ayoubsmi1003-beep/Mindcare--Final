import { alexaLive } from "@/i18n/alexa-live";
import { EvenementLive } from "@/shared/jarvis/live";
import { encoderPCM16 } from "@/shared/jarvis/pcm";
import { db } from "./db";
import { prendreMicro, type PriseMicro } from "./micro-partage";
import { abonnerPatientActif, patientActifCourant } from "./patient-actif";
import { log, type LogFields } from "./log";
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
  pendingAudio: Uint8Array[]; audioScheduled: boolean;
  sends: Promise<void>; turnFinished: boolean; patientId: string | null;
  announcedPatientId: string | null; contextRevision: number; capturePaused: boolean;
  microphoneEnded: () => void;
}
let current: Session | null = null, level = 0;
function diagnosticUi(event: string, fields: LogFields = {}) {
  log.info(event, fields);
  // Temporary, explicit demo diagnostics carry only fixed stages and counts.
  if (typeof window !== "undefined" && process.env.NODE_ENV === "production"
    && new URLSearchParams(window.location.search).get("alexa-live-debug") === "1")
    console.warn(JSON.stringify({ event, ...fields }));
}
function state(etat: EtatVoix, raison: string | null = null) {
  view = { etat, raison, reveilArme: false, sourceParole: etat === "parole" ? "cloud" : null };
  for (const subscriber of subscribers) subscriber(view);
  diagnosticUi("alexa.live.ui", { context: etat });
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
    s.pendingAudio.length = 0; s.queuedRequests = 0;
    if (s.capture) { s.capture.port.onmessage = null; s.capture.port.close(); s.capture.disconnect(); }
    s.input?.disconnect(); s.mute?.disconnect(); stopPlayback(s);
    for (const track of s.prise?.flux.getTracks() ?? []) track.removeEventListener("ended", s.microphoneEnded);
    s.prise?.rendre(); void s.reader?.cancel().catch(() => {}); void s.context.close().catch(() => {});
    if (s.id) void db().invokeFunction("jarvis-live", { action: "stop", sessionId: s.id }, AbortSignal.timeout(4_000)).catch(() => {});
  }
  state("desactive"); diagnosticUi("alexa.live.cleanup");
}
function fail(s: Session, code: string, message: string = alexaLive.indisponible) {
  if (current !== s) return;
  diagnosticUi("alexa.live.failure", { code, count: s.queuedRequests, context: s.context.state });
  arreterLive(); state("erreur", message);
}
function watchdog(s: Session, ms: number) {
  clearTimeout(s.timer); s.timer = setTimeout(() => fail(s, "deadline"), ms);
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
    if (current === s && s.sources.size === 0) {
      if (s.turnFinished) state("ecoute", alexaLive.ecoute);
      else { state("traitement", alexaLive.reflexion); watchdog(s, 30_000); }
    }
  };
  source.start(start); clearTimeout(s.timer);
  state("parole", alexaLive.parole); diagnosticUi("alexa.live.audioDecodedAndScheduled", { count: bytes.length });
}
function synchronizeContext(s: Session) {
  if (!s.id) return;
  const revision = s.contextRevision, patientId = s.patientId;
  s.sends = s.sends.then(async () => {
    if (current !== s || revision !== s.contextRevision) return;
    const r = await db().invokeFunction("jarvis-live", { action: "context", sessionId: s.id, currentPatientId: patientId },
      AbortSignal.any([s.control.signal, AbortSignal.timeout(4_000)]));
    if (!r.ok) { fail(s, "context-request"); return; }
    if (current === s && revision === s.contextRevision) {
      s.announcedPatientId = patientId; s.capturePaused = false;
      clearTimeout(s.timer); state("ecoute", alexaLive.ecoute);
    }
  }).catch(() => fail(s, "context-transport"));
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
          case "ready":
            s.id = event.sessionId; clearTimeout(s.timer);
            // Do not queue microphone audio while the provider is connecting.
            if (s.input && s.capture) s.input.connect(s.capture);
            if (s.patientId !== s.announcedPatientId) synchronizeContext(s);
            else state("ecoute", alexaLive.ecoute);
            break;
          case "thinking": if (!s.capturePaused && s.sources.size === 0) { state("traitement", alexaLive.reflexion); watchdog(s, 30_000); } break;
          case "audio": if (!s.capturePaused) play(s, event.data); break;
          case "turn_complete": s.turnFinished = true; clearTimeout(s.timer); if (s.sources.size === 0) state("ecoute", alexaLive.ecoute); break;
          case "interrupted": stopPlayback(s); clearTimeout(s.timer); state("ecoute", alexaLive.ecoute); break;
          case "error": fail(s, "provider-event"); return;
          case "closed": arreterLive(); return;
        }
      }
    }
    // An error envelope, abrupt network close or truncated event is a visible failure.
    if (current === s) fail(s, "stream-ended");
  } catch { fail(s, "stream-protocol"); }
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
  const initialPatientId = patientActifCourant()?.id ?? null;
  const s: Session = { control: new AbortController(), context, prise: null, input: null, capture: null,
    mute: null, id: null, reader: null, unsubscribe: () => {}, timer: undefined, sources: new Set(),
    playAt: 0, queuedRequests: 0, pendingAudio: [], audioScheduled: false,
    sends: Promise.resolve(), turnFinished: false, patientId: initialPatientId,
    announcedPatientId: initialPatientId, contextRevision: 0, capturePaused: false, microphoneEnded: () => {} };
  current = s; state("reveille", alexaLive.connexion); watchdog(s, 30_000);
  s.unsubscribe = abonnerPatientActif((patient) => {
    const id = patient?.id ?? null; if (id === s.patientId) return;
    s.patientId = id; s.contextRevision++; s.capturePaused = true;
    s.pendingAudio.length = 0; s.queuedRequests = 0;
    stopPlayback(s); state("reveille", alexaLive.connexion); watchdog(s, 30_000);
    synchronizeContext(s);
  });
  diagnosticUi("alexa.live.activation");
  try {
    await resumed;
    const access = await prendreMicro();
    if (!access.ok) { fail(s, "microphone-permission", alexaLive.micro); return; }
    if (current !== s) { access.data.rendre(); return; }
    s.prise = access.data; diagnosticUi("alexa.live.microphoneGranted");
    s.microphoneEnded = () => fail(s, "microphone-ended", alexaLive.micro);
    for (const track of s.prise.flux.getTracks()) track.addEventListener("ended", s.microphoneEnded);
    await context.audioWorklet.addModule("/audio/alexa-live-capture.js");
    if (current !== s) return;
    s.input = context.createMediaStreamSource(s.prise.flux); s.capture = new AudioWorkletNode(context, "alexa-live-capture");
    s.mute = context.createGain(); s.mute.gain.value = 0;
    s.capture.connect(s.mute); s.mute.connect(context.destination);
    let observedCapture = false, observedSignal = false, observedSent = false;
    // Coalesce frames accumulated during an authenticated request. Four frames
    // remain below the existing 48 kB base64 limit; PCM order is unchanged.
    const drainAudio = () => {
      if (s.audioScheduled || s.capturePaused || current !== s || !s.pendingAudio.length) return;
      s.audioScheduled = true;
      const revision = s.contextRevision;
      s.sends = s.sends.then(async () => {
        while (current === s && revision === s.contextRevision && !s.capturePaused && s.pendingAudio.length) {
          const frames = s.pendingAudio.splice(0, 4);
          s.queuedRequests = s.pendingAudio.length;
          const pcm = new Uint8Array(frames.reduce((size, frame) => size + frame.length, 0));
          let offset = 0;
          for (const frame of frames) { pcm.set(frame, offset); offset += frame.length; }
          const started = performance.now();
          const result = await db().invokeFunction("jarvis-live", { action: "audio", sessionId: s.id, pcmBase64: encode(pcm) },
            AbortSignal.any([s.control.signal, AbortSignal.timeout(4_000)]));
          if (!result.ok) { fail(s, "audio-request"); return; }
          if (!observedSent) {
            observedSent = true;
            diagnosticUi("alexa.live.audioAcknowledged", { count: s.queuedRequests, durationMs: Math.round(performance.now() - started) });
          }
        }
      }).catch(() => fail(s, "audio-transport")).finally(() => { s.audioScheduled = false; drainAudio(); });
    };
    s.capture.port.onmessage = (message: MessageEvent<unknown>) => {
      if (current !== s || !s.id || s.capturePaused || !(message.data instanceof Float32Array)) return;
      try {
        const samples = message.data;
        level = Math.min(1, Math.sqrt(samples.reduce((sum, n) => sum + n * n, 0) / samples.length) * 8);
        if (!observedCapture || (!observedSignal && level > 0.005)) {
          observedCapture = true; observedSignal ||= level > 0.005;
          diagnosticUi("alexa.live.microphoneFrame", { count: samples.length, context: observedSignal ? "signal" : "silence" });
        }
        // Four seconds also accommodates a brief main-thread delivery burst.
        if (s.pendingAudio.length >= 16) { fail(s, "input-backlog"); return; }
        s.pendingAudio.push(encoderPCM16([samples], context.sampleRate));
        s.queuedRequests = s.pendingAudio.length; drainAudio();
      } catch { fail(s, "capture-encoding"); }
    };
    diagnosticUi("alexa.live.captureReady");
    const result = await db().invokeFunctionStream("jarvis-live", { action: "start", currentPatientId: initialPatientId }, s.control.signal);
    if (current !== s) { if (result.ok) await result.data.cancel(); return; }
    if (!result.ok) { fail(s, "start-request"); return; }
    void consume(s, result.data);
  } catch { fail(s, "activation"); }
}
export function basculerLive(): void { if (current) arreterLive(); else void demarrerLive(); }
