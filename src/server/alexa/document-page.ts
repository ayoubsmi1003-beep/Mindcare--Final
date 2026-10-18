import {createHash} from 'node:crypto';
import {AgentReadError} from '@/shared/alexa/agent';
import {applicationReadCopy as copy} from '@/i18n/alexa-application';
/** A complete literal text is re-read behind its gate for every page; cursors bind the source and query. */
export function documentPage(id:string,text:string,sourceRevision:string|number,query:Record<string,unknown>,textOffset:number,revision?:string){
 const hash=createHash('sha256').update(JSON.stringify([id,sourceRevision,query,text])).digest('hex');
 if(revision&&revision!==hash)throw new AgentReadError('changed');
 if(textOffset>text.length||(textOffset>0&&/[\uDC00-\uDFFF]/u.test(text[textOffset]??'')&&/[\uD800-\uDBFF]/u.test(text[textOffset-1]??'')))throw new AgentReadError('malformed');
 let end=Math.min(text.length,textOffset+1200);if(end<text.length&&/[\uD800-\uDBFF]/u.test(text[end-1]??'')&&/[\uDC00-\uDFFF]/u.test(text[end]??''))end--;
 const excerpt=text.slice(textOffset,end),complete=end>=text.length;
 return {complete,document:{id,excerpt,textLength:text.length,textOffset,sourceRevision:typeof sourceRevision==='number'?sourceRevision:hash},revision:hash,documentQuery:query,...(!complete?{nextTextOffset:end}:{}),coverage:copy.documentCoverage(textOffset,end,text.length,complete)};
}
