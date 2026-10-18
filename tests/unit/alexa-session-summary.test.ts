import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@/server/alexa/clinical-narrative", async original => ({ ...await original<object>(), synthesizeClinicalNarrative: vi.fn() }));
import { synthesizeClinicalNarrative } from "@/server/alexa/clinical-narrative";
import { generateSessionSummary } from "@/server/alexa/session-summary";
import type { DbPort } from "@/services/db/port";
const consultationId="a4000000-0000-4000-8000-000000000001",patientId="a3000000-0000-4000-8000-000000000001",noteId="a5000000-0000-4000-8000-000000000001",analysisId="b3000000-0000-4000-8000-000000000001";
const row={id:consultationId,patient_id:patientId,started_at:"2026-10-01T08:00:00Z",ended_at:null,raw_notes:null,note_id:noteId,note_status:"draft",subjective:"Difficultés avec les parents.",objective:"Contact préservé.",assessment:"Humeur triste rapportée.",plan:"Revoir la situation familiale."};
beforeEach(()=>{vi.clearAllMocks();vi.mocked(synthesizeClinicalNarrative).mockResolvedValue({text:"Le patient rapporte une humeur triste et des difficultés avec ses parents.",complete:true,generated:true,sourceIds:[]});});
function fixture(options:{changed?:boolean;denied?:boolean;failedSave?:boolean;empty?:boolean}={}){
 const calls:{name:string;args:Record<string,unknown>}[]=[];let reads=0,content:unknown;
 const rpc=vi.fn(async(name:string,args:Record<string,unknown>)=>{calls.push({name,args});
  if(name==="get_consultation"){reads++;return {ok:true,data:[{...row,...(options.empty?{subjective:null,objective:null,assessment:null,plan:null}:{}),...(options.changed&&reads>1?{plan:"Consigne corrigée."}:{})}]};}
  if(name==="get_patient")return {ok:true,data:options.denied?[]:[{id:patientId}]};
  if(name==="list_amendments")return {ok:true,data:[]};
  if(name==="save_session_analysis"){content=JSON.parse(String(args.p_content));return options.failedSave?{ok:false,error:{code:"indisponible",message:"Unavailable"}}:{ok:true,data:[{id:analysisId,version:1,content}]};}
  if(name==="get_consultation_analysis")return {ok:true,data:[{id:analysisId,content}]};
  throw Error("Unexpected authority "+name);
 });return {db:{rpc} as unknown as Pick<DbPort,"rpc">,calls};
}
it("analyses SOAP-only sessions, saves one derived artifact and reads it back without rewriting notes",async()=>{const f=fixture(),r=await generateSessionSummary(f.db,consultationId,new AbortController().signal);expect(r.resume).toContain("parents");expect(r.persistee).toBe(true);expect(r.noteStructuree.plan).toBe(row.plan);expect(f.calls.filter(c=>c.name==='save_session_analysis')).toHaveLength(1);expect(f.calls.at(-1)?.name).toBe('get_consultation_analysis');expect(f.calls.some(c=>/save_note|save_raw_notes|sign_note/.test(c.name))).toBe(false);expect(JSON.parse(String(f.calls.find(c=>c.name==='save_session_analysis')?.args.p_source_state)).note_areas).toBe(5);});
it("stops before inference on an unauthorized patient",async()=>{const f=fixture({denied:true});await expect(generateSessionSummary(f.db,consultationId,new AbortController().signal)).rejects.toMatchObject({code:"unavailable"});expect(synthesizeClinicalNarrative).not.toHaveBeenCalled();});
it("does not persist a summary after any of the five notes changes during inference",async()=>{const f=fixture({changed:true});await expect(generateSessionSummary(f.db,consultationId,new AbortController().signal)).rejects.toMatchObject({code:"changed"});expect(f.calls.some(c=>c.name==='save_session_analysis')).toBe(false);});
it("keeps an honestly unpersisted paragraph when derived storage fails",async()=>{const f=fixture({failedSave:true});const r=await generateSessionSummary(f.db,consultationId,new AbortController().signal);expect(r.persistee).toBe(false);expect(r.analyseId).toBeNull();expect(r.resume).toContain('humeur');});
it("never invents an analysis for empty notes or a failed local reformulation",async()=>{const f=fixture({empty:true});await expect(generateSessionSummary(f.db,consultationId,new AbortController().signal)).rejects.toMatchObject({code:'empty'});vi.mocked(synthesizeClinicalNarrative).mockResolvedValue({text:'fallback',complete:false,generated:false,sourceIds:[]});const other=fixture();await expect(generateSessionSummary(other.db,consultationId,new AbortController().signal)).rejects.toMatchObject({code:'unavailable'});expect(other.calls.some(c=>c.name==='save_session_analysis')).toBe(false);});
