import React,{Fragment} from 'react';
import Link from 'next/link';
import {answerLinkPath,validAnswerLinks,type AlexaAnswerBlock} from '@/shared/alexa/answer-links';

/** Render only server-assembled ranges; stale or malformed metadata falls back to plain text. */
export function AlexaAnswerText({text,blocks}:{readonly text:string;readonly blocks?:readonly AlexaAnswerBlock[]|undefined}):React.JSX.Element{
 if(!blocks?.length||blocks.map(block=>block.text).join('\n')!==text||blocks.some(block=>block.links!==undefined&&!validAnswerLinks(block.text,block.links)))return <>{text}</>;
 return <>{blocks.map((block,index)=>{
  let end=0;const parts:React.ReactNode[]=[];
  for(const link of block.links??[]){
   const href=answerLinkPath(link.target),className='underline underline-offset-4';
   parts.push(block.text.slice(end,link.start),link.target.kind==='document'||link.target.kind==='draft'?<a key={link.start} className={className} href={href}>{link.label}</a>:<Link key={link.start} className={className} href={href}>{link.label}</Link>);end=link.end;
  }
  parts.push(block.text.slice(end));
  return <Fragment key={index}>{index?'\n':''}{parts}</Fragment>;
 })}</>;
}
