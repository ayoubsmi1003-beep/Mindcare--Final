import { afterEach, expect, it, vi } from "vitest";
const { local, cloud } = vi.hoisted(() => ({ local: vi.fn(), cloud: vi.fn(() => { throw new Error("UnexpectedCloudText"); }) }));
vi.mock("@/server/alexa/local-model", () => ({ inferLocalText: local }));
vi.mock("@/server/egress/external-call", () => ({ llm: cloud }));
import { synthesizeKnowledge } from "@/server/alexa/knowledge-synthesis";
import { readKnowledge } from "@/server/alexa/knowledge-adapter";
import type { ClientSql } from "@/server/jarvis/client-sql";
const quote = "Critères de la dépression : le texte de référence décrit les critères documentés.";
const clientFor=(text:string,language='fr',section='Synthetic'):ClientSql=>({ rpc: async <T>() => ({ data: [{
  chunk_id: "synthetic-chunk", source_id: "synthetic-dsm", source_titre: "DSM-5 — Manuel diagnostique et statistique des troubles mentaux",
  source_version: "synthetic-v1", section, version_chunk: "synthetic-c1", langue: language, texte: text, score: 0.6,
  source_statut: "active", source_classification: "C4", source_approuvee_le: new Date("2026-01-01"),
  source_approuvee_par: "synthetic-reviewer", source_revue_a_jour: true, source_remplacee_par: null,
  unit_id: "synthetic-unit", parent_texte_hash: "synthetic-parent", enfant_index: 1, enfants_total: 1,
}] as T, error: null }) });
const client=clientFor(quote);
afterEach(() => { local.mockReset(); cloud.mockClear(); });
it.each([
 ['Selon le DSM-5, les signes sont décrits dans ce passage.','source-edition'],
 ['Les signes durent 17 jours.','clinical-quantity'],
 ['Le passage décrit 17 éléments.','standalone-number'],
])('classifies unsupported numeric output without logging its content: %s',async(text,kind)=>{
 const warn=vi.spyOn(console,'warn').mockImplementation(()=>{});
 try{
  const result=await readKnowledge(clientFor('Les signes sont décrits dans ce passage de référence synthétique.'),'Explique les signes selon DSM');
  expect(result.preuves).toHaveLength(1);
  local.mockResolvedValue(JSON.stringify({coverage:'partial',sentences:[{text,evidence:[{index:1,quoteId:'q1'}]}]}));
  const events=await synthesizeKnowledge(result,'Explique les signes selon DSM','fr',new AbortController().signal,{compact:true});
  expect(events.some(e=>e.type==='sentence'&&e.kind==='inference')).toBe(false);
  expect(warn).toHaveBeenCalledWith('[alexa-knowledge] rejected-number-kind',kind);
  expect(JSON.stringify(warn.mock.calls)).not.toContain(text);
 }finally{warn.mockRestore();}
});
it.each([
 ['Le sujet se sent reposé dans cette description synthétique.',true],
 ['Le sujet se sent reposé ; le message a été envoyé.',false],
 ['The document was sent.',false],
 ['Le document est envoyé.',false],
])('distinguishes French se sent from an English sending claim: %s',async(text,accepted)=>{
 const result=await readKnowledge(clientFor('Contenu synthétique : '+text),'Explique le contenu selon DSM');
 expect(result.preuves).toHaveLength(1);
 local.mockResolvedValue(JSON.stringify({coverage:'partial',sentences:[{text,evidence:[{index:1,quoteId:'q1'}]}]}));
 const events=await synthesizeKnowledge(result,'Explique le contenu selon DSM','fr',new AbortController().signal,{compact:true});
 expect(events.some(e=>e.type==='sentence'&&e.kind==='inference')).toBe(accepted);
});
it.each([
 ['1. Les signes décrits dans ce passage sont des manifestations documentées.',true],
 ['1. Les signes décrits durent 2 jours.',false],
 ['1.5 mg sont décrits pour ces signes.',false],
 ['2 mg sont décrits pour ces signes.',false],
])('separates editorial list numbering from clinical quantities: %s',async(text,accepted)=>{
 const passage='Les signes décrits dans ce passage sont des manifestations documentées.';
 const result=await readKnowledge(clientFor(passage),'Explique les signes selon DSM');
 expect(result.preuves).toHaveLength(1);
 local.mockResolvedValue(JSON.stringify({coverage:'partial',sentences:[{text,evidence:[{index:1,quoteId:'q1'}]}]}));
 const events=await synthesizeKnowledge(result,'Explique les signes selon DSM','fr',new AbortController().signal,{compact:true});
 expect(events.some(e=>e.type==='sentence'&&e.kind==='inference')).toBe(accepted);
});
it.each(['Les signes décrits dans ce passage sont des manifestations documentées.','Signe le plus fréquent : les signes décrits sont des manifestations synthétiques documentées.'])('does not confuse a medical noun with an announcement that a document was signed: %s',async text=>{
 const result=await readKnowledge(clientFor(text),'Explique les signes selon DSM');
 expect(result.preuves).toHaveLength(1);
 local.mockResolvedValue(JSON.stringify({coverage:'partial',sentences:[{text,evidence:[{index:1,quoteId:'q1'}]}]}));
 const events=await synthesizeKnowledge(result,'Explique les signes selon DSM','fr',new AbortController().signal,{compact:true});
 expect(events.some(e=>e.type==='sentence'&&e.kind==='inference')).toBe(true);
});
it.each(['Le document est signé.','La note est signee.','Le document est signe.','Je signe la note.','Signe le document.'])('still rejects an unverified signing claim: %s',async claim=>{
 const result=await readKnowledge(clientFor('Contenu synthétique : '+claim),'Explique le contenu selon DSM');
 expect(result.preuves).toHaveLength(1);
 local.mockResolvedValue(JSON.stringify({coverage:'partial',sentences:[{text:claim,evidence:[{index:1,quoteId:'q1'}]}]}));
 const events=await synthesizeKnowledge(result,'Explique le contenu selon DSM','fr',new AbortController().signal,{compact:true});
 expect(events.some(e=>e.type==='sentence'&&e.kind==='inference')).toBe(false);
});
it.each([['Le document est signé.','signature'],['Le document est enregistré.','saving']])('limits record-action diagnostics to closed categories: %s',async(claim,kind)=>{
 const warn=vi.spyOn(console,'warn').mockImplementation(()=>{});
 try{
  const result=await readKnowledge(clientFor('Contenu synthétique : '+claim),'Explique le contenu selon DSM');
  expect(result.preuves).toHaveLength(1);
  local.mockResolvedValue(JSON.stringify({coverage:'partial',sentences:[{text:claim,evidence:[{index:1,quoteId:'q1'}]}]}));
  await synthesizeKnowledge(result,'Explique le contenu selon DSM','fr',new AbortController().signal,{compact:true});
  expect(warn).toHaveBeenCalledWith('[alexa-knowledge] rejected-record-kind',kind);
  expect(JSON.stringify(warn.mock.calls)).not.toContain(claim);
 }finally{warn.mockRestore();}
});
it('diagnoses an unsafe output using closed codes without logging generated text',async()=>{
 const warn=vi.spyOn(console,'warn').mockImplementation(()=>{});
 try{
  const result=await readKnowledge(client,'Explique la dépression selon DSM');
  local.mockResolvedValue(JSON.stringify({coverage:'partial',sentences:[{text:'<b>'+quote+'</b>',evidence:[{index:1,quoteId:'q1'}]}]}));
  await synthesizeKnowledge(result,'Explique la dépression selon DSM','fr',new AbortController().signal,{compact:true});
  expect(warn).toHaveBeenCalledWith('[alexa-knowledge] rejected-text-kind','markup');
  expect(JSON.stringify(warn.mock.calls)).not.toContain(quote);
 }finally{warn.mockRestore();}
});
it('keeps opt-in language diagnostics limited to counts rather than source or draft text',async()=>{
 const warn=vi.spyOn(console,'warn').mockImplementation(()=>{});
 vi.stubEnv('ALEXA_LOCAL_TIMINGS','1');
 try{
  const passage='Sertraline is excreted in urine.';
  const result=await readKnowledge(clientFor(passage,'en'),'Explique la sertraline selon DSM-5');
  local.mockResolvedValue(JSON.stringify({coverage:'partial',sentences:[1,2].map(()=>({text:passage,evidence:[{index:1,quoteId:'q1'}]}))}));
  await synthesizeKnowledge(result,'Explique la sertraline selon DSM-5','fr',new AbortController().signal,{compact:true});
  expect(warn).toHaveBeenCalledWith('[alexa-knowledge] language-shape',{sentences:2,english:2,literalSingleSpan:2,bibliographyMarkers:0});
  expect(JSON.stringify(warn.mock.calls)).not.toContain(passage);
 }finally{warn.mockRestore();vi.unstubAllEnvs();}
});
it('classifies the rejected action wording with a closed reason, without logging its text',async()=>{
 const warn=vi.spyOn(console,'warn').mockImplementation(()=>{});
 try{
  const text='Une surveillance synthétique est prescrite dans ce passage.';
  const result=await readKnowledge(clientFor(text),'Explique la surveillance selon DSM');
  expect(result.preuves).toHaveLength(1);
  local.mockResolvedValue(JSON.stringify({coverage:'partial',sentences:[{text,evidence:[{index:1,quoteId:'q1'}]}]}));
  await synthesizeKnowledge(result,'Explique la surveillance selon DSM','fr',new AbortController().signal,{compact:true});
  expect(warn).toHaveBeenCalledWith('[alexa-knowledge] rejected-action-kind','prescribing');
  expect(JSON.stringify(warn.mock.calls)).not.toContain(text);
 }finally{warn.mockRestore();}
});
it('does not synthesize a comparison when only one requested primary section was retrieved',async()=>{
 const question='Compare les descriptions de manie et d’hypomanie selon le DSM-5.';
 const result=await readKnowledge(clientFor('Épisode maniaque : contenu documentaire synthétique pour ce sujet.','fr','Section II › Épisode maniaque › Critères diagnostiques'),question);
 expect(result.preuves).toHaveLength(1);expect(result).toMatchObject({missingRequestedSections:true});
 const events=await synthesizeKnowledge(result,question,'fr',new AbortController().signal,{compact:true});
 expect(local).not.toHaveBeenCalled();expect(events.some(e=>e.type==='sentence'&&e.kind==='inference')).toBe(false);
 expect(events.some(e=>e.type==='sentence'&&e.text.includes('deux notions'))).toBe(true);
});
it('refuses an English source sentence copied into the native French answer',async()=>{
 const passage='Sertraline: unchanged sertraline is excreted in urine.';
 const result=await readKnowledge(clientFor(passage,'en'),'Explique la sertraline selon DSM-5');
 expect(result.preuves).toHaveLength(1);
 local.mockResolvedValue(JSON.stringify({coverage:'partial',sentences:[{text:passage,evidence:[{index:1,quoteId:'q1'}]}]}));
 const events=await synthesizeKnowledge(result,'Explique la sertraline selon DSM-5','fr',new AbortController().signal,{compact:true});
 expect(events.some(e=>e.type==='sentence'&&e.kind==='inference')).toBe(false);
});
it.each([
 ['La sertraline inchangée est excrétée dans les urines à moins de 0,2 %.',true],
 ['La sertraline inchangée est excrétée dans les urines à moins de 9 %.',false],
 ['La sertraline inchangée est excrétée dans les urines à plus de 0,2 %.',false],
 ['La sertraline inchangée est excrétée dans les urines à 0,2 %.',false],
 ['Sertraline: less than 0.2% of unchanged sertraline excreted in urine.',false],
])('allows one local French reformulation while preserving evidence and all guards: %s',async(text,accepted)=>{
 const passage='Sertraline: less than 0.2% of unchanged sertraline excreted in urine.';
 const result=await readKnowledge(clientFor(passage,'en'),'Explique la sertraline selon DSM-5');
 local.mockResolvedValueOnce(JSON.stringify({coverage:'partial',sentences:[{text:passage,evidence:[{index:1,quoteId:'q1'}]}]}))
  .mockResolvedValueOnce(JSON.stringify({sentences:[text]}));
 const events=await synthesizeKnowledge(result,'Explique la sertraline selon DSM-5','fr',new AbortController().signal,{compact:true});
 expect(events.some(e=>e.type==='sentence'&&e.kind==='inference')).toBe(accepted);
 expect(local).toHaveBeenCalledTimes(2);expect(local.mock.calls[1]![1].timeoutMs).toBe(120000);
 expect(JSON.stringify(local.mock.calls[1]![0])).toContain(passage);
 if(accepted)expect(events.flatMap(e=>e.type==='sentence'?e.sources:[])[0]?.excerpt).toBe(passage);
 expect(cloud).not.toHaveBeenCalled();
});
it('does not reformulate a conditional or population-qualified English draft without a preservation proof',async()=>{
 const passage='Sertraline is considered only in patients with a documented synthetic condition.';
 const result=await readKnowledge(clientFor(passage,'en'),'Explique la sertraline selon DSM-5');
 local.mockResolvedValue(JSON.stringify({coverage:'partial',sentences:[{text:passage,evidence:[{index:1,quoteId:'q1'}]}]}));
 const events=await synthesizeKnowledge(result,'Explique la sertraline selon DSM-5','fr',new AbortController().signal,{compact:true});
 expect(local).toHaveBeenCalledOnce();expect(events.some(e=>e.type==='sentence'&&e.kind==='inference')).toBe(false);
});
it('preserves caller cancellation during the single warm French reformulation',async()=>{
 const passage='Sertraline: less than 0.2% of unchanged sertraline excreted in urine.';
 const result=await readKnowledge(clientFor(passage,'en'),'Explique la sertraline selon DSM-5'),controller=new AbortController();
 local.mockResolvedValueOnce(JSON.stringify({coverage:'partial',sentences:[{text:passage,evidence:[{index:1,quoteId:'q1'}]}]}))
  .mockImplementationOnce(async(_messages,options)=>new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true})));
 const pending=synthesizeKnowledge(result,'Explique la sertraline selon DSM-5','fr',controller.signal,{compact:true});
 await vi.waitFor(()=>expect(local).toHaveBeenCalledTimes(2));
 controller.abort(new DOMException('Cancelled','AbortError'));
 await expect(pending).rejects.toMatchObject({name:'AbortError'});
});
it('retains a French paraphrase with a French decimal separator and exact English evidence',async()=>{
 const passage='Sertraline: less than 0.2% of unchanged sertraline excreted in urine.';
 const result=await readKnowledge(clientFor(passage,'en'),'Explique la sertraline selon DSM-5');
 const text='La sertraline inchangée est excrétée dans les urines à moins de 0,2 %.';
 local.mockResolvedValue(JSON.stringify({coverage:'partial',sentences:[{text,evidence:[{index:1,quoteId:'q1'}]}]}));
 const events=await synthesizeKnowledge(result,'Explique la sertraline selon DSM-5','fr',new AbortController().signal,{compact:true});
 expect(events.some(e=>e.type==='sentence'&&e.kind==='inference'&&e.text.includes(text))).toBe(true);
 expect(events.flatMap(e=>e.type==='sentence'?e.sources:[])[0]?.excerpt).toBe(passage);
});
it.each([
 ['3','supported'],['trois','supported'],['4','refused'],['quatre','refused'],
])('checks spelled-out source counts as well as digits without changing their value: %s',async(count,outcome)=>{
 const passage='Sertraline : trois observations indépendantes sont rapportées dans cette entrée synthétique.';
 const result=await readKnowledge(clientFor(passage),'Explique la sertraline selon DSM-5');
 local.mockResolvedValue(JSON.stringify({coverage:'partial',sentences:[{text:`La sertraline fait l’objet de ${count} observations indépendantes dans ce passage.`,evidence:[{index:1,quoteId:'q1'}]}]}));
 const events=await synthesizeKnowledge(result,'Explique la sertraline selon DSM-5','fr',new AbortController().signal,{compact:true});
 expect(events.some(e=>e.type==='sentence'&&e.kind==='inference')).toBe(outcome==='supported');
});
it('rejects an extra numeric citation which does not support the medication claim',async()=>{
 const passage='Sertraline: unchanged sertraline excreted in urine below 0.2%. Sertraline: synthetic study documented another observation.';
 const result=await readKnowledge(clientFor(passage,'en'),'Explique la sertraline selon DSM-5');
 local.mockResolvedValue(JSON.stringify({coverage:'partial',sentences:[{text:'La sertraline inchangée est excrétée dans les urines à moins de 0.2%.',evidence:[{index:1,quoteId:'q1'},{index:1,quoteId:'q2'}]}]}));
 const events=await synthesizeKnowledge(result,'Explique la sertraline selon DSM-5','fr',new AbortController().signal,{compact:true});
 expect(events.some(e=>e.type==='sentence'&&e.kind==='inference')).toBe(false);
});
it.each(['supported','partial'] as const)('does not certify complete diagnostic criteria from model coverage alone: %s',async coverage=>{
 const result=await readKnowledge(client,'critères dépression selon DSM'),observed:string[]=[];
 local.mockResolvedValue(JSON.stringify({coverage,sentences:[{text:quote,evidence:[{index:1,quoteId:'q1'}]}]}));
 await synthesizeKnowledge(result,'critères dépression selon DSM','fr',new AbortController().signal,{compact:true,onCoverage:value=>observed.push(value)});
 expect(observed).toEqual(['partial']);
});
it('keeps the requested topic locally and separates supporting quotes from the compact paragraph',async()=>{
 const result=await readKnowledge(client,'critères dépression selon DSM');
 local.mockResolvedValue(JSON.stringify({coverage:'supported',sentences:[{text:quote,evidence:[{index:1,quoteId:'q1'}]}]}));
 const question='Contexte fourni localement. '.repeat(45)+'Quels critères de dépression concernent les adolescents selon le DSM-5 ?';
 const events=await synthesizeKnowledge(result,question,'fr',new AbortController().signal,{compact:true});
 const answers=events.filter(e=>e.type==='sentence');
 expect(answers).toHaveLength(1);expect(answers[0]?.text).toContain(quote);expect(answers[0]?.text).toContain('exhaustivité');
 expect(answers[0]?.sources[0]?.excerpt).toBe(quote);
 expect(JSON.stringify(local.mock.calls[0]![0])).toContain('adolescents');
 expect(JSON.stringify(local.mock.calls[0]![0])).toContain('liste française');
 expect(JSON.stringify(local.mock.calls[0]![0])).not.toContain('40 à 100 mots');
 expect(local.mock.calls[0]![1].timeoutMs).toBe(480000);
 expect(cloud).not.toHaveBeenCalled();
});
it('keeps caller cancellation effective within the native cold-start allowance',async()=>{
 const result=await readKnowledge(client,'critères dépression selon DSM'),controller=new AbortController();
 local.mockImplementation(async(_messages,options)=>new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true})));
 const pending=synthesizeKnowledge(result,'critères dépression selon DSM','fr',controller.signal,{compact:true});
 controller.abort(new DOMException('Cancelled','AbortError'));
 await expect(pending).rejects.toMatchObject({name:'AbortError'});
});
it.each([
 ['supported',[], 'empty-answer'],
 ['insufficient',[{text:quote,evidence:[{index:1,quoteId:'q1'}]}],'insufficient-nonempty'],
] as const)('distinguishes closed coverage failure codes without publishing unverified content: %s',async(coverage,sentences,reason)=>{
 const warn=vi.spyOn(console,'warn').mockImplementation(()=>{});
 try{
  const result=await readKnowledge(client,'critères dépression selon DSM');local.mockResolvedValue(JSON.stringify({coverage,sentences}));
  const events=await synthesizeKnowledge(result,'critères dépression selon DSM','fr',new AbortController().signal,{compact:true});
  expect(events.some(e=>e.type==='sentence'&&e.kind==='inference')).toBe(false);
  expect(warn).toHaveBeenCalledWith('[alexa-knowledge] source-fallback',reason);
  expect(JSON.stringify(warn.mock.calls)).not.toContain(quote);
 }finally{warn.mockRestore();}
});
it('discloses compact synthesis failure without dumping retrieved chunks',async()=>{
 const result=await readKnowledge(client,'critères dépression selon DSM');local.mockRejectedValue(new Error('LocalModelUnavailable'));
 const events=await synthesizeKnowledge(result,'critères dépression selon DSM','fr',new AbortController().signal,{compact:true});
 expect(events).toHaveLength(1);expect(JSON.stringify(events)).not.toContain(quote);
 expect(events[0]?.type==='sentence'&&events[0].sources[0]?.provenance?.chunkId).toBe('synthetic-chunk');
});
it('does not publish references from a forged compact evidence envelope',async()=>{
 const issued=await readKnowledge(client,'critères dépression selon DSM');
 const events=await synthesizeKnowledge({...issued},'critères dépression','fr',new AbortController().signal,{compact:true});
 expect(local).not.toHaveBeenCalled();
 expect(events.every(e=>e.type!=='sentence'||e.sources.length===0)).toBe(true);
});
it('retains each supporting quote when several sentences cite the same chunk',async()=>{
 const short='Le texte de référence décrit un autre critère documenté.';
 const result=await readKnowledge(clientFor(quote+'\n'+short),'critères dépression selon DSM');
 local.mockResolvedValue(JSON.stringify({coverage:'supported',sentences:[{text:quote,evidence:[{index:1,quoteId:'q1'}]},{text:short,evidence:[{index:1,quoteId:'q2'}]}]}));
 const events=await synthesizeKnowledge(result,'critères dépression selon DSM','fr',new AbortController().signal,{compact:true});
 const sources=events.flatMap(e=>e.type==='sentence'?e.sources:[]);
 expect(sources).toHaveLength(1);expect(sources[0]?.excerpt).toContain(quote);expect(sources[0]?.excerpt).toContain(short);
});
it("synthesizes only immutable approved passages locally and preserves provenance", async () => {
  const result = await readKnowledge(client, "critères dépression selon DSM");
  expect(result.etat).toBe("ok");
  local.mockResolvedValue(JSON.stringify({ coverage: "supported", sentences: [{ text: quote, evidence: [{ index: 1, quote }] }] }));
  const events = await synthesizeKnowledge(result, "critères dépression selon DSM", "fr", new AbortController().signal);
  expect(events.some(event => event.type === "sentence" && event.sources.some(source => source.id === "synthetic-chunk"))).toBe(true);
  expect(local).toHaveBeenCalledOnce(); expect(cloud).not.toHaveBeenCalled();
  expect(JSON.stringify(local.mock.calls[0]![0])).not.toContain("synthetic-chunk");
});
it.each([
  { coverage: "supported", sentences: [{ text: quote, evidence: [{ index: 1, quote: "citation inventée absente du passage" }] }] },
  { coverage: "supported", sentences: [{ text: "La dose est de 999 mg.", evidence: [{ index: 1, quote }] }] },
  { coverage: "supported", sentences: [{ text: "Votre patient va mieux.", evidence: [{ index: 1, quote }] }] },
])("keeps unsafe or unsupported local synthesis behind the literal-source fallback", async answer => {
  const result = await readKnowledge(client, "critères dépression selon DSM");
  local.mockResolvedValue(JSON.stringify(answer));
  const events = await synthesizeKnowledge(result, "critères dépression selon DSM", "fr", new AbortController().signal);
  expect(events.some(event => event.type === "sentence" && event.kind === "inference")).toBe(false);
  expect(events.some(event => event.type === "sentence" && event.sources.length > 0)).toBe(true);
  expect(cloud).not.toHaveBeenCalled();
});
it("refuses a forged retrieval before inference", async () => {
  const result = await readKnowledge(client, "critères dépression selon DSM");
  await synthesizeKnowledge({ ...result }, "critères dépression selon DSM", "fr", new AbortController().signal);
  expect(local).not.toHaveBeenCalled(); expect(cloud).not.toHaveBeenCalled();
});
it("returns literal sources when MiniCPM is unavailable without trying a cloud model", async () => {
  local.mockRejectedValue(new Error("LocalModelUnavailable"));
  const result = await readKnowledge(client, "critères dépression selon DSM");
  const events = await synthesizeKnowledge(result, "critères dépression selon DSM", "fr", new AbortController().signal);
  expect(events.some(event => event.type === "sentence" && event.sources.length > 0)).toBe(true);
  expect(local).toHaveBeenCalledOnce(); expect(cloud).not.toHaveBeenCalled();
});
