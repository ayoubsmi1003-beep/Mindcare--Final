import type { AlexaNavigation, AlexaSource } from "./turn";

export interface TrameVoix { readonly samples: Float32Array; readonly sampleRate: number }
export interface ResultatTourVoix { readonly texte: string; readonly sources?: readonly AlexaSource[]; readonly patientId?: string | null; readonly persiste?: boolean; readonly navigation?: AlexaNavigation; readonly speechLimited?: true }
export interface TourVoix extends Omit<ResultatTourVoix, "texte"> { readonly id: string; readonly texte: string; readonly reponse?: string; readonly error?: "capture" | "stt" | "turn" | "tts" | "interrompu" }
export type PhaseVoixLocale = "desactive" | "reveille" | "ecoute" | "traitement" | "parole" | "erreur";
export interface PortsVoixLocale {
  ouvrir: (recevoir: (frame: TrameVoix) => void) => Promise<() => void>;
  transcrire: (samples: Float32Array, rate: number, signal: AbortSignal) => Promise<string>;
  repondre: (text: string, signal: AbortSignal, sentence: (text: string) => void) => Promise<ResultatTourVoix>;
  lire: (text: string, signal: AbortSignal, playing: () => void) => Promise<void>;
  couper: () => void;
  phase: (state: PhaseVoixLocale, error?: "capture" | "stt" | "turn" | "tts") => void;
  tour: (turn: TourVoix) => void;
  navigate?: (target: AlexaNavigation) => void;
  speechLimitNotice?: (utterance: string) => string;
}
/** Local VAD decisions have no tool authority. Only finalized STT enters the server turn. */
export function creerBoucleVoixLocale(ports: PortsVoixLocale) {
  let active = false, generation = 0, close: (() => void) | null = null;
  let control: AbortController | null = null, idle: ReturnType<typeof setTimeout> | undefined;
  let pendingTurn: { id: string; texte: string } | null = null;
  let frames: Float32Array[] = [], lead: Float32Array[] = [];
  let rate = 0, spoken = 0, silence = 0, duration = 0, onset = 0, speaking = false;
  const clearFrames = () => { frames = []; lead = []; spoken = silence = duration = onset = 0; speaking = false; };
  const cut = () => {
    control?.abort(); control = null; ports.couper();
    if (pendingTurn) { const turn = pendingTurn; pendingTurn = null; ports.tour({ ...turn, error: "interrompu" }); }
  };
  const arreter = () => {
    active = false; generation++; clearTimeout(idle); cut(); close?.(); close = null;
    clearFrames(); rate = 0; ports.phase("desactive");
  };
  const fail = (kind: "capture" | "stt" | "turn" | "tts") => {
    if (pendingTurn) { const turn = pendingTurn; pendingTurn = null; ports.tour({ ...turn, error: kind }); }
    arreter(); ports.phase("erreur", kind);
  };
  const alive = (epoch: number, c: AbortController) => active && generation === epoch && control === c && !c.signal.aborted;
  const touch = () => { clearTimeout(idle); idle = setTimeout(arreter, 15 * 60_000); };
  const finish = async (samples: Float32Array, sampleRate: number) => {
    cut(); const c = new AbortController(); control = c;
    const epoch = generation, deadline = setTimeout(() => c.abort(), 90_000);
    let stage: "stt" | "turn" | "tts" = "stt";
    try {
      ports.phase("traitement");
      const texte = (await ports.transcrire(samples, sampleRate, c.signal)).trim();
      if (!alive(epoch, c)) return;
      if (!texte) { ports.phase("ecoute"); return; }
      touch(); const id = crypto.randomUUID(); pendingTurn = { id, texte }; ports.tour({ id, texte }); stage = "turn";
      let count = 0, chars = 0, audioError = false, speechLimited = false, queue = Promise.resolve();
      const enqueue = (text: string) => {
        if (!alive(epoch, c) || !text.trim()) return;
        // Text and source verification must continue when speech reaches its
        // own bound. Never fail the clinical turn because its TTS queue is full.
        if (speechLimited || count >= 32 || chars + text.length > 20_000 || text.length > 2_000) { speechLimited = true; return; }
        count++; chars += text.length;
        queue = queue.then(async () => {
          if (!alive(epoch, c) || audioError) return;
          try { await ports.lire(text, c.signal, () => { if (alive(epoch, c)) ports.phase("parole"); }); }
          catch { audioError = true; }
        });
      };
      const sentence = (text: string) => {
        // A decimal dot belongs to its dosage. Split only at a line break or
        // punctuation followed by whitespace and the next sentence's text.
        const segments = text.split(/\r?\n|(?<=[.!?؟。])\s+(?=[\p{L}«])/u);
        for (const segment of segments) enqueue(segment);
      };
      const result = await ports.repondre(texte, c.signal, sentence);
      if (!alive(epoch, c)) return;
      if (count === 0) sentence(result.texte);
      pendingTurn = null; ports.tour({ id, texte, reponse: result.texte,
        ...(result.sources !== undefined ? { sources: result.sources } : {}),
        ...(result.patientId !== undefined ? { patientId: result.patientId } : {}),
        ...(result.persiste !== undefined ? { persiste: result.persiste } : {}),
        ...(speechLimited ? { speechLimited: true } : {}),
      });
      stage = "tts"; await queue;
      if (alive(epoch, c) && !audioError && speechLimited && ports.speechLimitNotice) {
        try { await ports.lire(ports.speechLimitNotice(texte), c.signal, () => { if (alive(epoch, c)) ports.phase("parole"); }); }
        catch { audioError = true; }
      }
      if (alive(epoch, c)) {
        if (audioError) fail("tts");
        else { if (result.navigation) ports.navigate?.(result.navigation); if (alive(epoch, c)) ports.phase("ecoute"); }
      }
    } catch { if (alive(epoch, c)) fail(stage); }
    finally {
      clearTimeout(deadline);
      if (control === c) { control = null; if (active && c.signal.aborted) fail(stage); }
    }
  };
  const receive = (frame: TrameVoix) => {
    if (!active) return;
    const { samples, sampleRate } = frame;
    if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 96000 || !samples.length
      || samples.length > sampleRate / 10 || (rate !== 0 && rate !== sampleRate)) { fail("capture"); return; }
    rate = sampleRate; let power = 0;
    for (const sample of samples) { if (!Number.isFinite(sample)) { fail("capture"); return; } power += sample * sample; }
    const ms = samples.length * 1000 / sampleRate, voiced = Math.sqrt(power / samples.length) >= 0.02;
    if (!speaking) {
      lead.push(samples.slice()); if (lead.length > 10) lead.shift();
      onset = voiced ? onset + ms : 0;
      if (onset < 60) return;
      // Synchronous cancellation happens at speech onset, before transcription or network work.
      cut(); touch(); speaking = true; frames = lead; lead = []; spoken = onset;
      duration = frames.reduce((n, f) => n + f.length * 1000 / sampleRate, 0); silence = 0;
      ports.phase("ecoute"); return;
    }
    frames.push(samples.slice()); duration += ms; spoken += voiced ? ms : 0; silence = voiced ? 0 : silence + ms;
    if (duration > 20_000) { fail("capture"); return; }
    if (silence < 700) return;
    const accepted = spoken >= 240;
    const utterance = frames;
    clearFrames();
    if (!accepted) return;
    const merged = new Float32Array(utterance.reduce((n, f) => n + f.length, 0)); let offset = 0;
    for (const frame of utterance) { merged.set(frame, offset); offset += frame.length; }
    void finish(merged, sampleRate);
  };
  return {
    demarrer: async () => {
      if (active) return;
      active = true; const epoch = ++generation; ports.phase("reveille");
      try {
        const release = await ports.ouvrir(receive);
        if (!active || generation !== epoch) { release(); return; }
        close = release; touch(); ports.phase("ecoute");
      } catch { if (active && generation === epoch) fail("capture"); }
    },
    arreter, active: () => active,
  };
}
