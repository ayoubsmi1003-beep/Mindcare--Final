import {z} from 'zod';

export const noteCursorSchema=z.object({offset:z.number().int().min(0).max(10000),textOffset:z.number().int().min(0).max(10000000)}).strict();
export const noteQuerySchema=z.object({consultationId:z.uuid().optional(),area:z.enum(['all','working','subjective','objective','assessment','plan','amendment','structured']).optional(),query:z.string().trim().max(160).optional(),from:z.iso.datetime({offset:true}).optional(),to:z.iso.datetime({offset:true}).optional(),status:z.enum(['all','open','closed']).optional(),offset:noteCursorSchema.shape.offset.optional(),textOffset:noteCursorSchema.shape.textOffset.optional(),maxCharacters:z.number().int().min(100).max(1200).optional(),revision:z.string().regex(/^[a-f0-9]{32}$/).optional(),reusePrevious:z.boolean().optional()}).strict();
export const noteReadQuerySchema=noteQuerySchema.omit({reusePrevious:true}).extend({patientId:z.uuid()}).strict().refine(v=>!!v.from===!!v.to&&(!v.from||Date.parse(v.from)<Date.parse(v.to!)),'InvalidPeriod');
export const noteContinuation=(text:string):boolean=>/^(?:la suite|suite|continue|continuer|poursuis|page suivante)[?!.\s]*$/iu.test(text.trim());
