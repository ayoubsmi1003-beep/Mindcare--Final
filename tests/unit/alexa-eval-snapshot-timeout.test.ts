import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const exec=vi.hoisted(()=>vi.fn());
vi.mock('node:child_process',()=>({execFileSync:exec}));
vi.mock('node:fs',()=>({readFileSync:()=>JSON.stringify({target:'mindcare-evaluation-20261022',database:'alexa_eval_clinical_20261022',port:55444,restorationVerified:true})}));
import {businessSnapshot,inspectSql} from '../../scripts/lib/alexa-eval-oracle.mjs';
beforeEach(()=>exec.mockReset());
afterEach(()=>exec.mockReset());
it('allows the full non-mutation inspection to finish on a slow PC without changing ordinary read deadlines',()=>{
 exec.mockReturnValueOnce('[{"schema":"app","table":"patients"}]')
  .mockReturnValueOnce('{"table":"app.patients","count":2,"hash":"content","versions":"versions"}')
  .mockReturnValueOnce('[]').mockReturnValueOnce('{"through":10,"count":10,"hash":"audit"}');
 expect(businessSnapshot({auditThrough:10})).toEqual({'app.patients':{count:2,hash:'content',versions:'versions'},$sequences:[],$auditPrefix:{through:10,count:10,hash:'audit'}});
 const inputs=exec.mock.calls.map(c=>c[2].input as string);
 expect(inputs[0]).toContain("statement_timeout='30s'");
 expect(inputs[1]).toContain("statement_timeout='1800s'");
 expect(inputs[3]).toContain("statement_timeout='1800s'");
 expect(inputs.every(s=>s.startsWith('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;'))).toBe(true);
 expect(inputs[1]).toContain('r.xmin');
});
it('still fails closed and never exposes captured clinical output when inspection fails',()=>{
 exec.mockImplementation(()=>{throw Error('private clinical row');});
 expect(()=>inspectSql('SELECT 1',{timeoutSeconds:1800})).toThrow(/^EvaluationInspectionUnavailable$/);
 expect(()=>inspectSql('SELECT 1',{timeoutSeconds:1801})).toThrow('InvalidInspectionTimeout');
});
