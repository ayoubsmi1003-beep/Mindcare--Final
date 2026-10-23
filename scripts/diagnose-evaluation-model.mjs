import {spawn} from 'node:child_process';
import {openSync,writeFileSync,createReadStream,readFileSync} from 'node:fs';
import {createHash,randomBytes} from 'node:crypto';
import path from 'node:path';
import {z} from 'zod';
const root=path.resolve('.cache/alexa/minicpm'),out=path.resolve('.cache/clinical-evaluation-20261022');
const policy=readFileSync('src/server/alexa/model-policy.ts','utf8'),runtime=readFileSync('src/server/alexa/local-model.ts','utf8');
const q8=process.argv.includes('--q8');
const modelName=q8?'Llama-3.2-1B-Instruct-Q8_0.gguf':/ALEXA_CONVERSATION_MODEL = "([A-Za-z0-9_.-]+\.gguf)"/.exec(policy)?.[1],expected=q8?'3f87a880027e7b9ea8e0da9e4009584336f352af444a0e6e5c20721ac4c7ffd1':/sha256: "([a-f0-9]{64})"/.exec(runtime)?.[1];
if(!modelName||!expected)throw Error('ModelPinRequired');
const model=path.join(root,modelName);
const hash=createHash('sha256');for await(const chunk of createReadStream(model))hash.update(chunk);
if(hash.digest('hex')!==expected)throw Error('ModelIntegrity');
const token=randomBytes(32).toString('hex'),port=18083,started=Date.now(),log=openSync(path.join(out,'model-startup.log'),'w');
const cpu=process.argv.includes('--cpu');
const threads=process.argv.includes('--threads=1')?'1':'4';
const child=spawn(path.join(root,'runtime-b11429','llama-server.exe'),['-m',model,'--host','127.0.0.1','--port',String(port),'-c','4096','-t',threads,'--batch-size','128','--ubatch-size','128','--load-mode','none','--parallel','1','--jinja','--reasoning','off','--no-context-shift','--no-warmup','--api-key',token,'--no-webui',...(cpu?['--gpu-layers','0']:[])],{cwd:path.join(root,'runtime-b11429'),windowsHide:true,stdio:['ignore',log,log],env:{NODE_ENV:'production',SystemRoot:process.env.SystemRoot,WINDIR:process.env.WINDIR,OMP_NUM_THREADS:threads}});
const result={model:path.basename(model),cpu,threads,sha256Verified:true};
try{
 let ready=false;
 for(let i=0;Date.now()-started<300000;i++){
  if(child.exitCode!==null)throw Error('ModelExited');
  try{const r=await fetch(`http://127.0.0.1:${port}/health`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(500)});if(r.status===200){ready=true;break;}}catch{}
  await new Promise(r=>setTimeout(r,250));
 }
 result.ready=ready;result.startupMs=Date.now()-started;
 if(!ready)throw Error('ModelStartupDeadline');
 if(ready){
  if(process.argv.includes('--template-probe')){
   result.cases=[];
   const schema=JSON.parse(readFileSync(path.join(out,'native-evidence-template-schema.json'),'utf8'));
   for(const style of ['bounded','without-items-false','mandatory-only']){
    const current=structuredClone(schema),evidence=current.properties.sentences.items.properties.evidence;
    if(style!=='bounded')delete evidence.items;
    if(style==='mandatory-only'){evidence.prefixItems=evidence.prefixItems.slice(0,evidence.minItems);evidence.maxItems=evidence.minItems;}
    const response=await fetch(`http://127.0.0.1:${port}/apply-template`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({model:'local',messages:[{role:'system',content:'Réponds en français en JSON.'},{role:'user',content:'La personne rapporte des réveils nocturnes. Le suivi reste prévu.'}],max_tokens:200,temperature:0,reasoning_effort:'none',chat_template_kwargs:{enable_thinking:false},response_format:{type:'json_schema',json_schema:{name:'probe',strict:true,schema:current}}}),signal:AbortSignal.timeout(60000)});
    const body=await response.text();writeFileSync(path.join(out,`native-template-${style}.json`),body);
    result.cases.push({id:style,status:response.ok?'PASS':'FAIL',httpStatus:response.status});
   }
  }else if(process.argv.includes('--schema-probe')){
   result.cases=[];
   for(const style of ['exact-pattern-root','exact-array']){
    const wanted=style.endsWith('-salut')?'Salut':'Bonjour';
    const pattern=style==='nested-noncapture'?'^(?:Bonjour)$':style==='nested-bounded'?'^(?:Bon){1}jour$':`^${wanted}$`;
    const property=style.includes('-const')?{type:'string',const:wanted}:{type:'string',pattern,...(style.endsWith('-length')?{minLength:1,maxLength:20}:{})};
    const exact=style.startsWith('exact-')?JSON.parse(readFileSync(path.join(out,'exact-repair-schema-native.json'),'utf8')):null;
    const exactText=exact?.properties.sentences.items.properties.text;
    const schema=style==='exact-array'?exact:style.startsWith('exact-pattern-')?{type:'object',properties:{text:style==='exact-pattern-no-length'?{type:'string',pattern:exactText.pattern}:exactText},required:['text'],additionalProperties:false}:style==='nested-array-pattern'?z.toJSONSchema(z.object({sentences:z.array(z.object({evidence:z.tuple([z.object({id:z.literal('s1'),quote:z.literal('Bonjour médecin.')}).strict()]),text:z.string().trim().min(1).max(1100).regex(/^Bonjour$/u)}).strict()).length(1)}).strict()):{type:'object',properties:{text:property},required:['text'],additionalProperties:false};
    const response_format=style==='flat-pattern'?{type:'json_schema',schema}:{type:'json_schema',json_schema:{name:style.startsWith('renamed-')?'probe_new':'probe',strict:true,schema}};
    const response=await fetch(`http://127.0.0.1:${port}/v1/chat/completions`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({model:'local',messages:[{role:'system',content:'Réponds uniquement en JSON avec un champ text.'},{role:'user',content:'Écris Salut dans text.'}],max_tokens:1024,temperature:0,reasoning_effort:'none',chat_template_kwargs:{enable_thinking:false},response_format}),signal:AbortSignal.timeout(180000)});
    const body=await response.json(),answer=body.choices?.[0]?.message?.content??'';
    let enforced=false;try{const decoded=JSON.parse(answer),text=style==='nested-array-pattern'||style==='exact-array'?decoded.sentences?.[0]?.text:decoded.text;enforced=exact?new RegExp(exactText.pattern,'u').test(text):text===wanted;}catch{}
    result.cases.push({id:style,status:enforced?'PASS':'FAIL',httpStatus:response.status,finishReason:body.choices?.[0]?.finish_reason,answer});
   }
  }else{
  const cases=[
   {id:'fr-fact',question:'Quelle est la capitale de l’Algérie ?',check:t=>/Alger/iu.test(t)},
   {id:'fr-source',question:'Le patient rapporte des réveils nocturnes. Le médecin observe un contact préservé. Aucune donnée de traitement n’est enregistrée. Résume ces faits en deux phrases naturelles.',check:t=>/r[ée]veils|sommeil/iu.test(t)&&/contact/iu.test(t)&&/rapporte|d[ée]crit/iu.test(t)&&!/\b(?:mg|sertraline|fluoxetine|diazepam|cause|conditions|consulter|sympt[oô]me)\b/iu.test(t)},
   {id:'fr-comparison',question:'Les seuls scores enregistrés sont une anxiété à 7 sur 10 à la séance précédente puis à 4 sur 10 aujourd’hui. Plus le score est élevé, plus la difficulté est forte. Décris l’évolution sans ajouter de symptôme.',check:t=>/7/u.test(t)&&/4/u.test(t)&&/diminu|baisse|am[ée]lior/iu.test(t)},
   {id:'fr-missing',question:'Le dossier ne contient ni nom de médicament ni dosage. Quel est le traitement du patient ? Réponds sans rien inventer.',check:t=>/dossier|renseign|information|pr[ée]cis|inconn/iu.test(t)&&/pas|aucun|absence|impossible|manqu|non renseign|inconn/iu.test(t)&&!/\b\d+\s*mg\b/iu.test(t)},
  ];
  result.cases=[];
  for(const spec of cases){
   const response=await fetch(`http://127.0.0.1:${port}/v1/chat/completions`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({model:'local',messages:[{role:'system',content:process.argv.includes('--concise')?'Answer in French, in at most two clear sentences. For questions about a patient record, use only the supplied facts, distinguish patient reports from observations, and explicitly state when information is missing. Do not infer diagnoses, causes or recommendations.':'Tu aides un médecin à relire son dossier. Réponds uniquement en français, en un court paragraphe fluide. Reformule seulement les faits fournis : aucun diagnostic ajouté, aucune cause supposée, aucune recommandation. Distingue ce que le patient rapporte et ce que le médecin observe. Compare les chiffres exacts en indiquant si la difficulté augmente ou diminue, sans inventer de seuil de gravité. Si le dossier ne donne pas une information, indique explicitement qu’elle n’est pas renseignée. La demande porte sur la lecture du dossier, pas sur des conseils médicaux.'},{role:'user',content:spec.question}],max_tokens:200,temperature:0,reasoning_effort:'none',chat_template_kwargs:{enable_thinking:false}}),signal:AbortSignal.timeout(900000)});
   const body=await response.json(),answer=body.choices?.[0]?.message?.content??'';
   result.cases.push({id:spec.id,status:response.status===200&&body.choices?.[0]?.finish_reason==='stop'&&spec.check(answer)?'PASS':'FAIL',answer,timings:body.timings,model:body.model,finishReason:body.choices?.[0]?.finish_reason});
  }
  }
 }
}catch(e){result.error=e.name+':'+e.message;}finally{child.kill();result.elapsedMs=Date.now()-started;writeFileSync(path.join(out,process.argv.includes('--template-probe')?'native-template-probe.json':process.argv.includes('--schema-probe')?'native-schema-probe.json':`${modelName.startsWith('Llama')?'llama32':'model'}${q8?'-q8':''}-diagnostic${cpu?'-cpu':''}${process.argv.includes('--concise')?'-concise':''}.json`),JSON.stringify(result,null,2));console.log(JSON.stringify({ready:result.ready,error:result.error,elapsedMs:result.elapsedMs,cpu,cases:result.cases?.map(c=>({id:c.id,status:c.status}))}));}
