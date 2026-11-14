// Actual UI and service adapter, isolated Vite dev server and synthetic RPC responses.
import path from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const {createServer}=await import(new URL('../vite/dist/node/index.js',import.meta.resolve('vitest/package.json')).href);
const root=process.cwd();
const server=await createServer({root,configFile:false,envDir:false,define:{"process.env.NODE_ENV":JSON.stringify("development"),"process.env":"{}"},cacheDir:'.cache/diagnosis-vite',optimizeDeps:{entries:['tests/visual/diagnosis-harness.tsx'],include:['react','react-dom/client']},server:{host:'127.0.0.1',port:0,watch:null},resolve:{alias:{'@':path.join(root,'src')}},esbuild:{jsx:'automatic'},plugins:[{name:'synthetic-diagnosis',configureServer(server){server.middlewares.use((req,res,next)=>{
 if(req.url!=='/__diagnosis_test'){next();return;}
 res.setHeader('Content-Type','text/html');res.end('<html lang="fr"><head><meta charset="utf-8"><script>globalThis.process={env:{NODE_ENV:"development"},browser:true}</script></head><body><div id="root"></div><script type="module" src="/tests/visual/diagnosis-harness.tsx"></script></body></html>');
});}}]});
let browser;
try{
 await server.listen();const address=server.httpServer.address();assert(address&&typeof address==='object');
 browser=await chromium.launch({headless:true});const page=await browser.newPage();const requests=[],errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error('[diagnosis browser]',e.stack);});
 let fail=false;
 await page.route('**/api/db/rpc',async route=>{
  requests.push(route.request().postDataJSON());
  await route.fulfill({status:fail?503:200,contentType:'application/json',body:JSON.stringify(fail?{ok:false,code:'indisponible'}:{ok:true,data:[{id:'d9000000-0000-4000-8000-000000000001',label:'Trouble anxieux généralisé',code_system:'ICD-10',code:'F41.1',is_primary:true,onset_date:null,resolved_at:null}]})});
 });
 page.setDefaultTimeout(120000);page.setDefaultNavigationTimeout(120000);
 console.log('Diagnosis: navigating isolated dev server');
 await page.goto(`http://127.0.0.1:${address.port}/__diagnosis_test`,{waitUntil:'domcontentloaded'});
 console.log('Diagnosis: page loaded');
 await page.waitForTimeout(1000);console.log('Buttons:',await page.getByRole('button').allTextContents());
 const open=()=>page.getByRole('button',{name:/Consigner un diagnostic/}).click();
 await open();const select=page.getByRole('combobox');await select.waitFor();assert.equal(await select.count(),1);assert.equal(await page.locator('input,textarea').count(),0);assert.equal(await select.inputValue(),'');
 const save=page.getByRole('button',{name:/Enregistrer le diagnostic/});assert(await save.isDisabled());
 await select.focus();await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');assert.notEqual(await select.inputValue(),'');
 await select.selectOption('F41.1');await save.click();await page.getByRole('status').waitFor();assert.equal(requests.length,1);
 const args=requests[0].args;assert(args,'RPC arguments');assert.equal(args.p_label,'Trouble anxieux généralisé');assert.equal(args.p_code_system,'ICD-10');assert.equal(args.p_code,'F41.1');assert.equal(args.p_onset_date,null);assert.equal(args.p_is_primary,true);
 await open();await page.getByRole('combobox').selectOption('F32.0');await page.getByRole('button',{name:/Annuler/}).last().click();assert.equal(await page.getByRole('combobox').count(),0);assert.equal(requests.length,1);
 await open();await page.getByRole('combobox').selectOption('F41.1');await page.getByRole('button',{name:'Changer le patient synthétique'}).click();assert.equal(await page.getByRole('combobox').count(),0);
 await open();assert.equal(await page.getByRole('combobox').inputValue(),'');fail=true;await page.getByRole('combobox').selectOption('F41.1');await page.getByRole('button',{name:/Enregistrer le diagnostic/}).click();await page.getByRole('alert').waitFor();assert.equal(await page.getByRole('combobox').inputValue(),'F41.1');assert.deepEqual(errors,[]);
 console.log('PASS diagnosis: one keyboard-accessible selector, exact RPC metadata, cancel, patient reset, failed save preserves selection. RPC is mocked; SQL is checked separately.');
}finally{await browser?.close();await server.close();}
