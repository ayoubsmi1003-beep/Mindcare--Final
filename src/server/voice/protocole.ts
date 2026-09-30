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
/** A single resident worker; no concurrent session audio or unbounded queue. */
export class CanalVoixNative {
 private courante: { entree: EntreeVoix; recevoir: (r: ReponseVoix) => void; rejeter: (e: Error) => void } | null = null;
 constructor(private readonly ecrire: (ligne: string) => void, private readonly detruire: () => void) {}
 recevoir(brut: unknown): void {
  const r = Reponse.safeParse(brut), c = this.courante;
  if (!r.success || c === null || r.data.id !== c.entree.id || r.data.runId !== c.entree.runId || r.data.utteranceId !== c.entree.utteranceId) return;
  if (!r.data.ok) { c.rejeter(new Error(r.data.code ?? "runtime")); return; }
  if (c.entree.action === "stt" && r.data.texte === undefined) { c.rejeter(new Error("format")); return; }
  if (c.entree.action === "tts" && (r.data.audioBase64 === undefined || r.data.mimeType === undefined)) { c.rejeter(new Error("format")); return; }
  c.recevoir(r.data);
 }
 echouer(): void { this.courante?.rejeter(new Error("runtime")); }
 demander(brut: unknown, signal?: AbortSignal, timeoutMs = 30000): Promise<ReponseVoix> {
  if (this.courante !== null) return Promise.reject(new Error("occupe"));
  const entree = validerEntreeVoix(brut);
  if (entree === null) return Promise.reject(new Error("format"));
  if (signal?.aborted) return Promise.reject(new Error("annulee"));
  return new Promise((resolve, reject) => {
   const terminer = (valeur: ReponseVoix | Error) => {
    clearTimeout(minuteur); signal?.removeEventListener("abort", annuler); this.courante = null;
    if (valeur instanceof Error) reject(valeur); else resolve(valeur);
   };
   const annuler = () => { this.detruire(); terminer(new Error("annulee")); };
   const minuteur = setTimeout(() => { this.detruire(); terminer(new Error("timeout")); }, Math.min(60000, timeoutMs));
   this.courante = { entree, recevoir: (r) => terminer(r), rejeter: (e) => terminer(e) };
   signal?.addEventListener("abort", annuler, { once: true });
   try { this.ecrire(JSON.stringify(entree) + "\n"); } catch { this.detruire(); terminer(new Error("runtime")); }
  });
 }
}
