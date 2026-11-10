import {vi} from 'vitest';
import { NAME_CHECK_LIMIT } from "@/server/alexa/patient-resolver";
import type {DbPort,RpcArgs} from '@/services/db/port';
import type {Result} from '@/services/result';

/** Test fixture boundary: production readers still validate every unknown payload with Zod. */
export function scriptedAlexaRpc(handler:(name:string,args:RpcArgs)=>Promise<Result<readonly unknown[]>>){
 // The name check of a read looks words up in the patient search. A script that doesn't handle that call finds nobody.
 const spy=vi.fn(async(name:string,args:RpcArgs)=>{
  if(name!=='search_patients'||args['p_limit']!==NAME_CHECK_LIMIT)return handler(name,args);
  try{return await handler(name,args);}catch{return {ok:true as const,data:[] as readonly unknown[]};}
 });
 return spy as typeof spy & DbPort["rpc"];
}
