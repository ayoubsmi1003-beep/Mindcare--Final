import {test,expect} from "vitest";
import {inferLocalCompletion} from "@/server/alexa/local-model";
test.skipIf(process.env.MINDCARE_ALEXA_NATIVE_EVAL!=="1")("pinned MiniCPM accepts real native calls and matching continuation",async()=>{
 const messages=[{role:"system" as const,content:"Use the native function to count patients lacking a national identity number. Do not answer without a tool result. Respond in French."},{role:"user" as const,content:"Combien de patients n’ont pas de numéro de carte d’identité ?"}];
 const options={maxOutputTokens:256,tools:[{type:"function" as const,function:{name:"query_patients",description:"Exact authorized count/list. identity_card means id_document_number.",parameters:{type:"object",properties:{mode:{type:"string",enum:["count","list"]},filter:{type:"string",enum:["missing_identity_card"]}},required:["mode","filter"]}}}]};
 const first=await inferLocalCompletion(messages,options);expect(first.kind).toBe("calls");if(first.kind!=="calls")return;
 expect(first.calls[0]?.name).toBe("query_patients");expect(first.calls[0]?.args).toEqual({mode:"count",filter:"missing_identity_card"});
 const next=await inferLocalCompletion([...messages,first.message,{role:"tool",tool_call_id:first.calls[0]!.id,content:'{"count":7,"complete":true}'}],options);
 expect(next.kind).toBe("answer");if(next.kind==="answer")expect(next.text).toContain("7");
},180000);

