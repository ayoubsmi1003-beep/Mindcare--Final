import {expect,it,vi} from 'vitest';
import {readApplication} from '@/server/alexa/application-reads';
import {agentSchemas} from '@/shared/alexa/agent';
import {frenchReadArgumentBindings,frenchRequestAdmission} from '@/shared/alexa/request-contract';
const signal=new AbortController().signal;
it.each([['Combien de notifications non lues ?', 'notifications'],['Quel est l’état du système ?', 'system'],['Quelle heure est-il au cabinet ?', 'system'],['Montre les notifications du cabinet.', 'notifications']])('admits the office read: %s',(text,view)=>{
 const a=frenchRequestAdmission(text,false);expect(a.tools).toEqual(['query_app']);
 expect(frenchReadArgumentBindings(a,'query_app')).toMatchObject({view});
 expect(agentSchemas.query_app.safeParse({partIds:['o'],view}).success).toBe(true);
});
it('keeps complete notification totals independent of the displayed kind page',async()=>{
 const rpc=vi.fn().mockResolvedValue({view:'notifications',total:83,unread:72,kinds:[{kind:'patient_arrived',total:70,unread:61}],totalKinds:21,offset:0,hasMore:true,revision:'a'.repeat(32)});
 const r=await readApplication('o','notifications',rpc,signal,{asOf:'2026-10-15T12:00:00Z'});
 expect(rpc).toHaveBeenCalledWith('get_alexa_office_status',{p_view:'notifications',p_offset:0,p_revision:null},signal);
 expect(r).toMatchObject({status:'partial',complete:false,data:{total:83,unread:72,nextOffset:1}});
 expect(r.text).toContain('83');expect(r.text).toContain('72');expect(r.text).not.toContain('payload');
});
it('phrases an empty notification result naturally instead of using parenthesized plurals',async()=>{
 const r=await readApplication('empty','notifications',vi.fn().mockResolvedValue({view:'notifications',total:0,unread:0,kinds:[],totalKinds:0,offset:0,hasMore:false,revision:'a'.repeat(32)}),signal);
 expect(r.text).toBe('Aucune notification n’est visible pour le moment.');
});
it('uses the admitted cabinet clock and recorded environment without claiming service health',async()=>{
 const r=await readApplication('o','system',vi.fn().mockResolvedValue({view:'system',environment:'self-hosted'}),signal,{asOf:'2026-10-15T23:30:00Z'});
 expect(r.data).toMatchObject({environment:'self-hosted',localDate:'2026-10-16',timezone:'Africa/Algiers'});
 expect(r.text).not.toMatch(/tous les services|opérationnel|fonctionnent/i);
});
it('rejects a missing environment instead of defaulting to cloud-dev',async()=>{
 await expect(readApplication('o','system',vi.fn().mockResolvedValue(null),signal,{asOf:'2026-10-15T12:00:00Z'})).rejects.toThrow();
});
it('rejects irrelevant pagination and arbitrary office views',()=>{
 expect(agentSchemas.query_app.safeParse({partIds:['o'],view:'system',offset:1}).success).toBe(false);
 expect(agentSchemas.query_app.safeParse({partIds:['o'],view:'raw_database'}).success).toBe(false);
});
