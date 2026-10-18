import {vi} from 'vitest';
import type {DbPort,RpcArgs} from '@/services/db/port';
import type {Result} from '@/services/result';

/** Test fixture boundary: production readers still validate every unknown payload with Zod. */
export function scriptedAlexaRpc(handler:(name:string,args:RpcArgs)=>Promise<Result<readonly unknown[]>>){
 const spy=vi.fn(handler);
 return spy as typeof spy & DbPort["rpc"];
}
