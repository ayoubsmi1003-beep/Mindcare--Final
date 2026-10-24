import type {AgentResult} from '@/shared/alexa/agent';

/** Preserve requested lists and verbatim notes; simple verified facts form one paragraph. */
export function presentAgentResults(results:readonly AgentResult[],question:string):string[]{
 const detailed=/\b(?:liste\w*|noms?|lesquels|lesquelles|mot pour mot|lis|lire|detail\w*|integral\w*)\b/u.test(question.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase());
 const linked=results.some(r=>r.links?.length);
 const texts=results.filter(r=>r.text).map(r=>detailed||linked?r.text:r.text.replace(/\s*\n\s*/gu,' ').trim());
 return detailed||linked?texts:texts.length?[texts.join(' ')]:[];
}
