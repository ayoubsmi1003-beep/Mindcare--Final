import {expect,it} from 'vitest';
import {recordComparisonOracleSql} from '../../scripts/lib/alexa-eval-oracle.mjs';
import {assessRecordComparison} from '../../scripts/lib/alexa-eval-record-meaning.mjs';

const actor='c1000000-0000-4000-8000-000000000001';
const patient='c3000000-0000-4000-8000-000000000001';
const expected={domain:'consultations',axis:'started_at',status:'closed',patientId:patient,periods:[
 {label:'Septembre 2026',from:'2026-09-01T00:00:00+01:00',to:'2026-10-01T00:00:00+01:00',total:4,ids:['a','b','c','d']},
 {label:'Octobre 2026',from:'2026-10-01T00:00:00+01:00',to:'2026-11-01T00:00:00+01:00',total:6,ids:['e','f','g','h','i','j']},
]};
const read=(period:typeof expected.periods[number],total=period.total)=>({
 name:'query_alexa_records',
 args:{p_domain:'consultations',p_spec:JSON.stringify({patientId:expected.patientId,from:period.from,to:period.to,dateAxis:expected.axis,status:expected.status,mode:'count'})},
 response:{ok:true,data:[{total,rows:[],complete:true,offset:0}]},
});
const answer='Septembre 2026 : 4 consultations terminées. Octobre 2026 : 6 consultations terminées.';

it('builds a separate independent closed-consultation SQL oracle for each requested month',()=>{
 const sql=recordComparisonOracleSql({patientId:patient,axis:'started_at',status:'closed',from:expected.periods[0]!.from,to:expected.periods[0]!.to},actor);
 expect(sql).toContain('FROM app.consultations t');
 expect(sql).toContain(`t.patient_id='${patient}'::uuid`);
 expect(sql).toContain(`id='${actor}'::uuid AND role='owner'`);
 expect(sql).toContain('t.started_at>=');
 expect(sql).toContain('t.started_at<');
 expect(sql).toContain("t.status::text='closed'");
});

it('keeps a cabinet-wide comparison bounded to the owner cabinet when no patient was requested',()=>{
 const sql=recordComparisonOracleSql({patientId:null,axis:'started_at',status:'closed',from:expected.periods[0]!.from,to:expected.periods[0]!.to},actor);
 expect(sql).toContain(`id='${actor}'::uuid AND role='owner'`);
 expect(sql).not.toContain('t.patient_id=');
});

it('accepts two matching bounded reads only when both independently verified counts appear beside their month labels',()=>{
 expect(assessRecordComparison(expected,[read(expected.periods[0]!),read(expected.periods[1]!)],answer)).toEqual([]);
 expect(assessRecordComparison(expected,[read(expected.periods[0]!)],answer)).toContain('comparison-month-read-missing');
 expect(assessRecordComparison(expected,[read(expected.periods[0]!),read(expected.periods[1]!,5)],answer)).toContain('comparison-independent-count');
 expect(assessRecordComparison(expected,[read(expected.periods[0]!),read(expected.periods[1]!)],answer.replace('Octobre 2026 : 6','Octobre 2026 : 5'))).toContain('comparison-count-not-presented');
 expect(assessRecordComparison(expected,[read(expected.periods[0]!),read(expected.periods[1]!)],answer.replace('Octobre 2026','Novembre 2026'))).toContain('comparison-month-not-presented');
});

it('accepts an explicit no-consultation phrase for a verified zero month',()=>{
 const zero={...expected,periods:[{...expected.periods[0]!,total:0,ids:[]},expected.periods[1]!]};
 const zeroReads=[read(zero.periods[0]!,0),read(zero.periods[1]!)];
 expect(assessRecordComparison(zero,zeroReads,'Septembre 2026 : aucune consultation terminée. Octobre 2026 : 6 consultations terminées.')).toEqual([]);
 expect(assessRecordComparison(zero,zeroReads,'Septembre 2026 : résultat vide. Octobre 2026 : 6 consultations terminées.')).toContain('comparison-count-not-presented');
});

it('rejects a read with the wrong date axis, status, period or patient even when its count matches',()=>{
 const original=read(expected.periods[0]!);
 const spec=JSON.parse(original.args.p_spec);
 for(const change of [
  {dateAxis:'ended_at'},
  {status:'all'},
  {patientId:'c3000000-0000-4000-8000-000000000099'},
  {from:'2026-09-02T00:00:00+01:00'},
 ]){
  const malformed={...original,args:{...original.args,p_spec:JSON.stringify({...spec,...change})}};
  expect(assessRecordComparison(expected,[malformed,read(expected.periods[1]!)],answer)).toContain('comparison-month-read-missing');
 }
});
