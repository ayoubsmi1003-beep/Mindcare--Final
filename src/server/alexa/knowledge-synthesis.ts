import {z} from 'zod';
import { knowledgeAnswerSchema, knowledgeAnswerJsonSchema,indexedKnowledgeAnswerSchema,resolveIndexedKnowledgeAnswer } from "@/shared/alexa/knowledge-answer";
import type { AlexaEvent, AlexaSource } from "@/shared/alexa/turn";
import type { AlexaLanguage } from "@/shared/alexa/request-plan";
import { dialogue } from "@/i18n/alexa-dialogue";
import { knowledgeSynthesisCopy,KNOWLEDGE_COMPACT_SYSTEM_PROMPT,KNOWLEDGE_COMPACT_GENERAL_CRITERIA_SYSTEM_PROMPT,KNOWLEDGE_COMPACT_CRITERIA_SYSTEM_PROMPT,KNOWLEDGE_FRENCH_REFORMULATION_PROMPT,KNOWLEDGE_COMPARISON_UNAVAILABLE,KNOWLEDGE_CRITERIA_COVERAGE } from "@/i18n/alexa-knowledge";
import {ALEXA_NATIVE_BUDGET,ALEXA_NATIVE_DEADLINE_MS} from '@/shared/alexa/agent';
import {headingOnlyEvidence,bibliographyEvidence,bibliographyRequested,knowledgeComparisonRequested,requestedMedicationNames,medicationSpanGrounded,medicationNumericQuoteGrounded,issuedQuoteChoices,copiedEnglishProse} from './knowledge-evidence-content';
import {isIssuedKnowledgeResult} from "./knowledge-adapter";
import { inferLocalText } from "./local-model";
import {localModelFailureCode} from './local-model-protocol';
import {planKnowledgeQuery,matchesSectionFocus} from './knowledge-query';
import { classerCharge } from "@/server/egress/classification";
import { verifierCitations } from "@/server/knowledge/citations";
import { ALEXA_KNOWLEDGE_TRANSFORM, knowledgeMessages, type KnowledgeTask, type KnowledgeFocus } from "./knowledge-envelope";
import { knowledgeResponseEvents, knowledgeSource, type KnowledgeResult } from "./knowledge-response";

const fold = (value: string) => value.normalize("NFC").replace(/\s+/gu, " ").trim();
const answerMetadata=z.object({coverage:knowledgeAnswerSchema.shape.coverage,sentences:z.array(z.unknown()).max(5)});
const numericFold = (value: string) => fold(value.normalize("NFKD").replace(/\p{M}/gu, "")).toLowerCase()
  .replace(/[٠-٩]/gu, digit => String(digit.charCodeAt(0) - 0x0660))
  .replace(/[۰-۹]/gu, digit => String(digit.charCodeAt(0) - 0x06f0)).replace(/٫/gu, ".")
  .replace(/[−﹣－]/gu, "-").replace(/[⁄∕]/gu, "/").replace(/(?<=\d),(?=\d)/gu,'.');
