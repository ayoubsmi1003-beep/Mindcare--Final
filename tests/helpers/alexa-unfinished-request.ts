import {restoreAgentTask} from '@/server/alexa/agent-loop';
import type {TurnInput} from '@/shared/alexa/turn';

/** Exercise native interpretation of an unfinished request; fresh closed reads have separate direct-path tests. */
export function unfinishedNativeRequest(input:TurnInput,actor:string):TurnInput {
 restoreAgentTask(actor,input.conversationId,{original:input.text,parts:[{id:'unfinished',goal:input.text,tools:[],conditions:[],dependsOn:[],status:'pending',resultRefs:[]}],results:[],at:Date.now(),patientId:input.appContext.patientId,page:input.appContext.page});
 return input;
}
