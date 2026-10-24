import {expect,it} from 'vitest';
import {parseInspectionRows} from '../../scripts/lib/alexa-eval-inspection-rows.mjs';
it('keeps multiline source aggregates intact across database record boundaries',()=>{
 expect(parseInspectionRows('{"sources":[{"id":"one"},\n {"id":"two","text":"ligne\\nfrançaise"}]}\x1e["patients","notes"]\x1e')).toEqual([{sources:[{id:'one'},{id:'two',text:'ligne\nfrançaise'}]},['patients','notes']]);
 expect(()=>parseInspectionRows('{"sources":')).toThrow();
 expect(parseInspectionRows('{"table":"one"}\n{"table":"two"}\n')).toEqual([{table:'one'},{table:'two'}]);
 expect(parseInspectionRows('{"text":"escaped \\\" quote and } brace"}\n')).toEqual([{text:'escaped " quote and } brace'}]);
});
