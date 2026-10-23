"use client";

import {useCallback, useEffect, useId, useRef, useState} from "react";

import {CHAMPS_PAR_TYPE,nombreEnLettres} from "@/services/documents";
import {documentsEditor as t,documentFieldLabels,treatmentLabel} from "@/i18n/documents-editor";
import {dateFrEstValide} from "./champs";
import {
  treatmentCount,
  treatmentValues,
  treatmentVariables,
  withTreatmentCount,
} from "./document-autofill";
import {Icone} from "@/components/ui";

import type {Draft,DocumentContent,Variables} from "@/shared/documents/types";

const DATE_FIELDS = new Set(["date_debut","date_naissance","date_consultation"]);

function isoFromFr(value:string):string{
  const match=/^(\d{2})\/(\d{2})\/(\d{4})$/u.exec(value);
  if(match===null)return "";
  return `${match[3]}-${match[2]}-${match[1]}`;
}

function frFromIso(value:string):string{
  const match=/^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if(match===null)return "";
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function replaceTreatmentValues(variables:Variables,values:readonly string[]):Variables{
  const next:Record<string,string>={};
  for(const [key,value] of Object.entries(variables)){
    if(!/^traitement_\d+$/u.test(key))next[key]=value;
  }
  return {...next,...treatmentVariables(values)};
}

function DateInput({id,label,value,onChange,hint}:{
  readonly id:string;
  readonly label:string;
  readonly value:string;
  readonly onChange:(value:string)=>void;
  readonly hint:string;
}){
  const valid=value===""||dateFrEstValide(value);
  return <label className="doc2-field" htmlFor={id}>
    <span className="doc2-field-label">{label}</span>
    {valid?<input id={id} type="date" value={isoFromFr(value)} onChange={event=>onChange(frFromIso(event.target.value))}/>:
      <input id={id} type="text" value={value} onChange={event=>onChange(event.target.value)} placeholder="JJ/MM/AAAA" aria-invalid="true"/>}
    <span className={valid?"doc2-hint":"doc2-hint is-warning"}>{valid?hint:t.invalidDate}</span>
  </label>;
}

export function DocumentFields({draft,onChange,onDate,onTreatmentChange}:{
  readonly draft:Draft;
  readonly onChange:(variables:Variables)=>void;
  readonly onDate:(value:string)=>void;
  readonly onTreatmentChange?:((content:DocumentContent,variables:Variables)=>void)|null;
}){
  const prefix=useId();
  const [computing,setComputing]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [lastAuto,setLastAuto]=useState<{readonly days:string;readonly words:string}|null>(null);
  const request=useRef(0);
  const variablesRef=useRef(draft.variables);
  const lastDays=useRef(draft.variables["jours"]??"");
  const lastDraft=useRef(draft.id);
  variablesRef.current=draft.variables;

  const days=draft.variables["jours"]??"";
  const written=draft.variables["jours_lettres"]??"";
  const values=treatmentValues(draft.variables);
  const count=treatmentCount(draft.variables);
  const fields=draft.kind==="ordonnance"?[]:CHAMPS_PAR_TYPE[draft.kind];

  const regenerate=useCallback(()=>{
    const number=Number(days);
    if(draft.kind!=="suivi_medical"||!/^\d{1,3}$/u.test(days)||!Number.isInteger(number)||number<1||number>365){
      setLastAuto(null);
      setComputing(false);
      return;
    }
    const current=++request.current;
    setComputing(true);
    setError(null);
    setLastAuto(null);
    void nombreEnLettres(number).then(result=>{
      if(current!==request.current)return;
      setComputing(false);
      if(result.ok&&result.data!==null){
        setLastAuto({days,words:result.data});
        onChange({...variablesRef.current,jours_lettres:result.data});
      }else if(!result.ok){
        setError(result.error.message);
      }
    });
  },[days,draft.kind,onChange]);

  useEffect(()=>{
    if(draft.kind!=="suivi_medical")return;
    const changed=lastDraft.current!==draft.id||lastDays.current!==days;
    lastDraft.current=draft.id;
    lastDays.current=days;
    if(!changed)return;
    regenerate();
  },[days,draft.id,draft.kind,regenerate]);

  const updateVariable=useCallback((key:string,value:string)=>{
    onChange({...variablesRef.current,[key]:value});
  },[onChange]);

  const updateTreatment=useCallback((index:number,value:string)=>{
    const next=[...treatmentValues(variablesRef.current)];
    next[index]=value;
    onChange(replaceTreatmentValues(variablesRef.current,next));
  },[onChange]);

  const addTreatment=useCallback(()=>{
    const next=[...treatmentValues(variablesRef.current),""];
    const nextVariables=replaceTreatmentValues(variablesRef.current,next);
    if(onTreatmentChange)onTreatmentChange(withTreatmentCount(draft.content,next.length),nextVariables);
    else onChange(nextVariables);
  },[draft.content,onChange,onTreatmentChange]);

  const removeTreatment=useCallback((index:number)=>{
    const next=treatmentValues(variablesRef.current).filter((_,position)=>position!==index);
    const valuesToKeep=next.length===0?[""]:next;
    const nextVariables=replaceTreatmentValues(variablesRef.current,valuesToKeep);
    if(onTreatmentChange)onTreatmentChange(withTreatmentCount(draft.content,valuesToKeep.length),nextVariables);
    else onChange(nextVariables);
  },[draft.content,onChange,onTreatmentChange]);

  const manualWritten=lastAuto!==null&&lastAuto.days===days&&written!==""&&written!==lastAuto.words;
  const daysInvalid=days!==""&&(!/^\d{1,3}$/u.test(days)||Number(days)<1||Number(days)>365);

  const field=(key:string)=>{
    const id=`${prefix}-${key}`;
    const label=documentFieldLabels[key]??key;
    const value=draft.variables[key]??"";
    if(DATE_FIELDS.has(key)){
      return <DateInput key={key} id={id} label={label} value={value} onChange={next=>updateVariable(key,next)} hint={t.dateHint}/>;
    }
    const hint=key==="id_document_number"&&value.trim()===""?t.identityHint
      :key==="mairie"&&value.trim()===""?t.mairieHint
      :key==="jours"?t.daysHint
      :key==="jours_lettres"?t.writtenHint
      :undefined;
    return <label className="doc2-field" key={key} htmlFor={id}>
      <span className="doc2-field-label">{label}</span>
      <input
        id={id}
        type="text"
        value={value}
        onChange={event=>updateVariable(key,event.target.value)}
        aria-invalid={key==="jours"&&daysInvalid?"true":undefined}
      />
      {hint!==undefined?<span className={key==="jours"&&daysInvalid?"doc2-hint is-warning":"doc2-hint"}>{key==="jours"&&daysInvalid?t.daysRange:hint}</span>:null}
    </label>;
  };

  return <section className="doc2-panel">
    <div className="doc2-panel-heading">
      <h3>{t.fields}</h3>
      <p>{t.autoFillHint}</p>
    </div>

    <label className="doc2-field" htmlFor={`${prefix}-document-date`}>
      <span className="doc2-field-label">{t.documentDate}</span>
      <input id={`${prefix}-document-date`} type="date" value={draft.documentDate} onChange={event=>onDate(event.target.value)}/>
      <span className="doc2-hint">{t.documentDateHint}</span>
    </label>

    {draft.kind==="suivi_medical"?
      <>
        <label className="doc2-field" htmlFor={`${prefix}-jours`}>
          <span className="doc2-field-label">{documentFieldLabels["jours"]}</span>
          <input
            id={`${prefix}-jours`}
            type="number"
            min="1"
            max="365"
            step="1"
            inputMode="numeric"
            value={days}
            onChange={event=>updateVariable("jours",event.target.value)}
            aria-invalid={daysInvalid?"true":undefined}
          />
          <span className={daysInvalid?"doc2-hint is-warning":"doc2-hint"}>{daysInvalid?t.daysRange:t.daysHint}</span>
        </label>
        <label className="doc2-field" htmlFor={`${prefix}-jours-lettres`}>
          <span className="doc2-field-label">{documentFieldLabels["jours_lettres"]}</span>
          <input
            id={`${prefix}-jours-lettres`}
            type="text"
            value={written}
            onChange={event=>updateVariable("jours_lettres",event.target.value)}
          />
          <span className={manualWritten?"doc2-hint is-warning":"doc2-hint"}>
            {computing?t.writtenComputing:manualWritten?t.writtenManual:t.writtenHint}
          </span>
        </label>
        {error!==null?<div className="doc2-inline-error" role="alert"><p>{error}</p><button type="button" onClick={regenerate}>{t.retry}</button></div>:null}
        <DateInput id={`${prefix}-date-debut`} label={documentFieldLabels["date_debut"]!} value={draft.variables["date_debut"]??""} onChange={next=>updateVariable("date_debut",next)} hint={t.dateHint}/>
      </>:
      draft.kind==="certificat_medical"?
        <>
          <DateInput id={`${prefix}-date-naissance`} label={documentFieldLabels["date_naissance"]!} value={draft.variables["date_naissance"]??""} onChange={next=>updateVariable("date_naissance",next)} hint={t.birthDateHint}/>
          <div className="doc2-treatments">
            <div className="doc2-field-label">{t.treatments}</div>
            <p className="doc2-hint">{t.treatmentsHint}</p>
            {values.map((value,index)=><div className="doc2-treatment-row" key={`treatment-${String(index)}`}>
              <label className="doc2-field" htmlFor={`${prefix}-traitement-${String(index)}`}>
                <span className="doc2-field-label">{treatmentLabel(index+1)}</span>
                <input
                  id={`${prefix}-traitement-${String(index)}`}
                  type="text"
                  value={value}
                  onChange={event=>updateTreatment(index,event.target.value)}
                  placeholder={t.treatmentPlaceholder}
                />
              </label>
              {count>1?<button className="doc2-remove" type="button" aria-label={`${t.remove} ${treatmentLabel(index+1)}`} title={t.remove} onClick={()=>removeTreatment(index)}><Icone nom="croix" taille={16}/></button>:null}
            </div>)}
            <button className="doc2-add" type="button" onClick={addTreatment}><Icone nom="plus" taille={16}/>{t.addTreatment}</button>
          </div>
        </>:
        fields.map(field)
    }
  </section>;
}
