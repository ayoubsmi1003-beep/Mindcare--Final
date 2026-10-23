// Public model download only; preserve the existing local runtime/cache layout.
import {createReadStream,createWriteStream,existsSync,statSync,renameSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import path from 'node:path';
const q8=process.argv.includes('--q8'),revision='b69aef112e9f895e6f98d7ae0949f72ff09aa401';
const name=q8?'Llama-3.2-1B-Instruct-Q8_0.gguf':'Llama-3.2-1B-Instruct-Q4_K_M.gguf';
const expected=q8?'3f87a880027e7b9ea8e0da9e4009584336f352af444a0e6e5c20721ac4c7ffd1':'3f5a22426976ab26cfe84dba63c1d08391717abb1af893e10f1b2968d862dcc1',bytes=q8?1321082528:807694368;
const target=path.resolve('.cache/alexa/minicpm',name),partial=target+'.partial';
async function hash(file){const h=createHash('sha256');for await(const chunk of createReadStream(file))h.update(chunk);return h.digest('hex');}
if(existsSync(target)){if(await hash(target)!==expected)throw Error('ExistingModelIntegrityMismatch');}
else{
 const offset=existsSync(partial)?statSync(partial).size:0;
 const response=await fetch(`https://huggingface.co/unsloth/Llama-3.2-1B-Instruct-GGUF/resolve/${revision}/${name}`,{headers:offset?{Range:`bytes=${offset}-`}:{},signal:AbortSignal.timeout(900000)});
 if(!response.ok||!response.body)throw Error('PublicModelDownloadFailed');
 await pipeline(Readable.fromWeb(response.body),createWriteStream(partial,{flags:response.status===206?'a':'w'}));
 if(statSync(partial).size!==bytes||await hash(partial)!==expected)throw Error('DownloadedModelIntegrityMismatch');
 renameSync(partial,target);
}
writeFileSync(path.resolve(`.cache/clinical-evaluation-20261022/llama-model-provenance${q8?'-q8':''}.json`),JSON.stringify({name,repository:'unsloth/Llama-3.2-1B-Instruct-GGUF',baseModel:'meta-llama/Llama-3.2-1B-Instruct',revision,sha256:expected,bytes,verified:true},null,2));
console.log(JSON.stringify({model:name,sha256Verified:true,bytes}));
