"use client";
import {useEffect,useState} from "react";
import type {DocumentContent,DocumentNode} from "@/shared/documents/types";
import {documentsEditor as t} from "@/i18n/documents-editor";
import {searchMedications,type MedicationCatalogItem} from "@/services/medications";
import {dailyFrequency,setDailyFrequency,setMedicationName} from "./prescription-fields";
function MedicationRow({node,change,remove}:{readonly node:DocumentNode;readonly change:(attrs:DocumentNode["attrs"])=>void;readonly remove:()=>void}){
 const [query,setQuery]=useState(""),[results,setResults]=useState<readonly MedicationCatalogItem[]>([]),[error,setError]=useState<string|null>(null);
 const attrs=node.attrs??{};
 useEffect(()=>{let current=true;setResults([]);setError(null);if(query.trim().length<3)return;const timer=setTimeout(()=>{void searchMedications(query,8).then(r=>{if(!current)return;if(r.ok)setResults(r.data);else setError(r.error.message);});},140);return()=>{current=false;clearTimeout(timer);};},[query]);
 return <div className="doc2-med-row"><div className="doc2-med-inputs"><label>{t.medication}<input autoComplete="off" value={String(attrs["designation"]??"")} onChange={e=>{setQuery(e.target.value);change(setMedicationName(attrs,e.target.value));}}/></label><label>{t.dailyCount}<input type="number" min="1" step="1" value={dailyFrequency(attrs)} onChange={e=>change(setDailyFrequency(attrs,e.target.value))}/></label><button className="doc2-remove" type="button" aria-label={t.remove} title={t.remove} onClick={remove}>×</button></div>
 {error?<p role="alert">{error}</p>:null}
 {results.length?<div className="doc2-suggestions">{results.map(item=><button type="button" key={item.id} onClick={()=>{change({...attrs,source:"catalogue",medicationId:item.id,designation:item.rawName,strength:""});setQuery("");}}>{item.rawName}</button>)}</div>:null}</div>;
}
export function MedicationRows({content,onChange}:{readonly content:DocumentContent;readonly onChange:(c:DocumentContent)=>void}){
 const change=(index:number,node:DocumentNode|null)=>{const next=[...content.content];if(node)next[index]=node;else next.splice(index,1);onChange({...content,content:next});};
 return <section className="doc2-medications"><h3>{t.prescription}</h3><p className="doc2-hint">{t.prescriptionHint}</p>{content.content.map((node,index)=>node.type==="medication"?<MedicationRow key={String(node.attrs?.["rowId"])} node={node} change={attrs=>change(index,{...node,attrs:attrs??{}})} remove={()=>change(index,null)}/>:null)}
 <button className="doc2-add" type="button" disabled={content.content.filter(n=>n.type==="medication").length>=50} onClick={()=>onChange({...content,content:[...content.content,{type:"medication",attrs:{rowId:crypto.randomUUID(),medicationId:null,source:"free-text",designation:"",strength:"",posology:"",quantity:"",frequency:"",duration:"",administration:"",instructions:""}}]})}>+ {t.addMedication}</button></section>;
}
