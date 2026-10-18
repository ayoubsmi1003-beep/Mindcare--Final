import {parseDocumentContent,nodeText} from '@/shared/documents/content';import type {DocumentNode} from '@/shared/documents/types';
/** Literal recorded content: inline runs stay adjacent, while document blocks stay separate. */
export function documentText(value:unknown):string{
 const content=parseDocumentContent(value);
 const block=(node:DocumentNode):string=>['doc','bulletList','orderedList','listItem'].includes(node.type)?(node.content??[]).map(block).join('\n'):nodeText(node);
 return block(content);
}
/** Issued HTML is displayed as text only; decode entities after removing markup. */
export function issuedDocumentText(html:string):string{
 const entities:Record<string,string>={nbsp:' ',amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",ndash:'–',mdash:'—',hellip:'…'};
 return html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/giu,'').replace(/<\/?(?:p|div|li|ul|ol|table|tr|h[1-6]|br|hr|blockquote|section|header|footer)\b[^>]*>/giu,'\n').replace(/<\/?(?:td|th)\b[^>]*>/giu,' ').replace(/<[^>]*>/gu,'').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/giu,(entity:string,name:string)=>{
  if(name.startsWith('#')){const code=Number.parseInt(name.slice(/^#x/iu.test(name)?2:1),/^#x/iu.test(name)?16:10);return code>0&&code<=0x10ffff&&!(code>=0xd800&&code<=0xdfff)?String.fromCodePoint(code):entity;}
  return entities[name.toLowerCase()]??entity;
 }).replace(/[ \t\f\v]+/gu,' ').replace(/ *\n */gu,'\n').replace(/\n{2,}/gu,'\n').trim();
}
export function documentExcerpt(value:unknown):{text:string;complete:boolean}{
 const text=documentText(value);return {text:text.slice(0,3000),complete:text.length<=3000};
}
