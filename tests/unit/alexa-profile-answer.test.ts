import {expect,it} from 'vitest';
import {profileAnswer,profileNeedsClarification} from '@/server/alexa/profile-answer';
import {frenchRequestAdmission} from '@/shared/alexa/request-contract';
const patient={id:'a3000000-0000-4000-8000-000000000001',record_number:'TEST-1',first_name:'Ayoub',last_name:'Salmi',birth_date:'2008-10-16',phone:'0000000001',phone_alt:'0000000002',id_document_number:'ID-FICTIF',id_document_issuer:'Autorité fictive',sex:'M',marital_status:'celibataire',address:'Adresse fictive',emergency_contact:{name:'Contact fictif',relation:'Parent',phone:'0000000003'},notes_admin:'Note administrative fictive',is_active:true};
const asOf='2026-10-15T12:00:00Z';
it('routes a named email request to the explicit unsupported profile capability',()=>{
 expect(frenchRequestAdmission('Quel est l’e-mail de Ayoub Salmi ?',false)).toMatchObject({tools:['get_patient_context'],patientSection:'profile'});
});
it('answers only the requested phone in one sentence',()=>{
 const text=profileAnswer(patient,'Quel est le téléphone de Ayoub Salmi ?',asOf);
 expect(text).toBe('Pour Ayoub Salmi, le téléphone enregistré est 0000000001.');expect(text).not.toMatch(/\n|ID-FICTIF|Note administrative|0000000002|Adresse fictive/);
});
it('answers a missing identity-card number in natural French',()=>{
 expect(profileAnswer({...patient,id_document_number:null},'Quel numéro de CNI est enregistré ?',asOf)).toBe('Pour Ayoub Salmi, aucun numéro de CNI n’est renseigné dans le dossier.');
});
it('answers a present identity-card number in one natural sentence',()=>{
 expect(profileAnswer(patient,'Quel numéro de CNI est enregistré ?',asOf)).toBe('Pour Ayoub Salmi, le numéro de CNI enregistré est ID-FICTIF.');
});
it('answers both phone numbers in a plural question without dumping the rest',()=>{
 const text=profileAnswer(patient,'Quels sont les téléphones enregistrés de ce patient ?',asOf);expect(text).toContain('0000000001');expect(text).toContain('0000000002');expect(text).not.toMatch(/ID-FICTIF|Adresse fictive|Note administrative/);
});
it('asks for an unknown administrative field instead of silently displaying the entire profile',()=>{
 const text=profileAnswer(patient,'Quel est son renseignement spécifique ?',asOf);expect(text).not.toMatch(/ID-FICTIF|0000000001|Note administrative/);expect(text).toContain('?');
});
it.each([['Son numéro de carte d’identité ?', ['ID-FICTIF'], ['Téléphone','Contact fictif']],['Son contact d’urgence ?', ['Contact fictif','0000000003'], ['ID-FICTIF','0000000001']],['Quelle est son adresse ?', ['Adresse fictive'], ['ID-FICTIF','0000000001']],['Sa date de naissance et son téléphone secondaire ?', ['2008-10-16','0000000002'], ['ID-FICTIF','0000000001']]])('preserves all requested fields without the rest: %s',(question,included,excluded)=>{
 const text=profileAnswer(patient,question,asOf);for(const value of included)expect(text).toContain(value);for(const value of excluded)expect(text).not.toContain(value);
});
it.each(['Quel numéro national est enregistré ?','Quel est l’identifiant de la carte nationale ?'])('recognizes alternate French national-identity wording: %s',question=>{
 expect(profileNeedsClarification(question)).toBe(false);const text=profileAnswer(patient,question,asOf);expect(text).toContain('ID-FICTIF');expect(text).not.toContain('0000000001');
});
it.each([['2026-10-15T12:00:00Z',17],['2026-10-15T23:30:00Z',18]])('evaluates age at the cabinet-local birthday %s',(anchor,age)=>{
 const text=profileAnswer(patient,'Quel âge a Ayoub Salmi ?',anchor);expect(text).toContain(age+' ans');expect(text).not.toContain('Téléphone');
});
it('does not replace an unknown or future birth date with an age',()=>{
 for(const birth_date of [null,'2030-01-01'])expect(profileAnswer({...patient,birth_date},'Quel âge a ce patient ?',asOf)).not.toMatch(/\d+ ans/);
});
it('keeps a complete administrative view when explicitly requested',()=>{
 const text=profileAnswer(patient,'Montre toutes les informations administratives du dossier.',asOf);for(const value of ['ID-FICTIF','Note administrative fictive','0000000001','Adresse fictive'])expect(text).toContain(value);
});
it('reports a missing requested phone without exposing unrelated fields',()=>{
 const text=profileAnswer({...patient,phone:null},'Son téléphone ?',asOf);expect(text).toBe('Pour Ayoub Salmi, aucun numéro de téléphone n’est renseigné dans le dossier.');expect(text).not.toContain('ID-FICTIF');
});
