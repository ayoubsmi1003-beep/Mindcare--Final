import {it,expect} from 'vitest';import {readAlexaHistory} from '@/shared/alexa/history';
it('reloads partial outcomes and sources without converting a proposal into an action',()=>{
 const metadata={version:1,events:[{type:'proposal',tool:'create_appointment',args:{}},{type:'sentence',sources:[{id:'source',type:'patient',label:'Synthetic'}]},{type:'done',status:'partial',parts:[{id:'a',goal:'Lecture',conditions:[],dependsOn:[],status:'failed',resultRefs:['c'],reason:'Échec'}],patientId:null,speechAllowed:false}]};
 const result=readAlexaHistory(metadata);expect(result.alexaStatus).toBe('partial');expect(result.alexaParts?.[0]?.status).toBe('failed');expect(result.porteUneIdentite).toBe(true);expect(result).not.toHaveProperty('proposal');expect(result.alexaSources).toHaveLength(1);
});
it('keeps unknown or malformed history out of external speech',()=>{expect(readAlexaHistory(null)).toEqual({porteUneIdentite:true});expect(readAlexaHistory({version:1,events:[{type:'done',speechAllowed:true}]}).porteUneIdentite).toBe(true);});
