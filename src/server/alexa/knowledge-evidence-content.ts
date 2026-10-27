const normalized=(value:string)=>value.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const leaf=(section:string|null)=>section?.split(/›|»|\s>\s/u).at(-1)?.trim()??'';

/** A repeated heading is a locator, not evidence for a medical assertion. */
export function headingOnlyEvidence(text:string,section:string|null):boolean{
 const title=normalized(leaf(section)),body=normalized(text.replace(/\[[^\]]*\]/gu,''));
 if(!!title&&(body===title||body===title.repeat(2)))return true;
 if(!section)return false;
 // A topic heading followed by an empty A./B. marker still contains no criterion.
 let remainder=normalized(text.replace(/\[[^\]]*\]/gu,'').replace(/(?:^|\s)[A-H]\.(?=\s|$)/gu,''));
 const headings=section.split(/›|»|\s>\s/u).map(normalized).filter(Boolean).sort((a,b)=>b.length-a.length);
 for(const heading of headings)remainder=remainder.split(heading).join('');
 return !!body&&!remainder;
}
export const bibliographyEvidence=(section:string|null)=>/\b(?:bibliograph\w*|bibliogr\w*|references)\b/u.test(leaf(section).normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase());
/**
 * Le sommaire alphabétique de fin d'ouvrage n'est pas une preuve clinique :
 * il cite un sujet sans le traiter. Sans ce filtre, l'index de Taylor remonte
 * en tête sur « side effects olanzapine » (mesuré).
 */
export const indexEvidence=(section:string|null)=>/^(?:index|index alphabetique|subject index|index des matieres)$/u.test(leaf(section).normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().trim());
export const indexRequested=(question:string)=>/r?\bindex\b/u.test(question.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase());
export const bibliographyRequested=(question:string)=>/\b(?:bibliogr\w*|references bibliographiques|liste des references|titres des references|auteurs des references)\b/u.test(question.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase());
/** Multiple journal records near the start identify a reference list even under a generic section label. */
export function bibliographyTextEvidence(text:string):boolean{
 const references=[...text.matchAll(/\b(?:19|20)\d{2};\s*\d+(?:\s+Suppl\s+\d+)?\s*:\s*\d+/giu)];
 return references.length>=2&&references[0]!.index<240;
}
/** Repeated empty column labels cannot establish relationships in a flattened table. */
export const unboundTableEvidence=(text:string)=>/(?:^|\s)([\p{L}][\p{L} ]{0,35}:)\s*(?:\1\s*){2,}$/iu.test(text.trim());
/** Reject obvious English prose copied as a French answer; source excerpts remain verbatim. */
export function copiedEnglishProse(text:string):boolean{
 const words=text.toLowerCase().match(/\p{L}+/gu)??[];
 const english=words.filter(word=>/^(?:the|of|with|without|is|are|was|were|has|have|been|in|than|unchanged|excreted|found|patients)$/u.test(word)).length;
 const french=words.some(word=>/^(?:le|la|les|du|des|un|une|est|sont|dans|chez|selon|avec|sans|moins|plus|pour)$/u.test(word));
 return english>=2&&!french;
}
import {medicationNames} from '@/shared/alexa/medications';
export function knowledgeComparisonRequested(question:string):boolean{
 const text=question.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase();
 return /\b(?:compar\w*|differences?|versus|vs)\b|فرق|قارن/u.test(text)
  ||/\b(?:distingu\w*|distinction)\b/u.test(text)&&/\b(?:entre|et|versus|vs)\b|\//u.test(text);
}
export function requestedMedicationNames(text:string):readonly string[]{
 const words=new Set(text.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().match(/\p{L}+/gu)??[]);
 return medicationNames.filter(name=>words.has(name));
}
/** Necessary entity binding, in addition to quote/quantity checks and independent clinical review. */
export function medicationSpanGrounded(question:string,sentence:string,quote:string):boolean{
 const requested=requestedMedicationNames(question);if(!requested.length)return true;
 const claimed=requestedMedicationNames(sentence),cited=requestedMedicationNames(quote);
 const subjects=claimed.length?claimed:requested;
 return subjects.every(name=>cited.includes(name))&&requested.some(name=>cited.includes(name));
}
/** A number in a neighbouring entry cannot support the requested medication. */
export function medicationNumericQuoteGrounded(question:string,quote:string,language:string):boolean{
 const requested=requestedMedicationNames(question);if(!requested.length)return true;
 const numeric=/\p{N}|\b(?:one|two|three|four|five|six|seven|eight|nine|ten|un|une|deux|trois|quatre|cinq|sept|huit|neuf|dix)\b/iu;
 const numericSentences=[...new Intl.Segmenter(language==='en'?'en':'fr',{granularity:'sentence'}).segment(quote)].map(row=>row.segment).filter(text=>numeric.test(text));
 return numericSentences.length>0&&numericSentences.every(text=>{
  const names=requestedMedicationNames(text);
  return names.some(name=>requested.includes(name))&&names.every(name=>requested.includes(name));
 });
}
/** Complete sentences once, without duplicating the source in the local context. */
export function issuedQuoteChoices(text:string,language:string):readonly string[]{
 const spans:{start:number;end:number}[]=[];
 let start=0;
 for(const row of new Intl.Segmenter(language==='en'?'en':'fr',{granularity:'sentence'}).segment(text)){
  const end=row.index+row.segment.length,length=text.slice(start,end).trim().length;
  if(length>1200)return [];
  if(length>=20){spans.push({start,end});start=end;}
 }
 if(text.slice(start).trim()){
  const last=spans.at(-1);if(!last||text.slice(last.start).trim().length>1200)return [];
  last.end=text.length;
 }
 return spans.map(span=>text.slice(span.start,span.end).trim());
}
