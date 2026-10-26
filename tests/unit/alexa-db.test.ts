import {beforeEach,expect,it,vi} from 'vitest';

const {withCallerMock,faireePgPortMock,portRpc}=vi.hoisted(()=>({withCallerMock:vi.fn(),faireePgPortMock:vi.fn(),portRpc:vi.fn()}));
vi.mock('@/server/db/withCaller',()=>({withCaller:withCallerMock}));
vi.mock('@/server/db/pgPort',()=>({faireePgPort:faireePgPortMock}));
import {alexaDb} from '@/server/alexa/db';

beforeEach(()=>{
 vi.clearAllMocks();
 portRpc.mockResolvedValue({ok:true,data:[]});
 faireePgPortMock.mockReturnValue({rpc:portRpc});
 withCallerMock.mockImplementation(async(_actor:string,fn:(q:unknown)=>Promise<unknown>)=>fn({query:vi.fn()}));
});

it('uses the bounded patient-search statement budget only for the Alexa patient query gate',async()=>{
 const db=alexaDb('verified-doctor');
 await db.rpc('search_patients',{p_spec:'{}',p_as_of:'2026-10-26T12:00:00Z'});
 expect(withCallerMock.mock.calls[0]?.[0]).toBe('verified-doctor');
 expect(withCallerMock.mock.calls[0]?.[2]).toEqual({statementTimeout:'patient-search'});
 expect(portRpc).toHaveBeenCalledWith('search_patients',{p_spec:'{}',p_as_of:'2026-10-26T12:00:00Z'});
});

it('keeps other Alexa gates on the default statement budget',async()=>{
 await alexaDb('verified-doctor').rpc('query_alexa_records',{p_spec:'{}',p_as_of:'2026-10-26T12:00:00Z'});
 expect(withCallerMock.mock.calls[0]?.[2]).toBeUndefined();
 expect(portRpc).toHaveBeenCalledWith('query_alexa_records',{p_spec:'{}',p_as_of:'2026-10-26T12:00:00Z'});
});
