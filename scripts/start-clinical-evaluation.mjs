// Explicit isolated local app; never changes the installed cabinet configuration.
import {loadEnvFile} from 'node:process';
import {spawn,execFileSync} from 'node:child_process';
import {readFileSync,openSync,writeFileSync} from 'node:fs';
import path from 'node:path';
const root=process.cwd(),privateRoot=path.join(root,'.cache','clinical-evaluation-20261022');
const isolation=JSON.parse(readFileSync(path.join(privateRoot,'isolation.json'),'utf8'));
if(!isolation.restorationVerified||isolation.port!==55444)throw Error('VerifiedEvaluationRequired');
loadEnvFile(path.join(root,'.env'));
const url=new URL(process.env.MINDCARE_DATABASE_URL??'');
url.hostname='127.0.0.1';url.port='55444';url.pathname='/alexa_eval_clinical_20261022';
process.env.MINDCARE_DATABASE_URL=url.href;
process.env.ALEXA_NATIVE_AGENT_ENABLED='1';
process.env.MINDCARE_LIVE_CHECK='1';
process.env.PORT='3006';
// The local model and browser share a small Windows machine; retain bounded
// connection waits without changing the installed cabinet's default settings.
process.env.MINDCARE_DATABASE_CONNECT_TIMEOUT_MS='30000';
process.env.ALEXA_DEBUG_NARRATIVE='1';
execFileSync(process.execPath,['scripts/verifier-base.mjs'],{stdio:['ignore','pipe','pipe'],windowsHide:true});
const out=openSync(path.join(privateRoot,'app.log'),'a');
const production=process.argv.includes('--production');
if(production){
 const build=spawn(process.execPath,['node_modules/next/dist/bin/next','build'],{cwd:root,env:process.env,windowsHide:true,stdio:['ignore',out,out]});
 await new Promise((resolve,reject)=>{build.once('error',reject);build.once('exit',code=>code===0?resolve():reject(Error('EvaluationBuildFailed')));});
}
const child=spawn(process.execPath,['node_modules/next/dist/bin/next',production?'start':'dev','--hostname','127.0.0.1','--port','3006'],{cwd:root,env:process.env,windowsHide:true,stdio:['ignore',out,out]});
writeFileSync(path.join(privateRoot,'app-process.json'),JSON.stringify({pid:child.pid,port:3006,database:isolation.database,startedAt:new Date().toISOString()}));
console.log(JSON.stringify({pid:child.pid,port:3006,database:isolation.database}));
await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error('EvaluationAppStopped')));});
