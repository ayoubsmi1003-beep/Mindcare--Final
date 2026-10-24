type LocalModelPhase='slot'|'integrity'|'startup'|'context'|'generation';
/** Opt-in operational measurements contain no requests, source text or exception messages. */
export async function measureLocalModelPhase<T>(phase:LocalModelPhase,work:()=>Promise<T>):Promise<T>{
 const start=performance.now();let completed=false;
 try{const result=await work();completed=true;return result;}
 finally{
  if(process.env['ALEXA_LOCAL_TIMINGS']==='1')try{
   console.info('[alexa-local-timing]',{phase,ms:Math.max(0,Math.round(performance.now()-start)),completed});
  }catch{/* Diagnostics cannot change the inference outcome. */}
 }
}
