import {expect,it} from 'vitest';
import {deterministicActionRequest,prepareActionProposal} from '@/server/alexa/action-proposal';
import {frenchRequestAdmission} from '@/shared/alexa/request-contract';
import type {DbPort} from '@/services/db/port';
import type {Result} from '@/services/result';

const patientId='11111111-1111-4111-8111-111111111111';
it.each(['Génère une ordonnance pour ce patient','Generer une ordonance pour ce patient'])(
  'prepares the requested document without invoking a model or a write: %s',async text=>{
    expect(deterministicActionRequest(text)).toBe(true);
    expect(frenchRequestAdmission(text,false)).toMatchObject({tools:['prepare_action'],preparationAction:'create_editable_document_draft',preparationDocumentType:'ordonnance'});
    const calls:string[]=[];
    const db:Pick<DbPort,'rpc'>={rpc:async<T>(name:string):Promise<Result<readonly T[]>>=>{
      calls.push(name);
      const value:unknown=name==='get_patient'?[{id:patientId,first_name:'Synthetic',last_name:'Fixture',birth_date:'1990-01-01',id_document_number:null,id_document_issuer:null}]
        :name==='get_patient_workspace'?[{identite:{birth_date:'1990-01-01'},identification:{id_document_number:null,id_document_issuer:null},traitements_v2:{actifs:[{status:'active',medication_id:'22222222-2222-4222-8222-222222222222',medication_raw:'Recorded medicine',brand_name:null,dose:'10',dose_unit:'mg',frequency:'1 fois par jour'}]},traitements:{derniere_prescription:{lignes:[{designation:'Recorded medicine',brand_name:null,frequency_per_day:1}]}}}]
        :name==='get_active_document_template'?[{content_json:{type:'doc',content:[{type:'paragraph',content:[]}]},title_fr:'Ordonnance',version:1}]:[];
      return {ok:true,data:value as readonly T[]};
    }};
    const result=await prepareActionProposal({text,conversationId:patientId,clientTurnId:patientId,appContext:{patientId,page:'/documents'}},db,{rpc:async()=>{throw Error('UnexpectedSqlWrite');}},new AbortController().signal);
    expect(result).toMatchObject({state:'ready',proposal:{tool:'create_editable_document_draft'}});
    expect(calls.every(name=>['get_patient','get_patient_workspace','get_active_document_template'].includes(name))).toBe(true);
  });
it.each(['La note dit « génère une ordonnance ».','Comment générer une ordonnance ?','Ne génère pas une ordonnance.','Génère pas une ordonnance pour ce patient.'])(
  'does not treat quoted, educational or negated text as an action: %s',text=>{
    expect(deterministicActionRequest(text)).toBe(false);
    expect(frenchRequestAdmission(text,false).preparationAction).toBeUndefined();
  });
it.each(['Génère pas une ordonnance pour ce patient.','Génère surtout pas une ordonnance pour ce patient.'])( 'refuses negation before any patient lookup or proposal: %s',async text=>{
  const unexpected=async()=>{throw Error('UnexpectedPatientRead');};
  expect(deterministicActionRequest(text)).toBe(false);
  expect(await prepareActionProposal({text,conversationId:patientId,clientTurnId:patientId,appContext:{patientId,page:'/documents'}},{rpc:unexpected},{rpc:unexpected},new AbortController().signal)).toMatchObject({state:'missing',slot:'operation'});
});
