import { createHash } from "node:crypto";
import { z } from "zod";
import type { ClinicalContext, ClinicalConsultation } from "@/shared/alexa/clinical";
import { inferLocalText } from "./local-model";
import { consultationExcerpts } from "./note-excerpts";
import { narrativeCopy as copy } from "@/i18n/alexa-narrative";

export const NARRATIVE_VERSION = "alexa-narrative-fr-v1";
export const NARRATIVE_HASH = createHash("sha256").update(NARRATIVE_VERSION + copy.prompt).digest("hex");
export interface NarrativeSource { id: string; text: string; at?: string; state?: "open" | "closed" }
export interface ClinicalNarrative { text: string; complete: boolean; generated: boolean; sourceIds: string[] }
const answerSchema = z.object({ sentences: z.array(z.object({ text: z.string().trim().min(10).max(500), evidence: z.array(z.object({ id: z.string().min(1).max(80), quote: z.string().trim().min(10).max(600) }).strict()).min(1).max(6) }).strict()).min(1).max(4) }).strict();
const fold = (value: string) => value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/gu, " ").trim();
const unsafe = /ignore.{0,40}(?:instruction|consigne)|(?:system|assistant|developer)\s*:|(?:execute|appelle).{0,30}(?:outil|tool)|<\/?[a-z][^>]*>|\/api\//iu;
const negative = /\b(?:pas|sans|aucun|aucune|nie|absence|jamais|ni)\b/u;
const numbers = (text: string): string[] => fold(text).match(/\d+(?:[.,]\d+)?(?:\s*(?:mg|mcg|g|ml|%))?/gu) ?? [];

