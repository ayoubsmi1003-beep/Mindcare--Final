import { z } from "zod";
const Scope = { id: z.string().uuid(), sessionId: z.string().regex(/^[a-f0-9]{64}$/), runId: z.string().uuid(), utteranceId: z.string().uuid() };
const PCM = z.string().min(4).max(1_280_000).regex(/^[A-Za-z0-9+/]+={0,2}$/).refine((s) => {
 const b = Buffer.from(s, "base64"); return b.length > 0 && b.length <= 960_000 && b.length % 2 === 0 && b.toString("base64") === s;
});
const Entree = z.discriminatedUnion("action", [
 z.object({ ...Scope, action: z.literal("stt"), pcmBase64: PCM, sampleRate: z.literal(16000), langue: z.enum(["fr", "ar", "auto"]).optional() }).strict(),
 z.object({ ...Scope, action: z.literal("tts"), texte: z.string().min(1).max(2000), langue: z.enum(["fr", "ar"]),
   segments: z.array(z.object({ texte: z.string().min(1).max(2000), langue: z.enum(["fr", "ar"]) }).strict()).min(1).max(32).optional(),
 }).strict().refine((v) => v.segments === undefined || v.segments.map((s) => s.texte).join("") === v.texte),
]);
export type EntreeVoix = z.infer<typeof Entree>;
export function validerEntreeVoix(v: unknown): EntreeVoix | null { const r = Entree.safeParse(v); return r.success ? r.data : null; }
const Reponse = z.object({
 id: z.string().uuid(), runId: z.string().uuid(), utteranceId: z.string().uuid(), ok: z.boolean(),
 texte: z.string().max(8000).optional(), audioBase64: z.string().max(8_000_000).optional(),
 mimeType: z.literal("audio/wav").optional(), sampleRate: z.number().int().min(8000).max(48000).optional(),
 code: z.string().max(40).optional(), model: z.string().max(100).optional(), durationMs: z.number().min(0).optional(),
}).strict();
export type ReponseVoix = z.infer<typeof Reponse>;
/**
 * A single resident worker; no concurrent session audio or unbounded queue.
 * A caller abort never kills the worker: reloading Whisper/Kokoro costs 15-40 s,
 * and aborts are routine (barge-in, STOP, new utterance). The aborted request
 * stays an orphan until the worker answers (its result is dropped); at most one
 * next request waits for it. Only a timeout or a dead process destroys the worker.
 */
export class CanalVoixNative {
 private courante: { entree: EntreeVoix; orpheline: boolean; recevoir: (r: ReponseVoix) => void; rejeter: (e: Error) => void } | null = null;
 private attente: { liberer: () => void; rejeter: (e: Error) => void } | null = null;
 constructor(private readonly ecrire: (ligne: string) => void, private readonly detruire: () => void) {}
 recevoir(brut: unknown): void {
  const r = Reponse.safeParse(brut), c = this.courante;
  if (!r.success || c === null || r.data.id !== c.entree.id || r.data.runId !== c.entree.runId || r.data.utteranceId !== c.entree.utteranceId) return;
  if (!r.data.ok) { c.rejeter(new Error(r.data.code ?? "runtime")); return; }
  if (c.entree.action === "stt" && r.data.texte === undefined) { c.rejeter(new Error("format")); return; }
  if (c.entree.action === "tts" && (r.data.audioBase64 === undefined || r.data.mimeType === undefined)) { c.rejeter(new Error("format")); return; }
  c.recevoir(r.data);
 }
 echouer(): void {
  const a = this.attente; this.attente = null; a?.rejeter(new Error("runtime"));
  this.courante?.rejeter(new Error("runtime"));
 }
 private liberer(): void { this.courante = null; const a = this.attente; this.attente = null; a?.liberer(); }
 private attendreOrpheline(signal?: AbortSignal): Promise<void> {
  if (this.attente !== null) return Promise.reject(new Error("occupe"));
  return new Promise((resolve, reject) => {
   const annuler = () => { if (this.attente === moi) this.attente = null; reject(new Error("annulee")); };
   const moi = { liberer: () => { signal?.removeEventListener("abort", annuler); resolve(); }, rejeter: (e: Error) => { signal?.removeEventListener("abort", annuler); reject(e); } };
   this.attente = moi; signal?.addEventListener("abort", annuler, { once: true });
  });
 }
 async demander(brut: unknown, signal?: AbortSignal, timeoutMs = 90_000): Promise<ReponseVoix> {
  const entree = validerEntreeVoix(brut);
  if (entree === null) throw new Error("format");
  if (signal?.aborted) throw new Error("annulee");
  if (this.courante !== null && !this.courante.orpheline) throw new Error("occupe");
  if (this.courante !== null) await this.attendreOrpheline(signal);
  if (this.courante !== null) throw new Error("occupe");
  return new Promise((resolve, reject) => {
   let fini = false;
   const terminer = (valeur: ReponseVoix | Error) => {
    clearTimeout(minuteur); signal?.removeEventListener("abort", annuler); if (this.courante?.entree === entree) this.liberer();
    if (fini) return; fini = true;
    if (valeur instanceof Error) reject(valeur); else resolve(valeur);
   };
   const annuler = () => { if (this.courante?.entree === entree) this.courante.orpheline = true; if (!fini) { fini = true; reject(new Error("annulee")); } };
   const minuteur = setTimeout(() => { this.detruire(); terminer(new Error("timeout")); }, Math.min(300_000, timeoutMs));
   this.courante = { entree, orpheline: false, recevoir: (r) => terminer(r), rejeter: (e) => terminer(e) };
   signal?.addEventListener("abort", annuler, { once: true });
   try { this.ecrire(JSON.stringify(entree) + "\n"); } catch { this.detruire(); terminer(new Error("runtime")); }
  });
 }
}
