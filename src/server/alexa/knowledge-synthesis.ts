import {z} from 'zod';
import { noteTurnCode } from "./turn-trace";
import { explicitNumbers, frenchAidAcceptable, frenchAidEligible, hiddenControls, medicationBoundBySection, numericEvidenceAllowed, numericFold, quantities } from "./knowledge-french";
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
import {isKnowledgeLocationQuestion,planKnowledgeQuery,matchesSectionFocus} from './knowledge-query';
import { verifierCitations } from "@/server/knowledge/citations";
import { knowledgeMessages, isIssuedKnowledgeEnvelope, type KnowledgeTask, type KnowledgeFocus } from "./knowledge-envelope";
import { knowledgeExcerptForSpeech, knowledgeResponseEvents, knowledgeSource, mentionsKnowledgeBookTitle, type KnowledgeResult } from "./knowledge-response";

const fold = (value: string) => value.normalize("NFC").replace(/\s+/gu, " ").trim();
const answerMetadata=z.object({coverage:knowledgeAnswerSchema.shape.coverage,sentences:z.array(z.unknown()).max(5)});
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
 const scaffolding=new Set(['quels','quelles','quel','quelle','criteres','les','des','du','de','d','dans','le','la','sont','est','decrits','decrit','documentes','documentees','selon','donne','donner','liste','lister','presente','presenter','enumere','enumerer',
  'pour','caracteriser','un','episode','depressif','seuils','symptomes','et','duree','faut','il','verifier']);
 return (text.match(/\p{L}+/gu)??[]).every(word=>scaffolding.has(word));
}

