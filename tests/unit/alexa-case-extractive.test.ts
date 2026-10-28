import {describe,expect,it,vi,beforeEach} from 'vitest';
vi.mock('@/server/alexa/local-model',()=>({inferLocalText:vi.fn()}));
import {inferLocalText} from '@/server/alexa/local-model';
import {summarizeClinicalCaseContext,clinicalNarrativeReferences} from '@/server/alexa/clinical-narrative';
import type {ClinicalContext} from '@/shared/alexa/clinical';
const context=(count=3):ClinicalContext=>({patientId:'a3000000-0000-4000-8000-000000000001',consultations:Array.from({length:count},(_,i)=>({id:`a4000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,startedAt:`2026-10-${String(i+1).padStart(2,'0')}T08:00:00Z`,endedAt:`2026-10-${String(i+1).padStart(2,'0')}T09:00:00Z`,rawNotes:null,notes:[{id:`a5000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,version:'1',status:'signed',subjective:`La personne rapporte une difficulté autour du repère ${i+1}.`,objective:null,assessment:null,plan:null,amendments:[]}]})),diagnoses:[],scales:[],treatments:{current:[],history:[],historyComplete:true},sourceRevision:'a'.repeat(64),coverage:{requested:100,returned:count,complete:true,hasMore:false}});
beforeEach(()=>{vi.mocked(inferLocalText).mockReset();});
describe('whole-case sentence selection',()=>{
  it('reads every visit while citing only the complete sentences actually selected',async()=>{
    vi.mocked(inferLocalText).mockImplementation(async messages=>{
      const body=JSON.parse(String(messages[1]!.content)) as {choices:{id:string;text:string}[]};
      const chosen=body.choices.filter(choice=>/repère [13]\./u.test(choice.text));
      return JSON.stringify({selection:chosen.map(choice=>choice.id).join('+')});
    });
    const ctx=context(),result=await summarizeClinicalCaseContext(ctx,new AbortController().signal);
    expect(result).toMatchObject({generated:true,complete:true,method:'extractive'});
    expect(result.text).toContain('01/10/2026');expect(result.text).toContain('03/10/2026');expect(result.text).not.toContain('repère 2');
    expect(result.text.split(/\s+/u).length).toBeLessThanOrEqual(70);
    expect(clinicalNarrativeReferences(ctx,result.sourceIds).map(source=>source.id)).toEqual([ctx.consultations[0]!.id,ctx.consultations[2]!.id]);
  });
  it('retains a documented medication and plan when summarizing the latest consultation',async()=>{
    vi.mocked(inferLocalText).mockImplementation(async(_messages,options)=>{
      const schema=options!.jsonSchema as {properties:{selection:{enum:string[]}}};
      return JSON.stringify({selection:schema.properties.selection.enum[0]});
    });
    const ctx=context(1);
    ctx.consultations[0]!.notes[0]!.subjective='La personne décrit une baisse de l’élan et souhaite reprendre une activité courte.';
    ctx.consultations[0]!.notes[0]!.plan='Le traitement par SERTRALINE ALMUS à 50 mg par jour est maintenu. La reprise du rangement sera progressive.';
    const result=await summarizeClinicalCaseContext(ctx,new AbortController().signal);
    expect(result).toMatchObject({generated:true,complete:true,method:'extractive'});
    expect(result.text.toLowerCase()).toContain('la personne décrit une baisse de l’élan');
    expect(result.text).toContain('SERTRALINE ALMUS à 50 mg par jour');
    expect((result.text.match(/consultation du/gu)??[])).toHaveLength(1);
    expect(result.text.split(/\s+/u).length).toBeLessThanOrEqual(70);
  });
  it('keeps sentence provenance through hidden batches without citing the entire selected batch',async()=>{
    const read=new Set<string>();
    vi.mocked(inferLocalText).mockImplementation(async messages=>{
      const body=JSON.parse(String(messages[1]!.content)) as {sources?:{text:string}[];choices:{id:string;text:string}[]};
      for(const source of body.sources??[])for(const match of source.text.matchAll(/repère (\d+)/gu))read.add(match[1]!);
      return JSON.stringify({selection:body.choices.at(-1)!.id});
    });
    const ctx=context(8),result=await summarizeClinicalCaseContext(ctx,new AbortController().signal);
    expect(read.size).toBe(8);expect(inferLocalText).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({generated:true,complete:true,method:'extractive'});
    expect(clinicalNarrativeReferences(ctx,result.sourceIds)).toHaveLength(1);
  });
  it('keeps the selected dated clinical sentence independent of note signature status',async()=>{
    vi.mocked(inferLocalText).mockImplementation(async messages=>{const body=JSON.parse(String(messages[1]!.content));return JSON.stringify({selection:body.choices[0].id});});
    const ctx=context(1);ctx.consultations[0]!.notes[0]!.status='draft';
    const result=await summarizeClinicalCaseContext(ctx,new AbortController().signal);
    expect(result.generated).toBe(true);expect(result.text).toContain('01/10/2026');expect(result.text).not.toMatch(/non signées|brouillon/iu);
  });
  it('never manufactures a case paragraph when the real model is unavailable',async()=>{
    vi.mocked(inferLocalText).mockRejectedValue(Error('LocalModelUnavailable'));
    const result=await summarizeClinicalCaseContext(context(),new AbortController().signal);
    expect(result).toMatchObject({generated:false,complete:false,sourceIds:[]});
  });
  it('does not detach a negative finding from the person it concerns',async()=>{
    vi.mocked(inferLocalText).mockImplementation(async messages=>{const body=JSON.parse(String(messages[1]!.content));return JSON.stringify({selection:body.choices[0].id});});
    const ctx=context(1);ctx.consultations[0]!.notes[0]!.subjective='Pas d’idées suicidaires. Cette information concerne la mère.';
    const result=await summarizeClinicalCaseContext(ctx,new AbortController().signal);
    expect(result.generated).toBe(true);expect(result.text).toContain('mère');expect(result.text).toContain('Pas d’idées');
  });
  it('keeps a later uncertainty statement attached to its preceding claim',async()=>{
    vi.mocked(inferLocalText).mockImplementation(async messages=>{const body=JSON.parse(String(messages[1]!.content));return JSON.stringify({selection:body.choices[0].id});});
    const ctx=context(1);ctx.consultations[0]!.notes[0]!.subjective='Le patient présente un trouble psychotique. Cette hypothèse reste à confirmer.';
    const result=await summarizeClinicalCaseContext(ctx,new AbortController().signal);
    expect(result.generated).toBe(true);expect(result.text).toContain('trouble psychotique');expect(result.text).toContain('Cette hypothèse reste à confirmer.');
  });
  it('rejects a model selection that is not bound to a recorded sentence',async()=>{
    vi.mocked(inferLocalText).mockResolvedValue(JSON.stringify({selection:'unrelated-sentence'}));
    const result=await summarizeClinicalCaseContext(context(),new AbortController().signal);
    expect(result).toMatchObject({generated:false,complete:false,sourceIds:[]});
  });
  it('reports insufficient recorded data without calling the model for an empty record',async()=>{
    const result=await summarizeClinicalCaseContext(context(0),new AbortController().signal);
    expect(result).toMatchObject({generated:false,complete:true,sourceIds:[]});expect(result.text).toContain('pas encore');expect(inferLocalText).not.toHaveBeenCalled();
  });
  it('can quote a short recorded field without turning it into an inferred diagnosis',async()=>{
    vi.mocked(inferLocalText).mockImplementation(async messages=>{const body=JSON.parse(String(messages[1]!.content));return JSON.stringify({selection:body.choices[0].id});});
    const ctx=context(1);ctx.consultations[0]!.notes[0]!.subjective='TDAH';
    const result=await summarizeClinicalCaseContext(ctx,new AbortController().signal);
    expect(result.generated).toBe(true);expect(result.text).toContain('« TDAH »');expect(result.text).toContain('note consignée');
  });
});
