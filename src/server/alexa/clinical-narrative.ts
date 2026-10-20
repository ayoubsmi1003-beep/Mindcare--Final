import { createHash } from "node:crypto";
import { z } from "zod";
import type { ClinicalContext, ClinicalConsultation } from "@/shared/alexa/clinical";
import { inferLocalText } from "./local-model";
import { localModelFailureCode } from "./local-model-protocol";
import { consultationExcerpts } from "./note-excerpts";
import { narrativeCopy as copy } from "@/i18n/alexa-narrative";

export const NARRATIVE_VERSION = "alexa-narrative-fr-v3";
export const NARRATIVE_HASH = createHash("sha256").update(NARRATIVE_VERSION + copy.prompt).digest("hex");
export interface NarrativeSource { id: string; text: string; at?: string; state?: "open" | "closed"; originalText?: string; attribution?: "unsigned" | "correction" | "plan" }
export interface ClinicalNarrative { text: string; complete: boolean; generated: boolean; sourceIds: string[]; method?: "reformulated" | "source_selection" }
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
  return { sources: selected.excerpts.map((e, i) => ({ id: `${c.id}:${i}`, originalText: e.text, ...(e.amendmentAt ? {attribution: "correction" as const} : e.unsigned ? {attribution: "unsigned" as const} : e.area === "plan" ? {attribution: "plan" as const} : {}), at: c.startedAt, state: c.endedAt === null ? "open" : "closed", text: `${e.amendmentAt ? copy.correction : ""}${e.unsigned ? copy.unsigned : ""}${e.area ? copyArea[e.area] + " : " : ""}${e.text}` })), complete: !selected.omitted };
}
const copyArea = copy.noteAreas;

/** Paragraph references describe its cited evidence, not every record read by the gate. */
export function clinicalNarrativeReferences(context: ClinicalContext, sourceIds: readonly string[]): {t:"consultation"|"diagnostic"|"treatment";id:string}[] {
  const references=new Map<string,{t:"consultation"|"diagnostic"|"treatment";id:string}>();
  for(const c of [...(context.currentConsultation?[context.currentConsultation]:[]),...context.consultations]){
    const reference={t:"consultation" as const,id:c.id};references.set(c.id,reference);
    for(const source of consultationNarrativeSources(c).sources)references.set(source.id,reference);
  }
  for(const d of context.diagnoses)references.set(d.id,{t:"diagnostic",id:d.id});
  for(const t of context.treatments.current)references.set(t.id,{t:"treatment",id:t.id});
  for(const h of context.treatments.history)references.set(h.id,{t:"treatment",id:h.treatmentId});
  const selected=new Map<string,{t:"consultation"|"diagnostic"|"treatment";id:string}>();
  for(const id of sourceIds){const reference=references.get(id);if(!reference)throw Error("InvalidNarrativeReference");selected.set(reference.t+":"+reference.id,reference);}
  return [...selected.values()];
}

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
      const field = fold(source.originalText ?? source.text);
      if ((negative.test(field) || /\b(?:hypothese|possible|suspect|a explorer|a confirmer|prevu|propose|envisage|programme)\b/u.test(field)) && !fold(sentence.text).includes(field)) return null;
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

