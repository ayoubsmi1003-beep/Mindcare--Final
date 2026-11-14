import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {validateIdentityBundle,referenceIdentityBundle} from '../../scripts/transfer-document-identity.mjs';
const bundle={version:1,profileId:'11111111-1111-4111-8111-111111111111',cabinetId:'22222222-2222-4222-8222-222222222222',identity:{practitioner:{full_name:'Praticienne synthétique',title:'Dr',speciality_fr:'Psychiatrie',speciality_ar:'طب نفسي',order_number:'TEST-001',phone:'0000000000',full_name_ar:'اسم تجريبي'},cabinet:{name:'Cabinet synthétique',address:'Adresse synthétique',phone:'0000000000'}}};
describe('controlled professional identity transfer',()=>{
 it('keeps every configured value including Unicode',()=>expect(validateIdentityBundle(bundle)).toBe(bundle));
 it('refuses absent values instead of producing an empty replacement',()=>{expect(()=>validateIdentityBundle({...bundle,identity:{...bundle.identity,practitioner:{...bundle.identity.practitioner,full_name_ar:''}}})).toThrow();expect(()=>validateIdentityBundle({...bundle,profileId:'wrong'})).toThrow();});
 it('keeps ordinary users excluded and refuses existing conflicts in SQL',()=>{const sql=readFileSync('supabase/migrations/225_controlled_identity_transfer.sql','utf8');expect(sql).toContain('FROM PUBLIC,anon,authenticated,service_role');expect(sql).toContain('IdentityTransferConflict');expect(sql).toContain('FOR UPDATE');});
});

it('prepares the explicitly approved professional reference without a database connection',()=>{
 const result=referenceIdentityBundle(bundle.profileId,bundle.cabinetId);
 expect(result.identity.practitioner.full_name).toBe('LARBI. N');
 expect(result.identity.practitioner.order_number).toBe('16 / 16780');
 expect(result.identity.practitioner.document_footer).toEqual({facebook_label:'Dr Larbi Psychiatre',instagram_label:'Dr Larbi Psychiatre'});
 expect(result.identity.cabinet.address.split('\n')).toHaveLength(2);
});
