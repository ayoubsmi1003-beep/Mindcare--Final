import {afterEach,expect,it} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {setImmediate as yieldToWorker} from 'node:timers/promises';
import {withNativeBootstrap,enablePackagedNativeEntrypoints,backendInventory,assertBackendInventory,assertModelInventory,snapshotAlexaBuildSources,finalizeAlexaBuild,verifyAlexaPackage,isPlaywrightRuntimePath} from '../../scripts/lib/alexa-package-integrity.mjs';
const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
function fixture(){const root=mkdtempSync(join(tmpdir(),'mindcare-alexa-package-'));roots.push(root);return root;}
it('identifies Playwright package and pnpm store paths as development-only runtime files',()=>{
 for(const path of [
  'node_modules/playwright/index.js',
  'node_modules/playwright-core/bin/reinstall_chrome_beta_linux.sh',
  'node_modules/@playwright/test/index.js',
  'node_modules/.pnpm/playwright@1.62.1/node_modules/playwright',
  'node_modules/.pnpm/playwright-core@1.62.1/node_modules/playwright-core',
  'node_modules/.pnpm/@playwright+test@1.62.1/node_modules/@playwright/test',
  'node_modules/.pnpm/node_modules/playwright-core',
 ]) expect(isPlaywrightRuntimePath(path)).toBe(true);
 for(const path of ['node_modules/next/server.js','node_modules/react/index.js','node_modules/some-playwright-reporter/index.js'])expect(isPlaywrightRuntimePath(path)).toBe(false);
});
it('activates the same native path in relocated CommonJS and ESM entries despite a conflicting inherited setting',()=>{
 const root=fixture();
 for(const suffix of ['cjs','mjs']){
  const file=join(root,'entry.'+suffix);writeFileSync(file,withNativeBootstrap('#!/usr/bin/env node\n"use strict";\nconsole.log(process.env.ALEXA_NATIVE_AGENT_ENABLED);'));
  expect(execFileSync(process.execPath,[file],{encoding:'utf8',windowsHide:true,env:{...process.env,ALEXA_NATIVE_AGENT_ENABLED:'0'}}).trim()).toBe('1');
  expect(readFileSync(file,'utf8')).toMatch(/^#![^\n]+\n"use strict";/u);
 }
});
it('binds both the actual server entry and schema preflight without altering source development entries',()=>{
 const root=fixture();mkdirSync(join(root,'scripts'));writeFileSync(join(root,'server.js'),'console.log("server");');writeFileSync(join(root,'scripts/verifier-base.mjs'),'console.log("schema");');
 enablePackagedNativeEntrypoints(root);
 expect(readFileSync(join(root,'server.js'),'utf8')).toContain('process.env.ALEXA_NATIVE_AGENT_ENABLED = "1";');
 expect(readFileSync(join(root,'scripts/verifier-base.mjs'),'utf8')).toContain('process.env.ALEXA_NATIVE_AGENT_ENABLED = "1";');
 expect(()=>enablePackagedNativeEntrypoints(root)).toThrow('AlexaPackageAlreadyPrepared');
});
it('rejects a changed, missing or additional backend file instead of accepting a stale build',()=>{
 const root=fixture();mkdirSync(join(root,'.next'));writeFileSync(join(root,'server.js'),'current');writeFileSync(join(root,'.next/BUILD_ID'),'build-current');
 const receipt=backendInventory(root);expect(()=>assertBackendInventory(root,receipt)).not.toThrow();
 writeFileSync(join(root,'server.js'),'old');expect(()=>assertBackendInventory(root,receipt)).toThrow('AlexaBackendIntegrity');
 writeFileSync(join(root,'server.js'),'current');writeFileSync(join(root,'extra.js'),'unrecorded');expect(()=>assertBackendInventory(root,receipt)).toThrow('AlexaBackendIntegrity');
 rmSync(join(root,'extra.js'));rmSync(join(root,'.next/BUILD_ID'));expect(()=>assertBackendInventory(root,receipt)).toThrow('AlexaBackendIntegrity');
});
it('requires the pinned model, archive and complete runtime rather than only their filenames',()=>{
 const actual={modelSha256:'model',archiveSha256:'archive',runtimeManifestSha256:'runtime',runtimeFiles:50};
 const pin={sha256:'model',archiveSha256:'archive',runtimeManifestSha256:'runtime'};
 expect(()=>assertModelInventory(actual,pin)).not.toThrow();
 for(const invalid of [{modelSha256:'old'},{archiveSha256:'old'},{runtimeManifestSha256:'old'},{runtimeFiles:49}])expect(()=>assertModelInventory({...actual,...invalid},pin)).toThrow('AlexaPackagedModelIntegrity');
});
it('checks an assembled relocated artifact against its real source receipt and rejects code/model/bootstrap drift',async()=>{
 const root=fixture(),source=join(root,'source'),artifact=join(root,'unpacked'),server=join(artifact,'resources/serveur'),assets=join(artifact,'resources/alexa/local-model');
 const write=(path:string,text:string)=>{mkdirSync(join(path,'..'),{recursive:true});writeFileSync(path,text);};
 const sha=(text:string)=>createHash('sha256').update(text).digest('hex');
 const model='synthetic-model',archive='synthetic-archive';
 const binaries=Array.from({length:50},(_,i)=>`cpu-${String(i).padStart(2,'0')}.dll`);
 for(const name of binaries)write(join(assets,'runtime-b11429',name),'synthetic-'+name);
 write(join(assets,'TestMiniCPM.gguf'),model);write(join(assets,'llama-b11429.zip'),archive);
 const modelSource=`export const pin={sha256: "${sha(model)}", runtime: "b11429", archiveSha256: "${sha(archive)}", runtimeManifestSha256: "${sha(binaries.map(name=>name+':'+sha('synthetic-'+name)).join('\n'))}"};`;
 write(join(source,'src/server/alexa/local-model.ts'),modelSource);
 write(join(source,'src/server/alexa/model-policy.ts'),'export const ALEXA_CONVERSATION_MODEL = "TestMiniCPM.gguf";');
 const buildInputs=['public/logo.svg','tailwind.config.ts','postcss.config.js'];
 for(const input of buildInputs)write(join(source,input),'synthetic build input');
 execFileSync('git',['init','-q'],{cwd:source,windowsHide:true});
 execFileSync('git',['add','.'],{cwd:source,windowsHide:true});
 execFileSync('git',['-c','user.name=Synthetic test','-c','user.email=test@example.invalid','-c','core.hooksPath=absent-hooks','commit','-qm','synthetic packaging fixture'],{cwd:source,windowsHide:true});
 write(join(server,'server.js'),'console.log("synthetic server");');write(join(server,'scripts/verifier-base.mjs'),'console.log("synthetic schema");');write(join(server,'.next/BUILD_ID'),'synthetic-build');
 enablePackagedNativeEntrypoints(server);const before=snapshotAlexaBuildSources(source);
 finalizeAlexaBuild(source,server,before);
 await yieldToWorker();
 expect(verifyAlexaPackage(source,artifact)).toMatchObject({commit:before.commit,native:true,buildId:'synthetic-build',modelSha256:sha(model)});
 // Let Vitest deliver worker updates between synchronous Git/hash inspections on a slow disk.
 for(const input of buildInputs){write(join(source,input),'changed build input');expect(()=>verifyAlexaPackage(source,artifact)).toThrow('AlexaBuildSourceMismatch');expect(()=>finalizeAlexaBuild(source,server,before)).toThrow('AlexaBuildSourceChanged');write(join(source,input),'synthetic build input');await yieldToWorker();}
 write(join(assets,'TestMiniCPM.gguf'),'old model');expect(()=>verifyAlexaPackage(source,artifact)).toThrow('AlexaPackagedModelIntegrity');write(join(assets,'TestMiniCPM.gguf'),model);
 write(join(server,'.next/BUILD_ID'),'old build');expect(()=>verifyAlexaPackage(source,artifact)).toThrow('AlexaBuildIdMismatch');write(join(server,'.next/BUILD_ID'),'synthetic-build');
 const entry=readFileSync(join(server,'server.js'),'utf8');write(join(server,'server.js'),'console.log("legacy");');expect(()=>verifyAlexaPackage(source,artifact)).toThrow('AlexaPackagedNativeRequired');write(join(server,'server.js'),entry);
 await yieldToWorker();
 write(join(source,'src/server/alexa/local-model.ts'),modelSource+'\n// changed source');expect(()=>verifyAlexaPackage(source,artifact)).toThrow('AlexaBuildSourceMismatch');expect(()=>finalizeAlexaBuild(source,server,before)).toThrow('AlexaBuildSourceChanged');write(join(source,'src/server/alexa/local-model.ts'),modelSource);
 const receipt=JSON.parse(readFileSync(join(server,'alexa-build.json'),'utf8'));receipt.commit='0'.repeat(40);write(join(server,'alexa-build.json'),JSON.stringify(receipt));expect(()=>verifyAlexaPackage(source,artifact)).toThrow('AlexaBuildSourceMismatch');
},180000);
