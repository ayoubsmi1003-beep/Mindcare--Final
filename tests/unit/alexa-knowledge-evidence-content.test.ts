import {expect,it,vi} from 'vitest';
import {headingOnlyEvidence,bibliographyEvidence,bibliographyRequested,bibliographyTextEvidence,unboundTableEvidence,medicationSpanGrounded,medicationNumericQuoteGrounded} from '@/server/alexa/knowledge-evidence-content';
import {readKnowledge} from '@/server/alexa/knowledge-adapter';
import type {ClientSql} from '@/server/jarvis/client-sql';
const local=vi.hoisted(()=>vi.fn());
vi.mock('@/server/alexa/local-model',()=>({inferLocalText:local}));
import {synthesizeKnowledge} from '@/server/alexa/knowledge-synthesis';
const heading='Plage de dose adulte';
const quote=heading+'\n'+heading;
const client=(body:string):ClientSql=>({rpc:async<T>()=>({data:[{chunk_id:'synthetic-content',source_id:'synthetic-dsm',source_titre:'DSM-5 — Manuel diagnostique et statistique des troubles mentaux',source_version:'synthetic-v1',section:'Synthetic › '+heading,version_chunk:'synthetic-c1',langue:'fr',texte:body,score:0.6,source_statut:'active',source_classification:'C4',source_approuvee_le:new Date('2026-01-01'),source_approuvee_par:'synthetic-reviewer',source_revue_a_jour:true,source_remplacee_par:null,unit_id:'synthetic-unit',parent_texte_hash:'synthetic-parent',enfant_index:1,enfants_total:1}] as T,error:null})});
it('does not treat reference records or repeated unbound column labels as clinical evidence',async()=>{
 const bibliography='Synthetic study title. J Synthetic Med 2000; 20:587–589. 69. Doe A, et al. Another synthetic study. J Synthetic Med 2016; 11:487–489.';
 expect(bibliographyTextEvidence(bibliography)).toBe(true);
 expect(bibliographyTextEvidence('Une observation clinique documentée reste une phrase narrative.')).toBe(false);
 expect(bibliographyTextEvidence('Une observation clinique documentée. Doe et al. J Synthetic Med 2016; 11:487–489.')).toBe(false);
 expect(unboundTableEvidence('Drug A Drug B Drug C Metabolises: Metabolises: Metabolises:')).toBe(true);
 expect(unboundTableEvidence('Metabolises: Drug A. Monitoring: documented observations.')).toBe(false);
 expect((await readKnowledge(client(bibliography),'Explique la sertraline selon DSM-5')).preuves).toEqual([]);
 expect((await readKnowledge(client('Drug A Drug B Drug C Metabolises: Metabolises: Metabolises:'),'Explique la sertraline selon DSM-5')).preuves).toEqual([]);
});
it('rejects headings and repeated headings after provenance normalization, retaining real content',()=>{
 expect(headingOnlyEvidence('[Source locale] '+quote,'Synthetic › '+heading)).toBe(true);
 expect(headingOnlyEvidence(heading+'. Le texte apporte une information documentée.','Synthetic › '+heading)).toBe(false);
 expect(bibliographyEvidence('Synthetic › References')).toBe(true);
 expect(bibliographyRequested('Donne les références vérifiables de cette affirmation.')).toBe(false);
 expect(bibliographyRequested('Liste les références bibliographiques de cette section.')).toBe(true);
});
it('rejects topic headings with an empty criterion marker while preserving substantive criteria',()=>{
 const section='Section II › Épisode hypomaniaque › Critères diagnostiques';
 expect(headingOnlyEvidence('Épisode hypomaniaque Critères diagnostiques A.',section)).toBe(true);
 expect(headingOnlyEvidence('A. Critères diagnostiques : une manifestation synthétique persiste quatre jours.',section)).toBe(false);
});
it('does not publish a title as the answer to a criteria question',async()=>{
 const text='Épisode hypomaniaque — Critères diagnostiques A. Une manifestation synthétique persiste quatre jours.';
 const question='Quels critères de l’hypomanie selon le DSM-5 ?';
 const source:ClientSql={rpc:async<T>()=>({data:[{chunk_id:'synthetic-criteria',source_id:'synthetic-dsm',source_titre:'DSM-5 — Manuel diagnostique et statistique des troubles mentaux',source_version:'synthetic-v1',section:'Section II › Épisode hypomaniaque › Critères diagnostiques',version_chunk:'synthetic-c1',langue:'fr',texte:text,score:0.6,source_statut:'active',source_classification:'C4',source_approuvee_le:new Date('2026-01-01'),source_approuvee_par:'synthetic-reviewer',source_revue_a_jour:true,source_remplacee_par:null,unit_id:'synthetic-unit',parent_texte_hash:'synthetic-parent',enfant_index:1,enfants_total:1}] as T,error:null})};
 const result=await readKnowledge(source,question);
 expect(result.preuves).toHaveLength(1);
 local.mockResolvedValue(JSON.stringify({coverage:'partial',sentences:[{text:'Épisode hypomaniaque Critères diagnostiques A.',evidence:[{index:1,quoteId:'q1'}]}]}));
 const events=await synthesizeKnowledge(result,question,'fr',new AbortController().signal,{compact:true});
 expect(events.some(e=>e.type==='sentence'&&e.kind==='inference')).toBe(false);
});
it('does not admit a heading-only chunk as narrative medical evidence',async()=>{
 const result=await readKnowledge(client('[Source locale] '+quote),'Explique la dose selon DSM-5');
 expect(result.preuves).toEqual([]);
});
it('rejects a substantive generalization supported only by a section heading within a real passage',async()=>{
 local.mockResolvedValue(JSON.stringify({coverage:'supported',sentences:[{text:'Ce médicament est adapté à la plupart des patients.',evidence:[{index:1,quoteId:'q1'}]}]}));
 const result=await readKnowledge(client(quote+'\nUne observation synthétique documentée accompagne la rubrique.'),'Explique la dose selon DSM-5');
 expect(result.preuves.length).toBeGreaterThan(0);
 const events=await synthesizeKnowledge(result,'Explique la dose selon DSM-5','fr',new AbortController().signal,{compact:true});
 expect(events.some(e=>e.type==='sentence'&&e.kind==='inference')).toBe(false);
});
it('does not attribute the neighbouring medication entry to the requested medication',async()=>{
 const otherEntry='Fluoxetine : information synthétique limitée à cette entrée.';
 local.mockResolvedValue(JSON.stringify({coverage:'supported',sentences:[{text:'La molécule possède les caractéristiques décrites dans cette entrée.',evidence:[{index:1,quoteId:'q1'}]}]}));
 const result=await readKnowledge(client(otherEntry+'\nSertraline : autre entrée synthétique distincte.'),'Explique la sertraline selon DSM-5');
 expect(result.preuves.length).toBeGreaterThan(0);
 const events=await synthesizeKnowledge(result,'Explique la sertraline selon DSM-5','fr',new AbortController().signal,{compact:true});
 expect(events.some(e=>e.type==='sentence'&&e.kind==='inference')).toBe(false);
 expect(medicationSpanGrounded('sertraline','La molécule possède ces caractéristiques.',otherEntry)).toBe(false);
 expect(medicationSpanGrounded('sertraline','Sertraline : information synthétique.','Sertraline : information synthétique.')).toBe(true);
 expect(medicationSpanGrounded('Compare sertraline et lithium','Sertraline et lithium ont leurs propres entrées.','Sertraline : entrée A. Lithium : entrée B.')).toBe(true);
});
it('does not borrow numbers across adjacent medication entries, including an unknown neighbour',async()=>{
 const passage='Reboxetine: synthetic fixture dose 2 mg. Sertraline: synthetic fixture dose 50 mg.';
 local.mockResolvedValue(JSON.stringify({coverage:'supported',sentences:[{text:'Sertraline: synthetic fixture dose 2 mg.',evidence:[{index:1,quoteId:'q1'},{index:1,quoteId:'q2'}]}]}));
 const result=await readKnowledge(client(passage),'Explique la dose de sertraline selon DSM-5');
 const events=await synthesizeKnowledge(result,'Explique la dose de sertraline selon DSM-5','fr',new AbortController().signal,{compact:true});
 expect(events.some(e=>e.type==='sentence'&&e.kind==='inference')).toBe(false);
 expect(medicationNumericQuoteGrounded('sertraline',passage,'en')).toBe(false);
 expect(medicationNumericQuoteGrounded('sertraline','Sertraline: synthetic fixture dose 50 mg.','en')).toBe(true);
 expect(medicationNumericQuoteGrounded('sertraline','Synthetic fixture dose 50 mg.','en')).toBe(false);
});
it('keeps a short English restriction and rejects a French reversal of its meaning',async()=>{
 const passage='Sertraline has a documented synthetic benefit. Avoid in pregnancy.';
 local.mockResolvedValue(JSON.stringify({coverage:'supported',sentences:[{text:'La sertraline est compatible avec la grossesse.',evidence:[{index:1,quoteId:'q1'}]}]}));
 const result=await readKnowledge(client(passage),'Explique la sertraline selon DSM-5');
 const events=await synthesizeKnowledge(result,'Explique la sertraline selon DSM-5','fr',new AbortController().signal,{compact:true});
 expect(JSON.stringify(local.mock.calls.at(-1)?.[0])).toContain('Avoid in pregnancy.');
 expect(events.some(e=>e.type==='sentence'&&e.kind==='inference')).toBe(false);
});
it('declines synthesis before inference when a passage cannot retain all its context',async()=>{
 local.mockClear();
 const passage='Sertraline '+('synthetic documentary context '.repeat(50))+'. Avoid in pregnancy.';
 const result=await readKnowledge(client(passage),'Explique la sertraline selon DSM-5');
 expect(result.preuves.length).toBeGreaterThan(0);
 const events=await synthesizeKnowledge(result,'Explique la sertraline selon DSM-5','fr',new AbortController().signal,{compact:true});
 expect(local).not.toHaveBeenCalled();
 expect(events.some(e=>e.type==='sentence'&&e.kind==='inference')).toBe(false);
});
it('keeps neighbouring context while admitting only the requested medication as citable evidence',async()=>{
 const other='Fluoxetine : information synthétique limitée à cette entrée.',requested='Sertraline : information synthétique propre à cette entrée.';
 local.mockResolvedValue(JSON.stringify({coverage:'partial',sentences:[{text:requested,evidence:[{index:1,quoteId:'q2'}]}]}));
 const result=await readKnowledge(client(other+' '+requested),'Explique la sertraline selon DSM-5');
 const events=await synthesizeKnowledge(result,'Explique la sertraline selon DSM-5','fr',new AbortController().signal,{compact:true});
 const messages=local.mock.calls.at(-1)?.[0],input=JSON.parse(messages.find((m:{role:string})=>m.role==='user').content);
 expect(input.passages[0].citableQuoteIds).toEqual(['q2']);
 expect(JSON.stringify(input)).toContain(other);
 expect(events.some(e=>e.type==='sentence'&&e.kind==='inference'&&e.sources[0]?.excerpt===requested)).toBe(true);
});
