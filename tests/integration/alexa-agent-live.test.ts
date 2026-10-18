import {test,expect} from "vitest";
import {writeFile} from "node:fs/promises";
import {runAlexa} from "@/server/alexa/orchestrator";
import {alexaDb} from "@/server/alexa/db";
import {clientSql} from "@/server/jarvis/client-sql";
import {inferLocalCompletion,releaseLocalModel} from "@/server/alexa/local-model";
import type {AlexaEvent} from "@/shared/alexa/turn";
const enabled=process.env.MINDCARE_ALEXA_NATIVE_EVAL==="1";
test.skipIf(!enabled)("French count → linked missing-ID list through actual MiniCPM and actor-bound PostgreSQL",async()=>{
 const actor="ea000000-0000-4000-8000-000000000001",conversationId=crypto.randomUUID();const report:unknown[]=[];
 try{for(const text of["Combien de patients n’ont pas de numéro de carte d’identité ?","Lesquels ?"]){
  const events:AlexaEvent[]=[];const started=Date.now();
  await runAlexa({text,conversationId,clientTurnId:crypto.randomUUID(),appContext:{patientId:null,page:"/jarvis"}},
   {actor,db:alexaDb(actor),knowledge:clientSql(actor),native:true,agentInfer:async(m,o)=>{const t=Date.now();try{const r=await inferLocalCompletion(m,o);report.push({kind:r.kind,...(r.kind==="answer"?{text:r.text}:{}),calls:r.kind==="calls"?r.calls.map(c=>({name:c.name,args:c.args})):[],ms:Date.now()-t,tokensIn:r.tokensIn,tokensOut:r.tokensOut});return r;}catch(e){report.push({error:e instanceof Error?e.message:"unknown",ms:Date.now()-t});throw e;}}},e=>events.push(e),AbortSignal.timeout(90000));
  report.push({text,ms:Date.now()-started,events});
  const done=[...events].reverse().find(e=>e.type==="done");expect(done?.type).toBe("done");
  expect(events.filter(e=>e.type==="sentence").map(e=>e.text).join("\n")).toContain("25");
  expect(done?.type==="done"&&done.status).toBe("completed");
  if(text==="Lesquels ?")expect(events.flatMap(e=>e.type==="sentence"?e.sources:[]).filter(s=>s.type==="patient").length).toBeGreaterThan(0);
 }}finally{if(process.env.MINDCARE_ALEXA_REPORT)await writeFile(process.env.MINDCARE_ALEXA_REPORT,JSON.stringify(report,null,2));await releaseLocalModel();}
},240000);

