// Actual UI and service adapter, isolated Vite dev server and synthetic RPC responses.
import path from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const {createServer}=await import(new URL('../vite/dist/node/index.js',import.meta.resolve('vitest/package.json')).href);
const root=process.cwd();
const server=await createServer({root,configFile:false,envDir:false,define:{"process.env.NODE_ENV":JSON.stringify("development"),"process.env":"{}"},cacheDir:'.cache/medications-vite',optimizeDeps:{entries:['tests/visual/medications-harness.tsx'],include:['react','react-dom/client']},server:{host:'127.0.0.1',port:0,watch:null},resolve:{alias:{'@':path.join(root,'src')}},esbuild:{jsx:'automatic'},plugins:[{name:'synthetic-medications',configureServer(server){server.middlewares.use((req,res,next)=>{
 if(!req.url?.startsWith('/__medications_test')){next();return;}
 res.setHeader('Content-Type','text/html');res.end('<html lang="fr"><head><meta charset="utf-8"><script>globalThis.process={env:{NODE_ENV:"development"},browser:true}</script></head><body><div id="root"></div><script type="module" src="/tests/visual/medications-harness.tsx"></script></body></html>');
});}}]});
let browser;
try{
 await server.listen();const address=server.httpServer.address();assert(address&&typeof address==='object');
 browser=await chromium.launch({headless:true});const page=await browser.newPage();page.setDefaultTimeout(90000);page.setDefaultNavigationTimeout(120000);
 const errors=[];page.on('pageerror',error=>{errors.push(error.message);console.error(error.stack);});
 await page.route('**/api/db/rpc',async route=>{
  const {name,args}=route.request().postDataJSON();
  if(name==='get_medication_catalog_status'){await route.fulfill({json:{ok:true,data:[{available_count:15645}]}});return;}
  assert.equal(name,'search_medications_page');
  const q=args.p_query;
  if(q==='slow')await new Promise(resolve=>setTimeout(resolve,1200));
  if(q==='error'){await route.fulfill({status:503,json:{ok:false,code:'indisponible'}});return;}
  const total=q==='page'?52:1;
  const data=Array.from({length:Math.max(0,Math.min(args.p_limit,total-args.p_offset))},(_,i)=>({id:`synthetic-${q}-${i+args.p_offset}`,raw_name:`Produit ${q} ${i+args.p_offset+1} ${i%2?'100':'50'} mg`,inn:'DCI synthétique',brand_name:'Produit',form:'comprimé',strength:i%2?'100 mg':'50 mg',normalized_name:'produit',source:'synthetic',rank:0,total_count:total}));
  await route.fulfill({json:{ok:true,data}});
 });
 for(const mode of ['', '?treatment']){
  await page.goto(`http://127.0.0.1:${address.port}/__medications_test${mode}`,{waitUntil:'domcontentloaded'});
  const input=page.getByRole('combobox');await input.waitFor();await input.fill('page');
  await page.getByRole('option').first().waitFor();assert.equal(await page.getByRole('option').count(),50);
  await page.getByRole('button',{name:'Afficher plus',exact:true}).click();await page.getByRole('option').filter({hasText:'Produit page 52'}).waitFor();assert.equal(await page.getByRole('option').count(),52);
  const oldRequest=page.waitForRequest(r=>r.url().endsWith('/api/db/rpc')&&r.postDataJSON()?.args?.p_query==='slow');await input.fill('slow');await oldRequest;
  await input.fill('new');await page.getByRole('option').filter({hasText:'Produit new 1'}).waitFor();await page.waitForTimeout(1400);assert.equal(await page.getByRole('option').filter({hasText:'Produit slow'}).count(),0);
  await input.fill('error');await page.getByRole('alert').filter({hasText:/service|indisponible|connexion/i}).first().waitFor();assert.equal(await page.getByRole('option').count(),0);
  await input.fill('page');await page.getByRole('option').first().waitFor();await page.getByRole('option').first().click();
  assert.equal(await page.locator('input[type=number]:visible').count(),1);
 }
 assert.deepEqual(errors,[]);console.log('PASS both medication selectors: second page, variants, stale responses, backend error and daily-count field. RPC is mocked; PostgreSQL is checked separately.');
}finally{await browser?.close();await server.close();}
