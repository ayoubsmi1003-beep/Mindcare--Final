import {openSync,readSync,closeSync,readFileSync,writeFileSync,readdirSync,lstatSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {join,relative,sep} from 'node:path';

const receiptName='alexa-build.json';
const bootstrap='// MindCare packaged Alexa: verified native path\nprocess.env.ALEXA_NATIVE_AGENT_ENABLED = "1";\n';
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function fileHash(file){
 const fd=openSync(file,'r'),hash=createHash('sha256'),buffer=Buffer.alloc(1024*1024);
 try{let size;while((size=readSync(fd,buffer,0,buffer.length,null))>0)hash.update(buffer.subarray(0,size));return hash.digest('hex');}finally{closeSync(fd);}
}
export function withNativeBootstrap(source){
 if(source.includes(bootstrap))throw Error('AlexaPackageAlreadyPrepared');
 const shebang=source.startsWith('#!')?source.indexOf('\n')+1:0;
 if(source.startsWith('#!')&&!shebang)throw Error('AlexaPackageInvalidEntrypoint');
 const strict=/^\s*(["'])use strict\1\s*;?/u.exec(source.slice(shebang));
 const at=shebang+(strict?.[0].length??0);
 return source.slice(0,at)+(at?'\n':'')+bootstrap+source.slice(at);
}
export function enablePackagedNativeEntrypoints(server){
 const paths=['server.js','scripts/verifier-base.mjs'];
 const updated=paths.map(path=>[join(server,path),withNativeBootstrap(readFileSync(join(server,path),'utf8'))]);
 for(const [path,text] of updated)writeFileSync(path,text);
}
export function backendInventory(root){
 const files=[];
 function visit(dir){for(const entry of readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name<b.name?-1:1)){
  const file=join(dir,entry.name),path=relative(root,file).split(sep).join('/');
  if(path==='node_modules'||path===receiptName)continue;
  if(entry.isSymbolicLink()||entry.name==='.env'||entry.name.startsWith('.env.'))throw Error('AlexaBackendUnexpectedAssets');
  if(entry.isDirectory())visit(file);else if(entry.isFile())files.push([path,fileHash(file)]);else throw Error('AlexaBackendUnexpectedAssets');
 }}visit(root);return files.sort(([a],[b])=>a<b?-1:a>b?1:0);
}
export function assertBackendInventory(root,expected){if(JSON.stringify(backendInventory(root))!==JSON.stringify(expected))throw Error('AlexaBackendIntegrity');}
export function assertModelInventory(actual,pin){
 if(actual.runtimeFiles!==50||actual.modelSha256!==pin.sha256||actual.archiveSha256!==pin.archiveSha256||actual.runtimeManifestSha256!==pin.runtimeManifestSha256)throw Error('AlexaPackagedModelIntegrity');
}
function modelPin(root){
 const runtime=readFileSync(join(root,'src/server/alexa/local-model.ts'),'utf8'),policy=readFileSync(join(root,'src/server/alexa/model-policy.ts'),'utf8');
 const value=name=>{const found=new RegExp('\\b'+name+': "([a-z0-9]+)"').exec(runtime)?.[1];if(!found)throw Error('AlexaModelPinMissing');return found;};
 const model=/ALEXA_CONVERSATION_MODEL = "([A-Za-z0-9_.-]+\.gguf)"/u.exec(policy)?.[1];if(!model)throw Error('AlexaModelPinMissing');
 return {model,runtime:value('runtime'),sha256:value('sha256'),archiveSha256:value('archiveSha256'),runtimeManifestSha256:value('runtimeManifestSha256')};
}
function packagedModelInventory(root,pin){
 const runtime='runtime-'+pin.runtime,archive='llama-'+pin.runtime+'.zip',allowed=new Set([pin.model,runtime,archive]);
 if(readdirSync(root).some(name=>!allowed.has(name)))throw Error('AlexaPackagedModelIntegrity');
 for(const name of allowed)if(lstatSync(join(root,name)).isSymbolicLink())throw Error('AlexaPackagedModelIntegrity');
 const entries=readdirSync(join(root,runtime),{withFileTypes:true});
 if(entries.some(e=>!e.isFile()||!/^[-A-Za-z0-9_.]+\.(?:exe|dll)$/iu.test(e.name)))throw Error('AlexaPackagedModelIntegrity');
 const lines=entries.map(e=>e.name).sort().map(name=>name+':'+fileHash(join(root,runtime,name)));
 const result={modelSha256:fileHash(join(root,pin.model)),archiveSha256:fileHash(join(root,archive)),runtimeManifestSha256:createHash('sha256').update(lines.join('\n')).digest('hex'),runtimeFiles:entries.length};
 assertModelInventory(result,pin);return result;
}
/** Source identity contains hashes only; it is not a claim of clinical qualification. */
export function snapshotAlexaBuildSources(root){
 const paths=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z','--','src','electron','scripts','supabase','public','build-ressources','resources/snapshot/purge-synthetic.sql','package.json','pnpm-lock.yaml','next.config.ts','next-env.d.ts','electron-builder.yml','tsconfig.json','tailwind.config.ts','postcss.config.js','postcss.config.cjs','postcss.config.mjs','tests/eval/alexa-fr-200-cases.json'],{cwd:root,encoding:'utf8',windowsHide:true}).split('\0').filter(Boolean);
 const files=[...new Set(paths)].sort().map(path=>[path,fileHash(join(root,path))]);
 const commit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',windowsHide:true}).trim();
 if(!/^[a-f0-9]{40}$/u.test(commit))throw Error('AlexaBuildCommitRequired');
 return {commit,sourceSha256:digest(files),sourceFiles:files.length};
}
export function finalizeAlexaBuild(root,server,before){
 const after=snapshotAlexaBuildSources(root);if(before.sourceSha256!==after.sourceSha256||before.commit!==after.commit)throw Error('AlexaBuildSourceChanged');
 for(const path of ['server.js','scripts/verifier-base.mjs'])if(!readFileSync(join(server,path),'utf8').includes(bootstrap))throw Error('AlexaPackagedNativeRequired');
 const buildId=readFileSync(join(server,'.next/BUILD_ID'),'utf8').trim();if(!buildId||buildId.length>256)throw Error('AlexaBuildIdRequired');
 const pin=modelPin(root),model=packagedModelInventory(join(server,'..','alexa','local-model'),pin);
 const receipt={version:1,...before,buildId,native:true,pin,model,files:backendInventory(server)};
 writeFileSync(join(server,receiptName),JSON.stringify(receipt,null,2));return receipt;
}
export function verifyAlexaPackage(root,artifact){
 const server=join(artifact,'resources','serveur'),raw=readFileSync(join(server,receiptName),'utf8');if(raw.length>16*1024*1024)throw Error('AlexaBuildReceiptInvalid');
 const receipt=JSON.parse(raw),current=snapshotAlexaBuildSources(root),pin=modelPin(root);
 if(receipt.version!==1||receipt.native!==true||receipt.commit!==current.commit||receipt.sourceSha256!==current.sourceSha256||JSON.stringify(receipt.pin)!==JSON.stringify(pin))throw Error('AlexaBuildSourceMismatch');
 if(readFileSync(join(server,'.next/BUILD_ID'),'utf8').trim()!==receipt.buildId)throw Error('AlexaBuildIdMismatch');
 for(const path of ['server.js','scripts/verifier-base.mjs'])if(!readFileSync(join(server,path),'utf8').includes(bootstrap))throw Error('AlexaPackagedNativeRequired');
 assertBackendInventory(server,receipt.files);
 const actual=packagedModelInventory(join(artifact,'resources','alexa','local-model'),pin);
 if(JSON.stringify(actual)!==JSON.stringify(receipt.model))throw Error('AlexaPackagedModelIntegrity');
 return {commit:receipt.commit,sourceSha256:receipt.sourceSha256,buildId:receipt.buildId,modelSha256:actual.modelSha256,native:true};
}
