import {z} from 'zod';
import {parsePatientMention} from './patient-mention';
const fold=(text:string)=>text.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/\s+/gu,' ').trim();
export const noteSearchRequested=(text:string):boolean=>/\b(?:cherch\w*|recherch\w*|(?:contien|contenan)\w*|mentionn\w*|parl\w*|propos|mots?|expressions?|phrases?)\b/u.test(fold(text));
export const documentBodySearchRequested=(text:string):boolean=>/\b(?:documents?|certificats?|ordonnances?|justificatifs?|justifications?)\b/u.test(fold(text))&&/\b(?:(?:contien|contenan)\w*|mentionn\w*|dont (?:le )?(?:texte|contenu)|par (?:le )?contenu|parlent de)\b/u.test(fold(text));
/** Identity resolution and literal content search are separate operations. */
export function noteQueryGrounded(text:string,query:string):boolean{
 const wanted=fold(query);if(!wanted)return true;
 if(!noteSearchRequested(text))return false;
 if([...text.matchAll(/[«“"]([^»”"]+)[»”"]/gu)].some(m=>fold(m[1]!)===wanted))return true;
 const mention=parsePatientMention(text),searchable=mention.status==='named'?fold(text).replace(fold(mention.name),''):fold(text);
 return new RegExp('(?<![\\p{L}\\p{N}])'+wanted.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?![\\p{L}\\p{N}])','u').test(searchable);
}

export const noteCursorSchema=z.object({offset:z.number().int().min(0).max(10000),textOffset:z.number().int().min(0).max(10000000)}).strict();
export const noteQuerySchema=z.object({consultationId:z.uuid().optional(),area:z.enum(['all','working','subjective','objective','assessment','plan','amendment','structured']).optional(),query:z.string().trim().max(160).optional(),from:z.iso.datetime({offset:true}).optional(),to:z.iso.datetime({offset:true}).optional(),status:z.enum(['all','open','closed']).optional(),offset:noteCursorSchema.shape.offset.optional(),textOffset:noteCursorSchema.shape.textOffset.optional(),maxCharacters:z.number().int().min(100).max(1200).optional(),revision:z.string().regex(/^[a-f0-9]{32}$/).optional(),reusePrevious:z.boolean().optional()}).strict();
export const noteReadQuerySchema=noteQuerySchema.omit({reusePrevious:true}).extend({patientId:z.uuid()}).strict().refine(v=>!!v.from===!!v.to&&(!v.from||Date.parse(v.from)<Date.parse(v.to!)),'InvalidPeriod');
export const noteContinuation=(text:string):boolean=>/^(?:la suite|suite|continue|continuer|poursuis|page suivante)[?!.\s]*$/iu.test(text.trim());
