import { db } from "./db";
import {validAnswerLinks,type AlexaAnswerBlock} from '@/shared/alexa/answer-links';
import { abonnerPatientActif, patientActifCourant } from "./patient-actif";
import { alexa } from "@/i18n/alexa";
import { validAlexaSources, alexaNavigationSchema, alexaProposalSchema, type AlexaProposal, type AlexaEvent, type AlexaNavigation, type AlexaSource } from "@/shared/alexa/turn";

let conversation: string | null = null;
let conversationPending: Promise<string> | null = null;
let lastPatient: string | null = null;
let lastPage = "";
let sequence = 0;
let generation = 0;
let observedPatient: string | null = patientActifCourant()?.id ?? null;
interface AlexaSelectedDocumentContext {documentId:string|null;draftId:string|null;revision:string|null;patientId:string|null}
let selectedDocumentContext:AlexaSelectedDocumentContext|null=null;
const uuid=(value:string|null):string|null=>value&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)?value:null;
export function setAlexaDocumentContext(value:AlexaSelectedDocumentContext|null):void{selectedDocumentContext=value;}
abonnerPatientActif(patient => {
  const next = patient?.id ?? null;
  if (observedPatient !== next) { observedPatient = next; lastPatient = next; sequence++; }
});
export function adoptAlexaConversation(id: string): void { conversation = id; }
export function clearAlexaConversation(): void { conversation = null; conversationPending = null; lastPatient = null; lastPage = ""; sequence++; generation++; }
export async function ensureAlexaConversation(): Promise<string> {
  if (conversation) return conversation;
  if (conversationPending) return conversationPending;
  const ownGeneration = generation;
  const pending = (async () => {
    const result = await db().rpc<string>("start_jarvis_conversation", {});
    if (!result.ok || !result.data[0]) throw new Error(alexa.lectureIndisponible);
    if (generation !== ownGeneration) throw new Error(alexa.contexteChange);
    conversation = result.data[0];
    return conversation;
  })().finally(() => { if (conversationPending === pending) conversationPending = null; });
  conversationPending = pending;
  return conversationPending;
}
export interface AlexaContinuationProgress {kind:"application"|"analysis"|"document"|"notes"|"calendar"|"timeline";completedBatches:number;position:number}
export interface AlexaTurnResult { texte: string; sources: AlexaSource[]; blocks?:AlexaAnswerBlock[]; patientId: string | null; limited: boolean; persiste: boolean; status?: import("@/shared/alexa/agent").AgentTerminal; parts?: import("@/shared/alexa/agent").RequestPart[]; speechAllowed?:boolean; navigation?: AlexaNavigation; proposal?:AlexaProposal; progress?:{completedBatches:number;complete:boolean} }
export class AlexaTurnError extends Error {
  constructor(message: string, readonly partial: boolean) { super(message); this.name = "AlexaTurnError"; }
}
const continuationTokenPattern=/^[A-Za-z0-9_-]{40,64}$/u;
const continuationKinds=new Set(["application","analysis","document","notes","calendar","timeline"]);
async function sha256(value:string):Promise<string|null>{
  try{
    if(!globalThis.crypto?.subtle)return null;
    const bytes=await globalThis.crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));
    return [...new Uint8Array(bytes)].map(byte=>byte.toString(16).padStart(2,"0")).join("");
  }catch{return null;}
}
function alexaContinuationStorage():Storage|null{
  try{return typeof window==="undefined"?null:window.sessionStorage;}catch{return null;}
}
export async function envoyerTourAlexa(text: string, signal?: AbortSignal, callbacks: { onSentence?: (text: string) => void; onStage?: (stage: string) => void; onProgress?: (progress:AlexaContinuationProgress,complete:boolean) => void; clientTurnId?:string } = {}): Promise<AlexaTurnResult> {
  signal?.throwIfAborted();
  const page = typeof window === "undefined" ? "" : window.location.pathname;
  const activePatient = patientActifCourant()?.id ?? null;
  if(lastPage==='/documents'&&page!=='/documents')selectedDocumentContext=null;
  if (lastPage !== page) lastPatient = activePatient;
  lastPage = page;
  const params=typeof window==='undefined'?new URLSearchParams():new URLSearchParams(window.location.search),routePatient=uuid(params.get('patient'));
  const requestedDocumentId=uuid(params.get('document')),requestedDraftId=uuid(params.get('draft'));
  const matchingSelectedDocument=page==='/documents'&&selectedDocumentContext&&(!routePatient||routePatient===selectedDocumentContext.patientId)&&(!requestedDocumentId&&!requestedDraftId||requestedDocumentId===selectedDocumentContext.documentId||requestedDraftId===selectedDocumentContext.draftId)?selectedDocumentContext:null;
  const patientId=page==='/documents'?routePatient??matchingSelectedDocument?.patientId??lastPatient:lastPatient;
  const consultationId=uuid(/^\/consultation\/([^/]+)$/u.exec(page)?.[1]??null);
  const documentId=requestedDocumentId??matchingSelectedDocument?.documentId??null,draftId=requestedDraftId??matchingSelectedDocument?.draftId??null;
  const documentRevision=matchingSelectedDocument&&(documentId===matchingSelectedDocument.documentId||draftId===matchingSelectedDocument.draftId)?matchingSelectedDocument.revision:null;
  const ownSequence = ++sequence;
  const id = await ensureAlexaConversation();
  signal?.throwIfAborted();
  if (ownSequence !== sequence) throw new Error(alexa.contexteChange);
  const appContext={patientId,page,...(consultationId?{consultationId}:{}),...(documentId?{documentId}:{}),...(draftId?{draftId}:{}),...(documentRevision?{documentRevision}:{})};
  const storage=alexaContinuationStorage(),contextHash=await sha256(JSON.stringify([id,appContext])),requestHash=await sha256(text);
  const storagePrefix=`mindcare:alexa:v8:${id}:`,storageKey=contextHash?storagePrefix+contextHash:null;
  let continuationToken:string|undefined;
  if(storage&&storageKey&&requestHash){
    try{
      for(let index=storage.length-1;index>=0;index--){const key=storage.key(index);if(key?.startsWith(storagePrefix)&&key!==storageKey)storage.removeItem(key);}
      const raw=storage.getItem(storageKey);if(raw){const saved=JSON.parse(raw) as {requestHash?:unknown;token?:unknown};
        if(saved.requestHash===requestHash&&typeof saved.token==="string"&&continuationTokenPattern.test(saved.token))continuationToken=saved.token;
        else storage.removeItem(storageKey);
      }
    }catch{continuationToken=undefined;}
  }
  let combinedAnswer="",limited=true,persiste=true,sourcePatientId:string|null=null,replacePatient=false;
  let navigation:AlexaNavigation|undefined,proposal:AlexaProposal|undefined,status:AlexaTurnResult["status"],parts:AlexaTurnResult["parts"],speechAllowed=false;
  let finalProgress:AlexaTurnResult["progress"];
  const allSources:AlexaSource[]=[],allBlocks:AlexaAnswerBlock[]=[],seenTokens=new Set<string>();
  let batchNumber=0;
  const checkScope = () => {
    signal?.throwIfAborted();
    if (ownSequence !== sequence || (typeof window !== "undefined" && page !== window.location.pathname)) throw new Error(alexa.contexteChange);
  };
  for(;;){
    checkScope();
    if(continuationToken){if(seenTokens.has(continuationToken))throw new Error(alexa.format);seenTokens.add(continuationToken);}
    const response=await db().invokeFunctionStream("alexa-turn",{text,conversationId:id,clientTurnId:batchNumber===0?(callbacks.clientTurnId??crypto.randomUUID()):crypto.randomUUID(),appContext,...(continuationToken?{continuationToken}:{})},signal);
    if(!response.ok)throw new Error(alexa.lectureIndisponible);
    const reader=response.data.getReader(),decoder=new TextDecoder();
    let pending="",batchAnswer="",batchDone=false,batchLimited=true,batchPersiste=false,batchPatientId:string|null=null,batchReplacePatient=false;
    let batchNavigation:AlexaNavigation|undefined,batchProposal:AlexaProposal|undefined,batchStatus:AlexaTurnResult["status"],batchParts:AlexaTurnResult["parts"],batchSpeechAllowed=false;
    let nextContinuation:{token:string;progress:AlexaContinuationProgress}|undefined,batchProgress:AlexaTurnResult["progress"];
    const batchSources:AlexaSource[]=[],batchBlocks:AlexaAnswerBlock[]=[];
    try{
      for(;;){
        checkScope();const chunk=await reader.read();checkScope();pending+=decoder.decode(chunk.value,{stream:!chunk.done});
        if(pending.length>256_000)throw new Error(alexa.format);
        let boundary:number;
        while((boundary=pending.indexOf("\n\n"))!==-1){
          checkScope();const record=pending.slice(0,boundary);pending=pending.slice(boundary+2);
          const raw=record.startsWith("data: ")?JSON.parse(record.slice(6)) as AlexaEvent:null;if(!raw)continue;
          if(raw.type==="sentence"&&typeof raw.text==="string"&&raw.text.length<=10_000&&Array.isArray(raw.sources)){
            if(!validAlexaSources(raw.sources)||raw.links!==undefined&&!validAnswerLinks(raw.text,raw.links))throw new Error(alexa.format);
            batchBlocks.push({text:raw.text,...(raw.links?{links:raw.links}:{})});batchAnswer+=`${batchAnswer?"\n":""}${raw.text}`;
            if(batchAnswer.length>64_000)throw new Error(alexa.format);batchSources.push(...raw.sources);
          }else if(raw.type==="proposal"){
            if(batchProposal)throw new Error(alexa.format);const parsed=alexaProposalSchema.safeParse({tool:raw.tool,args:raw.args,...(raw.actionId?{actionId:raw.actionId}:{})});
            if(!parsed.success)throw new Error(alexa.format);batchProposal=parsed.data;
          }else if(raw.type==="stage")callbacks.onStage?.(raw.stage);
          else if(raw.type==="error")throw new AlexaTurnError(raw.message,raw.partial===true);
          else if(raw.type==="done"){
            if(batchDone)throw new Error(alexa.format);
            if(raw.navigation!==undefined){const parsed=alexaNavigationSchema.safeParse(raw.navigation);if(!parsed.success||((parsed.data.target==="patient"||parsed.data.target==="document")&&(parsed.data.patientId!==raw.patientId||raw.patientScope!=="replace")))throw new Error(alexa.format);batchNavigation=parsed.data;}
            if(raw.continuation!==undefined){
              const value=raw.continuation as {token?:unknown;progress?:{kind?:unknown;completedBatches?:unknown;position?:unknown}};
              const p=value.progress;
              if(typeof value.token!=="string"||!continuationTokenPattern.test(value.token)||!p||typeof p.kind!=="string"||!continuationKinds.has(p.kind)||!Number.isSafeInteger(p.completedBatches)||typeof p.completedBatches!=="number"||p.completedBatches<1||!Number.isSafeInteger(p.position)||typeof p.position!=="number"||p.position<0)throw new Error(alexa.format);
              nextContinuation={token:value.token,progress:{kind:p.kind as AlexaContinuationProgress["kind"],completedBatches:p.completedBatches,position:p.position}};
            }
            if(raw.progress!==undefined){if(!Number.isSafeInteger(raw.progress.completedBatches)||raw.progress.completedBatches<1||typeof raw.progress.complete!=="boolean")throw new Error(alexa.format);batchProgress=raw.progress;}
            if(nextContinuation&&batchProgress&&(batchProgress.complete||batchProgress.completedBatches!==nextContinuation.progress.completedBatches))throw new Error(alexa.format);
            batchStatus=raw.status;batchParts=raw.parts;batchSpeechAllowed=raw.speechAllowed===true;batchDone=true;batchLimited=raw.limited;batchPersiste=raw.persiste===true;
            batchPatientId=raw.patientId;batchReplacePatient=raw.patientScope!=="preserve";
          }
        }
        if(chunk.done)break;
      }
      checkScope();if(!batchDone)throw new Error(alexa.interrompu);
    }catch(error){if(error instanceof AlexaTurnError&&error.partial&&batchNumber===0&&batchAnswer)callbacks.onSentence?.(batchAnswer);throw error;}
    finally{await reader.cancel().catch(()=>{});reader.releaseLock();}

    batchNumber++;combinedAnswer+=`${combinedAnswer?"\n\n":""}${batchAnswer}`;
    if(combinedAnswer.length>512_000)throw new Error(alexa.format);
    allBlocks.push(...batchBlocks);allSources.push(...batchSources);
    if(batchReplacePatient){sourcePatientId=batchPatientId;replacePatient=true;}
    navigation=batchNavigation??navigation;proposal=batchProposal??proposal;status=batchStatus;parts=batchParts;speechAllowed=batchSpeechAllowed;
    limited=batchLimited;persiste=persiste&&batchPersiste;finalProgress=batchProgress;

    if(nextContinuation){
      if(batchProposal)throw new Error(alexa.format);
      continuationToken=nextContinuation.token;
      if(storage&&storageKey&&requestHash)try{storage.setItem(storageKey,JSON.stringify({requestHash,token:continuationToken}));}catch{/* Browser storage is optional; the authenticated server task remains resumable. */}
      callbacks.onProgress?.(nextContinuation.progress,false);
      continue;
    }
    if(storage&&storageKey)try{storage.removeItem(storageKey);}catch{/* Browser storage is optional. */}
    if(batchProgress)finalProgress=batchProgress;
    break;
  }
  checkScope();if(replacePatient)lastPatient=sourcePatientId;
  const sourceMap=new Map<string,AlexaSource>();for(const source of allSources)sourceMap.set(JSON.stringify([source.type,source.id,source.version]),source);
  callbacks.onSentence?.(combinedAnswer);
  return {texte:combinedAnswer,sources:[...sourceMap.values()],blocks:allBlocks,patientId:sourcePatientId,limited,persiste,...(status?{status}:{}),...(parts?{parts}:{}),speechAllowed:batchNumber>1?false:speechAllowed,...(navigation?{navigation}:{}),...(proposal?{proposal}:{}),...(finalProgress?{progress:finalProgress}:{})};
}
