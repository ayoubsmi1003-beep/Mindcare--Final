import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@/server/alexa/clinical-narrative", async original => ({ ...await original<object>(), synthesizeClinicalNarrative: vi.fn() }));
import { synthesizeClinicalNarrative } from "@/server/alexa/clinical-narrative";
import { generateSessionSummary } from "@/server/alexa/session-summary";
import type { DbPort, RpcArgs } from "@/services/db/port";
const consultationId="a4000000-0000-4000-8000-000000000001",patientId="a3000000-0000-4000-8000-000000000001",noteId="a5000000-0000-4000-8000-000000000001",analysisId="b3000000-0000-4000-8000-000000000001";
const row={id:consultationId,patient_id:patientId,started_at:"2026-10-01T08:00:00Z",ended_at:null,raw_notes:null,note_id:noteId,note_status:"draft",subjective:"Difficultés avec les parents.",objective:"Contact préservé.",assessment:"Humeur triste rapportée.",plan:"Revoir la situation familiale."};
beforeEach(()=>{vi.clearAllMocks();vi.mocked(synthesizeClinicalNarrative).mockResolvedValue({text:"Le patient rapporte une humeur triste et des difficultés avec ses parents.",complete:true,generated:true,sourceIds:[]});});
function fixture(options:{changed?:boolean;denied?:boolean;failedSave?:boolean;empty?:boolean;previous?:boolean;medicationChange?:boolean;timingChange?:boolean}={}){
 const calls:{name:string;args:Record<string,unknown>}[]=[];let reads=0,content:unknown;
 const rpc:DbPort["rpc"]=async<T>(name:string,args:RpcArgs)=>{
  calls.push({name,args});
  let data:readonly unknown[]=[];
  if(name==="get_consultation"){reads++;data=[{...row,...(options.empty?{subjective:null,objective:null,assessment:null,plan:null}:{}),...(options.changed&&reads>1?{plan:"Consigne corrigée."}:{})}];}
  else if(name==="get_patient")data=options.denied?[]:[{id:patientId}];
  else if(name==="list_amendments")data=[];
  else if(name==="get_scale_history")data=[];
  else if(name==="list_scales")data=[];
  else if(name==='get_session_details')data=[null];
  else if(name==='get_alexa_clinical_context'){
   const state={status:'active',dose:'50',doseUnit:'mg',frequency:'quotidienne',timing:options.timingChange?['soir']:[],instructions:options.timingChange?'Avec le repas.':null,startDate:'2026-08-01',endDate:null},treatmentId='c3000000-0000-4000-8000-000000000001';
   data=[{patientId,consultations:options.previous?[{id:'a4000000-0000-4000-8000-000000000002',startedAt:'2026-09-01T08:00:00Z',endedAt:'2026-09-01T09:00:00Z',rawNotes:'Réveils nocturnes fréquents.',notes:[]}]:[],treatments:{current:options.medicationChange?[{...state,id:treatmentId,medication:'TEST',version:2}]:[],history:options.medicationChange?[{id:'d3000000-0000-4000-8000-000000000001',treatmentId,version:2,action:'update',occurredAt:'2026-09-15T08:00:00Z',previous:options.timingChange?{...state,timing:['matin'],instructions:'Avant le repas.'}:{...state,dose:'25'},next:state,reason:'Difficulté persistante.',notes:null}]:[],historyComplete:true},diagnoses:[],scales:[],sourceRevision:'a'.repeat(64),coverage:{requested:1,returned:options.previous?1:0,complete:true,hasMore:false}}];
  }
  else if(name==="save_session_analysis"){content=JSON.parse(String(args.p_content));if(options.failedSave)return {ok:false,error:{code:"indisponible",message:"Unavailable"}};data=[{id:analysisId,version:1,content}];}
  else if(name==="get_consultation_analysis")data=[{id:analysisId,content}];
  else throw Error("Unexpected authority "+name);
  return {ok:true,data:data as readonly T[]};
 };const db:Pick<DbPort,"rpc">={rpc};return {db,calls};
}
it("analyses SOAP-only sessions, saves one derived artifact and reads it back without rewriting notes",async()=>{const f=fixture(),r=await generateSessionSummary(f.db,consultationId,new AbortController().signal);expect(r.resume).toContain("parents");expect(r.persistee).toBe(true);expect(r.noteStructuree.plan).toBe(row.plan);expect(f.calls.filter(c=>c.name==='save_session_analysis')).toHaveLength(1);expect(f.calls.at(-1)?.name).toBe('get_consultation_analysis');expect(f.calls.some(c=>/save_note|save_raw_notes|sign_note/.test(c.name))).toBe(false);expect(JSON.parse(String(f.calls.find(c=>c.name==='save_session_analysis')?.args.p_source_state)).note_areas).toBe(5);});
it('passes the actual previous consultation as comparison evidence',async()=>{
 const f=fixture({previous:true});await generateSessionSummary(f.db,consultationId,new AbortController().signal);
 expect(vi.mocked(synthesizeClinicalNarrative).mock.calls[0]?.[0].some(s=>s.text.includes('Réveils nocturnes'))).toBe(true);
 const sources=vi.mocked(synthesizeClinicalNarrative).mock.calls[0]![0];
 expect(sources[0]).toMatchObject({scope:'previous',id:'a4000000-0000-4000-8000-000000000002'});
 expect(sources.filter(s=>s.consultationId===consultationId).every(s=>s.scope==='current')).toBe(true);
 const state=JSON.parse(String(f.calls.find(c=>c.name==='save_session_analysis')?.args.p_source_state));
 expect(state.previous_consultation_id).toBe('a4000000-0000-4000-8000-000000000002');
 expect(state.previous_raw_notes_hash).toMatch(/^[a-f0-9]{64}$/);
});
it('keeps both documented doses as an atomic source independently of the reason',async()=>{
 const f=fixture({previous:true,medicationChange:true});await generateSessionSummary(f.db,consultationId,new AbortController().signal);
 const source=vi.mocked(synthesizeClinicalNarrative).mock.calls[0]![0].find(source=>source.scope==='change');
 expect(source).toMatchObject({originalText:'La dose de TEST est passée de 25 mg à 50 mg.'});
 expect(source?.text).toContain('Motif consigné : Difficulté persistante.');
 expect(source?.originalText).not.toContain('Motif');
});
it('preserves actual timing and instruction changes when the dose remains unchanged',async()=>{
 const f=fixture({previous:true,medicationChange:true,timingChange:true});await generateSessionSummary(f.db,consultationId,new AbortController().signal);
 const transition=vi.mocked(synthesizeClinicalNarrative).mock.calls[0]![0].find(source=>source.scope==='change')?.originalText;
 expect(transition).toContain('matin');expect(transition).toContain('soir');
 expect(transition).toContain('Avant le repas.');expect(transition).toContain('Avec le repas.');
});
it("stops before inference on an unauthorized patient",async()=>{const f=fixture({denied:true});await expect(generateSessionSummary(f.db,consultationId,new AbortController().signal)).rejects.toMatchObject({code:"unavailable"});expect(synthesizeClinicalNarrative).not.toHaveBeenCalled();});
it('does not persist a source selection in place of the requested reformulated paragraph',async()=>{
 vi.mocked(synthesizeClinicalNarrative).mockResolvedValue({text:'Faits cités du dossier.',complete:true,generated:true,method:'source_selection',sourceIds:[]});
 const f=fixture();await expect(generateSessionSummary(f.db,consultationId,new AbortController().signal)).rejects.toMatchObject({code:'unavailable'});
 expect(f.calls.some(call=>call.name==='save_session_analysis')).toBe(false);
});
it('persists and reads back a transparent model-selected extractive paragraph',async()=>{
 vi.mocked(synthesizeClinicalNarrative).mockResolvedValue({text:'Le patient rapporte une humeur triste. Le suivi reste prévu.',complete:true,generated:true,method:'extractive',sourceIds:['note','plan']});
 const f=fixture(),result=await generateSessionSummary(f.db,consultationId,new AbortController().signal);
 expect(result).toMatchObject({method:'extractive',persistee:true});
 expect(f.calls.filter(call=>call.name==='save_session_analysis')).toHaveLength(1);
});
it("does not persist a summary after any of the five notes changes during inference",async()=>{const f=fixture({changed:true});await expect(generateSessionSummary(f.db,consultationId,new AbortController().signal)).rejects.toMatchObject({code:"changed"});expect(f.calls.some(c=>c.name==='save_session_analysis')).toBe(false);});
it("keeps an honestly unpersisted paragraph when derived storage fails",async()=>{const f=fixture({failedSave:true});const r=await generateSessionSummary(f.db,consultationId,new AbortController().signal);expect(r.persistee).toBe(false);expect(r.analyseId).toBeNull();expect(r.resume).toContain('humeur');});
it("never invents an analysis for empty notes or a failed local reformulation",async()=>{const f=fixture({empty:true});await expect(generateSessionSummary(f.db,consultationId,new AbortController().signal)).rejects.toMatchObject({code:'empty'});vi.mocked(synthesizeClinicalNarrative).mockResolvedValue({text:'fallback',complete:false,generated:false,sourceIds:[]});const other=fixture();await expect(generateSessionSummary(other.db,consultationId,new AbortController().signal)).rejects.toMatchObject({code:'unavailable'});expect(other.calls.some(c=>c.name==='save_session_analysis')).toBe(false);});
