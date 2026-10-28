import {ALEXA_AGENT_LANGUAGE,ALEXA_NATIVE_DEADLINE_MS} from "@/shared/alexa/agent";
import { legacyAlexaTurn } from "./legacy";
import { identite } from "@/app/api/jarvis/_commun";
import { clientSql } from "@/server/jarvis/client-sql";
import { alexaDb } from "@/server/alexa/db";
import { runAlexa } from "@/server/alexa/orchestrator";
import { savedAgentTask,restoreAgentTask } from "@/server/alexa/agent-loop";
import { createAgentContinuation, describePendingAgentCursor, resolveAgentContinuation } from "@/server/alexa/agent-continuation";
import { conversationState } from "@/server/alexa/conversation-state";
import { turnInput,type AlexaEvent } from "@/shared/alexa/turn";
import { alexa } from "@/i18n/alexa";
import { agentCopy } from "@/i18n/alexa-agent";
import { isSameOriginRequest } from "@/server/auth/same-origin";
import { z } from "zod";

export const runtime="nodejs";
export const dynamic="force-dynamic";
const claimSchema=z.object({state:z.enum(["claimed","replay","pending","interrupted","conflict","unavailable"]),answer:z.string().max(12000).optional(),metadata:z.unknown().optional()});
export async function POST(request:Request):Promise<Response>{
 if(process.env["ALEXA_NATIVE_AGENT_ENABLED"]!=="1")return legacyAlexaTurn(request);
 if(!isSameOriginRequest(request))return new Response(null,{status:403});
 const actor=await identite();if(!actor)return Response.json({ok:false},{status:401});
 const parsed=turnInput.safeParse(await request.json().catch(()=>null));
 if(!parsed.success)return Response.json({ok:false,error:{code:"invalid",message:alexa.format}},{status:400});
 const input=parsed.data,persistence=clientSql(actor),context=JSON.stringify(input.appContext);
 const jsonGate=(value:unknown):unknown=>Array.isArray(value)&&value.length===1?(value as unknown[])[0]:value;
 const prior=await persistence.rpc<unknown>("get_alexa_task_context",{p_conversation_id:input.conversationId,p_context:context});
 const savedContext=jsonGate(prior.data),savedMetadata=z.object({task:z.unknown().optional(),reference:z.unknown().optional(),continuation:z.unknown().nullable().optional()}).passthrough().safeParse(savedContext);
 const taskSnapshot=savedMetadata.success?savedMetadata.data.task:savedContext;
 const storedContinuation=savedMetadata.success?savedMetadata.data.continuation:undefined;
 if(input.continuationToken&&prior.error)return Response.json({ok:false,error:{code:"stale"}},{status:409});
 const binding={actor,conversationId:input.conversationId,requestText:input.text,appContext:input.appContext};
 const currentCursor=describePendingAgentCursor(taskSnapshot);
 const resolvedContinuation=resolveAgentContinuation(storedContinuation,input.continuationToken,binding,currentCursor);
 const matchingContinuation=resolvedContinuation.continuation;
 if(resolvedContinuation.stale)return Response.json({ok:false,error:{code:"stale"}},{status:409});
 const resumeCursor=matchingContinuation?{cursorId:matchingContinuation.cursorId,kind:matchingContinuation.kind,patientId:matchingContinuation.patientId}:undefined;
 const completedBatches=matchingContinuation?.completedBatches??0;
 const claimed=await persistence.rpc<unknown>("claim_alexa_turn",{p_conversation_id:input.conversationId,p_client_turn_id:input.clientTurnId,p_demande:input.text,p_context:context});
 const claim=claimSchema.safeParse(jsonGate(claimed.data));
 if(claimed.error||!claim.success||claim.data.state==="unavailable")return Response.json({ok:false},{status:503});
 if(["pending","conflict"].includes(claim.data.state))return Response.json({ok:false,error:{code:claim.data.state}},{status:409});
 const encoder=new TextEncoder(),headers={"Content-Type":"text/event-stream; charset=utf-8","Cache-Control":"no-store","X-Accel-Buffering":"no"};
 if(claim.data.state==="replay"){
  const metadata=claim.data.metadata as {events?:AlexaEvent[]}|undefined;
  if(!metadata?.events?.length)return Response.json({ok:false},{status:409});
  const replayEvents=[...metadata.events];
  for(const event of metadata.events)if(event.type==="proposal"){
   if(!event.actionId)return Response.json({ok:false},{status:409});
   const read=await persistence.rpc<unknown>("get_alexa_action_outcome",{p_id:event.actionId});
   const outcome=z.object({state:z.enum(["proposed","confirmed","executed","failed","rejected"]),tool:z.string(),affectedId:z.uuid().nullable()}).safeParse(jsonGate(read.data));
   if(read.error)return Response.json({ok:false},{status:503});
   if(jsonGate(read.data)===null)continue;
   if(!outcome.success)return Response.json({ok:false},{status:503});
   if(outcome.data.state!=="proposed"){
    replayEvents.splice(replayEvents.indexOf(event),1);
    replayEvents.unshift({type:"sentence",text:agentCopy[ALEXA_AGENT_LANGUAGE].actionKnown,kind:"fact",sources:[]});
    for(const terminal of replayEvents)if(terminal.type==="done"){terminal.status="partial";terminal.limited=true;terminal.speechAllowed=false;}
   }
  }
  return new Response(replayEvents.map(event=>`data: ${JSON.stringify(event)}\n\n`).join(""),{headers});
 }
 const copy=agentCopy[ALEXA_AGENT_LANGUAGE],effectivePatientId=resumeCursor?.patientId??input.appContext.patientId;
 if(!prior.error&&prior.data){
  if(savedMetadata.success){
   restoreAgentTask(actor,input.conversationId,savedMetadata.data.task??savedContext);
   if(savedMetadata.data.reference)conversationState.restore(actor,input.conversationId,effectivePatientId,input.appContext.page,savedMetadata.data.reference,context);
  }else restoreAgentTask(actor,input.conversationId,savedContext);
 }
 const controller=new AbortController(),abort=()=>controller.abort(request.signal.reason);
 request.signal.addEventListener("abort",abort,{once:true});if(request.signal.aborted)abort();
 const timer=setTimeout(()=>controller.abort(new DOMException("Deadline", "TimeoutError")),ALEXA_NATIVE_DEADLINE_MS);
 let answer="",events:AlexaEvent[]=[],overflow=false,disconnected=false,terminal:Extract<AlexaEvent,{type:"done"}>|null=null;
 const stream=new ReadableStream<Uint8Array>({start(sink){
  const send=(event:AlexaEvent)=>{if(!request.signal.aborted&&!disconnected)sink.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));};
  const emit=(event:AlexaEvent)=>{
   if(event.type==="done"){terminal=event;return;}
   if(event.type==="sentence"){
    if(overflow)return;
    if(answer.length+event.text.length+1>11000){overflow=true;event={type:"sentence",text:copy.budget,kind:"fact",sources:[]};}
    answer+=(answer?"\n":"")+event.text;
   }
   if(event.type!=="stage")events.push(event);send(event);
  };
  void (async()=>{
   try{
    if(claim.data.state==="interrupted"){
     const reason=copy.interrupted;emit({type:"sentence",text:reason,kind:"fact",sources:[]});
     emit({type:"done",status:"failed",parts:[{id:"request",goal:input.text,conditions:[],dependsOn:[],status:"failed",resultRefs:[],reason}],patientId:null,patientScope:"preserve",coverage:null,sourceRevision:null,limited:true,speechAllowed:false});
    }else await runAlexa(resumeCursor?{...input,appContext:{...input.appContext,patientId:effectivePatientId}}:input,{actor,db:alexaDb(actor),knowledge:persistence,native:true,contextKey:context,...(resumeCursor?{resumeCursor}:{})},emit,controller.signal);
   }catch{emit({type:"sentence",text:copy.unavailable,kind:"fact",sources:[]});}
   finally{
    const done:Extract<AlexaEvent,{type:"done"}>=terminal??{type:"done",patientId:null,patientScope:"preserve",sourceRevision:null,coverage:null,limited:true,status:request.signal.aborted?"cancelled":"failed",speechAllowed:false};
    if(!answer){answer=copy.unavailable;const event:AlexaEvent={type:"sentence",text:answer,kind:"fact",sources:[]};events.push(event);send(event);}
    if(overflow){done.status="partial";done.limited=true;done.speechAllowed=false;if(done.parts)done.parts=done.parts.map(p=>p.status==="answered"?{...p,status:"budget_limited",reason:copy.budget}:p);}
    const task=claim.data.state==="interrupted"?null:savedAgentTask(actor,input.conversationId);
    const cursor=task?describePendingAgentCursor(task):null;
    const cursorAdvanced=!matchingContinuation||!!cursor&&(cursor.cursorId!==matchingContinuation.cursorId||cursor.position>matchingContinuation.position);
    const nextContinuation=cursor&&cursorAdvanced&&done.status==="partial"&&!controller.signal.aborted&&!disconnected
      ?createAgentContinuation(binding,cursor,completedBatches+1):null;
    const batchesCompleted=nextContinuation?.completedBatches??(resumeCursor?completedBatches+1:cursor?1:undefined);
    if(batchesCompleted!==undefined)done.progress={completedBatches:batchesCompleted,complete:!nextContinuation};
    if(nextContinuation)done.continuation={token:nextContinuation.token,progress:{kind:nextContinuation.kind,completedBatches:nextContinuation.completedBatches,position:nextContinuation.position}};
    const persistedEvents=[...events,{...done,persiste:true}];
    const reference=conversationState.read(actor,input.conversationId,effectivePatientId,input.appContext.page,Date.now(),context)??undefined;
    const persistenceStartedAt=Date.now();
    const saved=await persistence.rpc("complete_jarvis_turn",{p_conversation_id:input.conversationId,p_client_turn_id:input.clientTurnId,p_chemin:"patient",p_contenu:answer,p_statut:done.status==="completed"?"complet":"interrompu",p_outil:JSON.stringify({version:3,events:persistedEvents,task,...(reference?{reference}:{}),continuation:nextContinuation})}).catch(()=>({error:true,data:false}));
    const persisted=!saved.error&&saved.data===true;
    if(!persisted)console.error("[alexa-turn] persistence outcome",JSON.stringify({operation:"complete_jarvis_turn",outcome:saved.error?"rpc_error":saved.data===false?"gate_rejected":"invalid_response",elapsedMs:Date.now()-persistenceStartedAt}));
    send({...done,persiste:persisted});
    clearTimeout(timer);request.signal.removeEventListener("abort",abort);try{sink.close();}catch{/* disconnected */}
   }
  })();
 },cancel(){disconnected=true;controller.abort();}});
 return new Response(stream,{headers});
}
