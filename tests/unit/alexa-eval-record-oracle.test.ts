import {expect,it} from 'vitest';
import {recordOracleSql} from '../../scripts/lib/alexa-eval-oracle.mjs';

const actor='c1000000-0000-4000-8000-000000000001';
const patient='c3000000-0000-4000-8000-000000000001';
it('keeps unsigned notes independent of whether their consultation is closed',()=>{
 const sql=recordOracleSql('consultations',{mode:'count',status:'unsigned',patientRef:'primary'},{primary:patient},actor);
 expect(sql).toContain("n.status='draft'");
 expect(sql).not.toContain("status='closed'");
 expect(sql).toContain(`patient_id='${patient}'::uuid`);
 expect(sql).toContain(`id='${actor}'::uuid AND role='owner'`);
});
it('independently selects the first appointment by start time and stable identifier inside the requested scope',()=>{
 const sql=recordOracleSql('agenda',{mode:'first',patientRef:'primary',from:'2026-10-24T00:00:00+01:00',to:'2026-10-25T00:00:00+01:00'},{primary:patient},actor);
 expect(sql).toContain('ORDER BY starts_at,id LIMIT 1');
 expect(sql).toContain(`patient_id='${patient}'::uuid`);
 expect(sql).toContain("starts_at>='2026-10-24T00:00:00+01:00'");
 expect(sql).toContain("starts_at<'2026-10-25T00:00:00+01:00'");
 expect(sql).toContain("'first',(SELECT json_build_object");
 expect(sql).toContain("status<>'cancelled'");
});
it('keeps collected and created payment axes distinct in independent oracles',()=>{
 const range={mode:'list',from:'2026-10-01T00:00:00+01:00',to:'2026-11-01T00:00:00+01:00'};
 const collected=recordOracleSql('finance',{...range,state:'collected'},{},actor);
 const created=recordOracleSql('finance',{...range,state:'all'},{},actor);
 expect(collected).toContain("collected_at>='2026-10-01T00:00:00+01:00'");
 expect(collected).toContain('collected_at IS NOT NULL');
 expect(collected).toContain("'payments',coalesce(json_agg(json_build_object('id',id,'patientId',patient_id,'amount',amount_dzd");
 expect(collected).toContain("'label',(SELECT p.first_name||' '||p.last_name FROM app.patients p WHERE p.id=t.patient_id)");
 expect(created).toContain("created_at>='2026-10-01T00:00:00+01:00'");
 expect(created).not.toContain('collected_at IS NOT NULL AND');
});