/** Source fingerprint includes all five areas and corrections, never an AI output. */
export function consultationNotesSnapshot(c: ClinicalConsultation) {
  return { rawNotes: c.rawNotes ?? null, notes: [...c.notes].sort((a,b)=>a.id.localeCompare(b.id)).map(n => ({ id: n.id, status: n.status ?? null, subjective: n.subjective, objective: n.objective, assessment: n.assessment, plan: n.plan, amendments: [...n.amendments].sort((a,b)=>a.id.localeCompare(b.id)).map(a=>({id:a.id,body:a.body,reason:a.reason})) })) };
}
export function consultationNotesDigest(c: ClinicalConsultation): string {
  return createHash("sha256").update(JSON.stringify(consultationNotesSnapshot(c))).digest("hex");
}
export function relativeClinicalDate(date: string, asOf: string): string {
  const day = (s: string) => Date.parse(new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Algiers", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(s)));
  const days = Math.round((day(date) - day(asOf)) / 86400000);
  if (!Number.isFinite(days)) throw Error("InvalidClinicalDate");
  return new Intl.RelativeTimeFormat("fr", { numeric: "auto" }).format(days, "day");
}
export function consultationNarrativeSources(c: ClinicalConsultation): { sources: NarrativeSource[]; complete: boolean } {
  const selected = consultationExcerpts(c, undefined, 30000, 100, 12000);
  return { sources: selected.excerpts.map((e, i) => ({ id: `${c.id}:${i}`, at: c.startedAt, state: c.endedAt === null ? "open" : "closed", text: `${e.amendmentAt ? copy.correction : ""}${e.unsigned ? copy.unsigned : ""}${e.area ? copyArea[e.area] + " : " : ""}${e.text}` })), complete: !selected.omitted };
}
const copyArea = copy.noteAreas;

/** Fail closed on unsupported amounts, polarity reversal, invented citations or instructions. */
export function validateClinicalNarrative(value: unknown, sources: readonly NarrativeSource[]): string | null {
  const parsed = answerSchema.safeParse(value);
  if (!parsed.success) return null;
  for (const sentence of parsed.data.sentences) {
    const quotes: string[] = [];
    if (unsafe.test(sentence.text) || /\n|^\s*[-*\d]|\b(?:SOAP|subjectif\s*:|objectif\s*:|évaluation\s*:|plan\s*:)/iu.test(sentence.text)) return null;
    for (const citation of sentence.evidence) {
      const source = sources.find(s => s.id === citation.id);
      if (!source || unsafe.test(citation.quote) || !fold(source.text).includes(fold(citation.quote))) return null;
      quotes.push(citation.quote);
    }
    const proof = fold(quotes.join(" ")), text = fold(sentence.text);
    const supported = numbers(proof); let position = 0;
    for (const quantity of numbers(text)) { const index = supported.indexOf(quantity, position); if (index < 0) return null; position = index + 1; }
    // A negative must stay attached to its exact clinical clause.
    if ((negative.test(proof) || negative.test(text)) && !proof.includes(text)) return null;
    if (/\b(?:hypothese|possible|suspect|a explorer|a confirmer)\b/u.test(proof) && !/\b(?:hypothese|possible|suspect|explor|confirmer)\w*\b/u.test(text)) return null;
    const words = text.match(/[\p{L}]{5,}/gu) ?? [];
    if (!words.length || words.filter(w => proof.includes(w)).length / words.length < 0.5) return null;
    if (/\b(?:je|j’ai|j'ai|nous avons)\b/u.test(text) || /\b(?:doit prendre|il faut prescrire|je recommande)\b/u.test(text)) return null;
  }
  const text = parsed.data.sentences.map(s => s.text.trim()).join(" ");
  return text.length <= 1100 && text.split(/\s+/u).length <= 150 ? text : null;
}

export async function synthesizeClinicalNarrative(sources: readonly NarrativeSource[], signal: AbortSignal): Promise<ClinicalNarrative> {
  const available = sources.filter(s => s.text.trim() && !unsafe.test(s.text));
  const safe = available.slice(0, 60);
  // Share the context across sources; retain the end carrying the recorded plan.
  const allowance = Math.max(80, Math.floor(6500 / Math.max(safe.length, 1)));
  const projected = safe.map(s => ({ ...s, text: s.text.length > allowance ? s.text.slice(-allowance) : s.text }));
  const complete = safe.length === sources.length && safe.every((s, i) => s.text === projected[i]?.text);
  if (!projected.length) return { text: copy.empty, complete, generated: false, sourceIds: [] };
  try {
    const raw = await inferLocalText([{ role: "system", content: copy.prompt }, { role: "user", content: JSON.stringify({ sources: projected }) }], { jsonSchema: z.toJSONSchema(answerSchema), maxOutputTokens: 1024, timeoutMs: 170000, signal });
    signal.throwIfAborted();
    const text = validateClinicalNarrative(JSON.parse(raw), projected);
    if (text) return { text, complete, generated: true, sourceIds: projected.map(s => s.id) };
  } catch { signal.throwIfAborted(); }
  // No fabricated prose if the small local model cannot support its own claims.
  const excerpts = projected.slice(0, 4).map(s => `« ${s.text.slice(0, 200)} »`);
  return { text: `${copy.unavailable} ${excerpts.join(" ")}`, complete: false, generated: false, sourceIds: projected.slice(0, 4).map(s => s.id) };
}

/** Fresh session summaries first; original notes remain the fallback for old/unanalysed visits. */
export async function summarizeClinicalContext(context: ClinicalContext, signal: AbortSignal, wholeRecord = false): Promise<ClinicalNarrative> {
  let complete = context.coverage.complete && (!wholeRecord || !context.coverage.hasMore);
  const sources: NarrativeSource[] = [];
  for (const c of [...context.consultations, ...(context.currentConsultation ? [context.currentConsultation] : [])]) {
    const saved = z.object({ resume: z.string().min(1).max(1500), notesDigest: z.string(), complete: z.literal(true), generated: z.literal(true) }).safeParse(c.analysis?.content);
    if (saved.success && saved.data.notesDigest === consultationNotesDigest(c)) sources.push({ id: c.id, text: saved.data.resume, at: c.startedAt, state: c.endedAt === null ? "open" : "closed" });
    else { const raw = consultationNarrativeSources(c); sources.push(...raw.sources); complete &&= raw.complete; }
  }
  for (const d of context.diagnoses) sources.push({ id: d.id, text: JSON.stringify({ diagnosticDocumente: d.label, resolu: d.resolvedAt !== null }) });
  for (const t of context.treatments.current) sources.push({ id: t.id, text: JSON.stringify({ traitement: t.medication, dose: t.dose, unite: t.doseUnit, frequence: t.frequency, etat: t.status, instructions: t.instructions }) });
  for (const h of context.treatments.history) sources.push({ id: h.id, text: JSON.stringify({ changementEnregistre: h.occurredAt, avant: h.previous, apres: h.next, motif: h.reason }) });
  const result = await synthesizeClinicalNarrative(sources, signal);
  return { ...result, complete: complete && result.complete };
}