/** Synthesis cannot call tools. Every emitted paragraph must cite a literal span of this turn's evidence. */
const FRENCH_AID_LATEST_START_MS=150_000;
export async function synthesizeKnowledge(result: KnowledgeResult, question: string, language: AlexaLanguage, signal: AbortSignal, options:{compact?:boolean;onCoverage?:(coverage:'supported'|'partial')=>void}={}): Promise<AlexaEvent[]> {
  const synthesisStartedAt=Date.now();
  const locale = language === "fr" ? "fr" : "ar";
  const copy = dialogue(language);
  const message = (text: string): AlexaEvent => ({ type: "sentence", text, kind: "knowledge", sources: [] });
  let extractiveChoices: Array<{ proof: KnowledgeResult["preuves"][number]; quote: string; order: number }> = [];
  /**
   * The ingested chunk carries its breadcrumb ("Sertraline › Dosing and Use ›
   * Other Warnings/Precautions — …"). The breadcrumb is provenance, already
   * carried by `proof.section`; repeating it inside the quoted sentence makes
   * the answer look like a raw index row. Strip an EXACT leading prefix only.
   */
  const sansEnteteDeSection = (quote: string, section: string | null): string => {
    if (!section) return quote;
    const escaped = section.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const stripped = quote.replace(new RegExp(`^${escaped}\\s*(?:—|–|-)\\s*`, "u"), "").trim();
    return stripped.length ? stripped : quote;
  };
  // A number that relies on its heading must show that heading: drug or population may be there.
  const framedQuote = (proof: KnowledgeResult["preuves"][number], quote: string): string =>
    proof.section && (explicitNumbers(quote).length || quantities(quote).length) && !requestedMedicationNames(quote).length
      ? knowledgeSynthesisCopy.fr.quoteIn(proof.section, quote) : knowledgeSynthesisCopy[locale].quote(quote);
  const extractiveFallback = (): AlexaEvent[] | null => {
    // Same per-quote checks as the main path: this path must never be the weaker one.
    const groundedChoices = extractiveChoices.filter(({ proof, quote }) => !hiddenControls.test(quote)
      && !/\p{N}|±/u.test(numericFold(quote).replace(/[0-9]/gu, ""))
      && numericEvidenceAllowed(question, quote, proof.langue, proof.section));
    if (!groundedChoices.length) return null;
    const stop = new Set(["avec", "dans", "pour", "quel", "quels", "quelle", "quelles", "comment", "combien", "quoi", "sont", "être", "cette", "cette", "leur", "leurs", "plus", "moins", "selon", "entre", "dont", "aussi", "peut", "faut", "il", "elle", "nous", "vous", "mais", "donc", "alors", "tout", "tous", "toute", "toutes", "sans", "chez", "dossier", "patient", "patiente"]);
    const words = new Set((numericFold(question).match(/[\p{L}\p{N}]+/gu) ?? []).filter(word => word.length >= 4 && !stop.has(word)));
    const scored = groundedChoices.map(entry => ({
      ...entry,
      score: [...words].reduce((total, word) => total + (numericFold(entry.quote).includes(word) ? 1 : 0), 0),
    })).sort((left, right) => right.score - left.score || left.order - right.order);
    const selected = scored.filter(entry => entry.score > 0).slice(0, 3);
    let pool = selected.length ? selected : scored.slice(0, 1);
    // A comparison answered for one drug only reads as the whole answer.
    const compared = knowledgeComparisonRequested(question) ? requestedMedicationNames(question) : [];
    if (compared.length > 1) {
      const covering = compared.map(name => scored.find(entry => requestedMedicationNames(entry.quote).includes(name)));
      if (covering.some(entry => entry === undefined)) return null;
      pool = [...new Set(covering as typeof scored)];
    }
    const sentences: Extract<AlexaEvent, { type: "sentence" }>[] = [];
    for (const entry of pool) {
      const quote = knowledgeExcerptForSpeech(sansEnteteDeSection(entry.quote, entry.proof.section));
      if (quote === null) continue;
      sentences.push({
        type: "sentence",
        text: framedQuote(entry.proof, quote),
        kind: "knowledge",
        sources: [{ ...knowledgeSource(entry.proof), excerpt: quote }],
      });
    }
    if (!sentences.length) return null;
    if (options.compact) {
      const sources = new Map<string, AlexaSource>();
      for (const source of sentences.flatMap(sentence => sentence.sources)) {
        const previous = sources.get(source.id);
        const excerpts = [...new Set([previous?.excerpt, source.excerpt].filter((value): value is string => !!value))];
        sources.set(source.id, { ...source, ...(excerpts.length ? { excerpt: excerpts.join("\n\n") } : {}) });
      }
      return [{ type: "sentence", text: sentences.map(sentence => sentence.text).join(" "), kind: "knowledge", sources: [...sources.values()] }];
    }
    return sentences;
  };
  // Only literal approved passages are published on these paths, so the model's failure
  // or its discarded text never hides evidence the retrieval found.
  const EXTRACTIVE_REASONS = new Set(["citation", "quote", "quote-span", "quote-polarity", "schema", "parse", "empty-answer", "insufficient-nonempty", "coverage", "provider", "entity", "source-title"]);
  const fallback = (reason: "provider" | "schema" | "coverage" | "insufficient-nonempty" | "empty-answer" | "heading-only" | "bibliography-only" | "language" | "entity" | "criteria-selection" | "unsafe-text" | "quote" | "quote-span" | "quote-polarity" | "unicode-number" | "number" | "quantity" | "citation" | "source-title" | "size" | "parse" = "parse") => {
    console.warn("[alexa-knowledge] source-fallback", reason);
    noteTurnCode("knowledge", `source-fallback:${reason}`);
    if (EXTRACTIVE_REASONS.has(reason)) {
      const extracted = extractiveFallback();
      if (extracted) return extracted;
    }
    if(options.compact)return [{type:'sentence' as const,text:knowledgeSynthesisCopy.fr.compactUnavailable,kind:'knowledge' as const,sources:isIssuedKnowledgeResult(result)?result.preuves.map(p=>knowledgeSource(p)):[]}];
    return [message(knowledgeSynthesisCopy[locale].unavailable), ...knowledgeResponseEvents(result, language)];
  };
  if (isIssuedKnowledgeResult(result) && isKnowledgeLocationQuestion(question)) {
    return knowledgeResponseEvents(result, language, false, [], question);
  }
  const messages = knowledgeMessages(result, taskFor(question), locale, focusFor(question));
  if (process.env["ALEXA_DEBUG_KNOWLEDGE"] === "1") {
    console.warn("[alexa-knowledge] synthesis-entry", JSON.stringify({
      etat: result.etat, proofs: result.preuves.length, issued: isIssuedKnowledgeResult(result),
      messages: messages !== null, envelope: messages !== null && isIssuedKnowledgeEnvelope(messages), compact: options.compact === true,
    }));
  }
  // A weak match is not an answer, but hiding it leaves the doctor with nothing to check.
  // Show the closest literal passages, labelled as such, under the same per-quote rules.
  if(options.compact&&result.etat==='faible'&&isIssuedKnowledgeResult(result)){
    const requested=requestedMedicationNames(question);
    const closest=result.preuves.flatMap(proof=>{
      const quote=issuedQuoteChoices(proof.extrait,proof.langue).find(text=>!headingOnlyEvidence(text,proof.section)&&!hiddenControls.test(text)
        &&!/\p{N}|±/u.test(numericFold(text).replace(/[0-9]/gu,''))&&(!requested.length||requested.some(name=>requestedMedicationNames(text).includes(name))||medicationBoundBySection(question,text,proof.section))
        &&numericEvidenceAllowed(question,text,proof.langue,proof.section));
      const excerpt=quote?knowledgeExcerptForSpeech(sansEnteteDeSection(quote,proof.section)):null;
      return excerpt?[{proof,excerpt}]:[];
    }).slice(0,2);
    noteTurnCode('knowledge',closest.length?'faible-closest-shown':'faible-nothing-citable');
    if(closest.length)return [{type:'sentence',text:[copy.weakKnowledge,...closest.map(({proof,excerpt})=>framedQuote(proof,excerpt))].join(' '),kind:'knowledge',sources:closest.map(({proof,excerpt})=>({...knowledgeSource(proof),excerpt}))}];
  }
  // Local inference only: the evidence envelope is server-issued and frozen,
  // and no byte leaves the machine. The egress classifier's person-name
  // heuristic is not an egress control here and rejects book titles
  // ("Prescriber's Guide") and section paths ("Sertraline Dosing") as names.
  // Identifier/injection checks remain at the real egress boundary.
  if (!messages || !isIssuedKnowledgeEnvelope(messages))
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
    const allowedQuoteIds=quotes.flatMap((text,i)=>(!extractiveCriteria||isRequestedCriteriaProof(proof))&&!headingOnlyEvidence(text,proof.section)&&(!bibliographyEvidence(proof.section)||bibliographyRequested(question))&&(!medications.length||medications.some(name=>requestedMedicationNames(text).includes(name))||medicationBoundBySection(question,text,proof.section))?['q'+(i+1)]:[]);
    return {index:index+1,quotes,allowedQuoteIds};
  });
  extractiveChoices = choices.flatMap((row, index) => row.allowedQuoteIds.flatMap(id => {
    const quote = row.quotes[Number(id.slice(1)) - 1];
    const proof = result.preuves[index];
    return quote && proof ? [{ proof, quote, order: index * 100 + Number(id.slice(1)) }] : [];
  }));
  const omittedQuotes=options.compact&&choices.some((row,index)=>fold(row.quotes.join(' '))!==fold(result.preuves[index]!.extrait));
  // A bibliographic marker or a heading is not a citable span. Rejecting the
  // WHOLE synthesis because the split quotes do not reconstruct the raw chunk
  // discarded every real answer; the model's citations are still bounded by
  // `allowedQuoteIds` and checked below.
  if(omittedQuotes)console.warn('[alexa-knowledge] quote-context-omitted');
  if(options.compact&&choices.every(row=>!row.allowedQuoteIds.length)){
    if(extractiveCriteria)console.warn('[alexa-knowledge] criteria-selection-rejected','no-allowed-quote');
    return fallback(extractiveCriteria?'criteria-selection':'entity');
  }
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
      maxOutputTokens: options.compact?(extractiveCriteria?256:1024):1024, signal });
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
      const selected=new Set<string>();
      for(const sentence of answer.sentences){
        for(const evidence of sentence.evidence){
          const proof=result.preuves[evidence.index-1];
          if(!proof||!isRequestedCriteriaProof(proof)){console.warn('[alexa-knowledge] criteria-selection-rejected','section');return fallback('criteria-selection');}
          const key=JSON.stringify([evidence.index,evidence.quote]);
          if(selected.has(key))continue;
          if(sentences.length>=5){console.warn('[alexa-knowledge] criteria-selection-rejected','quote-count');return fallback('criteria-selection');}
          selected.add(key);
          // Models may group several selected sources into one sentence. Split
          // their references and emit each exact approved quote independently.
          sentences.push({...sentence,text:evidence.quote,evidence:[evidence]});
        }
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
    const events: AlexaEvent[] = options.compact?[]:[message(knowledgeSynthesisCopy[locale].draft)];
    if(unverifiedCriteria)events.push(message(KNOWLEDGE_CRITERIA_COVERAGE));
    else if (answer.coverage === "partial") events.push(message(knowledgeSynthesisCopy[locale].partial));
    // Indices RÉELLEMENT cités par les phrases acceptées : la ligne de sources
    // ne mentionne que ces passages, jamais un voisin récupéré mais inutilisé.
    let frenchRenderings=0,hasFrenchAid=false;
    const frenchOf=async(proof:KnowledgeResult['preuves'][number],quote:string):Promise<string|null>=>{
      if(!options.compact||locale!=='fr'||proof.langue!=='en'||frenchRenderings>=2)return null;
      if(!frenchAidEligible(quote)){noteTurnCode('knowledge','french-ineligible');return null;}
      // Validated quotes must not be lost to the turn deadline for the sake of an optional aid.
      if(Date.now()-synthesisStartedAt>FRENCH_AID_LATEST_START_MS){noteTurnCode('knowledge','french-skipped:budget');return null;}
      frenchRenderings++;
      try{
        const schema=z.object({sentences:z.array(z.string().min(1).max(1600)).length(1)}).strict();
        const completion=await inferLocalText([{role:'system',content:KNOWLEDGE_FRENCH_REFORMULATION_PROMPT},{role:'user',content:JSON.stringify({draft:quote})}],
          {jsonSchema:z.toJSONSchema(schema,{target:'draft-7'}),timeoutMs:ALEXA_NATIVE_BUDGET.inferenceMs,maxOutputTokens:1024,signal});
        signal.throwIfAborted();
        const french=schema.parse(JSON.parse(completion)).sentences[0]!.trim(),verdict=frenchAidAcceptable(quote,french);
        if(!verdict.ok){noteTurnCode('knowledge',`french-rejected:${verdict.reason}`);return null;}
        if(personalClaim.test(numericFold(french))||claimsPerformedAction(french)||mentionsKnowledgeBookTitle(french)){noteTurnCode('knowledge','french-rejected:unsafe');return null;}
        noteTurnCode('knowledge','french-aid');
        return french;
      }catch(error){
        signal.throwIfAborted();
        noteTurnCode('knowledge',`french-failed:${localModelFailureCode(error)}`);
        return null;
      }
    };
    for (const sentence of answer.sentences) {
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
        if(medications.length&&!medications.some(name=>requestedMedicationNames(evidence.quote).includes(name))&&!medicationBoundBySection(question,evidence.quote,proof.section))return fallback('entity');
      }
      const citedText = sentence.evidence.map(evidence => evidence.quote).join(" ");
      // The model's sentence text is not emitted; validate the exact literal passages.
      if(!medicationSpanGrounded(question,citedText,citedText)&&!sentence.evidence.every(e=>medicationBoundBySection(question,e.quote,result.preuves[e.index-1]!.section)))return fallback('entity');
      const normalizedSentence = numericFold(citedText);
      if (/\p{N}|±/u.test(normalizedSentence.replace(/[0-9]/gu, ""))) return fallback("unicode-number");
      const numbers = explicitNumbers(citedText);
      const quotedQuantities = quantities(citedText);
      if((numbers.length||quotedQuantities.length)&&sentence.evidence.some(e=>!numericEvidenceAllowed(question,e.quote,result.preuves[e.index-1]!.langue,result.preuves[e.index-1]!.section)))return fallback('entity');
      if (verifierCitations(citedText, used.map(index => result.preuves[index - 1]!)).verdict === "rejete") return fallback("citation");
      // A genuine citation cannot establish that generated prose follows from it. The model
      // selects quotes; the server frames them. The only model text ever emitted is the French
      // reading aid, placed after the literal passage and marked as unverified.
      for (const evidence of sentence.evidence) {
        const proof=result.preuves[evidence.index-1]!;
        const quote = knowledgeExcerptForSpeech(sansEnteteDeSection(evidence.quote, proof.section));
        if(quote===null)return fallback('source-title');
        const french=await frenchOf(proof,quote);
        if(french)hasFrenchAid=true;
        events.push({ type: "sentence", text: framedQuote(proof,quote)+(french?' '+knowledgeSynthesisCopy.fr.readingAid(french):''),
          kind: french?"inference":"knowledge", sources: [{...knowledgeSource(proof),excerpt:quote}] });
      }
    }
    if ("omittedLongPassages" in result && result.omittedLongPassages) events.push(message(copy.longKnowledge));
    if (events.reduce((total, event) => total + (event.type === "sentence" ? event.text.length : 0), 0) > 12000) return fallback("size");
    // Deliberate: the evidence is the verbatim approved quote, not the model's prose.
    // An answer built this way is therefore never certified `supported`
    // (tests: "does not publish a generated claim as supported", criteria).
    options.onCoverage?.("partial");
    if(options.compact){
      const sentences=events.filter((e):e is Extract<AlexaEvent,{type:'sentence'}>=>e.type==='sentence'),sources=new Map<string,AlexaSource>();
      for(const source of sentences.flatMap(e=>e.sources)){
        const previous=sources.get(source.id),quotes=[...new Set([previous?.excerpt,source.excerpt].filter((value):value is string=>!!value))];
        sources.set(source.id,{...source,...(quotes.length?{excerpt:quotes.join('\n\n')}:{})});
      }
      const comparisonFocuses=planKnowledgeQuery(question)?.sectionFocuses;
      if(comparisonFocuses?.some(focus=>!result.preuves.some(p=>sources.has(p.chunkId)&&matchesSectionFocus(p.section,focus))))return fallback('coverage');
      return [{type:'sentence',text:sentences.map(e=>e.text).join(' '),kind:hasFrenchAid?'inference':'knowledge',sources:[...sources.values()]}];
    }
    return events;
  } catch(error) {
    signal.throwIfAborted();
    console.warn('[alexa-knowledge] local-failure',localModelFailureCode(error));
    return fallback(error instanceof SyntaxError?'parse':error instanceof z.ZodError?'schema':'provider');
  }
}