/** The rejected prose is never displayed. Only whole, known source fields can be recovered. */
function recoverClinicalSelection(value: unknown, sources: readonly NarrativeSource[], includeAll = false): Pick<ClinicalNarrative, "text" | "sourceIds"> | null {
  const parsed = answerSchema.safeParse(value);
  if (!parsed.success) return null;
  const ids = new Set(parsed.data.sentences.flatMap(sentence => sentence.evidence.map(e => e.id)));
  if (!ids.size || ids.size > 6 || [...ids].some(id => !sources.some(s => s.id === id))) return null;
  const selected = sources.filter(s => includeAll || ids.has(s.id));
  const groups: {prefix: string | null; at: string | undefined; texts: string[]}[] = [];
  for (const source of selected) {
    const text = (source.originalText ?? source.text).replace(/\s+/gu, " ").trim();
    // Structured domain objects must not be presented as clinical prose.
    if (!text || unsafe.test(text) || /^[{[]/u.test(text)) return null;
    const prefix = source.attribution === "correction" ? copy.recordedCorrection
      : source.attribution === "unsigned" ? copy.recordedDraft
      : source.attribution === "plan" ? copy.recordedPlan
      : /^(?:je\b|j[’']|nous\b)/iu.test(text) ? copy.recordedAuthor : null;
    const sentence = /[.!?…]$/u.test(text) ? text : text + ".";
    const last = groups.at(-1);
    if (last && last.prefix === prefix && last.at === source.at) last.texts.push(sentence);
    else groups.push({prefix, at: source.at, texts: [sentence]});
  }
  const text = groups.map(group => group.prefix ? group.prefix + "« " + group.texts.join(" ") + " »" : group.texts.join(" ")).join(" ");
  return text.length <= 1100 && text.split(/\s+/u).length <= 150 ? {text,sourceIds:selected.map(s=>s.id)} : null;
}

export async function synthesizeClinicalNarrative(sources: readonly NarrativeSource[], signal: AbortSignal): Promise<ClinicalNarrative> {
  const available = sources.filter(s => s.text.trim() && !unsafe.test(s.text));
  const projected: NarrativeSource[] = []; let characters = 0;
  for (const source of available) {
    // Never remove a qualifier at either end of a recorded field.
    if (projected.length >= 20 || characters + source.text.length > 5500) continue;
    projected.push(source); characters += source.text.length;
  }
  let complete = projected.length === sources.length;
  if (!projected.length) return { text: sources.length ? copy.unavailable : copy.empty, complete: sources.length === 0, generated: false, sourceIds: [] };
  const boundedSignal = AbortSignal.any([signal, AbortSignal.timeout(170000)]);
  // Context rejection happens before generation. Fit whole fields within the same deadline.
  while (projected.length) try {
    const raw = await inferLocalText([{ role: "system", content: copy.prompt }, { role: "user", content: JSON.stringify({ sources: projected.map(({originalText: _original, attribution: _attribution, ...source}) => source) }) }], { jsonSchema: z.toJSONSchema(answerSchema), maxOutputTokens: 384, timeoutMs: 170000, signal: boundedSignal });
    boundedSignal.throwIfAborted();
    const value: unknown = JSON.parse(raw);
    const text = validateClinicalNarrative(value, projected);
    const parsed = answerSchema.safeParse(value);
    const cited = parsed.success ? [...new Set(parsed.data.sentences.flatMap(s => s.evidence.map(e => e.id)))] : [];
    const covered = cited.length === projected.length && projected.every(s => cited.includes(s.id));
    if (text && covered) return { text, complete, generated: true, sourceIds: cited, method: "reformulated" };
    const all = recoverClinicalSelection(value, projected, true);
    if (all) return { ...all, complete, generated: true, method: "source_selection" };
    if (text) return { text, complete: false, generated: true, sourceIds: cited, method: "reformulated" };
    const selected = recoverClinicalSelection(value, projected);
    if (selected) return { ...selected, complete: complete && selected.sourceIds.length === projected.length, generated: true, method: "source_selection" };
    break;
  } catch (error) {
    signal.throwIfAborted();
    if (!boundedSignal.aborted && error instanceof Error && error.message === "LocalModelContext") { projected.pop(); complete = false; continue; }
    console.warn("[alexa-narrative] failure", localModelFailureCode(error));
    break;
  }
  // No fabricated prose if the small local model cannot support its own claims.
  return { text: copy.unavailable, complete: false, generated: false, sourceIds: [] };
}

/** Fresh session summaries first; original notes remain the fallback for old/unanalysed visits. */
export async function summarizeClinicalContext(context: ClinicalContext, signal: AbortSignal, wholeRecord = true): Promise<ClinicalNarrative> {
  let complete = context.coverage.complete && (!wholeRecord || !context.coverage.hasMore);
  const sources: NarrativeSource[] = [];
  const visits=[...(context.currentConsultation ? [context.currentConsultation] : []), ...context.consultations]
    .filter((c,index,all)=>all.findIndex(other=>other.id===c.id)===index)
    .sort((a,b)=>Date.parse(b.startedAt)-Date.parse(a.startedAt)||b.id.localeCompare(a.id));
  for (const c of wholeRecord?visits:visits.slice(0,context.coverage.requested)) {
    const saved = z.object({ resume: z.string().min(1).max(1500), notesDigest: z.string(), complete: z.boolean(), generated: z.literal(true) }).safeParse(c.analysis?.content);
    if (saved.success && saved.data.notesDigest === consultationNotesDigest(c)) {
      sources.push({ id: c.id, text: saved.data.resume, at: c.startedAt, state: c.endedAt === null ? "open" : "closed" });
      complete &&= saved.data.complete;
    }
    else { const raw = consultationNarrativeSources(c); sources.push(...raw.sources); complete &&= raw.complete; }
  }
  for (const d of context.diagnoses) sources.push({ id: d.id, text: JSON.stringify({ diagnosticDocumente: d.label, resolu: d.resolvedAt !== null }) });
  for (const t of context.treatments.current) sources.push({ id: t.id, text: JSON.stringify({ traitement: t.medication, dose: t.dose, unite: t.doseUnit, frequence: t.frequency, etat: t.status, instructions: t.instructions }) });
  for (const h of context.treatments.history) sources.push({ id: h.id, text: JSON.stringify({ changementEnregistre: h.occurredAt, avant: h.previous, apres: h.next, motif: h.reason }) });
  const result = await synthesizeClinicalNarrative(sources, signal);
  return { ...result, complete: complete && result.complete };
}
