#!/usr/bin/env node
// Explicit administrative operation; never imported or invoked by application startup.
import {readFileSync,writeFileSync,realpathSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
export function validateIdentityBundle(bundle){
 if(bundle?.version!==1||!uuid.test(bundle.profileId)||!uuid.test(bundle.cabinetId))throw new Error('Identifiants de transfert invalides.');
 const {practitioner,cabinet}=bundle.identity??{};
 for(const key of ['full_name','title','speciality_fr','speciality_ar','order_number','phone','full_name_ar'])if(typeof practitioner?.[key]!=='string'||!practitioner[key].trim())throw new Error('Identité professionnelle incomplète.');
 for(const key of ['name','address','phone'])if(typeof cabinet?.[key]!=='string'||!cabinet[key].trim())throw new Error('Coordonnées du cabinet incomplètes.');
 return bundle;
}
export function referenceIdentityBundle(profileId,cabinetId){
 const identity=JSON.parse(readFileSync(new URL('../resources/documents/cabinet-letterhead.json',import.meta.url),'utf8'));
 return validateIdentityBundle({version:1,profileId,cabinetId,identity});
}
function main(){
 const [action,file,profileId,cabinetId]=process.argv.slice(2);
 if(!['reference','export','import'].includes(action)||!file||!uuid.test(profileId??'')||!uuid.test(cabinetId??''))throw new Error('Usage : reference|export|import fichier-privé profil-UUID cabinet-UUID.');
 if(action!=='reference')for(const key of ['PGHOST','PGPORT','PGDATABASE','PGUSER','PGPASSWORD'])if(!process.env[key])throw new Error('Connexion PG* administrative explicite requise ; aucun fichier .env n’est chargé.');
 const root=realpathSync(path.resolve(fileURLToPath(new URL('..',import.meta.url))));
 const destination=path.join(realpathSync(path.dirname(path.resolve(file))),path.basename(file));
 if(!/^document-identity(?:-[a-zA-Z0-9_-]+)?\.json$/.test(path.basename(destination)))throw new Error('Nom de fichier de transfert privé invalide.');
 const privateRoot=realpathSync(path.join(process.env.ProgramData??'', 'MindCare','private'));
 if(path.dirname(destination)!==privateRoot)throw new Error('Le transfert doit rester dans le dossier privé protégé du cabinet.');
 const relative=path.relative(root,destination);
 if(!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative))throw new Error('Un transfert privé doit rester hors du dépôt.');
 if(action==='reference'){
  writeFileSync(destination,JSON.stringify(referenceIdentityBundle(profileId,cabinetId)),{flag:'wx',mode:0o600});
  console.log('Identité de référence préparée ; aucune connexion ni écriture en base.');
  return;
 }
 const literal=value=>"'"+value.replaceAll("'","''")+"'";
 const query=sql=>{
  const result=spawnSync(process.env.MINDCARE_PSQL??'psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{input:'SET standard_conforming_strings=on;\n'+sql,encoding:'utf8',windowsHide:true,maxBuffer:128*1024});
  if(result.status!==0)throw new Error('Transfert refusé par PostgreSQL ; aucune valeur privée n’a été affichée.');
  return result.stdout.trim();
 };
 if(action==='export'){
  const result=query(`SELECT jsonb_build_object('version',1,'profileId',p.id,'cabinetId',c.id,'identity',jsonb_build_object('practitioner',jsonb_build_object('full_name',p.full_name,'title',p.title,'speciality_fr',p.speciality_fr,'speciality_ar',p.speciality_ar,'order_number',p.order_number,'phone',p.phone,'full_name_ar',p.signature_block->>'full_name_ar')||CASE WHEN p.signature_block?'document_footer' THEN jsonb_build_object('document_footer',p.signature_block->'document_footer') ELSE '{}'::jsonb END,'cabinet',jsonb_build_object('name',c.name,'address',c.address,'phone',c.phone))) FROM app.profiles p JOIN app.cabinets c ON c.id=p.cabinet_id WHERE p.id=${literal(profileId)}::uuid AND c.id=${literal(cabinetId)}::uuid AND p.is_active AND p.role IN ('owner','practitioner');`);
  writeFileSync(destination,JSON.stringify(validateIdentityBundle(JSON.parse(result))),{flag:'wx',mode:0o600});
 }else{
  const bundle=validateIdentityBundle(JSON.parse(readFileSync(destination,'utf8')));
  if(bundle.profileId!==profileId||bundle.cabinetId!==cabinetId)throw new Error('La cible ne correspond pas au transfert ; aucune correspondance par nom n’est autorisée.');
  query(`BEGIN; SELECT app.provision_document_identity(${literal(profileId)}::uuid,${literal(cabinetId)}::uuid,${literal(JSON.stringify(bundle.identity))}::jsonb); COMMIT;`);
 }
 console.log('Transfert terminé ; aucune identité ni aucun secret affiché.');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))try{main();}catch{console.error('Transfert refusé. Vérifiez la cible, la complétude, les conflits et les permissions administratives ; aucune valeur privée affichée.');process.exitCode=1;}
