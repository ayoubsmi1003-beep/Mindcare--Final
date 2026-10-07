"use client";

import {useState,useEffect} from "react";
import {CHAMPS_PAR_TYPE,nombreEnLettres} from "@/services/documents";

import {documentsEditor as t,documentFieldLabels} from "@/i18n/documents-editor";



import type {Draft,Variables} from "@/shared/documents/types";

export function DocumentFields({draft,onChange,onDate}:{readonly draft:Draft;readonly onChange:(v:Variables)=>void;readonly onDate:(value:string)=>void}){

 const [computedWords,setComputedWords]=useState("");const [error,setError]=useState<string|null>(null),[retry,setRetry]=useState(0);
 const days=draft.variables["jours"]??"";
 useEffect(()=>{let active=true;setComputedWords("");setError(null);const n=Number(days);if(draft.kind!=="suivi_medical"||!/^\d{1,3}$/.test(days)||n<1||n>365)return;const timer=setTimeout(()=>{void nombreEnLettres(n).then(r=>{if(!active)return;if(r.ok)setComputedWords(r.data??"");else setError(r.error.message);});},300);return()=>{active=false;clearTimeout(timer);};},[draft.kind,days,retry]);
 const fields=draft.kind==="ordonnance"?[]:CHAMPS_PAR_TYPE[draft.kind];

 return <section className="doc2-panel"><h3>{t.fields}</h3><label>{t.documentDate}<input type="date" value={draft.documentDate} onChange={e=>onDate(e.target.value)}/></label>

 {fields.map(key=>{const label=documentFieldLabels[key]??key;return <label key={key}>{label}<input value={key==="jours_lettres"?computedWords:draft.variables[key]??""} readOnly={key==="jours_lettres"} onChange={e=>onChange({...draft.variables,[key]:e.target.value})}/></label>;})}{error?<div role="alert"><p>{error}</p><button type="button" onClick={()=>setRetry(v=>v+1)}>{t.retry}</button></div>:null}</section>;

}

