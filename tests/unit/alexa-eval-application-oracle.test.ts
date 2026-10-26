import {expect,it,vi} from 'vitest';
import {applicationOracle} from '../../scripts/lib/alexa-eval-oracle.mjs';

const actor='ea000000-0000-4000-8000-000000000001';
const asOf='2026-10-28T12:00:00+01:00';

it.each([
 ['cabinet',{id:'22222222-2222-4222-8222-222222222222',name:'Cabinet de test',address:'Adresse de test',phone:'0550000000'},'get_my_cabinet'],
 ['practitioner',{id:actor,full_name:'Docteur de test',title:null,speciality_fr:'Psychiatrie',speciality_ar:null,order_number:'12345',phone:null},'get_my_profile'],
 ['notifications',{view:'notifications',total:3,unread:1,kinds:[{kind:'patient_arrived',total:3,unread:1}],totalKinds:1,offset:0,hasMore:false,revision:'a'.repeat(32)},'get_alexa_office_status'],
 ['system',{view:'system',environment:'self-hosted'},'get_alexa_office_status'],
])('builds the independent actor-scoped oracle for the %s read', (view,row,gate)=>{
 const inspect=vi.fn((..._args:[string])=>[row]);
 const result=applicationOracle({view},asOf,actor,inspect);
 expect(inspect).toHaveBeenCalledOnce();
 const sql=inspect.mock.calls[0]?.[0] as string;
 if(view!=='system')expect(sql).toContain(actor);
 expect(result).toMatchObject({gate});
 if(view==='notifications')expect(sql).toMatch(/recipient_id|recipient_role/u);
 if(view==='system')expect(result).toMatchObject({environment:'self-hosted',localDate:'2026-10-28',localTime:'12:00'});
 if(view==='cabinet'||view==='practitioner')expect(result).toHaveProperty('args',{});
 if(view==='notifications')expect(result).toHaveProperty('args',{p_view:'notifications',p_offset:0,p_revision:null});
 if(view==='system')expect(result).toHaveProperty('args',{p_view:'system',p_offset:0,p_revision:null});
 expect(sql).not.toContain('payload');
});
it('retains the reception view in its independent oracle for native-tool admission checks',()=>{
 const inspect=vi.fn(()=>[{total:0,ids:[]}]);
 const result=applicationOracle({view:'reception',queue:'requests'},asOf,actor,inspect);
 expect(result).toMatchObject({view:'reception',gate:'reception_board',queue:'requests',day:'2026-10-28'});
 expect(inspect).toHaveBeenCalledOnce();
});
it('retains the medication catalogue view in its independent oracle',()=>{
 const inspect=vi.fn(()=>[{total:1,ids:['medication-1'],names:['Sertraline 50 mg']}]);
 const result=applicationOracle({view:'medication_catalog',query:'sertraline'},asOf,actor,inspect);
 expect(result).toMatchObject({view:'medication_catalog',gate:'search_medications',query:'sertraline',pageSize:1});
});
