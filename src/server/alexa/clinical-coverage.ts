import type {ClinicalContext} from '@/shared/alexa/clinical';
import {consultationExcerpts} from './note-excerpts';

export function clinicalSectionComplete(context:ClinicalContext,section:string|undefined):boolean{
 if(section==='diagnoses'||section==='scales')return true;
 if(section==='treatments')return context.treatments.historyComplete;
 if(section==='current')return !context.currentConsultation||!consultationExcerpts(context.currentConsultation).omitted;
 if(!context.coverage.complete)return false;
 let characters=0;
 for(const consultation of context.consultations){
  const selected=consultationExcerpts(consultation);
  if(selected.omitted)return false;
  for(const excerpt of selected.excerpts){characters+=excerpt.text.length;if(characters>8000)return false;}
 }
 return true;
}

export function clinicalSummaryComplete(context:ClinicalContext,narrativeComplete:boolean,requestedScope:boolean):boolean{
 if(!narrativeComplete)return false;
 if(requestedScope)return true;
 if(context.coverage.hasMore)return false;
 return ['history','treatments','current'].every(section=>clinicalSectionComplete(context,section));
}
