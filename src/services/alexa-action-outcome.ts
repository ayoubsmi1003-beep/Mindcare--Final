import {z} from 'zod';import {db} from './db';
const outcome=z.object({state:z.enum(['proposed','confirmed','executed','failed','rejected']),tool:z.string().max(80),affectedId:z.uuid().nullable()}).strict();
export type AlexaActionOutcome=z.infer<typeof outcome>;
/** Read the same action after an uncertain transport. Never submits another write. */
export async function readAlexaActionOutcome(actionId:string):Promise<AlexaActionOutcome|null>{
 try{const r=await db().rpc<unknown>('get_alexa_action_outcome',{p_id:actionId});if(!r.ok)return null;return outcome.safeParse(r.data[0]).data??null;}catch{return null;}
}
