import { createHash } from "node:crypto";
import { z } from "zod";
import type { ClinicalContext, ClinicalConsultation } from "@/shared/alexa/clinical";
import { inferLocalText } from "./local-model";
import { localModelFailureCode } from "./local-model-protocol";
import { consultationExcerpts } from "./note-excerpts";
import { narrativeCopy as copy } from "@/i18n/alexa-narrative";

export const NARRATIVE_VERSION = "alexa-narrative-fr-v5";
export const NARRATIVE_HASH = createHash("sha256").update(NARRATIVE_VERSION + copy.prompt + copy.multiVisitPrompt + copy.multiVisitRetryPrompt).digest("hex");
export interface NarrativeSource { id: string; text: string; at?: string; state?: "open" | "closed"; consultationId?: string; originalText?: string; attribution?: "unsigned" | "correction" | "plan" }
export interface ClinicalNarrative { text: string; complete: boolean; generated: boolean; sourceIds: string[]; method?: "reformulated" | "source_selection" | "structured" }
const answerSchema = z.object({ sentences: z.array(z.object({ text: z.string().trim().min(10).max(500), evidence: z.array(z.object({ id: z.string().min(1).max(80), quote: z.string().trim().min(10).max(600) }).strict()).min(1).max(20) }).strict()).min(1).max(4) }).strict();
function multiVisitAnswerSchemaFor(aliases: readonly string[]) {
  const citation = (id:string) => z.object({ id:z.literal(id), quote:z.string().trim().min(10).max(64) }).strict();
  const citations=aliases.map(citation);
  if(!citations.length)throw new Error("NarrativeVisitScope");
  const requiredCitations=z.tuple([citations[0]!,...citations.slice(1)] as [typeof citations[number],...typeof citations[number][]]);
  return z.object({ sentences: z.array(z.object({ text: z.string().trim().min(10).max(400), evidence: requiredCitations }).strict()).length(1) }).strict();
}
const fold = (value: string) => value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/gu, " ").trim();
const quoteFold = (value:string)=>fold(value).replace(/[’‘`]/gu,"'").replace(/[\p{P}\p{S}]/gu," ").replace(/\s+/gu," ").trim();
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
  return { sources: selected.excerpts.map((e, i) => ({ id: `${c.id}:${i}`, consultationId:c.id, originalText: e.text, ...(e.amendmentAt ? {attribution: "correction" as const} : e.unsigned ? {attribution: "unsigned" as const} : e.area === "plan" ? {attribution: "plan" as const} : {}), at: c.startedAt, state: c.endedAt === null ? "open" : "closed", text: `${e.amendmentAt ? copy.correction : ""}${e.unsigned ? copy.unsigned : ""}${e.area ? copyArea[e.area] + " : " : ""}${e.text}` })), complete: !selected.omitted };
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
function checkClinicalNarrative(value: unknown, sources: readonly NarrativeSource[]): {text:string|null;rejection?:string} {
  const parsed = answerSchema.safeParse(value);
  if (!parsed.success) return {text:null,rejection:"schema"};
  for (const sentence of parsed.data.sentences) {
    const quotes: string[] = [];
    if (unsafe.test(sentence.text) || /\n|^\s*[-*\d]|\b(?:SOAP|subjectif\s*:|objectif\s*:|évaluation\s*:|plan\s*:)/iu.test(sentence.text)) return {text:null,rejection:"format"};
    for (const citation of sentence.evidence) {
      const source = sources.find(s => s.id === citation.id);
      if (!source) return {text:null,rejection:"citation-id"};
      if (unsafe.test(citation.quote) || !quoteFold(source.text).includes(quoteFold(citation.quote))) return {text:null,rejection:"citation-quote"};
      // Preserve qualifiers attached to the cited excerpt, while allowing a
      // positive fact to be summarized when another note clause is negative.
      const field = fold(citation.quote), sentenceText = fold(sentence.text);
      const qualified = negative.test(field) || /\b(?:hypothese|possible|suspect|a explorer|a confirmer|prevu|propose|envisage|programme)\b/u.test(field);
      if (qualified && !sentenceText.includes(field)) return {text:null,rejection:"qualifier"};
      // A negative finding can change meaning when its note assigns it to
      // someone other than the patient or says the patient was not assessed.
      const sourceContext = fold(source.originalText ?? source.text);
      const attribution = sourceContext.match(/\b(?:cela|ceci|cette information|cette idee|ce fait)\s+(?:concerne|se rapporte a|est attribue a)\s+[^.!?;]*/u)
        ?? sourceContext.match(/\b(?:le|la) patient(?:e)?\s+n['’]a\s+pas\s+ete\s+interroge[^.!?;]*/u);
      if (qualified && attribution && !sentenceText.includes(attribution[0])) return {text:null,rejection:"attribution"};
      quotes.push(citation.quote);
    }
    const proof = fold(quotes.join(" ")), text = fold(sentence.text);
    const supported = numbers(proof); let position = 0;
    for (const quantity of numbers(text)) { const index = supported.indexOf(quantity, position); if (index < 0) return {text:null,rejection:"number"}; position = index + 1; }
    // A negative must stay attached to its exact clinical clause.
    if ((negative.test(proof) || negative.test(text)) && !proof.includes(text)) return {text:null,rejection:"polarity"};
    if (/\b(?:hypothese|possible|suspect|a explorer|a confirmer)\b/u.test(proof) && !/\b(?:hypothese|possible|suspect|explor|confirmer)\w*\b/u.test(text)) return {text:null,rejection:"uncertainty"};
    const words = text.match(/[\p{L}]{5,}/gu) ?? [];
    const narrativeGlue = new Set(["patient","patiente","patients","patientes","note","notes","consultation","consultations","seance","seances","dossier","theme","themes","motif","motifs","suivi","historique","resume","synthese","evolution","cours","paragraphe","revient","reviennent","mentionne","mentionnent","indique","indiquent","rapporte","rapportent","decrit","decrivent","consigne","consignent","contient","contiennent","presente","presentent","montre","montrent","relate","relatent","evoque","evoquent","concerne","concernent","porte","portent","autour","recurrent","recurrents","disponible","disponibles","ensemble","element","elements","plusieurs","chaque","selon","affirme","affirment","retrouve","retrouvent","parle","parlent","constate","constatent","rapport","rapports","mention","mentions"]);
    const contentWords=words.filter(word=>!narrativeGlue.has(word));
    if (!contentWords.length || contentWords.some(word=>!proof.includes(word))) return {text:null,rejection:"grounding"};
    if (/\b(?:je|j’ai|j'ai|nous avons)\b/u.test(text) || /\b(?:doit prendre|il faut prescrire|je recommande)\b/u.test(text)) return {text:null,rejection:"prescription"};
  }
  const text = parsed.data.sentences.map(s => s.text.trim()).join(" ");
  return text.length <= 1100 && text.split(/\s+/u).length <= 150 ? {text} : {text:null,rejection:"length"};
}
export function validateClinicalNarrative(value: unknown, sources: readonly NarrativeSource[]): string | null {
 return checkClinicalNarrative(value,sources).text;
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

function groupSourcesByConsultation(sources: readonly NarrativeSource[]): NarrativeSource[] {
  const groups = new Map<string, NarrativeSource[]>();
  for (const source of sources) {
    const key = source.consultationId ? `visit:${source.consultationId}` : `source:${source.id}`;
    const group = groups.get(key) ?? [];
    group.push(source);
    groups.set(key, group);
  }
  return [...groups.values()].map(group => {
    const first = group[0]!;
    const consultationId = first.consultationId;
    return {
      id: consultationId ?? first.id,
      text: group.map(source => source.text).join("\n"),
      originalText: group.map(source => source.originalText ?? source.text).join("\n"),
      ...(first.at ? { at: first.at } : {}),
      ...(group.some(source => source.state === "open") ? { state: "open" as const } : first.state ? { state: first.state } : {}),
      ...(consultationId ? { consultationId } : {}),
    };
  });
}

export async function synthesizeClinicalNarrative(sources: readonly NarrativeSource[], signal: AbortSignal): Promise<ClinicalNarrative> {
  const available = sources.filter(s => s.text.trim() && !unsafe.test(s.text));
  const projected: NarrativeSource[] = []; let characters = 0;
  for (const source of available) {
    // Never remove a qualifier at either end of a recorded field.
    if (projected.length >= 40 || characters + source.text.length > 5500) continue;
    projected.push(source); characters += source.text.length;
  }
  let complete = projected.length === sources.length;
  if (!projected.length) return { text: sources.length ? copy.unavailable : copy.empty, complete: sources.length === 0, generated: false, sourceIds: [] };
  const boundedSignal = AbortSignal.any([signal, AbortSignal.timeout(170000)]);
  let multiVisitRetries=0;
  // Context rejection happens before generation. Fit whole fields within the same deadline.
  while (projected.length) try {
    const visitIds=new Set(projected.flatMap(source=>source.consultationId?[source.consultationId]:[]));
    const multiVisit=visitIds.size>1;
    const validationSources=multiVisit?groupSourcesByConsultation(projected):projected;
    const sourceAliases=new Map(validationSources.map((source,index)=>[`s${index+1}`,source.id]));
    const responseSchema=multiVisit?multiVisitAnswerSchemaFor([...sourceAliases.keys()]):answerSchema;
    const systemPrompt=multiVisit?(multiVisitRetries?copy.multiVisitRetryPrompt:copy.multiVisitPrompt):copy.prompt;
    const maxOutputTokens=multiVisit?Math.min(340,160+visitIds.size*16):384;
    const visitAliases=new Map([...new Set(validationSources.flatMap(source=>source.consultationId?[source.consultationId]:[]))].map((id,index)=>[id,`v${index+1}`]));
    const modelSources=validationSources.map(({originalText:_original,attribution:_attribution,consultationId,...source},index)=>({
      ...source,id:`s${index+1}`,...(consultationId?{visit:visitAliases.get(consultationId)}:{}),
    }));
    const raw = await inferLocalText([{ role: "system", content: systemPrompt }, { role: "user", content: JSON.stringify({ sources: modelSources }) }], { jsonSchema: z.toJSONSchema(responseSchema), maxOutputTokens, timeoutMs: 170000, signal: boundedSignal });
    boundedSignal.throwIfAborted();
    const modelValue: unknown = JSON.parse(raw),parsedModel=responseSchema.safeParse(modelValue);
    if(!parsedModel.success){
      if(multiVisit&&multiVisitRetries<1){multiVisitRetries++;continue;}
      if(multiVisit){console.warn("[alexa-narrative] rejected","schema");break;}
    }
    const parsedAnswer=answerSchema.safeParse(modelValue);
    const value: unknown=parsedAnswer.success?{...parsedAnswer.data,sentences:parsedAnswer.data.sentences.map(sentence=>({...sentence,evidence:sentence.evidence.map(citation=>({...citation,id:sourceAliases.get(citation.id)??citation.id}))}))}:modelValue;
    const validation = checkClinicalNarrative(value, validationSources), text = validation.text;
    const parsed = answerSchema.safeParse(value);
    const cited = parsed.success ? [...new Set(parsed.data.sentences.flatMap(s => s.evidence.map(e => e.id)))] : [];
    const visits=new Set(projected.flatMap(source=>source.consultationId?[source.consultationId]:[]));
    const covered=visits.size>1
      ?[...visits].every(consultationId=>cited.includes(consultationId))
      :cited.length===validationSources.length&&validationSources.every(source=>cited.includes(source.id));
    if (text && covered) return { text, complete, generated: true, sourceIds: cited, method: "reformulated" };
    if (multiVisit) {
      if(multiVisitRetries<1){multiVisitRetries++;continue;}
      if(text)return { text, complete: false, generated: true, sourceIds: cited, method: "reformulated" };
      console.warn("[alexa-narrative] rejected", validation.rejection??(!parsed.success?"schema":"visit-coverage"));
      break;
    }
    const all = recoverClinicalSelection(value, projected, true);
    if (all) return { ...all, complete, generated: true, method: "source_selection" };
    if (text) return { text, complete: false, generated: true, sourceIds: cited, method: "reformulated" };
    const selected = recoverClinicalSelection(value, projected);
    if (selected) return { ...selected, complete: complete && selected.sourceIds.length === projected.length, generated: true, method: "source_selection" };
    console.warn("[alexa-narrative] rejected", validation.rejection??(!parsed.success?"schema":"recovery"));
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

/** Fast, evidence-only answer when separate visits explicitly label the same recurring theme. */
export function extractRecurringClinicalTheme(context: ClinicalContext): ClinicalNarrative | null {
  const visits = [...(context.currentConsultation ? [context.currentConsultation] : []), ...context.consultations]
    .filter((visit, index, all) => all.findIndex(other => other.id === visit.id) === index);
  const recurringLabel = /\b(?:th[èe]me|motif|[ée]l[ée]ment)\s+r[ée]currente?\s*[:–—-]?\s*[«“"]([^»”"]{3,100})[»”"]/giu;
  const groups = new Map<string, { value: string; visits: Set<string>; sourceIds: Set<string> }>();
  let complete = context.coverage.complete && !context.coverage.hasMore;
  for (const visit of visits) {
    const selected = consultationNarrativeSources(visit);
    complete &&= selected.complete;
    for (const source of selected.sources) {
      const sourceText = source.originalText ?? source.text;
      for (const match of sourceText.matchAll(recurringLabel)) {
        const value = match[1]?.trim().replace(/\s+/gu, " ");
        if (!value || unsafe.test(value)) continue;
        const key = fold(value);
        const group = groups.get(key) ?? { value, visits: new Set<string>(), sourceIds: new Set<string>() };
        if (!group.visits.has(visit.id)) {
          group.visits.add(visit.id);
          group.sourceIds.add(source.id);
        }
        groups.set(key, group);
      }
    }
  }
  const ranked = [...groups.values()].sort((a, b) => b.visits.size - a.visits.size);
  if (!ranked[0] || ranked[0].visits.size < 2 || ranked[0].visits.size === ranked[1]?.visits.size) return null;
  return {
    text: copy.recurringTheme(ranked[0].value),
    complete,
    generated: true,
    sourceIds: [...ranked[0].sourceIds],
    method: "structured",
  };
}

/** Summarizes a bounded history only when every visit explicitly records the same theme and a progress step. */
export function extractStructuredClinicalProgression(context:ClinicalContext):ClinicalNarrative|null{
 const visits=[...context.consultations].filter((visit,index,all)=>all.findIndex(other=>other.id===visit.id)===index).sort((a,b)=>Date.parse(a.startedAt)-Date.parse(b.startedAt)||a.id.localeCompare(b.id));
 if(visits.length<2||!context.coverage.complete||context.coverage.hasMore)return null;
 const themePattern=/\bth[èe]me\s+r[ée]current(?:e)?\s*[:–—-]?\s*[«“"]([^»”"]{3,100})[»”"]/giu;
 const stepPattern=/(?:^|[^\p{L}\p{N}_])[ée]tape\s+observ[ée]e\s*[:–—-]\s*([^.;\n]{3,160})/giu;
 const sourceIds=new Set<string>(),stages:string[]=[];let theme:string|undefined;
 for(const visit of visits){
  const selected=consultationNarrativeSources(visit);if(!selected.complete)return null;
  const visitThemes=new Set<string>(),visitSteps=new Set<string>(),evidenceIds=new Set<string>();
  for(const source of selected.sources){
   const sourceText=source.originalText??source.text;if(unsafe.test(sourceText))continue;
   for(const match of sourceText.matchAll(themePattern)){const value=match[1]?.trim().replace(/\s+/gu," ");if(value&&!unsafe.test(value)){visitThemes.add(value);evidenceIds.add(source.id);}}
   for(const match of sourceText.matchAll(stepPattern)){const value=match[1]?.trim().replace(/\s+/gu," ");if(value&&!unsafe.test(value)){visitSteps.add(value);evidenceIds.add(source.id);}}
  }
  if(visitThemes.size!==1||visitSteps.size!==1)return null;
  const visitTheme=[...visitThemes][0]!;
  if(theme&&fold(theme)!==fold(visitTheme))return null;
  theme??=visitTheme;stages.push([...visitSteps][0]!);for(const id of evidenceIds)sourceIds.add(id);
 }
 if(!theme||sourceIds.size<visits.length)return null;
 return {text:copy.structuredProgression(theme,stages),complete:true,generated:true,sourceIds:[...sourceIds],method:"structured"};
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
      sources.push({ id: c.id, text: saved.data.resume, at: c.startedAt, state: c.endedAt === null ? "open" : "closed", consultationId:c.id });
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

/** Summarizes only consultations already selected by an authorized, bounded read. */
export async function summarizeClinicalConsultations(context:ClinicalContext,signal:AbortSignal):Promise<ClinicalNarrative>{
 const visits=[...context.consultations].filter((c,index,all)=>all.findIndex(other=>other.id===c.id)===index).sort((a,b)=>Date.parse(b.startedAt)-Date.parse(a.startedAt)||b.id.localeCompare(a.id));
 let complete=context.coverage.complete&&!context.coverage.hasMore;
 if(!visits.length)return {text:complete?"Aucune consultation terminée n’est enregistrée pendant cette période.":copy.limited,complete,generated:false,sourceIds:[]};
 const structured=extractStructuredClinicalProgression(context);if(structured)return {...structured,complete:complete&&structured.complete};
 const sources:NarrativeSource[]=[];
 for(const visit of visits){
  const saved=z.object({resume:z.string().min(1).max(1500),notesDigest:z.string(),complete:z.boolean(),generated:z.literal(true)}).safeParse(visit.analysis?.content);
  if(saved.success&&saved.data.notesDigest===consultationNotesDigest(visit)){sources.push({id:visit.id,text:saved.data.resume,at:visit.startedAt,state:visit.endedAt===null?"open":"closed",consultationId:visit.id});complete&&=saved.data.complete;}
  else{const raw=consultationNarrativeSources(visit);sources.push(...raw.sources);complete&&=raw.complete;}
 }
 const result=await synthesizeClinicalNarrative(sources,signal);
 return {...result,complete:complete&&result.complete};
}
