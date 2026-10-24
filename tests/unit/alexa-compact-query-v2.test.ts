import {expect,it} from 'vitest';
import {parseDeclaration} from '@/shared/alexa/agent';
it('validates extended compact conditions through the same bounded typed schema',()=>{
 const parse=(conditions:string[])=>parseDeclaration({parts:[{id:'p',goal:'Recherche',tool:'query_patients',conditions,dependsOn:[]}]})[0]!;
 expect(parse(['phone:present','age:lte:18','sex:eq:F']).conditions).toEqual([{field:'phone',op:'present',value:null},{field:'age',op:'lte',value:18},{field:'sex',op:'eq',value:'F'}]);
 const invalid=parse(['age:lte','phone:eq:F','sex:eq:X']);
 expect(invalid.conditions).toEqual([]);expect(invalid.unsupportedConditions).toHaveLength(3);
});
