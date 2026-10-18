import {z} from 'zod';
import {partSchema,type RequestPart,type AgentTerminal} from './agent';
import type {AlexaSource} from './turn';
const status=z.enum(['completed','partial','needs_input','needs_confirmation','failed','cancelled']);
const part=partSchema.extend({status:z.enum(['pending','answered','proposed','needs_input','unsupported','failed','budget_limited','cancelled']),resultRefs:z.array(z.string().max(200)).max(6),reason:z.string().max(3000).optional()});
const source=z.object({id:z.string().max(200),type:z.enum(['patient','consultation','diagnostic','scale','treatment','knowledge','appointment','document','query']),label:z.string().max(500),version:z.string().max(100).optional(),provenance:z.record(z.string(),z.union([z.string().max(500),z.number(),z.null()])).optional()});
/** Restore display state only. Historical proposals never become executable cards. */
export function readAlexaHistory(value:unknown):{alexaStatus?:AgentTerminal;alexaParts?:RequestPart[];alexaSources?:AlexaSource[];sourcePatientId?:string|null;porteUneIdentite:boolean}{
 const denied={porteUneIdentite:true};
 const parsed=z.object({version:z.literal(1),events:z.array(z.unknown()).max(100)}).safeParse(value);
 if(!parsed.success)return denied;
 const terminal=[...parsed.data.events].reverse().find(e=>!!e&&typeof e==='object'&&'type' in e&&e.type==='done');
 const done=z.object({type:z.literal('done'),status,parts:z.array(part).max(12),patientId:z.uuid().nullable(),speechAllowed:z.boolean().optional()}).safeParse(terminal);
 if(!done.success)return denied;
 const sources=parsed.data.events.flatMap(event=>{const sentence=z.object({type:z.literal('sentence'),sources:z.array(source).max(100)}).safeParse(event);return sentence.success?sentence.data.sources:[];});
 return {alexaStatus:done.data.status,alexaParts:done.data.parts as RequestPart[],alexaSources:sources as AlexaSource[],sourcePatientId:done.data.patientId,porteUneIdentite:done.data.speechAllowed!==true};
}
