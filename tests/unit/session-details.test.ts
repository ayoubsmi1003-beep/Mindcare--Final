import { expect, it } from 'vitest';
import { sessionDetailsSchema,measureChanges } from '@/shared/alexa/session-details';
import { consultationNotesDigest, consultationNarrativeSources } from '@/server/alexa/clinical-narrative';
const visit={id:'a4000000-0000-4000-8000-000000000001',startedAt:'2026-10-01T08:00:00Z',endedAt:null,rawNotes:null,notes:[]};
it('compares increasing-difficulty scores in chronological order and skips missing measurements',()=>{
 const details={focus:[],focusLibre:'',scoreConvention:'difficulty-v1' as const,mesures:{anxiete:7,sommeil:null,humeur:4}};
 expect(measureChanges(details,{...details,mesures:{anxiete:4,sommeil:3,humeur:4}})).toEqual([{key:'anxiete',previous:7,current:4,delta:-3},{key:'humeur',previous:4,current:4,delta:0}]);
 expect(measureChanges(null,details)).toEqual([]);
});
it('validates difficulty scores without coercing absent scores to zero',()=>{
 expect(sessionDetailsSchema.parse({focus:['Sommeil'],focusLibre:'Réveils',mesures:{anxiete:4,sommeil:7,humeur:null},scoreConvention:'difficulty-v1'}).mesures.humeur).toBeNull();
 for(const score of [0,11,1.5])expect(sessionDetailsSchema.safeParse({focus:[],focusLibre:'',mesures:{anxiete:score,sommeil:null,humeur:null},scoreConvention:'difficulty-v1'}).success).toBe(false);
});
it('includes persisted focus and measures in narrative sources and freshness',()=>{
 const details=sessionDetailsSchema.parse({focus:['Sommeil'],focusLibre:'Réveils',mesures:{anxiete:4,sommeil:7,humeur:null},scoreConvention:'difficulty-v1'});
 const enriched={...visit,sessionDetails:details};
 expect(consultationNotesDigest(enriched)).not.toBe(consultationNotesDigest(visit));
 const text=consultationNarrativeSources(enriched).sources.map(s=>s.text).join(' ');
 expect(text).toContain('Sommeil');expect(text).toContain('7/10');expect(text).toContain('difficulté');
});
