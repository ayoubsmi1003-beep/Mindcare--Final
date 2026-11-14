// Source-rendering check only: never starts Next, loads .env or contacts a database.
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createServer as reservePort} from 'node:net';
import {chromium} from 'playwright';
// Vite is already installed as Vitest's dependency.
const {createServer}=await import(new URL('../vite/dist/node/index.js',import.meta.resolve('vitest/package.json')).href);
const root=process.cwd();
const reference=process.argv.includes('--reference');
const file=process.argv[2]??'.cache/document-visual-preview.json';
const envelope=JSON.parse(readFileSync(file,'utf8').replace(/^\uFEFF/,''));
assert.equal(envelope.synthetic,true,'Only a verified synthetic preview is allowed');
assert.equal(envelope.preview.rendererVersion,'v2');
const output=path.join(root,'.cache','document-visual');mkdirSync(output,{recursive:true});
const probe=reservePort();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const reserved=probe.address();assert(reserved&&typeof reserved==='object');const port=reserved.port;await new Promise(resolve=>probe.close(resolve));
console.log('[visual] Starting isolated Vite (file watching disabled).');
const server=await createServer({root,configFile:false,envDir:false,cacheDir:'.cache/document-vite',optimizeDeps:{entries:['tests/visual/document-renderer.tsx'],include:['react','react-dom/client','react/jsx-runtime']},server:{host:'127.0.0.1',port,strictPort:true,watch:null},resolve:{alias:{'@':path.join(root,'src')}},esbuild:{jsx:'automatic'},plugins:[{name:'synthetic-documents',configureServer(server){server.middlewares.use((req,res,next)=>{
 if(req.url==='/__document_fixture'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(envelope.preview));return;}
 if(req.url==='/__document_render_test'){res.setHeader('Content-Type','text/html');res.end('<html lang="fr"><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="/tests/visual/document-renderer.tsx"></script></body></html>');return;}next();
});}}]});
let browser;
try{
 await server.listen();console.log('[visual] Starting Chromium.');const address=server.httpServer.address();assert(address&&typeof address==='object');
 browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1500,height:1200},deviceScaleFactor:2});const errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')console.error('[browser]',message.text());});
 await page.goto(`http://127.0.0.1:${address.port}/__document_render_test`,{waitUntil:'domcontentloaded',timeout:120000});console.log('[visual] Checking editor.');
 await page.waitForFunction(()=>Boolean(window.documentVisual),undefined,{timeout:90000});await page.locator('.tiptap').waitFor();
 if(!reference){
 const field=page.locator('.doc2-bound-field').first();if(await field.count())assert.equal(await field.evaluate(el=>getComputedStyle(el).display),'inline');
 const paste=await page.evaluate(()=>window.documentVisual.sanitize('<p dir="rtl" style="color:red;text-align:right" onclick="bad()"><strong>عربي</strong> <span data-field="patient_first_name">Synthétique</span><img src="https://invalid.test/x"><script>bad()</script></p>'));
 assert(paste.includes('data-field="patient_first_name"'));assert(paste.includes('text-align:right'));assert(!paste.includes('onclick'));assert(!paste.includes('<img'));assert(!paste.includes('<script'));
 await page.locator('.tiptap').click();await page.keyboard.press('Control+End');await page.keyboard.insertText(' Contrôle synthétique.');
 assert((await page.evaluate(()=>JSON.stringify(window.documentVisual.content()))).includes('Contrôle synthétique.'));
 await page.keyboard.press('Control+z');assert(!(await page.evaluate(()=>JSON.stringify(window.documentVisual.content()))).includes('Contrôle synthétique.'));
 await page.keyboard.press('Control+Shift+z');assert((await page.evaluate(()=>JSON.stringify(window.documentVisual.content()))).includes('Contrôle synthétique.'));
 }
 const short=await page.evaluate(()=>window.documentVisual.layout(false));assert.equal(short.pages.length,1);
 await page.locator('#pages article').first().screenshot({path:path.join(output,reference?'cabinet-letterhead.png':'synthetic-v2-first-page.png')});
 const long=await page.evaluate(()=>window.documentVisual.layout(true));assert(long.pages.length>1);
 for(const info of [...short.pages,...long.pages]){assert(info.footer&&info.watermark&&info.number);assert(info.body.bottom<info.footer.top);assert(info.number.bottom<info.footer.top);if(info.signature)assert(info.body.bottom<info.signature.top);}
 await page.addStyleTag({content:'@media print{#root > .doc2-editing{display:none}}'});
 await page.pdf({path:path.join(output,'synthetic-v2.pdf'),preferCSSPageSize:true,printBackground:true});
 await page.locator('#pages article').first().screenshot({path:path.join(output,'synthetic-v2.png')});assert.deepEqual(errors,[]);
 writeFileSync(path.join(output,'result.json'),JSON.stringify({source:'synthetic preview',shortPages:short.pages.length,longPages:long.pages.length,pass:true},null,2));
 console.log(reference?"PASS: approved cabinet letterhead capture, dynamic patient placeholders, pagination and PDF.":`PASS: editor inline fields, safe paste, undo/redo, ${short.pages.length}/${long.pages.length} pages, footer/signature separation, synthetic PDF.`);
}finally{await browser?.close();await server.close();}
