import { createHash } from "node:crypto";
import { z } from "zod";
import type { ClinicalContext, ClinicalConsultation } from "@/shared/alexa/clinical";
import {SESSION_NARRATIVE_VERSION} from '@/shared/alexa/clinical';
import { inferLocalText } from "./local-model";
import { localModelFailureCode } from "./local-model-protocol";
import { consultationExcerpts } from "./note-excerpts";
import { narrativeCopy as copy } from "@/i18n/alexa-narrative";
import { ALEXA_CONVERSATION_MODEL } from './model-policy';
import {dialogue} from '@/i18n/alexa-dialogue';
import {alexaRecordCopy} from '@/i18n/alexa-records';

export const NARRATIVE_VERSION = SESSION_NARRATIVE_VERSION;
export const NARRATIVE_HASH = createHash("sha256").update(ALEXA_CONVERSATION_MODEL + NARRATIVE_VERSION + copy.prompt + copy.sessionInstruction + copy.sessionRepairPrompt + copy.multiVisitPrompt + copy.multiVisitRetryPrompt).digest("hex");
export const CASE_NARRATIVE_VERSION='alexa-case-extractive-fr-v1';
export const CASE_NARRATIVE_HASH=createHash('sha256').update(ALEXA_CONVERSATION_MODEL+CASE_NARRATIVE_VERSION+copy.caseSelectionPrompt).digest('hex');
export interface NarrativeSource { id: string; text: string; at?: string; state?: "open" | "closed"; consultationId?: string; originalText?: string; attribution?: "unsigned" | "correction" | "plan"; scope?: "previous" | "current" | "change" }
export interface ClinicalNarrative { text: string; complete: boolean; generated: boolean; sourceIds: string[]; method?: "reformulated" | "extractive" | "source_selection" | "structured"; selectedSentences?: {id:string;quote:string}[] }
function requiredSessionSource(source:NarrativeSource):boolean {
  return source.scope==='change'&&!/:trend-\d+$/u.test(source.id)
    || source.scope==='current'&&(source.attribution==='plan'||source.text.includes(copy.noteAreas.plan+' : '));
}
function hasTreatmentComparison(sources:readonly NarrativeSource[]):boolean {
  return sources.some(source=>source.scope==='change'&&!/:trend-\d+$/u.test(source.id));
}
const answerSchema = z.object({ sentences: z.array(z.object({ text: z.string().trim().min(10).max(1100), evidence: z.array(z.object({ id: z.string().min(1).max(80), quote: z.string().trim().min(10).max(600) }).strict()).min(1).max(40) }).strict()).min(1).max(4) }).strict();
function repairVocabulary(quotes:ReadonlyMap<string,string>,sources:readonly NarrativeSource[],maxWords=70):string{
  const connectors='le la les un une des du de et ou en au aux avec sans pour par sur dans qui que ce cette ces son sa ses il elle ils elles est sont a ont lors depuis puis ainsi tandis mais reste restent rapporte rapportent indique indiquent décrit décrivent mentionne mentionnent patient patiente séance consultation';
  const words=new Set((connectors+' '+[...quotes.values()].join(' ')).match(/[\p{L}\p{M}]+(?:[’'-][\p{L}\p{M}]+)*|\d+(?:[.,/]\d+)*/gu)??[]);
  if(sources.some(source=>/:measures$|:trend-\d+$/u.test(source.id))){
    for(const word of ['score','scores','mesure','mesures','l’anxiété','d’anxiété','l’humeur','d’humeur'])words.add(word);
  }
  if(sources.some(source=>source.id.endsWith(':focus')))words.add('focus');
  if(sources.some(source=>source.scope==='previous'))words.add('précédente');
  if(sources.some(source=>source.scope==='current'))words.add('actuelle');
  const variants=[...words].flatMap(word=>[word,word.toLowerCase(),word.charAt(0).toUpperCase()+word.slice(1)]).flatMap(word=>[word,word.replaceAll('’',"'"),word.replaceAll("'",'’')]);
  const escaped=[...new Set(variants)].sort((a,b)=>b.length-a.length).map(word=>word.replace(/[.*+?^${}()|[\]\\]/gu,'\\$&'));
  const opening=sources.some(source=>source.scope==='previous')?'Lors de la séance précédente, ':'';
  const word='(?:'+escaped.join('|')+')',separator='(?: |, |; | ; |: | : |\\. )';
  const required=[...new Set([...quotes.values()].filter(qualifiedQuotation))];
  const escape=(value:string)=>value.replace(/[.*+?^${}()|[\]\\]/gu,'\\$&');
  const fixedWords=(opening.trim()?opening.trim().split(/\s+/u).length:0)+required.reduce((count,quote)=>count+quote.trim().split(/\s+/u).length,0);
  const freeWords=Math.max(0,maxWords-fixedWords);
  const prefixWords=required.length?Math.min(16,Math.floor(Math.max(0,freeWords-20)/required.length)):0;
  const tailWords=Math.max(0,freeWords-prefixWords*required.length);
  // The validator already requires these exact qualified facts. Make that
  // requirement generative, so a compressed plan or negation is never offered.
  const facts=required.map(quote=>'(?:'+word+separator+'){0,'+prefixWords+'}'+escape(quote)+( /[.!?;:,]$/u.test(quote)?'':'\\.')).join(' ');
  const remainder=tailWords?word+'(?:'+separator+word+'){0,'+(tailWords-1)+'}\\.?':'';
  return '^'+opening+facts+(required.length&&remainder?'(?: '+remainder+')?':remainder)+'$';
}
export function sessionAnswerSchemaFor(sources:readonly NarrativeSource[],chosenQuotes?:ReadonlyMap<string,string>){
  const selective=sources.some(source=>source.scope==='current');
  const citations=sources.flatMap((source,index)=>{
    if(selective&&chosenQuotes&&!chosenQuotes.has(source.id))return [];
    const excerpts=new Set<string>();
    const sentences=(source.originalText??source.text).split(/(?<=[.!?])\s+/u);
    for(const sentence of sentences)if(sentence.trim().length>=10&&sentence.trim().length<=320&&/[.!?]$/u.test(sentence.trim()))excerpts.add(sentence.trim());
    if(requiredSessionSource(source)&&source.scope==='current'){
      const next=[...excerpts].filter(sentence=>/\b(?:convenu|prévu|propos[ée]|envisag[ée]|prévoir|poursuivre|maintenir|noter)\b/iu.test(sentence));
      if(next.length){excerpts.clear();for(const sentence of next)excerpts.add(sentence);}
    }
    for(const sentence of excerpts.size?[]:sentences){
      const words=sentence.trim().split(/\s+/u);
      if(sentence.trim().length>=10&&sentence.trim().length<=96)excerpts.add(sentence.trim());
      for(let start=0;start<words.length;start+=4){
        let excerpt='';
        for(const word of words.slice(start,start+12)){
          if((excerpt+' '+word).trim().length>96)break;
          excerpt=(excerpt+' '+word).trim();
        }
        if(excerpt.length>=10)excerpts.add(excerpt);
      }
    }
    if(!excerpts.size)excerpts.add(source.text.trim());
    const chosen=chosenQuotes?.get(source.id);
    const transition=source.scope==='change'&&!/:trend-\d+$/u.test(source.id)?source.originalText??sentences[0]?.trim():undefined;
    const quote=transition?z.literal(transition):chosen?z.literal(chosen):/:trend-\d+$/u.test(source.id)?z.literal(source.text):source.id.endsWith(':measures')?z.literal(source.originalText??source.text):z.enum([...excerpts] as [string,...string[]]);
    return [z.object({id:z.literal(`s${index+1}`),quote}).strict()];
  });
  if(!citations.length)throw Error('NarrativeSourceScope');
  const text=z.string().trim().min(10).max(1100);
  const retainedSources=selective&&chosenQuotes?sources.filter(source=>chosenQuotes.has(source.id)):sources;
  const entries=retainedSources.map((source,index)=>({source,citation:citations[index]!}));
  const choice=(items:typeof entries):z.ZodType=>items.length===1?items[0]!.citation:z.union(items.map(item=>item.citation) as [typeof citations[number],typeof citations[number],...typeof citations[number][]]);
  const slots:z.ZodType[]=[];
  let minimum=0;
  if(selective){
    const comparison=entries.filter(({source})=>source.scope==='previous'||/:trend-\d+$/u.test(source.id));
    if(comparison.length&&!hasTreatmentComparison(retainedSources))slots.push(choice(comparison));
    const main=entries.filter(({source})=>source.scope==='current'&&!requiredSessionSource(source)&&!/:focus$|:measures$/u.test(source.id));
    const reported=main.filter(({source})=>source.text.includes(copy.noteAreas.subjective+' : '));
    if(main.length)slots.push(choice(reported.length?reported:main));
    slots.push(...entries.filter(({source})=>requiredSessionSource(source)).map(entry=>entry.citation));
    if(!slots.length)slots.push(choice(entries));
    minimum=slots.length;
    // Optional additional facts stay bounded; mandatory slots cannot be omitted
    // by a model that ignores prose instructions about clinical coverage.
    for(let i=0;i<Math.min(2,Math.max(0,6-slots.length));i++)slots.push(choice(entries).optional());
  }else {slots.push(...citations);minimum=slots.length;}
  // Zod's JSON export omits tuple bounds. Emit them for the native decoder too.
  const evidence=z.tuple(slots as [z.ZodType,...z.ZodType[]]).meta({minItems:minimum,maxItems:slots.length});
  return z.object({sentences:z.array(z.object({evidence,text:chosenQuotes?text.regex(new RegExp(repairVocabulary(chosenQuotes,retainedSources),'u')):text}).strict()).length(1)}).strict();
}
function multiVisitAnswerSchemaFor(aliases: readonly string[],chosenQuotes:ReadonlyMap<string,string>|undefined,sources:readonly NarrativeSource[]) {
  const citation = (id:string) => {
    const source=sources[Number(id.slice(1))-1]!;
    const excerpts=new Set<string>();
    for(const sentence of source.text.split(/(?<=[.!?])\s+|\n/u)){
      const text=sentence.trim();
      if(text.length>=10&&text.length<=64)excerpts.add(text);
      const words=text.split(/\s+/u);
      for(let start=0;start<words.length;start++){
        let excerpt='';
        for(const word of words.slice(start,start+10)){
          if((excerpt+' '+word).trim().length>64)break;
          excerpt=(excerpt+' '+word).trim();
          if(excerpt.length>=10){
            excerpts.add(excerpt);
            const unpunctuated=excerpt.replace(/[.,;:!?]+$/u,'');
            if(unpunctuated.length>=10)excerpts.add(unpunctuated);
          }
        }
      }
    }
    if(!excerpts.size)excerpts.add(source.text.trim());
    return z.object({id:z.literal(id),quote:chosenQuotes?.has(id)?z.literal(chosenQuotes.get(id)!):z.enum([...excerpts] as [string,...string[]])}).strict();
  };
  const citations=aliases.map(citation);
  if(!citations.length)throw new Error("NarrativeVisitScope");
  const requiredCitations=z.tuple([citations[0]!,...citations.slice(1)] as [typeof citations[number],...typeof citations[number][]]).meta({minItems:citations.length,maxItems:citations.length});
  const text=z.string().trim().min(10).max(400);
  return z.object({ sentences: z.array(z.object({ evidence: requiredCitations,text: chosenQuotes?text.regex(new RegExp(repairVocabulary(chosenQuotes,[],60),'u')):text }).strict()).length(1) }).strict();
}
const fold = (value: string) => value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/gu, " ").trim();
const quoteFold = (value:string)=>fold(value).replace(/[’‘`]/gu,"'").replace(/[\p{P}\p{S}]/gu," ").replace(/\s+/gu," ").trim();
const unsafe = /ignore.{0,40}(?:instruction|consigne)|(?:system|assistant|developer)\s*:|(?:execute|appelle).{0,30}(?:outil|tool)|<\/?[a-z][^>]*>|\/api\//iu;
const negative = /\b(?:pas|sans|aucun|aucune|nie|absence|jamais|ni)\b/u;
function qualifiedQuotation(value:string):boolean{
  const text=fold(value);
  return negative.test(text)||/\b(?:hypothese|possible|suspect|a explorer|a confirmer|prevu|propose|envisage|programme)\b/u.test(text);
}
const numbers = (text: string): string[] => fold(text).match(/\d+(?:[.,]\d+)?(?:\s*(?:mg|mcg|g|ml|%))?/gu) ?? [];

/** Source fingerprint includes all five areas and corrections, never an AI output. */
export function consultationNotesSnapshot(c: ClinicalConsultation) {
  return { rawNotes: c.rawNotes ?? null, ...(c.sessionDetails ? {sessionDetails:c.sessionDetails} : {}), notes: [...c.notes].sort((a,b)=>a.id.localeCompare(b.id)).map(n => ({ id: n.id, status: n.status ?? null, subjective: n.subjective, objective: n.objective, assessment: n.assessment, plan: n.plan, amendments: [...n.amendments].sort((a,b)=>a.id.localeCompare(b.id)).map(a=>({id:a.id,body:a.body,reason:a.reason})) })) };
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
  const sources: NarrativeSource[] = selected.excerpts.map((e, i) => ({ id: `${c.id}:${i}`, consultationId:c.id, originalText: e.text, ...(e.amendmentAt ? {attribution: "correction" as const} : e.unsigned ? {attribution: "unsigned" as const} : e.area === "plan" ? {attribution: "plan" as const} : {}), at: c.startedAt, state: c.endedAt === null ? "open" : "closed", text: `${e.amendmentAt ? copy.correction : ""}${e.unsigned ? copy.unsigned : ""}${e.area ? copyArea[e.area] + " : " : ""}${e.text}` }));
  if(c.sessionDetails){
    const details=c.sessionDetails,focus=[...details.focus,details.focusLibre].filter(Boolean);
    if(focus.length)sources.push({id:`${c.id}:focus`,consultationId:c.id,originalText:focus.join(' ; ')+'.',text:copy.focusSource(focus)});
    const measures=(Object.keys(details.mesures) as (keyof typeof details.mesures)[]).flatMap(key=>details.mesures[key]===null?[]:[`${copy.measureLabels[key]} ${details.mesures[key]}/10`]);
    if(measures.length)sources.push({id:`${c.id}:measures`,consultationId:c.id,originalText:measures.join(' ; ')+'.',text:copy.measuresSource(measures)});
  }
  return {sources,complete:!selected.omitted};
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

/**
 * The model must cite a verbatim excerpt. Snap a paraphrase back onto the cited
 * source when at least two of its words are present, so a copy drift cannot
 * turn a supported fact into a rejection. A quote with no support is left
 * untouched and still fails closed.
 */
function snapQuote(quote: string, sourceText: string): string | null {
  const folded = quoteFold(sourceText), words = quote.trim().split(/\s+/u).filter(Boolean);
  for (let length = words.length; length >= 2; length--)
    for (let start = 0; start + length <= words.length; start++) {
      const candidate = words.slice(start, start + length).join(" ");
      if (candidate.length >= 10 && candidate.length <= 64 && folded.includes(quoteFold(candidate))) return candidate;
    }
  return null;
}
function snapNarrativeQuotes(value: unknown, sources: readonly NarrativeSource[]): unknown {
  const parsed = answerSchema.safeParse(value);
  if (!parsed.success) return value;
  return { sentences: parsed.data.sentences.map(sentence => ({
    ...sentence,
    evidence: sentence.evidence.map(citation => {
      const source = sources.find(s => s.id === citation.id);
      if(source&&quoteFold(source.text).includes(quoteFold(citation.quote)))return citation;
      const snapped = source ? snapQuote(citation.quote, source.text) : null;
      return snapped ? { ...citation, quote: snapped } : citation;
    }),
  })) };
}

/** Fail closed on unsupported amounts, polarity reversal, invented citations or instructions. */
function checkClinicalNarrative(value: unknown, sources: readonly NarrativeSource[]): {text:string|null;rejection?:string} {
  const parsed = answerSchema.safeParse(value);
  if (!parsed.success) return {text:null,rejection:"schema"};
  for (const sentence of parsed.data.sentences) {
    const quotes: string[] = [];
    const datedQuotes:{scope:NarrativeSource['scope'];quote:string}[]=[];
    if (unsafe.test(sentence.text) || /\n|^\s*[-*\d]|\b(?:SOAP|subjectif\s*:|objectif\s*:|évaluation\s*:|plan\s*:)/iu.test(sentence.text)) return {text:null,rejection:"format"};
    if(/[,;:][’']|[’'][,.!?]|[.!?](?=\p{L})/u.test(sentence.text))return {text:null,rejection:'format'};
    if(sentence.text.split(/(?<=[.!?])\s+/u).some(part=>part.trim().split(/\s+/u).length===1&&!/^(?:Dr|Pr|Mme|M)\.$/u.test(part.trim())))return {text:null,rejection:'format'};
    if(/(?:^|[.!?]\s+)(?:focus de la séance|scores de difficulté[^.!?]*?)\s*:/iu.test(sentence.text))return {text:null,rejection:'format'};
    for (const citation of sentence.evidence) {
      const source = sources.find(s => s.id === citation.id);
      if (!source) return {text:null,rejection:"citation-id"};
      if (unsafe.test(citation.quote) || !quoteFold(source.text).includes(quoteFold(citation.quote))) return {text:null,rejection:"citation-quote"};
      // Preserve qualifiers attached to the cited excerpt, while allowing a
      // positive fact to be summarized when another note clause is negative.
      const field = fold(citation.quote), sentenceText = fold(sentence.text);
      const qualified = qualifiedQuotation(field);
      if (qualified && !sentenceText.includes(field)) return {text:null,rejection:"qualifier"};
      // A negative finding can change meaning when its note assigns it to
      // someone other than the patient or says the patient was not assessed.
      const sourceContext = fold(source.originalText ?? source.text);
      const attribution = sourceContext.match(/\b(?:cela|ceci|cette information|cette idee|ce fait)\s+(?:concerne|se rapporte a|est attribue a)\s+[^.!?;]*/u)
        ?? sourceContext.match(/\b(?:le|la) patient(?:e)?\s+n['’]a\s+pas\s+ete\s+interroge[^.!?;]*/u);
      if (qualified && attribution && !sentenceText.includes(attribution[0])) return {text:null,rejection:"attribution"};
      const contextWords=/:measures$|:trend-\d+$/u.test(source.id)?' score scores mesure mesures':source.id.endsWith(':focus')?' focus':'';
      const proofQuote=citation.quote+contextWords;
      quotes.push(proofQuote);
      datedQuotes.push({scope:source.scope,quote:proofQuote});
      // Temporal scope comes from the authorized read, independently of the quoted clinical words.
      if(source.scope==='previous')quotes.push('séance précédente');
      if(source.scope==='current')quotes.push('séance actuelle');
    }
    const proof = fold(quotes.join(" ")), text = fold(sentence.text);
    const supported = numbers(proof); let position = 0;
    for (const quantity of numbers(text)) { const index = supported.indexOf(quantity, position); if (index < 0) return {text:null,rejection:"number"}; position = index + 1; }
    // A negation may not be introduced unless the cited evidence carries one. The
    // per-citation qualifier check above already forces any quoted negation into
    // the sentence, so a paraphrase of a positive fact stays allowed.
    if (negative.test(text) && !negative.test(proof)) return {text:null,rejection:"polarity"};
    if (/\b(?:hypothese|possible|suspect|a explorer|a confirmer)\b/u.test(proof) && !/\b(?:hypothese|possible|suspect|explor|confirmer)\w*\b/u.test(text)) return {text:null,rejection:"uncertainty"};
    const words = text.match(/[\p{L}]{5,}/gu) ?? [];
    const narrativeGlue = new Set(["patient","patiente","patients","patientes","note","notes","consultation","consultations","seance","seances","dossier","theme","themes","motif","motifs","suivi","historique","resume","synthese","evolution","cours","paragraphe","revient","reviennent","mentionne","mentionnent","indique","indiquent","rapporte","rapportent","decrit","decrivent","consigne","consignent","contient","contiennent","presente","presentent","montre","montrent","relate","relatent","evoque","evoquent","concerne","concernent","porte","portent","autour","recurrent","recurrents","disponible","disponibles","ensemble","element","elements","plusieurs","chaque","selon","affirme","affirment","retrouve","retrouvent","parle","parlent","constate","constatent","rapport","rapports","mention","mentions"]);
    const contentWords=words.filter(word=>!narrativeGlue.has(word));
    if (!contentWords.length || contentWords.some(word=>!proof.includes(word))) return {text:null,rejection:"grounding"};
    // Scope labels cannot license transferring a finding between visits.
    // Each temporally attributed sentence must be supported by that visit's
    // own citations. An exact recorded comparison remains valid as written.
    const clinicalClauses=text.split(/[.!?;]/u).map(clause=>clause.trim()).filter(Boolean);
    const wholeSentences=text.split(/[.!?]/u).map(clause=>clause.trim()).filter(Boolean);
    if(new Set(wholeSentences).size!==wholeSentences.length)return {text:null,rejection:'repetition'};
    const presentProof=fold(datedQuotes.filter(citation=>citation.scope!=='previous').map(citation=>citation.quote).join(' '));
    const pastOnlyWords=(fold(datedQuotes.filter(citation=>citation.scope==='previous').map(citation=>citation.quote).join(' ')).match(/[\p{L}]{5,}/gu)??[]).filter(word=>!narrativeGlue.has(word)&&!presentProof.includes(word));
    for(const clause of clinicalClauses){
      if(pastOnlyWords.some(word=>clause.includes(word))&&!/\b(?:seance|consultation) precedente\b/u.test(clause))return {text:null,rejection:'temporal-attribution'};
      if(sentence.evidence.some(citation=>quoteFold(citation.quote).includes(quoteFold(clause))))continue;
      for(const scope of ['previous','current'] as const){
        const marker=scope==='previous'?/\b(?:seance|consultation) precedente\b/u:/\b(?:seance|consultation) actuelle\b/u;
        if(!marker.test(clause))continue;
        const scopedProof=fold(datedQuotes.filter(citation=>citation.scope===scope).map(citation=>citation.quote).join(' '));
        const clinicalWords=(clause.match(/[\p{L}]{5,}/gu)??[]).filter(word=>!narrativeGlue.has(word)&&!['precedente','actuelle'].includes(word));
        if(!scopedProof||clinicalWords.some(word=>!scopedProof.includes(word))||numbers(clause).some(quantity=>!numbers(scopedProof).includes(quantity)))return {text:null,rejection:'temporal-attribution'};
      }
    }
    if (/\b(?:je|j’ai|j'ai|nous avons)\b/u.test(text) || /\b(?:doit prendre|il faut prescrire|je recommande)\b/u.test(text)) return {text:null,rejection:"prescription"};
  }
  const text = parsed.data.sentences.map(s => s.text.trim()).join(" ");
  return text.length <= 1100 && text.split(/\s+/u).length <= 70 ? {text} : {text:null,rejection:"length"};
}
export function validateClinicalNarrative(value: unknown, sources: readonly NarrativeSource[]): string | null {
 return checkClinicalNarrative(value,sources).text;
}

/** A real model chooses the evidence; only whole recorded sentences reach this mode. */
function extractSelectedSentences(value:unknown,sources:readonly NarrativeSource[]):Pick<ClinicalNarrative,'text'|'sourceIds'|'selectedSentences'>|null {
  const parsed=answerSchema.safeParse(value);if(!parsed.success)return null;
  const citations=[...new Map(parsed.data.sentences.flatMap(sentence=>sentence.evidence.map(e=>[e.id,e] as const))).values()];
  const findSource=(id:string)=>sources.find(source=>source.id===id);
  if(citations.some(citation=>!findSource(citation.id)))return null;
  const required=new Set(sources.filter(requiredSessionSource).map(source=>source.id));
  const main=citations.find(citation=>{const source=findSource(citation.id)!;return source.scope==='current'&&source.originalText!==undefined&&!/:focus$|:measures$/u.test(source.id);})
    ??citations.find(citation=>findSource(citation.id)!.scope==='current');
  if(sources.some(source=>source.scope==='current')&&!main)return null;
  if(main)required.add(main.id);
  const comparison=hasTreatmentComparison(sources)?undefined:citations.find(citation=>/:trend-\d+$/u.test(citation.id))??citations.find(citation=>findSource(citation.id)!.scope==='previous');
  if(!hasTreatmentComparison(sources)&&sources.some(source=>source.scope==='previous'||/:trend-\d+$/u.test(source.id))&&!comparison)return null;
  if(comparison)required.add(comparison.id);
  if(!required.size)return null;
  if([...required].some(id=>!citations.some(citation=>citation.id===id)))return null;
  const selected=citations.filter(citation=>required.has(citation.id)),texts:string[]=[];
  for(const citation of selected){
    const source=findSource(citation.id)!;
    const atomic=source.scope==='change'&&!/:trend-\d+$/u.test(source.id)&&source.originalText;
    const exact=atomic&&atomic===citation.quote?atomic:(source.originalText??source.text).split(/(?<=[.!?])\s+/u).map(sentence=>sentence.trim()).find(sentence=>sentence===citation.quote);
    if(!exact||!/[.!?]$/u.test(exact)||unsafe.test(exact))return null;
    const text=source.scope==='previous'?copy.previousSentence(exact):exact;
    if(!texts.includes(text))texts.push(text);
  }
  const checked=checkClinicalNarrative({sentences:[{text:texts.join(' '),evidence:selected}]},sources);
  return checked.text?{text:checked.text,sourceIds:selected.map(citation=>citation.id),selectedSentences:selected}:null;
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
  return text.length <= 1100 && text.split(/\s+/u).length <= 70 ? {text,sourceIds:selected.map(s=>s.id)} : null;
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

async function synthesizeNarrativeBatch(sources: readonly NarrativeSource[], signal: AbortSignal,extractiveMode=false): Promise<ClinicalNarrative> {
  const available = sources.filter(s => s.text.trim() && !unsafe.test(s.text));
  const projected: NarrativeSource[] = []; let characters = 0;
  for (const source of available) {
    // Never remove a qualifier at either end of a recorded field.
    if (projected.length >= 40 || characters + source.text.length > 5500) continue;
    projected.push(source); characters += source.text.length;
  }
  let complete = projected.length === sources.length;
  if (!projected.length) return { text: sources.length ? copy.unavailable : copy.empty, complete: sources.length === 0, generated: false, sourceIds: [] };
  const boundedSignal = AbortSignal.any([signal, AbortSignal.timeout(900000)]);
  let multiVisitRetries=0;
  let multiVisitEvidence:Map<string,string>|undefined;
  let sessionEvidence:Map<string,string>|undefined;
  let lastRaw = "";
  // A single summary sentence cannot cite an unbounded history: keep the six most recent visits.
  const recentVisits = new Set<string>();
  for (const source of projected) if (source.consultationId && (recentVisits.has(source.consultationId) || recentVisits.size < 6)) recentVisits.add(source.consultationId);
  const kept = projected.filter(source => !source.consultationId || recentVisits.has(source.consultationId));
  if (kept.length !== projected.length) { projected.splice(0, projected.length, ...kept); complete = false; }
  // Context rejection happens before generation. Fit whole fields within the same deadline.
  while (projected.length) try {
    const visitIds=new Set(projected.flatMap(source=>source.consultationId?[source.consultationId]:[]));
    const multiVisit=visitIds.size>1;
    const validationSources=multiVisit?groupSourcesByConsultation(projected):projected;
    const sourceAliases=new Map(validationSources.map((source,index)=>[`s${index+1}`,source.id]));
    const requiredAliases=validationSources.map((source,index)=>({source,alias:`s${index+1}`})).filter(entry=>entry.source.consultationId).map(entry=>entry.alias).slice(0,6);
    const selectedEvidence=multiVisit?multiVisitEvidence:sessionEvidence;
    const aliasedEvidence=multiVisitEvidence?new Map([...sourceAliases].flatMap(([alias,id])=>multiVisitEvidence!.has(id)?[[alias,multiVisitEvidence!.get(id)!] as const]:[])):undefined;
    const responseSchema=multiVisit?multiVisitAnswerSchemaFor(requiredAliases.length?requiredAliases:[...sourceAliases.keys()].slice(0,6),aliasedEvidence,validationSources):sessionAnswerSchemaFor(validationSources,sessionEvidence);
    const systemPrompt=multiVisit?(multiVisitRetries?copy.multiVisitRetryPrompt:copy.multiVisitPrompt):sessionEvidence?copy.sessionRepairPrompt:`${copy.prompt} ${copy.sessionInstruction}`;
    const maxOutputTokens=multiVisit?Math.min(560,200+visitIds.size*70):1024;
    const visitAliases=new Map([...new Set(validationSources.flatMap(source=>source.consultationId?[source.consultationId]:[]))].map((id,index)=>[id,`v${index+1}`]));
    const modelSources=validationSources.map(({originalText:_original,attribution:_attribution,consultationId,...source},index)=>({
      ...source,...(selectedEvidence?.has(source.id)?{text:selectedEvidence.get(source.id)}:{}),id:`s${index+1}`,...(consultationId?{visit:visitAliases.get(consultationId)}:{}),...(requiredSessionSource(source)?{required:true}:{}),
    })).filter(source=>!sessionEvidence||!validationSources.some(s=>s.scope==='current')||sessionEvidence.has(sourceAliases.get(source.id)!));
    const raw = await inferLocalText([{ role: "system", content: systemPrompt }, { role: "user", content: JSON.stringify({ sources: modelSources }) }], { jsonSchema: z.toJSONSchema(responseSchema), maxOutputTokens, timeoutMs: 900000, signal: boundedSignal });
    lastRaw = raw;
    boundedSignal.throwIfAborted();
    const modelValue: unknown = JSON.parse(raw),parsedModel=responseSchema.safeParse(modelValue);
    if(extractiveMode&&!parsedModel.success&&process.env.ALEXA_DEBUG_NARRATIVE==='1')console.warn('[alexa-narrative] selection-schema',JSON.stringify({issues:parsedModel.error.issues.map(issue=>({code:issue.code,path:issue.path})),characters:raw.length}));
    if(!parsedModel.success){
      if(multiVisit&&multiVisitRetries<1){multiVisitRetries++;continue;}
      if(multiVisit){console.warn("[alexa-narrative] rejected","schema");break;}
    }
    const parsedAnswer=answerSchema.safeParse(modelValue);
    const textFitsSchema=parsedAnswer.success&&parsedAnswer.data.sentences.every(sentence=>responseSchema.shape.sentences.element.shape.text.safeParse(sentence.text).success);
    const value: unknown=snapNarrativeQuotes(parsedAnswer.success?{...parsedAnswer.data,sentences:parsedAnswer.data.sentences.map(sentence=>({...sentence,evidence:sentence.evidence.map(citation=>({...citation,id:sourceAliases.get(citation.id)??citation.id}))}))}:modelValue,validationSources);
    const validation = checkClinicalNarrative(value, validationSources), text = validation.text;
    const parsed = answerSchema.safeParse(value);
    const cited = parsed.success ? [...new Set(parsed.data.sentences.flatMap(s => s.evidence.map(e => e.id)))] : [];
    const visits=new Set(projected.flatMap(source=>source.consultationId?[source.consultationId]:[]));
    const scopedSession=!multiVisit&&validationSources.some(source=>source.scope==='current');
    // Full source reads establish coverage; citations describe the facts retained
    // in a short paragraph. Preserve the plan, treatment changes and a comparison.
    const sessionCovered=scopedSession&&validationSources.some(source=>source.scope==='current'&&cited.includes(source.id))
      &&validationSources.filter(requiredSessionSource).every(source=>cited.includes(source.id))
      &&(hasTreatmentComparison(validationSources)||!validationSources.some(source=>source.scope==='previous'||/:trend-\d+$/u.test(source.id))||validationSources.some(source=>(source.scope==='previous'||/:trend-\d+$/u.test(source.id))&&cited.includes(source.id)));
    const covered=visits.size>1
      ?[...visits].every(consultationId=>cited.includes(consultationId))
      :scopedSession?sessionCovered:cited.length===validationSources.length&&validationSources.every(source=>cited.includes(source.id));
    if(extractiveMode&&!multiVisit&&parsedModel.success&&covered){
      const selection=extractSelectedSentences(value,validationSources);
      if(selection)return {...selection,complete,generated:true,method:'extractive'};
      if(process.env.ALEXA_DEBUG_NARRATIVE==='1')console.warn('[alexa-narrative] selection-debug',JSON.stringify({sources:validationSources.length,citations:cited.length,characters:raw.length}));
      console.warn('[alexa-narrative] rejected','selected-sentences');break;
    }
    if (!extractiveMode&&text && covered && textFitsSchema) return { text, complete, generated: true, sourceIds: cited, method: "reformulated" };
    if (multiVisit) {
      if(multiVisitRetries<1){
        if(parsed.success&&covered&&parsed.data.sentences.every(part=>part.evidence.every(citation=>{const source=validationSources.find(s=>s.id===citation.id);return source&&quoteFold(source.text).includes(quoteFold(citation.quote));})))multiVisitEvidence=new Map(parsed.data.sentences.flatMap(part=>part.evidence.map(citation=>[citation.id,citation.quote] as const)));
        multiVisitRetries++;continue;
      }
      if(text&&textFitsSchema)return { text, complete: false, generated: true, sourceIds: cited, method: "reformulated" };
      console.warn("[alexa-narrative] rejected", validation.rejection??(!parsed.success?"schema":"visit-coverage"));
      if (process.env.ALEXA_DEBUG_NARRATIVE === "1") console.warn("[alexa-narrative] debug", JSON.stringify({ rejection: validation.rejection, sources: validationSources.length, citations: cited.length, characters: raw.length }));
      break;
    }
    if (process.env.ALEXA_DEBUG_NARRATIVE === "1") console.warn("[alexa-narrative] debug", JSON.stringify({ rejection: validation.rejection, sources: validationSources.length, citations: cited.length, characters: raw.length }));
    if(!sessionEvidence&&parsedModel.success&&parsed.success&&covered&&validation.rejection){
      // Repair once from the model's verified excerpts, never from its rejected claims.
      sessionEvidence=new Map(parsed.data.sentences.flatMap(s=>s.evidence.map(e=>[e.id,e.quote] as const)));
      continue;
    }
    const all = recoverClinicalSelection(value, projected, true);
    if (all) return { ...all, complete, generated: true, method: "source_selection" };
    if (!extractiveMode&&text&&textFitsSchema&&(!scopedSession||covered)) return { text, complete: false, generated: true, sourceIds: cited, method: "reformulated" };
    const selected = recoverClinicalSelection(value, projected);
    if (selected) return { ...selected, complete: complete && selected.sourceIds.length === projected.length, generated: true, method: "source_selection" };
    console.warn("[alexa-narrative] rejected", validation.rejection??(!parsed.success?"schema":"recovery"));
    break;
  } catch (error) {
    signal.throwIfAborted();
    if (!boundedSignal.aborted && error instanceof Error && error.message === "LocalModelContext") { projected.pop(); complete = false; continue; }
    console.warn("[alexa-narrative] failure", localModelFailureCode(error));
    if (process.env.ALEXA_DEBUG_NARRATIVE === "1") console.warn("[alexa-narrative] debug", JSON.stringify({ characters: lastRaw.length, sources: projected.length }));
    break;
  }
  // No fabricated prose if the small local model cannot support its own claims.
  return { text: copy.unavailable, complete: false, generated: false, sourceIds: [] };
}

/** Fast, evidence-only answer when separate visits explicitly label the same recurring theme. */
export async function synthesizeClinicalNarrative(sources: readonly NarrativeSource[], signal: AbortSignal): Promise<ClinicalNarrative> {
  const extractiveMode=sources.some(source=>source.scope!==undefined&&source.originalText!==undefined);
  if(sources.some(s=>s.text.length>5500))return synthesizeNarrativeBatch(sources,signal,extractiveMode);
  const visits=new Map<string,NarrativeSource[]>();
  for(const source of sources){const key=source.consultationId??source.id;const group=visits.get(key)??[];group.push(source);visits.set(key,group);}
  if(visits.size<=6 && sources.length<=40 && sources.reduce((n,s)=>n+s.text.length,0)<=4500)return synthesizeNarrativeBatch(sources,signal,extractiveMode);
  const chunks:NarrativeSource[][]=[];let chunk:NarrativeSource[]=[],count=0,characters=0;
  for(const group of visits.values()){
    const length=group.reduce((n,s)=>n+s.text.length,0);
    if(chunk.length&&(count===6||characters+length>4500||chunk.length+group.length>40)){chunks.push(chunk);chunk=[];count=0;characters=0;}
    chunk.push(...group);characters+=length;count++;
  }
  if(chunk.length)chunks.push(chunk);
  if(chunks.length===1)return synthesizeNarrativeBatch(sources,signal,extractiveMode);
  const results:ClinicalNarrative[]=[];
  for(const group of chunks){signal.throwIfAborted();const result=await synthesizeNarrativeBatch(group,signal,extractiveMode);if(!result.generated)return {...result,complete:false};results.push(result);}
  if(extractiveMode){
    if(results.every(result=>result.method==='extractive'&&result.selectedSentences)){
      const selected=results.flatMap(result=>result.selectedSentences??[]);
      const combined=extractSelectedSentences({sentences:[{text:copy.summary,evidence:selected}]},sources);
      if(combined)return {...combined,complete:results.every(result=>result.complete),generated:true,method:'extractive'};
    }
    return {text:copy.unavailable,complete:false,generated:false,sourceIds:[]};
  }
  const intermediate=results.map((r,i)=>({id:`batch-${i}`,text:r.text}));
  const final=await synthesizeClinicalNarrative(intermediate,signal);
  if(!final.generated)return {...final,complete:false};
  const cited=results.filter((_,i)=>final.sourceIds.includes(`batch-${i}`));
  return {...final,sourceIds:[...new Set(cited.flatMap(r=>r.sourceIds))],complete:final.complete&&results.every(r=>r.complete)};
}

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
/** Domain objects must reach the model as readable text, never as "[object Object]". */
function describeChangeValue(value: unknown, depth = 0): string {
  if (value === null || value === undefined || value === "") return "non renseigné";
  if (typeof value !== "object") return String(value);
  if (depth >= 2) return "non renseigné";
  const entries = Object.entries(value as Record<string, unknown>).filter(([, entry]) => entry !== null && entry !== undefined && entry !== "");
  const labels={...alexaRecordCopy.fr.treatmentFields,...copy.treatmentFields};
  return entries.length ? entries.map(([key, entry]) => {
    const label=Object.entries(labels).find(([field])=>field===key)?.[1]??key;
    const value=key==='status'&&(entry==='active'||entry==='paused'||entry==='stopped')?dialogue('fr').states[entry]:describeChangeValue(entry,depth+1);
    return `${label} ${value}`;
  }).join(", ") : "non renseigné";
}
interface CaseSentence {id:string;text:string;sourceIds:string[];at?:string;fact:string}
/** Native selection retains exact sentence provenance at every hidden level. */
async function synthesizeCaseSentences(sources:readonly NarrativeSource[],signal:AbortSignal):Promise<ClinicalNarrative>{
  const unavailable:ClinicalNarrative={text:copy.unavailable,generated:false,complete:false,sourceIds:[]};
  if(!sources.length)return unavailable;
  let sequence=0;
  const words=(text:string)=>text.trim().split(/\s+/u).length;
  const date=new Intl.DateTimeFormat('fr-FR',{timeZone:'Africa/Algiers'});
  const groups=new Map<string,NarrativeSource[]>();
  for(const source of sources){
    if(unsafe.test(source.text))return unavailable;
    const key=source.consultationId??source.id,list=groups.get(key)??[];list.push(source);groups.set(key,list);
  }
  const candidatesFor=(entries:readonly NarrativeSource[]):CaseSentence[]=>{
    const byVisit=new Map<string,NarrativeSource[]>();
    for(const source of entries){const key=source.consultationId??source.id,list=byVisit.get(key)??[];list.push(source);byVisit.set(key,list);}
    return [...byVisit.values()].flatMap(group=>{
      const corrected=group.filter(source=>source.attribution==='correction');
      const priority=(source:NarrativeSource)=>source.text.includes(copy.noteAreas.subjective+' : ')?0:source.attribution==='plan'?1:source.text.includes(copy.noteAreas.assessment+' : ')?2:3;
      const ordered=[...(corrected.length?corrected:group)].sort((a,b)=>priority(a)-priority(b));
      const choices:CaseSentence[]=[],seen=new Set<string>();
      for(const source of ordered){
        if(/:focus$|:measures$/u.test(source.id)&&choices.length)continue;
        // A following sentence may qualify a diagnosis, identify its subject,
        // or withdraw the preceding claim. Never detach it from its field.
        const sentences=[(source.originalText??source.text).trim()].filter(text=>text.length>0&&!unsafe.test(text)&&!/(?:séance|consultation) précédente/iu.test(text));
        for(const quote of sentences){
          const sourceContext=fold(source.originalText??source.text);
          const attribution=sourceContext.match(/\b(?:cela|ceci|cette information|cette idee|ce fait)\s+(?:concerne|se rapporte a|est attribue a)\s+[^.!?;]*/u)??sourceContext.match(/\b(?:le|la) patient(?:e)?\s+n['’]a\s+pas\s+ete\s+interroge[^.!?;]*/u);
          if(qualifiedQuotation(quote)&&attribution&&!fold(quote).includes(attribution[0]))continue;
          const prefix=source.attribution==='unsigned'?copy.recordedDraft:source.attribution==='correction'?copy.recordedCorrection:source.attribution==='plan'?copy.recordedPlan:undefined;
          const prose=/[.!?]$/u.test(quote)&&/\b(?:est|sont|rapporte|décrit|reste|convenu|dit|présente|porte|mentionne|indique|retient|constate)\b/iu.test(quote);
          let text=prefix?copy.caseQuotation(prefix,quote):prose?quote:copy.caseQuotation(copy.recordedAuthor,quote);
          if(source.at&&source.consultationId)text=copy.caseDatedSentence(date.format(new Date(source.at)),text);
          if(words(text)>70||seen.has(text))continue;
          seen.add(text);choices.push({id:`c${++sequence}`,text,sourceIds:[source.id],...(source.at?{at:source.at}:{}),fact:quoteFold(quote)});
          // Each choice keeps its entire recorded field and qualifications.
          if(ordered.length>1||choices.length>=3)break;
        }
        if(choices.length>=3)break;
      }
      return choices;
    });
  };
  const select=async(choices:readonly CaseSentence[],entries:readonly NarrativeSource[]):Promise<CaseSentence[]>=>{
    if(!choices.length)throw Error('CaseSentenceUnavailable');
    const latest=choices.flatMap(choice=>choice.at?[choice.at]:[]).sort().at(-1);
    const current=(choice:CaseSentence)=>!latest||choice.at===latest;
    const combinations=new Map(choices.filter(current).map(choice=>[choice.id,[choice]]));
    for(let i=0;i<choices.length;i++)for(let j=i+1;j<choices.length;j++){
      const pair=[choices[i]!,choices[j]!];
      if(pair[0]!.fact!==pair[1]!.fact&&pair.some(current)&&words(pair.map(choice=>choice.text).join(' '))<=70)combinations.set(pair.map(choice=>choice.id).join('+'),pair);
    }
    const schema=z.object({selection:z.enum([...combinations.keys()] as [string,...string[]])}).strict();
    const raw=await inferLocalText([{role:'system',content:copy.caseSelectionPrompt},{role:'user',content:JSON.stringify({sources:entries.map((source,index)=>({id:`s${index+1}`,text:source.text,at:source.at})),choices:choices.map(({id,text})=>({id,text}))})}],{jsonSchema:z.toJSONSchema(schema),maxOutputTokens:64,timeoutMs:900000,signal});
    signal.throwIfAborted();
    return combinations.get(schema.parse(JSON.parse(raw)).selection)!;
  };
  const readBatch=async(entries:readonly NarrativeSource[]):Promise<CaseSentence[]>=>{
    try{return await select(candidatesFor(entries),entries);}
    catch(error){
      if(error instanceof Error&&error.message==='LocalModelContext'&&entries.length>1){
        const middle=Math.ceil(entries.length/2),left=await readBatch(entries.slice(0,middle)),right=await readBatch(entries.slice(middle));
        return select([...left,...right],[]);
      }
      throw error;
    }
  };
  try{
    const chunks:NarrativeSource[][]=[];let chunk:NarrativeSource[]=[],characters=0,visits=0;
    for(const group of groups.values()){
      const length=group.reduce((total,source)=>total+source.text.length,0);
      if(chunk.length&&(characters+length>3500||visits===6)){chunks.push(chunk);chunk=[];characters=0;visits=0;}
      chunk.push(...group);characters+=length;visits++;
    }
    if(chunk.length)chunks.push(chunk);
    let selected:CaseSentence[]=[];
    let completed=0;
    for(const group of chunks){
      signal.throwIfAborted();selected.push(...await readBatch(group));completed++;
      if(process.env.ALEXA_DEBUG_NARRATIVE==='1')console.warn('[alexa-case] progress',JSON.stringify({completed,total:chunks.length}));
    }
    if(chunks.length>1){
      while(selected.length>12){const next:CaseSentence[]=[];for(let start=0;start<selected.length;start+=12)next.push(...await select(selected.slice(start,start+12),[]));selected=next;}
      selected=await select(selected,[]);
    }
    const text=[...new Set(selected.map(choice=>choice.text))].join(' ');
    if(!text||words(text)>70)return unavailable;
    return {text,generated:true,complete:true,method:'extractive',sourceIds:[...new Set(selected.flatMap(choice=>choice.sourceIds))]};
  }catch(error){signal.throwIfAborted();console.warn('[alexa-case] failure',localModelFailureCode(error));return unavailable;}
}

export async function summarizeClinicalCaseContext(context:ClinicalContext,signal:AbortSignal):Promise<ClinicalNarrative>{return summarizeClinicalContext(context,signal,true,true);}

export async function summarizeClinicalContext(context: ClinicalContext, signal: AbortSignal, wholeRecord = true,caseSelection=false): Promise<ClinicalNarrative> {
  let complete = context.coverage.complete && (!wholeRecord || !context.coverage.hasMore);
  // Same deterministic progression as a ranged summary: no model call, no drift.
  const structured = extractStructuredClinicalProgression(context);
  if (structured && !wholeRecord) return { ...structured, complete: complete && structured.complete };
  const sources: NarrativeSource[] = [];
  const visits=[...(context.currentConsultation ? [context.currentConsultation] : []), ...context.consultations]
    .filter((c,index,all)=>all.findIndex(other=>other.id===c.id)===index)
    .sort((a,b)=>wholeRecord?Date.parse(a.startedAt)-Date.parse(b.startedAt)||a.id.localeCompare(b.id):Date.parse(b.startedAt)-Date.parse(a.startedAt)||b.id.localeCompare(a.id));
  for (const c of wholeRecord?visits:visits.slice(0,context.coverage.requested)) {
    const saved = z.object({ resume: z.string().min(1).max(1500), notesDigest: z.string(), complete: z.boolean(), generated: z.literal(true) }).safeParse(c.analysis?.content);
    // The case selector keeps original fields atomic: a derived session
    // paragraph cannot establish that a following qualifier was preserved.
    if (!caseSelection&&saved.success && c.analysis?.model === ALEXA_CONVERSATION_MODEL && c.analysis.promptHash === NARRATIVE_HASH && saved.data.notesDigest === consultationNotesDigest(c)) {
      sources.push({ id: c.id, text: saved.data.resume, at: c.startedAt, state: c.endedAt === null ? "open" : "closed", consultationId:c.id });
      complete &&= saved.data.complete;
    }
    else { const raw = consultationNarrativeSources(c); sources.push(...raw.sources); complete &&= raw.complete; }
  }
  for (const d of context.diagnoses) sources.push({ id: d.id, text: `Diagnostic documenté : ${d.label} ; état : ${d.resolvedAt !== null ? "résolu" : "non résolu"}.` });
  for (const t of context.treatments.current) sources.push({ id: t.id, text: `Traitement en cours : ${[t.medication, t.dose, t.doseUnit, t.frequency].filter(Boolean).join(" ")} ; état : ${dialogue('fr').states[t.status]}.` });
  for (const h of context.treatments.history) sources.push({ id: h.id, text: `Changement de traitement enregistré le ${h.occurredAt} ; précédent : ${describeChangeValue(h.previous)} ; nouveau : ${describeChangeValue(h.next)}${h.reason ? ` ; motif : ${h.reason}` : ""}.` });
  if(caseSelection&&!sources.length)return {text:complete?copy.caseEmpty:copy.unavailable,complete,generated:false,sourceIds:[]};
  const result = caseSelection?await synthesizeCaseSentences(sources,signal):await synthesizeClinicalNarrative(sources, signal);
  if(wholeRecord&&result.method==='source_selection')return {text:copy.unavailable,complete:false,generated:false,sourceIds:[]};
  return { ...result, complete: complete && result.complete };
}

/** Summarizes only consultations already selected by an authorized, bounded read. */
export async function summarizeClinicalConsultations(context:ClinicalContext,signal:AbortSignal):Promise<ClinicalNarrative>{
 const visits=[...context.consultations].filter((c,index,all)=>all.findIndex(other=>other.id===c.id)===index).sort((a,b)=>Date.parse(b.startedAt)-Date.parse(a.startedAt)||b.id.localeCompare(a.id));
 let complete=context.coverage.complete&&(!context.coverage.hasMore||context.coverage.returned>=context.coverage.requested);
 if(!visits.length)return {text:complete?"Aucune consultation terminée n’est enregistrée pendant cette période.":copy.limited,complete,generated:false,sourceIds:[]};
 const structured=extractStructuredClinicalProgression(context);if(structured)return {...structured,complete:complete&&structured.complete};
 const sources:NarrativeSource[]=[];
 for(const visit of visits){
  const saved=z.object({resume:z.string().min(1).max(1500),notesDigest:z.string(),complete:z.boolean(),generated:z.literal(true)}).safeParse(visit.analysis?.content);
  if(saved.success&&visit.analysis?.model===ALEXA_CONVERSATION_MODEL&&visit.analysis.promptHash===NARRATIVE_HASH&&saved.data.notesDigest===consultationNotesDigest(visit)){sources.push({id:visit.id,text:saved.data.resume,at:visit.startedAt,state:visit.endedAt===null?"open":"closed",consultationId:visit.id});complete&&=saved.data.complete;}
  else{const raw=consultationNarrativeSources(visit);sources.push(...raw.sources);complete&&=raw.complete;}
 }
 const result=await synthesizeClinicalNarrative(sources,signal);
 return {...result,complete:complete&&result.complete};
}
