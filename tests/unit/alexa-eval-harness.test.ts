import {expect,it} from 'vitest';
import {evaluateAlexaCase} from '../eval/evaluate-alexa-agent.mjs';

it('checks effective authorized tool arguments after server-bound query filters are applied',()=>{
 const result=evaluateAlexaCase({
  id:'note-filter',scenario:26,language:'fr',input:'Cherche une référence dans les notes.',
  expected:{status:'completed',exactParts:1,toolArguments:[{name:'get_patient_context',args:{area:'all',query:'REPERE-001-S06'}}]},
  expectedManifest:{requiredParts:['notes'],filters:[]},permittedToolSequence:[['declare_request'],['get_patient_context']],timing:{deadlineMs:600000},
 },{
  id:'note-filter',ms:100,events:[
   {type:'sentence',text:'Référence trouvée.'},
   {type:'done',status:'completed',parts:[{id:'notes',goal:'Lire les notes',status:'answered',resultRefs:['result-1']}]},
  ],
  calls:[{name:'get_patient_context',args:{partIds:['notes'],area:'structured'},effectiveArgs:{partIds:['notes'],section:'notes',area:'all',query:'REPERE-001-S06'},valid:true}],
  queries:[],faults:[],timings:{},
 });
 expect(result.failures).not.toContain('requested tool arguments: get_patient_context');
});
