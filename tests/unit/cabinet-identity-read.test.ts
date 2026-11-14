import {describe,it,expect,vi,beforeEach} from 'vitest';
const mocks=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('@/services/db',()=>({db:()=>({rpc:mocks.rpc})}));
vi.mock('@/services/log',()=>({log:{error:vi.fn(),info:vi.fn()}}));
import {getCabinet,getProfil} from '@/services/cabinet';
describe('identity reads preserve failure classification',()=>{
 beforeEach(()=>vi.clearAllMocks());
 it.each(['interdit','indisponible'] as const)('does not turn %s into missing identity',async code=>{
  const error={code,message:'Erreur synthétique'};mocks.rpc.mockResolvedValue({ok:false,error});
  await expect(getProfil()).resolves.toEqual({ok:false,error});await expect(getCabinet()).resolves.toEqual({ok:false,error});
 });
 it('distinguishes an absent profile from a configured bilingual profile',async()=>{
  mocks.rpc.mockResolvedValueOnce({ok:true,data:[]});await expect(getProfil()).resolves.toEqual({ok:true,data:null});
  mocks.rpc.mockResolvedValueOnce({ok:true,data:[{id:'synthetic',full_name:'Praticienne synthétique',title:'Dr',speciality_fr:'Psychiatrie',speciality_ar:'طب نفسي',order_number:'TEST-001',phone:'0000000000',signature_block:{full_name_ar:'اسم تجريبي'}}]});
  await expect(getProfil()).resolves.toMatchObject({ok:true,data:{fullName:'Praticienne synthétique',fullNameAr:'اسم تجريبي',orderNumber:'TEST-001'}});
 });
});
