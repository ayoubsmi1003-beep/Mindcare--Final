import {expect,it} from 'vitest';
import {validAlexaSources} from '@/shared/alexa/turn';
it('accepts old source references and optional bounded evidence details',()=>{
 const source={id:'local-chunk',type:'knowledge',label:'Source approuvée',provenance:{chunkId:'local-chunk'}};
 expect(validAlexaSources([source])).toBe(true);
 expect(validAlexaSources([{...source,excerpt:'Passage justificatif local.'}])).toBe(true);
 expect(validAlexaSources([{...source,excerpt:{instruction:'untrusted'}}])).toBe(false);
 expect(validAlexaSources([{...source,excerpt:'x'.repeat(30001)}])).toBe(false);
 expect(validAlexaSources([{...source,type:'execute'}])).toBe(false);
});
