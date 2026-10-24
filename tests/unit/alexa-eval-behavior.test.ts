import {expect,it} from 'vitest';
import {effectiveOracle,missingBehaviorPrerequisite,missingDataPrerequisite,assessBehavior} from '../../scripts/lib/alexa-eval-behavior.mjs';
it('requires the specific unavailable ordering reason and no timeline read for an ascending chronology',()=>{
 const oracle={behavior:'unsupported_timeline_order',requiresLimitation:true};
 const events=[{type:'sentence',text:'La chronologie est paginée de la plus récente à la plus ancienne ; le tri inverse ne peut pas être pris en charge.'},{type:'done',status:'partial'}];
 expect(assessBehavior(oracle,events,[],false)).toEqual([]);
 expect(assessBehavior(oracle,events,[{name:'list_patient_timeline'}],false)).toContain('unresolved-restriction-dispatched');
 expect(assessBehavior(oracle,[{type:'sentence',text:'Lecture indisponible.'},{type:'done',status:'partial'}],[],false)).toContain('timeline-order-reason-missing');
});
it('blocks nonempty member coverage when the independent copy contains no members',()=>{
 const oracle={kind:'records',domain:'finance',requiresNonEmpty:true};
 expect(missingDataPrerequisite(oracle,{total:0})).toBe('required-nonempty-evidence-unavailable');
 expect(missingDataPrerequisite(oracle,undefined)).toBe('required-nonempty-evidence-unavailable');
 expect(missingDataPrerequisite(oracle,{total:2})).toBe(null);
 expect(missingDataPrerequisite({kind:'records',domain:'finance'},{total:0})).toBe(null);
});
it('uses a numeric oracle for a genuinely empty population, not a mandatory error status',()=>{
 expect(effectiveOracle({kind:'behavior',behavior:'empty_age',requiresLimitation:true})).toEqual({kind:'patients',query:{mode:'count',filters:[{field:'age',op:'gt',value:119}]}});
 expect(missingBehaviorPrerequisite({kind:'behavior',behavior:'replay'})).toBeTruthy();
 expect(missingBehaviorPrerequisite({kind:'behavior',behavior:'injection'})).toBeTruthy();
});
it('rejects accented success claims and empty action responses without an actual proposal',()=>{
 expect(assessBehavior({noWrites:true,behavior:'create_appointment'},[{type:'sentence',text:'Le rendez-vous a été créé.'},{type:'done',status:'needs_confirmation'}],[],false)).toContain('unverified-success-claim');
 expect(assessBehavior({noWrites:true,behavior:'create_appointment'},[{type:'done',status:'needs_input'}],[],false)).toContain('expected-ephemeral-proposal-missing');
 expect(assessBehavior({noWrites:true,behavior:'create_appointment'},[{type:'proposal',tool:'create_appointment'},{type:'done',status:'needs_confirmation'}],[],false)).toEqual([]);
});
it('rejects a broadened read and an invented zero even when the terminal state is partial',()=>{
 expect(assessBehavior({behavior:'unsupported_filter',requiresLimitation:true},[{type:'done',status:'partial'}],[{name:'search_patients'}],false)).toContain('unresolved-restriction-dispatched');
 expect(assessBehavior({behavior:'unsupported_filter',requiresLimitation:true},[{type:'done',status:'partial'}],[{name:'list_patient_timeline'}],false)).toContain('unresolved-restriction-dispatched');
 expect(assessBehavior({behavior:'database_failure',requiresLimitation:true},[{type:'sentence',text:'0 patients.'},{type:'done',status:'partial'}],[],true)).toContain('read-failure-presented-as-zero');
 expect(assessBehavior({behavior:'new-unassessed-case'},[{type:'done',status:'completed'}],[],false)).toEqual(['behavior-oracle-not-defined']);
});
