import {it,expect,vi} from "vitest";
import {runAlexa} from "@/server/alexa/orchestrator";
import type {ClinicalContext} from "@/shared/alexa/clinical";
import type {AlexaEvent} from "@/shared/alexa/turn";
import {fixtureRows} from "../helpers/rpc-fixture";
import type {DbPort} from "@/services/db/port";
const id="11111111-1111-4111-8111-111111111111";
const context:ClinicalContext={patientId:id,consultations:[],treatments:{current:[{id,medication:"sertraline",version:1,status:"active",dose:"50",doseUnit:"mg",frequency:"daily",timing:[],instructions:null,startDate:"2026-01-01",endDate:null}],history:[],historyComplete:true},diagnoses:[],scales:[],sourceRevision:"a".repeat(64),coverage:{requested:1,returned:0,complete:true,hasMore:false}};
it("production private interpretation never calls clinical cloud inference",async()=>{
  const infer=vi.fn(async()=>({ok:false as const,code:"unavailable" as const,localFallback:true as const})),events:AlexaEvent[]=[];
  const db: Pick<DbPort,"rpc"> = {rpc:async<T>()=>fixtureRows<T>([{id,first_name:"Test",last_name:"Patient"}])};
  await runAlexa({text:"Analyse son traitement",conversationId:"final-private",clientTurnId:id,appContext:{patientId:id,page:"/patients/test"}},
    {actor:"actor",db,knowledge:{rpc:async<T>()=>({data:null,error:null})},build:async()=>context,infer},e=>events.push(e),new AbortController().signal);
  expect(infer).not.toHaveBeenCalled();expect(events.at(-1)?.type).toBe("done");
});
