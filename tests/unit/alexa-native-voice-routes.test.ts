import {afterEach,describe,expect,it,vi} from "vitest";
const {native,actor,config,cloud}=vi.hoisted(()=>({native:vi.fn(),actor:{id:"doctor"},config:{VOICE_PROVIDER:"local"},cloud:vi.fn()}));
vi.mock("@/app/api/jarvis/_commun",()=>({identite:async()=>actor.id||null,echec:(code:string,message:string)=>Response.json({ok:false,error:{code,message}}),succes:(data:unknown)=>Response.json({ok:true,data})}));
vi.mock("next/headers",()=>({cookies:async()=>({get:()=>({value:"synthetic-session-token"})})}));
vi.mock("@/server/auth/session",()=>({NOM_COOKIE:"session"}));
vi.mock("@/server/voice/runtime",()=>({demanderVoixNative:native}));
vi.mock("@/server/env",()=>({env:()=>config}));
vi.mock("@/server/egress/external-call",()=>({stt:cloud,tts:cloud,groqSttProvider:{transcribe:cloud},elevenLabsTtsProvider:{synthesize:cloud}}));
import {POST as stt} from "@/app/api/jarvis/jarvis-voice-in/route";
import {POST as tts} from "@/app/api/jarvis/jarvis-voice-out/route";
const ids={runId:"00000000-0000-4000-8000-000000000001",utteranceId:"00000000-0000-4000-8000-000000000002"};
const request=(body:unknown)=>new Request("http://localhost/api/jarvis/voice",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
afterEach(()=>{vi.clearAllMocks();actor.id="doctor";config.VOICE_PROVIDER="local";});
describe("actual local voice API boundary",()=>{
 it("keeps both HTTP routes local even when the old cloud provider is configured",async()=>{
  config.VOICE_PROVIDER="cloud";
  native.mockImplementation(async(job)=>job.action==="stt"?{...job,ok:true,texte:"Bonjour"}:{...job,ok:true,audioBase64:Buffer.from("RIFFsynthetic").toString("base64"),mimeType:"audio/wav"});
  expect((await (await stt(request({...ids,pcmBase64:Buffer.alloc(32000).toString("base64"),sampleRate:16000}))).json()).ok).toBe(true);
  expect((await tts(request({...ids,texte:"Bonjour"}))).headers.get("Content-Type")).toBe("audio/wav");
  expect(native.mock.calls.map(call=>call[0].action)).toEqual(["stt","tts"]);
  expect(cloud).not.toHaveBeenCalled();
 });
 it("authenticates and forwards only bounded memory PCM with real session scope",async()=>{
  native.mockImplementation(async(job)=>({...job,ok:true,texte:"Bonjour"}));
  const response=await stt(request({...ids,pcmBase64:Buffer.alloc(32000).toString("base64"),sampleRate:16000}));
  expect(await response.json()).toMatchObject({ok:true,data:{...ids,texte:"Bonjour"}});
  expect(native.mock.calls[0]?.[0]).toMatchObject({action:"stt",sessionId:expect.stringMatching(/^[a-f0-9]{64}$/)});
  expect(native.mock.calls[0]?.[1]).toBeInstanceOf(AbortSignal);
 });
 it("refuses anonymous requests, filenames, oversize or cloud formats before native work",async()=>{
  actor.id="";await stt(request({...ids,pcmBase64:"AAAA",sampleRate:16000}));actor.id="doctor";
  for(const body of [{...ids,path:"note.wav"},{...ids,pcmBase64:"AAAA",sampleRate:44100},{...ids,audioBase64:"AAAA"}])expect((await (await stt(request(body))).json()).ok).toBe(false);
  expect(native).not.toHaveBeenCalled();
 });
 it("returns local WAV with correlated IDs and no-store; missing runtime refuses",async()=>{
  native.mockImplementation(async(job)=>({...job,ok:true,audioBase64:Buffer.from("RIFFsynthetic").toString("base64"),mimeType:"audio/wav"}));
  const r=await tts(request({...ids,texte:"Bonjour"}));expect(r.headers.get("Cache-Control")).toBe("no-store");expect(r.headers.get("X-Alexa-Utterance-ID")).toBe(ids.utteranceId);
  native.mockRejectedValue(Error("configuration: voices"));expect((await (await tts(request({...ids,texte:"Bonjour"}))).json()).error.code).toBe("configuration");
 });
});
