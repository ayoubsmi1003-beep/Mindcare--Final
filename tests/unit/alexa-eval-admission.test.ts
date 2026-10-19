import {expect,it} from 'vitest';
import {z} from 'zod';
import {finalizeAlexaAdmission} from '../../scripts/lib/alexa-eval-admission.mjs';
const schema=z.object({partIds:z.array(z.string()),section:z.literal('diagnoses'),diagnosisState:z.literal('active')}).strict();
const trace={name:'get_patient_context',args:{partIds:['d'],diagnosisState:'active'},valid:false};
it('counts server-bound constants as valid without rewriting the raw model call',()=>{
 const liveCall={id:'c',name:trace.name,args:{...trace.args,section:'diagnoses'}};
 const r=finalizeAlexaAdmission(trace,liveCall,schema,new Set(['c']),liveCall);
 expect(r).toMatchObject({valid:true,unboundSchemaValid:false,admitted:true,args:trace.args,effectiveArgs:liveCall.args});expect(r.args).not.toHaveProperty('section');
});
it('measures the dispatched arguments rather than the model object before server binding',()=>{
 const liveCall={id:'c',name:trace.name,args:{partIds:['d']}};
 const dispatched={...liveCall,args:{partIds:['d'],section:'diagnoses',diagnosisState:'active'}};
 const r=finalizeAlexaAdmission(trace,liveCall,schema,new Set(['c']),dispatched);
 expect(r).toMatchObject({valid:true,effectiveArgs:dispatched.args,normalizedModelArgs:liveCall.args,args:trace.args});
});
it('requires actual dispatch evidence for a domain call',()=>{
 const liveCall={id:'c',name:trace.name,args:{...trace.args,section:'diagnoses'}};
 expect(finalizeAlexaAdmission(trace,liveCall,schema,new Set(['c']))).toMatchObject({valid:false,effectiveArgs:null});
});
it('does not qualify a schema-valid call rejected for an unrequested filter',()=>{
 expect(finalizeAlexaAdmission(trace,{id:'c',name:trace.name,args:{...trace.args,section:'diagnoses'}},schema,new Set()).valid).toBe(false);
});
it('does not qualify an invalid effective call merely because a result reference exists',()=>{
 expect(finalizeAlexaAdmission(trace,{id:'c',name:trace.name,args:trace.args},schema,new Set(['c'])).valid).toBe(false);
});
