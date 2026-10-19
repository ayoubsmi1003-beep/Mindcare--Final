import {expect,it,vi} from 'vitest';
import {readMessageDraft} from '@/server/alexa/message-draft';
import {agentSchemas} from '@/shared/alexa/agent';
import {frenchRequestAdmission,frenchReadArgumentBindings} from '@/shared/alexa/request-contract';
import {parsePatientMention} from '@/shared/alexa/patient-mention';
const patient='a3000000-0000-4000-8000-000000000001',appointment='b1000000-0000-4000-8000-000000000001',signal=new AbortController().signal,asOf='2026-10-15T12:00:00Z';
it.each(['Prépare un rappel de rendez-vous pour Ayoub Salmi.','Prépare un rappel de rendez vous pour Ayoub Salmi.'])('does not mistake appointment vocabulary for a second identity: %s',text=>{
 expect(parsePatientMention(text)).toEqual({status:'named',name:'Ayoub Salmi'});
});
it.each([['Prépare un rappel de rendez-vous pour Ayoub Salmi.','rappel_rendez_vous'],['Rédige un message de document prêt pour le patient sélectionné.','document_pret']])('prepares unsent text rather than a business appointment: %s',(text,motif)=>{
 const a=frenchRequestAdmission(text,false);expect(a.tools).toEqual(['query_app']);expect(frenchReadArgumentBindings(a,'query_app')).toMatchObject({view:'message_draft',motif});
 expect(agentSchemas.query_app.safeParse({partIds:['m'],view:'message_draft',motif}).success).toBe(true);
});
it('keeps combined message and business requests open for complete native interpretation',()=>{
 expect(frenchRequestAdmission('Prépare un rappel de rendez-vous pour Ayoub Salmi et modifie le tarif de la consultation.',false).tools).toBeUndefined();
});
it('drafts a reminder only for the verified patient and never writes or sends it',async()=>{
 const rpc=vi.fn().mockImplementation(async name=>name==='get_patient'?{id:patient,first_name:'Ayoub',last_name:'Salmi'}:{patientId:patient,appointment:{id:appointment,patientId:patient,startsAt:'2026-10-16T08:00:00Z',status:'confirmed'}});
 const r=await readMessageDraft('m',patient,'rappel_rendez_vous',asOf,rpc,signal);
 expect(r).toMatchObject({status:'ok',complete:true,data:{sent:false,persisted:false,patientId:patient}});expect(r.text).toContain('Ayoub Salmi');expect(r.text).toContain('non envoyé');
 expect(rpc).toHaveBeenCalledWith('get_alexa_reminder_context',{p_patient_id:patient,p_as_of:asOf},signal);expect(r.evidence).toContainEqual(expect.objectContaining({id:appointment,type:'appointment'}));expect(r.proposal).toBeUndefined();
 expect(rpc.mock.calls.map(c=>c[0])).toEqual(['get_patient','get_alexa_reminder_context']);
});
it('keeps requested appointments pending confirmation in the message',async()=>{
 const rpc=vi.fn().mockImplementation(async name=>name==='get_patient'?{id:patient,first_name:'Ayoub',last_name:'Salmi'}:{patientId:patient,appointment:{id:appointment,patientId:patient,startsAt:'2026-10-16T08:00:00Z',status:'requested'}});
 expect((await readMessageDraft('m',patient,'rappel_rendez_vous',asOf,rpc,signal)).text).toContain('reste à confirmer');
});
it('returns an honest empty result when this patient has no future appointment',async()=>{
 const rpc=vi.fn().mockImplementation(async name=>name==='get_patient'?{id:patient,first_name:'Ayoub',last_name:'Salmi'}:{patientId:patient,appointment:null});
 const r=await readMessageDraft('m',patient,'rappel_rendez_vous',asOf,rpc,signal);expect(r).toMatchObject({status:'empty',complete:true});expect(r.text).not.toContain('Bonjour');
});
it('rejects a reminder returned for another patient',async()=>{
 const rpc=vi.fn().mockImplementation(async name=>name==='get_patient'?{id:patient,first_name:'Ayoub',last_name:'Salmi'}:{patientId:patient,appointment:{id:appointment,patientId:'a3000000-0000-4000-8000-000000000002',startsAt:'2026-10-16T08:00:00Z',status:'confirmed'}});
 await expect(readMessageDraft('m',patient,'rappel_rendez_vous',asOf,rpc,signal)).rejects.toThrow();
});
it('uses only an issued document through the existing clinical gate',async()=>{
 const rpc=vi.fn().mockImplementation(async name=>name==='get_patient'?{id:patient,first_name:'Ayoub',last_name:'Salmi'}:{total:1,complete:true,rows:[{id:appointment,patientId:patient,label:'certificat_medical',at:'2026-10-01T09:00:00Z',status:'issued',amount:null}],offset:0,totals:{}});
 const r=await readMessageDraft('m',patient,'document_pret',asOf,rpc,signal);expect(r.data).toMatchObject({sent:false,persisted:false});expect(r.evidence).toContainEqual(expect.objectContaining({type:'document',id:appointment}));
 expect(JSON.parse(rpc.mock.calls[1]![1].p_spec)).toEqual({patientId:patient,status:'issued'});
});
it('requires a draft motif and rejects a cursor or patient scope on unrelated office reads',()=>{
 expect(agentSchemas.query_app.safeParse({partIds:['m'],view:'message_draft'}).success).toBe(false);
 expect(agentSchemas.query_app.safeParse({partIds:['m'],view:'message_draft',motif:'rappel_rendez_vous',offset:2}).success).toBe(false);
 expect(agentSchemas.query_app.safeParse({partIds:['m'],view:'system',patientId:patient}).success).toBe(false);
});
