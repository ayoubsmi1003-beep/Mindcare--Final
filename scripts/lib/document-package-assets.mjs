import {cpSync,existsSync,lstatSync,mkdirSync,readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname,join} from 'node:path';

const reference='resources/documents/cabinet-letterhead.json';
const required=[
 'public/documents/v1/document.css','public/documents/v1/fonts.css',
 'public/documents/v2/document.css','public/documents/v2/header.svg',
 'public/documents/v2/watermark.svg','public/documents/v2/social.svg',
 'supabase/migrations/222_document_renderer_v2.sql',
 'supabase/migrations/223_medication_search_paging.sql',
 'supabase/migrations/224_reference_medication_catalog.sql',
 'supabase/migrations/225_controlled_identity_transfer.sql',
 'supabase/migrations/226_document_print_corrections.sql',reference,
];
function regularFile(root,relative){
 let current=root;
 for(const part of relative.split('/')){
  current=join(current,part);
  if(!existsSync(current))throw Error(`DocumentPackageAssetMissing:${relative}`);
  if(lstatSync(current).isSymbolicLink())throw Error(`DocumentPackageAssetInvalid:${relative}`);
 }
 if(!lstatSync(current).isFile())throw Error(`DocumentPackageAssetInvalid:${relative}`);
 return current;
}
function sourceAssets(root){
 const files=new Set(required);
 function visit(relative){
  const dir=join(root,relative);
  if(!existsSync(dir)||lstatSync(dir).isSymbolicLink())throw Error(`DocumentPackageAssetMissing:${relative}`);
  for(const entry of readdirSync(dir,{withFileTypes:true})){
   const file=`${relative}/${entry.name}`;
   if(entry.isSymbolicLink())throw Error(`DocumentPackageAssetInvalid:${file}`);
   if(entry.isDirectory())visit(file);
   else if(/\.(?:css|svg|woff2?)$/iu.test(entry.name))files.add(file);
  }
 }
 visit('public/documents/v1');visit('public/documents/v2');
 if(![...files].some(file=>/\.woff2?$/iu.test(file)))throw Error('DocumentPackageFontsMissing');
 return [...files].sort();
}
export function assertDocumentAssets(root,server){
 const files=sourceAssets(root);
 for(const file of files){
  const digest=base=>createHash('sha256').update(readFileSync(regularFile(base,file))).digest('hex');
  if(digest(root)!==digest(server))throw Error(`DocumentPackageAssetMismatch:${file}`);
 }
 return {files:files.length};
}
export function stageDocumentAssets(root,server){
 const source=regularFile(root,reference),target=join(server,reference);
 mkdirSync(dirname(target),{recursive:true});cpSync(source,target);
 return assertDocumentAssets(root,server);
}
