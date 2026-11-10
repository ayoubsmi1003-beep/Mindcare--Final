import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, lstat, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const models = [
  { slug:'e5-base', recipe:'recette-embedding-secondaire-768.json' },
  { slug:'mmarco-rerank', recipe:'recette-rerank-secondaire.json' },
];
async function regular(file) {
  const s=await lstat(file);
  if(!s.isFile()||s.isSymbolicLink())throw new Error('KNOWLEDGE_ASSET_NOT_REGULAR');
}
async function hash(file) {
  await regular(file); const h=createHash('sha256');
  for await(const chunk of createReadStream(file))h.update(chunk);
  return h.digest('hex');
}
export async function stageKnowledgeAssets(root,cache,dest,specs=models) {
  const checks=[];
  for(const {slug,recipe} of specs) {
    if(!/^[a-z0-9-]+$/.test(slug)||!/^recette-[a-z0-9-]+\.json$/.test(recipe))throw new Error('KNOWLEDGE_SPEC_INVALID');
    const sourceRecipe=path.join(root,'knowledge',recipe);await regular(sourceRecipe);
    const data=JSON.parse(await readFile(sourceRecipe,'utf8'));
    for(const [name,key] of [['model.onnx','model_onnx'],['tokenizer.json','tokenizer_json']]) {
      const expected=data.artifact_sha256?.[key];
      if(!/^[a-f0-9]{64}$/.test(expected??'')||await hash(path.join(cache,slug,name))!==expected)throw new Error('KNOWLEDGE_ASSET_HASH_MISMATCH');
    }
    const config=path.join(cache,slug,'tokenizer_config.json');await regular(config);JSON.parse(await readFile(config,'utf8'));
    checks.push({slug,recipe,sourceRecipe,pins:data.artifact_sha256});
  }
  for(const {slug,recipe,sourceRecipe,pins} of checks) {
    const target=path.join(dest,'resources','models',slug);
    await mkdir(target,{recursive:true});await mkdir(path.join(dest,'knowledge'),{recursive:true});
    for(const name of ['model.onnx','tokenizer.json','tokenizer_config.json'])await copyFile(path.join(cache,slug,name),path.join(target,name));
    await copyFile(sourceRecipe,path.join(dest,'knowledge',recipe));
    if(await hash(path.join(target,'model.onnx'))!==pins.model_onnx||await hash(path.join(target,'tokenizer.json'))!==pins.tokenizer_json)throw new Error('KNOWLEDGE_COPY_HASH_MISMATCH');
  }
  return checks.length;
}
export async function verifyKnowledgeAssets(root,dest,specs=models) {
  for(const {slug,recipe} of specs) {
    if(!/^[a-z0-9-]+$/.test(slug)||!/^recette-[a-z0-9-]+\.json$/.test(recipe))throw new Error('KNOWLEDGE_SPEC_INVALID');
    const source=path.join(root,'knowledge',recipe), packaged=path.join(dest,'knowledge',recipe);
    if(await hash(source)!==await hash(packaged))throw new Error('KNOWLEDGE_RECIPE_MISMATCH');
    const pins=JSON.parse(await readFile(source,'utf8')).artifact_sha256;
    const target=path.join(dest,'resources','models',slug);
    if(await hash(path.join(target,'model.onnx'))!==pins?.model_onnx||await hash(path.join(target,'tokenizer.json'))!==pins?.tokenizer_json)throw new Error('KNOWLEDGE_ASSET_HASH_MISMATCH');
    const config=path.join(target,'tokenizer_config.json');await regular(config);JSON.parse(await readFile(config,'utf8'));
  }
  return specs.length;
}
