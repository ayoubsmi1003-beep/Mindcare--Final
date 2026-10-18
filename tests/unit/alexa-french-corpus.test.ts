import {it,expect} from 'vitest';
import manifest from '../eval/alexa-french-questions.json';
import {evaluateAlexaCase} from '../eval/evaluate-alexa-agent.mjs';
it('contains 245 independently specified French questions across the app and all mandatory scenarios',()=>{
 expect(manifest.languages).toEqual(['fr']);expect(manifest.cases).toHaveLength(245);expect(new Set(manifest.cases.map(c=>c.id)).size).toBe(245);
 expect(new Set(manifest.cases.map(c=>'family' in c?c.family:'mandatory')).size).toBe(23);
 for(let scenario=1;scenario<=25;scenario++)expect(manifest.cases.some(c=>c.scenario===scenario)).toBe(true);
 for(const c of manifest.cases){expect(c.language).toBe('fr');expect(c.expectedManifest.requiredParts.length).toBeGreaterThan(0);expect(c.timing.deadlineMs).toBe(90000);expect(c.permittedToolSequence.length).toBeGreaterThan(0);}
});
it('does not qualify an unsourced answer that never performed its independently required application read',()=>{
 const spec=manifest.cases.find(c=>c.id==='fr-coordonnees-01')!;
 const record={events:[{type:'done',status:'completed',parts:[{id:'p',goal:'Téléphone',status:'answered',conditions:[],resultRefs:['c']}]},{type:'sentence',text:'0550000000',sources:[]}],calls:[],queries:[],ms:10};
 expect(evaluateAlexaCase(spec,record).failures).toContain('required authoritative read: get_patient');
});
it('does not equate the wrong clinical section with a correct answer merely because the same broad gate was read',()=>{
 const spec=manifest.cases.find(c=>c.id==='fr-diagnostics-01')!;
 const record={events:[{type:'done',status:'completed',parts:[]},{type:'sentence',text:'Aucun traitement.',sources:[]}],calls:[{name:'get_patient_context',args:{section:'treatments'},valid:true}],queries:[{name:'get_alexa_clinical_context',args:{p_patient_id:'ed000000-0000-4000-8000-000000000001'}}],ms:10};
 expect(evaluateAlexaCase(spec,record).failures).toContain('requested tool arguments: get_patient_context');
});
