import {afterEach,expect,it} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,cpSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {assertDocumentAssets,stageDocumentAssets} from '../../scripts/lib/document-package-assets.mjs';
const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0)){if(dirname(resolve(root))!==resolve(tmpdir()))throw Error('Unsafe test cleanup');rmSync(root,{recursive:true,force:true});}});
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'mindcare-document-assets-'));roots.push(root);
 const source=join(root,'source'),server=join(root,'server');
 const files=['public/documents/v1/document.css','public/documents/v1/fonts.css','public/documents/v1/font.woff2','public/documents/v2/document.css','public/documents/v2/header.svg','public/documents/v2/watermark.svg','public/documents/v2/social.svg','supabase/migrations/222_document_renderer_v2.sql','supabase/migrations/223_medication_search_paging.sql','supabase/migrations/224_reference_medication_catalog.sql','supabase/migrations/225_controlled_identity_transfer.sql','resources/documents/cabinet-letterhead.json'];
 files.push('supabase/migrations/226_document_print_corrections.sql');
 for(const file of files){const target=join(source,file);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,file.endsWith('.json')?'{}':`synthetic:${file}`);}
 cpSync(join(source,'public'),join(server,'public'),{recursive:true});cpSync(join(source,'supabase'),join(server,'supabase'),{recursive:true});
 return {source,server};
}
it('includes the approved reference and checks both renderers, fonts and migrations without a build',()=>{
 const {source,server}=fixture();stageDocumentAssets(source,server);
 expect(readFileSync(join(server,'resources/documents/cabinet-letterhead.json'),'utf8')).toBe('{}');
 expect(()=>assertDocumentAssets(source,server)).not.toThrow();
});
it.each(['public/documents/v2/watermark.svg','public/documents/v1/font.woff2','supabase/migrations/222_document_renderer_v2.sql','supabase/migrations/224_reference_medication_catalog.sql','supabase/migrations/226_document_print_corrections.sql','resources/documents/cabinet-letterhead.json'])('rejects a missing delivered asset: %s',file=>{
 const {source,server}=fixture();stageDocumentAssets(source,server);rmSync(join(server,file));
 expect(()=>assertDocumentAssets(source,server)).toThrow('DocumentPackageAssetMissing');
});
it('refuses stale CSS or a changed identity reference',()=>{
 const {source,server}=fixture();stageDocumentAssets(source,server);writeFileSync(join(server,'public/documents/v2/document.css'),'old version');
 expect(()=>assertDocumentAssets(source,server)).toThrow('DocumentPackageAssetMismatch');
});
