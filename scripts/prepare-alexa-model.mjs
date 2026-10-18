import {readFile,readdir,stat,mkdir,copyFile} from 'node:fs/promises';
import {createReadStream} from 'node:fs';import {createHash} from 'node:crypto';import {resolve,join,dirname} from 'node:path';import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const source=join(root,'.cache/alexa/minicpm'),target=join(root,'resources/alexa/local-model');
const runtimeSource=await readFile(join(root,'src/server/alexa/local-model.ts'),'utf8'),policy=await readFile(join(root,'src/server/alexa/model-policy.ts'),'utf8');
const pin=name=>{const value=new RegExp('\\b'+name+': "([a-z0-9]+)"').exec(runtimeSource)?.[1];if(!value)throw Error('MissingModelPin');return value;};
const model=/ALEXA_CONVERSATION_MODEL = "([A-Za-z0-9_.-]+\.gguf)"/.exec(policy)?.[1];if(!model)throw Error('MissingModelPin');
const runtime='runtime-'+pin('runtime'),archive='llama-'+pin('runtime')+'.zip';
async function hash(file){const sha=createHash('sha256');for await(const chunk of createReadStream(file,{highWaterMark:1024*1024}))sha.update(chunk);return sha.digest('hex');}
const binaries=(await readdir(join(source,runtime),{withFileTypes:true})).filter(e=>/\.(exe|dll)$/i.test(e.name));
if(binaries.length!==50||binaries.some(e=>!e.isFile()))throw Error('InvalidRuntimeFiles');
const names=binaries.map(e=>e.name).sort(),lines=[];for(const name of names)lines.push(name+':'+await hash(join(source,runtime,name)));
if(await hash(join(source,model))!==pin('sha256')||await hash(join(source,archive))!==pin('archiveSha256')||createHash('sha256').update(lines.join('\n')).digest('hex')!==pin('runtimeManifestSha256'))throw Error('LocalModelIntegrity');
const files=[model,archive,...names.map(name=>runtime+'/'+name)];
if(!process.argv.includes('--check')){
 // Every copied file is named and hashed above; no qualification, audio or cache logs are shipped.
 for(const file of files){await mkdir(dirname(join(target,file)),{recursive:true});await copyFile(join(source,file),join(target,file));}
 for(const file of files)if((await stat(join(source,file))).size!==(await stat(join(target,file))).size||await hash(join(source,file))!==await hash(join(target,file)))throw Error('PackagedModelIntegrity');
}
console.log(JSON.stringify({status:'PASS',mode:process.argv.includes('--check')?'source-integrity':'assembled',model,runtime,files:files.length}));
