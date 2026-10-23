"use client";

import {useState,useRef,useEffect,useCallback} from "react";

import {getDraft,saveDraft} from "@/services/document-drafts";

import {documentsEditor as t} from "@/i18n/documents-editor";

import type {Draft,DocumentContent,Variables} from "@/shared/documents/types";

import {recoverDraft} from "./document-recovery";

import {saveState,type SaveState} from "./document-save-state";

export function useDocumentDraft(id:string|null){

 const [draft,setDraft]=useState<Draft|null>(null),[error,setError]=useState<string|null>(null);

 const [state,setState]=useState<SaveState>({generation:0,edit:0,saved:0,saving:null,conflict:false});

 const current=useRef<Draft|null>(null),stateRef=useRef(state),generation=useRef(0),invalid=useRef(false),inFlight=useRef<Promise<Draft|null>|null>(null);

 const apply=useCallback((action:Parameters<typeof saveState>[1])=>{stateRef.current=saveState(stateRef.current,action);setState(stateRef.current);},[]);

 useEffect(()=>{const gen=++generation.current;current.current=null;invalid.current=false;inFlight.current=null;setDraft(null);setError(null);stateRef.current={generation:gen,edit:0,saved:0,saving:null,conflict:false};setState(stateRef.current);

 if(id)void getDraft(id).then(r=>{if(generation.current!==gen)return;if(!r.ok)setError(r.error.message);else {current.current=r.data;setDraft(r.data);}});

 return()=>{generation.current=gen+1;};

 },[id]);

 const setValue=useCallback((patch:Partial<Pick<Draft,"content"|"variables"|"documentDate">>)=>{if(!current.current||current.current.issuedDocumentId)return;if(patch.content)invalid.current=false;current.current={...current.current,...patch};setDraft(current.current);apply({type:"edit"});if(!invalid.current)setError(null);},[apply]);

 const save=useCallback(async():Promise<Draft|null>=>{

 if(invalid.current)return null;
 if(inFlight.current)return inFlight.current;

 const value=current.current,s=stateRef.current,gen=generation.current;if(!value||s.conflict)return null;if(s.edit===s.saved)return value;

 const edit=s.edit;apply({type:"start",generation:gen});

 const job=saveDraft(value,value.content,value.variables,value.documentDate).then(r=>{

 if(generation.current!==gen)return null;

 if(!r.ok){apply({type:r.error.context==="draft-conflict"?"conflict":"failure",generation:gen});setError(r.error.message);return null;}

 // Only the revision is authoritative from this acknowledgement. Newer input remains untouched.

 if(current.current)current.current={...current.current,revision:r.data.revision};

 setDraft(current.current);apply({type:"ack",generation:gen,edit});if(!invalid.current)setError(null);return current.current;

 }).finally(()=>{if(generation.current===gen)inFlight.current=null;});

 inFlight.current=job;return job;

 },[apply]);

 const recover=useCallback(async(keepLocal:boolean)=>{if(!id)return;const started=generation.current;const local=current.current;const r=await getDraft(id);if(generation.current!==started)return;if(!r.ok){setError(r.error.message);return;}if(!r.data)return;const gen=++generation.current;inFlight.current=null;invalid.current=false;current.current=recoverDraft(r.data,local,keepLocal);setDraft(current.current);stateRef.current={generation:gen,edit:keepLocal?1:0,saved:0,saving:null,conflict:false};setState(stateRef.current);setError(null);},[id]);

 const flush=useCallback(async()=>{const gen=generation.current;let value=await save();while(value&&gen===generation.current&&stateRef.current.saved<stateRef.current.edit)value=await save();return gen===generation.current?value:null;},[save]);

 useEffect(()=>{if(!draft||state.edit===state.saved||state.conflict||state.saving!==null||error)return;const timer=setTimeout(()=>{void save();},750);return()=>clearTimeout(timer);},[draft,state,save,error]);

 useEffect(()=>{const guard=(e:BeforeUnloadEvent)=>{if(stateRef.current.edit>stateRef.current.saved){e.preventDefault();e.returnValue=t.unsavedLeave;}};window.addEventListener("beforeunload",guard);return()=>window.removeEventListener("beforeunload",guard);},[]);

 const isCurrent=useCallback((draftId:string,revision:number)=>current.current?.id===draftId&&current.current.revision===revision&&stateRef.current.edit===stateRef.current.saved&&!invalid.current,[]);
 const setContent=useCallback((content:DocumentContent)=>setValue({content}),[setValue]);
 const setVariables=useCallback((variables:Variables)=>setValue({variables}),[setValue]);
 const setDate=useCallback((documentDate:string)=>setValue({documentDate}),[setValue]);
 const setContentAndVariables=useCallback((content:DocumentContent,variables:Variables)=>setValue({content,variables}),[setValue]);
 return {draft,error,state,recover,invalidContent:invalid.current,rejectContent:(message:string)=>{invalid.current=true;apply({type:"edit"});setError(message);},isCurrent,dirty:state.edit>state.saved,save,flush,setContent,setVariables,setDate,setContentAndVariables,saveLabel:state.conflict?t.conflict:state.saving!==null?t.saving:state.edit>state.saved?t.dirty:t.saved};

}

