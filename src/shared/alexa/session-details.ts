import { z } from 'zod';
const score = z.number().int().min(1).max(10).nullable();
export const sessionDetailsSchema = z.object({
  focus: z.array(z.string().trim().min(1).max(200)).max(20),
  focusLibre: z.string().max(2000),
  mesures: z.object({ anxiete: score, sommeil: score, humeur: score }).strict(),
  scoreConvention: z.literal('difficulty-v1'),
}).strict();
export type SessionDetails = z.infer<typeof sessionDetailsSchema>;
export function measureChanges(previous:SessionDetails|null|undefined,current:SessionDetails|null|undefined){
  if(!previous||!current)return [];
  return (['anxiete','sommeil','humeur'] as const).flatMap(key=>{
    const before=previous.mesures[key],after=current.mesures[key];
    return before===null||after===null?[]:[{key,previous:before,current:after,delta:after-before}];
  });
}
export const emptySessionDetails = (): SessionDetails => ({focus:[],focusLibre:'',mesures:{anxiete:null,sommeil:null,humeur:null},scoreConvention:'difficulty-v1'});