const hiddenControls = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u;
const negation = /\b(?:ne|pas|jamais|sans|non|no|not|never|without|avoid\w*|contraindicat\w*|evit\w*|contre[- ]?indiqu\w*)\b|\bn['’]|لا|ليس|دون/u;
const personalClaim = /\b(?:tu|toi|ton|ta|tes|vous|votre|vos|your|you|my|j['’]ai|je suis|i have|i am|prescrivez|prenez|arretez|augmentez|diminuez)\b|أنت|انت\s|لديك|عندك|تناول|انصحك/u;
const performedAction = /\b(?:enregistree?s?|sauvegardee?s?|modifiee?s?|cree[es]*|supprimee?s?|envoyee?s?|executee?s?|prescrit(?:e|s|es)?|validee?s?|confirmee?s?|ajoutee?s?|saved|recorded|updated|prescribed|created|deleted|sent|executed|confirmed|signed)\b|\bmis(?:e|es)? a jour\b|تم\s+(?:حفظ|تسجيل|تعديل|ارسال|حذف|تنفيذ|تاكيد|توقيع)|حفظت|سجلت|عدلت|ارسلت|نفذت/u;
// French reflexive sensation is not the English past-tense action "sent".
const actionClaimText=(text:string)=>numericFold(text).replace(/\bse\s+sent\b/gu,'se');
function claimsPerformedAction(text:string):boolean{
 const plain=numericFold(text);
 // Accent folding merges the medical noun "signes" and the participle "signés".
 // Keep explicit accented signatures and unaccented action phrases, not the noun.
 return performedAction.test(actionClaimText(text))||/(?<!\p{L})signée?s?(?!\p{L})/iu.test(text.normalize('NFC'))
  ||/\bsignees?\b|\b(?:je|nous|on)\s+sign(?:e|es|ons|ez|ent)\b/u.test(plain)
  ||/\b(?:notes?|documents?|ordonnances?|comptes? rendus?|dossiers?|consultations?|actions?|prescriptions?)\s+(?:(?:est|sont|a ete|ont ete)\s+)?signes?\b/u.test(plain)
  ||/(?:^|[.!?]\s*)signez?\s+(?:le |la |les |l')(?:(?:note|document|ordonnance|dossier|prescription|consultation)s?|compte rendu|comptes rendus)\b/u.test(plain);
}
const numberWords: Readonly<Record<string, string>> = { un: "1", une: "1", deux: "2", trois: "3", quatre: "4", cinq: "5", six: "6", sept: "7", huit: "8", neuf: "9", dix: "10", one: "1", two: "2", three: "3", four: "4", five: "5", seven: "7", eight: "8", nine: "9", ten: "10", واحد: "1", اثنين: "2", ثلاثة: "3", اربعة: "4", خمسة: "5", ستة: "6", سبعة: "7", ثمانية: "8", تسعة: "9", عشرة: "10" };
const units: Readonly<Record<string, string>> = { day: "day", days: "day", jour: "day", jours: "day", يوم: "day", يوما: "day", ايام: "day", week: "week", weeks: "week", semaine: "week", semaines: "week", اسبوع: "week", اسابيع: "week", month: "month", months: "month", mois: "month", شهر: "month", اشهر: "month", year: "year", years: "year", an: "year", ans: "year", annee: "year", annees: "year", سنة: "year", سنوات: "year", hour: "hour", hours: "hour", heure: "hour", heures: "hour", ساعة: "hour", ساعات: "hour", minute: "minute", minutes: "minute", دقيقة: "minute", دقائق: "minute", mg: "mg", milligramme: "mg", milligrammes: "mg", milligram: "mg", milligrams: "mg", g: "g", mcg: "mcg", μg: "mcg", ml: "ml", symptom: "symptom", symptoms: "symptom", symptome: "symptom", symptomes: "symptom", اعراض: "symptom", "%": "%" };
function explicitNumbers(value:string):string[]{
 const text=numericFold(value),written=text.match(/\p{L}+/gu)??[];
 // Indefinite articles establish a quantity only next to a recognized unit.
 return [...text.match(/[+-]?\d+(?:[.,]\d+)?(?:\/\d+)?/gu)??[],...written.flatMap(word=>numberWords[word]&&!['un','une','one'].includes(word)?[numberWords[word]]:[])];
}
function numericBounds(value:string):string[]{
 const signs:Readonly<Record<string,string>>={'<':'lt','>':'gt','<=':'lte','>=':'gte','≤':'lte','≥':'gte','less than':'lt','below':'lt','under':'lt','moins de':'lt','greater than':'gt','more than':'gt','above':'gt','plus de':'gt','at most':'lte','au plus':'lte','at least':'gte','au moins':'gte'};
 const pattern=/(<=|>=|<|>|≤|≥|less than|below|under|moins de|greater than|more than|above|plus de|at most|au plus|at least|au moins)\s*([0-9]+(?:\.[0-9]+)?)/gu;
 return [...numericFold(value).matchAll(pattern)].map(m=>`${signs[m[1]!]}:${m[2]}`).sort();
}
function quantities(value: string): string[] {
  const expression = new RegExp(`(?<![\\p{L}\\p{N}])([+-]?\\d+(?:[.,]\\d+)?(?:/\\d+)?|${Object.keys(numberWords).join("|")})\\s*(?:(?:des|de|du|of|the|من)\\s+){0,2}(${Object.keys(units).join("|")})(?![\\p{L}\\p{N}])`, "gu");
  return [...numericFold(value).matchAll(expression)].map(match => `${numberWords[match[1]!] ?? match[1]!.replace(",", ".")} ${units[match[2]!]}`);
}

/** Task labels only are projected. The original question remains local. */
function taskFor(question: string): KnowledgeTask {
  const text = question.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  return knowledgeComparisonRequested(question) ? "compare" : /criter|criteria|symptomes|symptoms|معايير|اعراض/u.test(text) ? "criteria"
    : /traitement|treatment|dose|posolog|علاج|جرعة/u.test(text) ? "treatment" : "explain";
}
function focusFor(question: string): KnowledgeFocus {
  const text = numericFold(question);
  return /\bhamilton\b/u.test(text) ? "hamilton" : /\btrouble depressif caracterise\b/u.test(text) ? "major-depressive-disorder"
    : /\bdepression\b|اكتئاب/u.test(text) ? "depressive-disorders" : "retrieved-sections";
}
function onlyRequestsNamedCriteria(question:string,focus:string):boolean{
 const text=numericFold(question).replace(/\bdsm\s*-?\s*5\b/gu,' ').replace(focus,' ');
 const scaffolding=new Set(['quels','quelles','quel','quelle','criteres','les','des','du','de','d','dans','le','la','sont','est','decrits','decrit','documentes','documentees','selon','donne','donner','liste','lister','presente','presenter','enumere','enumerer']);
 return (text.match(/\p{L}+/gu)??[]).every(word=>scaffolding.has(word));
}

/** Synthesis cannot call tools. Every emitted paragraph must cite a literal span of this turn's evidence. */
export async function synthesizeKnowledge(result: KnowledgeResult, question: string, language: AlexaLanguage, signal: AbortSignal, options:{compact?:boolean;onCoverage?:(coverage:'supported'|'partial')=>void}={}): Promise<AlexaEvent[]> {
  const locale = language === "fr" ? "fr" : "ar";
  const copy = dialogue(language);
  const message = (text: string): AlexaEvent => ({ type: "sentence", text, kind: "knowledge", sources: [] });
  const fallback = (reason: "provider" | "schema" | "coverage" | "insufficient-nonempty" | "empty-answer" | "heading-only" | "bibliography-only" | "language" | "entity" | "criteria-selection" | "unsafe-text" | "quote" | "quote-span" | "quote-polarity" | "unicode-number" | "number" | "quantity" | "citation" | "size" | "parse" = "parse") => {
    console.warn("[alexa-knowledge] source-fallback", reason);
    if(options.compact)return [{type:'sentence' as const,text:knowledgeSynthesisCopy.fr.compactUnavailable,kind:'knowledge' as const,sources:isIssuedKnowledgeResult(result)?result.preuves.map(p=>knowledgeSource(p)):[]}];
    return [message(knowledgeSynthesisCopy[locale].unavailable), ...knowledgeResponseEvents(result, language)];
  };
  const messages = knowledgeMessages(result, taskFor(question), locale, focusFor(question));
  if (!messages || classerCharge(messages, { transformId: ALEXA_KNOWLEDGE_TRANSFORM }).decision !== "AUTORISER")
    return options.compact?(result.etat!=='ok'?knowledgeResponseEvents(result,language):fallback('coverage')):knowledgeResponseEvents(result, language);
  if(options.compact&&'missingRequestedSections' in result&&result.missingRequestedSections)return [{type:'sentence',text:KNOWLEDGE_COMPARISON_UNAVAILABLE,kind:'knowledge',sources:result.preuves.map(p=>knowledgeSource(p))}];
  // Question data is local-only; do not alter the issued, approved-source egress envelope.
  const medications=requestedMedicationNames(question);
  const maxEvidence=medications.length===1&&!knowledgeComparisonRequested(question)&&taskFor(question)==='explain'?1:5;
  const unverifiedCriteria=options.compact&&taskFor(question)==='criteria';
  const criteriaPlan=unverifiedCriteria?planKnowledgeQuery(question):null;
  const extractiveCriteria=unverifiedCriteria&&!!criteriaPlan?.sectionFocus&&!!criteriaPlan.sectionLeaf
    &&onlyRequestsNamedCriteria(question,criteriaPlan.sectionFocus);
  const isRequestedCriteriaProof=(proof:KnowledgeResult['preuves'][number])=>!extractiveCriteria||proof.langue==='fr'
    &&(!criteriaPlan?.sectionFocus||matchesSectionFocus(proof.section,criteriaPlan.sectionFocus))
    &&numericFold((proof.section??'').split('›').at(-1)??'')===numericFold(criteriaPlan?.sectionLeaf??'criteres diagnostiques');
  const choices=result.preuves.map((proof,index)=>{
    const quotes=issuedQuoteChoices(proof.extrait,proof.langue);
    const allowedQuoteIds=quotes.flatMap((text,i)=>(!extractiveCriteria||isRequestedCriteriaProof(proof))&&!headingOnlyEvidence(text,proof.section)&&(!bibliographyEvidence(proof.section)||bibliographyRequested(question))&&(!medications.length||medications.some(name=>requestedMedicationNames(text).includes(name)))?['q'+(i+1)]:[]);
    return {index:index+1,quotes,allowedQuoteIds};
  });
  const omittedQuotes=options.compact&&choices.some((row,index)=>fold(row.quotes.join(' '))!==fold(result.preuves[index]!.extrait));
  if(omittedQuotes)return fallback('coverage');
  if(options.compact&&choices.every(row=>!row.allowedQuoteIds.length))return fallback(extractiveCriteria?'criteria-selection':'entity');
  const localMessages=options.compact?messages.map(m=>m.role==='user'?{...m,content:JSON.stringify({...JSON.parse(m.content),passages:result.preuves.map((proof,index)=>{
    const row=choices[index]!,spans=row.quotes.map((text,i)=>['q'+(i+1),text]);
    return {index:index+1,title:proof.titre,section:proof.section,citableQuoteIds:row.allowedQuoteIds,citations:spans.filter(span=>row.allowedQuoteIds.includes(span[0]!)),context:spans.filter(span=>!row.allowedQuoteIds.includes(span[0]!))};
  }),question,questionConstraints:{medications,comparison:knowledgeComparisonRequested(question)}})}:{...m,content:extractiveCriteria?KNOWLEDGE_COMPACT_CRITERIA_SYSTEM_PROMPT:unverifiedCriteria?KNOWLEDGE_COMPACT_GENERAL_CRITERIA_SYSTEM_PROMPT:KNOWLEDGE_COMPACT_SYSTEM_PROMPT}):messages;
  signal.throwIfAborted();
  try {
    const answerSchema=options.compact?indexedKnowledgeAnswerSchema(choices,maxEvidence):knowledgeAnswerSchema;
    const completion = await inferLocalText(localMessages, { jsonSchema:options.compact?z.toJSONSchema(answerSchema,{target:'draft-7'}):knowledgeAnswerJsonSchema,
      // Direct native book reads may be the first inference of the turn, including integrity and startup.
      timeoutMs: options.compact?ALEXA_NATIVE_DEADLINE_MS-ALEXA_NATIVE_BUDGET.marginMs:60000,
      maxOutputTokens: options.compact?(extractiveCriteria?256:unverifiedCriteria?512:1024):1024, signal });
    signal.throwIfAborted();
    const decoded:unknown=JSON.parse(completion),metadata=answerMetadata.safeParse(decoded);
    if(metadata.success&&metadata.data.coverage==='insufficient'&&metadata.data.sentences.length)return fallback('insufficient-nonempty');
    if(metadata.success&&metadata.data.coverage!=='insufficient'&&!metadata.data.sentences.length)return fallback('empty-answer');
    const parsed = knowledgeAnswerSchema.safeParse(options.compact?resolveIndexedKnowledgeAnswer(decoded,choices,maxEvidence):decoded);
    if (!parsed.success) {
      // Only closed schema fields/codes: never provider text or unknown keys.
      const fields = new Set(["coverage", "sentences", "text", "evidence", "index", "quote"]);
      console.warn("[alexa-knowledge] invalid-schema", parsed.error.issues.slice(0, 5).map(issue => ({
        code: issue.code, path: issue.path.map(part => typeof part === "number" ? "item" : fields.has(String(part)) ? part : "unknown"),
      })));
      return fallback("schema");
    }
    let answer = parsed.data;
    // Leading list ordinals are presentation; doses, decimals and body quantities remain checked.
    if(options.compact)answer={...answer,sentences:answer.sentences.map(sentence=>({...sentence,text:sentence.text.replace(/^\s*\d+[.)]\s+(?=\p{L})/u,'')}))};
    if(extractiveCriteria){
      const sentences:typeof answer.sentences=[];
      for(const sentence of answer.sentences){
        if(sentence.evidence.length!==1)return fallback('criteria-selection');
        const evidence=sentence.evidence[0]!,proof=result.preuves[evidence.index-1];
        if(!proof||!isRequestedCriteriaProof(proof))return fallback('criteria-selection');
        sentences.push({...sentence,text:evidence.quote});
      }
      answer={...answer,coverage:'partial',sentences};
    }
    if (answer.coverage === "insufficient") return answer.sentences.length === 0 ? [message(copy.noKnowledge)] : fallback("insufficient-nonempty");
    if (!answer.sentences.length) return fallback("empty-answer");
    if(options.compact&&process.env['ALEXA_LOCAL_TIMINGS']==='1'&&answer.sentences.some(s=>copiedEnglishProse(s.text)))
      console.warn('[alexa-knowledge] language-shape',{
        sentences:answer.sentences.length,
        english:answer.sentences.filter(s=>copiedEnglishProse(s.text)).length,
        literalSingleSpan:answer.sentences.filter(s=>s.evidence.length===1&&fold(s.text)===fold(s.evidence[0]!.quote)).length,
        bibliographyMarkers:answer.sentences.filter(s=>/\p{L}\d+(?:,\d+){2,}/u.test(s.text)).length,
      });
    const englishDraft=answer.sentences.length===1?answer.sentences[0]:undefined;
    if(options.compact&&englishDraft&&copiedEnglishProse(englishDraft.text)){
      // Restriction-bearing or combined claims need an entailment proof before translation repair.
      const literal=englishDraft.evidence.length===1&&fold(englishDraft.text)===fold(englishDraft.evidence[0]!.quote);
      if(!literal||medications.length!==1||negation.test(numericFold(englishDraft.text))||/\b(?:if|when|unless|except|however|although|but|may|might|should|could|only|patients?|pregnan\w*|renal|kidney|hepatic|children|elderly|usually|generally|often|approximately|associated)\b/u.test(numericFold(englishDraft.text)))return fallback('language');
      const localizedSchema=z.object({sentences:z.array(z.string().min(1).max(1600)).length(1)}).strict();
      const localized=localizedSchema.parse(JSON.parse(await inferLocalText([
        {role:'system',content:KNOWLEDGE_FRENCH_REFORMULATION_PROMPT},
        ...localMessages.filter(m=>m.role==='user'),
        {role:'user',content:JSON.stringify({draft:englishDraft.text})},
      ],{jsonSchema:z.toJSONSchema(localizedSchema,{target:'draft-7'}),timeoutMs:ALEXA_NATIVE_BUDGET.inferenceMs,maxOutputTokens:1024,signal})));
      signal.throwIfAborted();
      if(JSON.stringify(numericBounds(englishDraft.text))!==JSON.stringify(numericBounds(localized.sentences[0]!)))return fallback('quantity');
      answer={...answer,sentences:[{...englishDraft,text:localized.sentences[0]!}]};
    }
    const events: AlexaEvent[] = options.compact?[]:[message(knowledgeSynthesisCopy[locale].draft)];
    if(unverifiedCriteria)events.push(message(KNOWLEDGE_CRITERIA_COVERAGE));
    else if (answer.coverage === "partial") events.push(message(knowledgeSynthesisCopy[locale].partial));
    for (const sentence of answer.sentences) {
      if(options.compact&&(copiedEnglishProse(sentence.text)||/\p{L}\d+(?:,\d+){2,}/u.test(sentence.text)))return fallback('language');
      const unsafeKind=/<\/?[a-z][^>]*>/iu.test(sentence.text)?'markup':hiddenControls.test(sentence.text)?'controls'
        :personalClaim.test(numericFold(sentence.text))?'personal-claim':claimsPerformedAction(sentence.text)?'action-claim':null;
      if(unsafeKind){
        console.warn('[alexa-knowledge] rejected-text-kind',unsafeKind);
        if(unsafeKind==='action-claim'){
          const action=performedAction.exec(actionClaimText(sentence.text))?.[0]??'';
          console.warn('[alexa-knowledge] rejected-action-kind',/^prescri/u.test(action)?'prescribing':/^confirm/u.test(action)?'confirming':/^valid/u.test(action)?'validating':'record-change');
          if(!/^(?:prescri|confirm|valid)/u.test(action)){
            const kinds=[[/^(?:enregistr|sauvegard|saved|recorded)/u,'saving'],[/^(?:modifi|updated|mis)/u,'modification'],[/^(?:cree|created)/u,'creation'],[/^(?:supprim|deleted)/u,'deletion'],[/^(?:envoy|sent)/u,'sending'],[/^(?:execut|executed)/u,'execution'],[/^ajout/u,'addition']] as const;
            console.warn('[alexa-knowledge] rejected-record-kind',!action||/^signed/u.test(action)?'signature':kinds.find(([pattern])=>pattern.test(action))?.[1]??'other');
          }
        }
        return fallback('unsafe-text');
      }
      const used = [...new Set(sentence.evidence.map(evidence => evidence.index))];
      if(options.compact&&used.some(index=>headingOnlyEvidence(sentence.text,result.preuves[index-1]?.section??null)))return fallback('heading-only');
      for (const evidence of sentence.evidence) {
        const proof = result.preuves[evidence.index - 1];
        const quote = fold(evidence.quote);
        if (!proof || quote.length < 20 || (quote.match(/[\p{L}\p{N}]/gu)?.length ?? 0) < 12
          || hiddenControls.test(evidence.quote) || !fold(proof.extrait).includes(quote)) return fallback("quote-span");
        if(headingOnlyEvidence(evidence.quote,proof.section))return fallback('heading-only');
        if(bibliographyEvidence(proof.section)&&!bibliographyRequested(question))return fallback('bibliography-only');
        if(medications.length&&!medications.some(name=>requestedMedicationNames(evidence.quote).includes(name)))return fallback('entity');
      }
      const citedText = sentence.evidence.map(evidence => evidence.quote).join(" ");
      if(!medicationSpanGrounded(question,sentence.text,citedText))return fallback('entity');
      const normalizedSentence = numericFold(sentence.text);
      if (/\p{N}|±/u.test(normalizedSentence.replace(/[0-9]/gu, ""))) return fallback("unicode-number");
      const numbers = explicitNumbers(sentence.text);
      const supportedNumbers = new Set<string>(explicitNumbers(citedText));
      for (const quantity of quantities(citedText)) supportedNumbers.add(quantity.split(" ")[0]!);
      if (numbers.some(number => !supportedNumbers.has(number))){
        const withoutEdition=sentence.text.replace(/\bDSM[-\s]5(?:[-\s]TR)?\b/giu,'');
        const kind=explicitNumbers(withoutEdition).every(number=>supportedNumbers.has(number))?'source-edition'
          :quantities(sentence.text).some(quantity=>!supportedNumbers.has(quantity.split(' ')[0]!))?'clinical-quantity'
          :/(?:^|[\n;]\s*)\d+[.)]\s+\p{L}/u.test(sentence.text)?'editorial-enumeration':'standalone-number';
        console.warn('[alexa-knowledge] rejected-number-kind',kind);
        return fallback("number");
      }
      const supportedQuantities = new Set(quantities(citedText));
      if (quantities(sentence.text).some(quantity => !supportedQuantities.has(quantity))) return fallback("quantity");
      if((numbers.length||quantities(sentence.text).length)&&sentence.evidence.some(e=>!medicationNumericQuoteGrounded(question,e.quote,result.preuves[e.index-1]!.langue)))return fallback('entity');
      if (verifierCitations(sentence.text, used.map(index => result.preuves[index - 1]!)).verdict === "rejete") return fallback("citation");
      // Polarity cannot be proved from a matching citation. Preserve the literal
      // source instead of publishing a paraphrased exclusion or its reversal.
      if ((!negation.test(numericFold(citedText)) && !negation.test(normalizedSentence))
        || fold(citedText).includes(fold(sentence.text))) {
        events.push({ type: "sentence", text: sentence.text, kind: "inference", sources: used.map(index => ({...knowledgeSource(result.preuves[index - 1]!),...(options.compact?{excerpt:sentence.evidence.filter(e=>e.index===index).map(e=>e.quote).join(' ')}:{})})) });
      }else if(options.compact){return fallback('quote-polarity');
      }
      if(!options.compact)for (const evidence of sentence.evidence) events.push({ type: "sentence", text: knowledgeSynthesisCopy[locale].quote(evidence.quote),
        kind: "knowledge", sources: [knowledgeSource(result.preuves[evidence.index - 1]!)] });
    }
    if ("omittedLongPassages" in result && result.omittedLongPassages) events.push(message(copy.longKnowledge));
    if (events.reduce((total, event) => total + (event.type === "sentence" ? event.text.length : 0), 0) > 12000) return fallback("size");
    options.onCoverage?.(unverifiedCriteria||answer.coverage==='partial'||'omittedLongPassages' in result&&result.omittedLongPassages?'partial':'supported');
    if(options.compact){
      const sentences=events.filter((e):e is Extract<AlexaEvent,{type:'sentence'}>=>e.type==='sentence'),sources=new Map<string,AlexaSource>();
      for(const source of sentences.flatMap(e=>e.sources)){
        const previous=sources.get(source.id),quotes=[...new Set([previous?.excerpt,source.excerpt].filter((value):value is string=>!!value))];
        sources.set(source.id,{...source,...(quotes.length?{excerpt:quotes.join('\n\n')}:{})});
      }
      const comparisonFocuses=planKnowledgeQuery(question)?.sectionFocuses;
      if(comparisonFocuses?.some(focus=>!result.preuves.some(p=>sources.has(p.chunkId)&&matchesSectionFocus(p.section,focus))))return fallback('coverage');
      return [{type:'sentence',text:sentences.map(e=>e.text).join(' '),kind:'inference',sources:[...sources.values()]}];
    }
    return events;
  } catch(error) {
    signal.throwIfAborted();
    console.warn('[alexa-knowledge] local-failure',localModelFailureCode(error));
    return fallback(error instanceof SyntaxError?'parse':error instanceof z.ZodError?'schema':'provider');
  }
}
