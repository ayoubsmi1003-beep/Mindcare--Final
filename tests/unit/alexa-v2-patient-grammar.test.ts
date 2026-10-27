import { describe, expect, it } from "vitest";
import { parsePatientMention } from "@/shared/alexa/patient-mention";

describe("Alexa patient identity grammar stays local and explicit", () => {
  // Dropping contracted/elided introducers or capturing request modifiers
  // would lose the requested identity before the audited resolver receives it.
  it.each([
    ["Dossier de «Courant»", "Courant"],
    ["Dossier de «Sélectionné»", "Sélectionné"],
    ["traitement du belkacem mohamed", "belkacem mohamed"],
    ["note du consultations du consultation passée du nadia belkacem", "nadia belkacem"],
    ["notes de la consultation passée de Nadia Test", "Nadia Test"],
    ["notes de la patiente Nadia Test", "Nadia Test"],
    ["traitement de la Nadia Test", "Nadia Test"],
    ["notes d'Inès Test", "Inès Test"],
    ["notes d’Inès Test", "Inès Test"],
    ["notes de l'Inès Test", "Inès Test"],
    ["notes de l’Inès Test", "Inès Test"],
    ["notes des consultations passées de Nadia Test", "Nadia Test"],
    ["traitement du patient Lithium", "Lithium"],
    ["traitement de «Nadia Test»", "Nadia Test"],
    ["Explique le traitement selon le livre de Stahl pour Nadia Test", "Nadia Test"],
    ["notes de Nadia Test d'après la dernière consultation", "Nadia Test"],
    ["traitement du Jean D'Angelo", "Jean D'Angelo"],
    ["traitement Jean D’Angelo", "Jean D’Angelo"],
    ["traitement du patient D'Angelo", "D'Angelo"],
    ["notes de «Jean D'Angelo»", "Jean D'Angelo"],
    ["traitement du Nadia", "Nadia"],
    ["notes de la consultation passée d'Inès", "Inès"],
    ["Quels sont les symptômes de Nadia Test ?", "Nadia Test"],
    ["Quels sont les symptômes du patient Nadia ?", "Nadia"],
    ["Quels sont les symptômes de «Nadia» ?", "Nadia"],
    ["traitement du Parkinson", "Parkinson"],
    ["Lis les notes de travail de Nadia Test", "Nadia Test"],
    ["Lis le dossier du patient «Travail»", "Travail"],
    ["Peux-tu vérifier si Samir Ferhat a un numéro de carte d’identité ?", "Samir Ferhat"],
    ["Quel est l’identifiant de la carte nationale de Sarah Boudiaf ?", "Sarah Boudiaf"],
    ["Combien de consultations terminées compte Nadia Test ?", "Nadia Test"],
    ["Le dossier de Riad Khelifi contient-il un numéro de CNI ?", "Riad Khelifi"],
    ["Cherche la phrase « SUBJ-011-S01 » dans le Subjectif de Amina Meziane.", "Amina Meziane"],
    ["Cherche le code « SUBJ-015-S01 » dans la partie subjective de Dounia Ghani.", "Dounia Ghani"],
    ["Dans le dossier d’Ayoub Salmi, ajoute uniquement une date de fin au traitement ZOLOFT 25 mg : 27/10/2026.", "Ayoub Salmi"],
    ["Pour Amel Bensaid, retire la date de fin du traitement Sertraline.", "Amel Bensaid"],
    ["Le traitement de Lina Ziani : fixe la fréquence de Sertraline à une fois par jour.", "Lina Ziani"],
    ["Pour Saliha Abdelkarim, fixe la dose de Sertraline à 50 mg.", "Saliha Abdelkarim"],
    ["Pour Salah Eddine Abassi, change uniquement la date de fin du traitement Zoloft au 27/10/2026.", "Salah Eddine Abassi"],
    ["Le traitement de Tassadit Aguelmin : arrête la Sertraline.", "Tassadit Aguelmin"],
    ["Pour Wafa Aksas, retire uniquement la date de fin du Zoloft.", "Wafa Aksas"],
    ["Stoppe uniquement le traitement Sertraline de Khalil Ait Said.", "Khalil Ait Said"],
  ])("extracts only the stated patient name: %s", (text, name) => {
    expect(parsePatientMention(text)).toEqual({ status: "named", name });
  });

  // Promoting grammar, an unquoted drug, or an explicitly introduced book
  // author to an identity would wrongly change a general/local-context request.
  it.each([
    "Quels sont les rendez-vous de demain ?",
    "Les rendez-vous d’aujourd’hui.",
    "Lis toutes les informations du dossier courant.",
    "Quel est le téléphone enregistré du patient sélectionné ?",
    "Les notes de la patiente sélectionnée.",
    "Lis les dossiers sélectionnés.",
    "Les informations des patientes sélectionnées.",
    "Les notes de la consultation courante.",
    "Lis les dossiers courants.",
    "Les notes des consultations courantes.",
    "notes de la consultation passée",
    "notes des consultations passées",
    "traitement du patient",
    "notes de l'ancienne consultation",
    "traitement du trouble bipolaire",
    "traitement de la dépression",
    "traitement de l'anxiété",
    "traitement d'une dépression",
    "notes de la dernière consultation du 21 mai",
    "traitement du lithium",
    "traitement d'escitalopram",
    "Quelle est la posologie de l'escitalopram ?",
    "Explique le traitement selon le livre de Stahl",
    "Explique le traitement selon les livres de Taylor",
    "diagnostic selon le DSM",
    "Quels sont les symptômes du diabète ?",
    "Quelle est la définition du diabète ?",
    "Quelle est la taille du Soleil ?",
    "Quels sont les symptômes de diabète ?",
    "Quelle est la définition de diabète ?",
    "Quelle est la taille de Soleil ?",
    "Quels sont les symptômes du Parkinson ?",
    "Quels sont les symptômes de pneumonie ?",
    "Quel est le diagnostic de pneumonie ?",
    "Explique les symptômes du Parkinson",
    "Explique le diagnostic de pneumonie",
    "Quels sont les symptômes du Parkinson et de pneumonie ?",
    "Lis les notes de travail enregistrées de ce patient.",
    "Lis les notes subjectives du patient sélectionné.",
    "Montre les notes objectives de la consultation courante.",
    "Lis l’évaluation de cette consultation.",
    "Montre la conduite à tenir du dossier courant.",
    "Quel est le numéro de carte d’identité du patient sélectionné ?",
    "Quelle est la date de naissance du patient sélectionné ?",
    "Quelle est l’adresse du patient sélectionné ?",
    "Montre les rectificatifs de ses notes.",
  ])("does not treat grammar or clinical/knowledge topics as a patient: %s", text => {
    expect(parsePatientMention(text)).toEqual({ status: "none" });
  });

  // Consuming later introducers or selecting one of several identities would
  // bypass the local ambiguity choice that the resolver/orchestrator preserves.
  it.each([
    "traitement du Nadia Test et du Karim Test",
    "notes d'Inès Test et de Nadia Test",
    "notes de la Nadia Test pour Karim Test",
    "traitement de «Nadia Test» pour Karim Test",
    "Quels sont les symptômes de Nadia Test et de Karim Test ?",
  ])("keeps multiple explicit identities ambiguous: %s", text => {
    expect(parsePatientMention(text)).toEqual({ status: "ambiguous" });
  });
});

it("does not treat a French preposition after 'patient' as a patient name", () => {
  expect(parsePatientMention("Que rapporte le patient dans les notes Subjectif ?")).toEqual({ status: "none" });
});

it.each([
  "Que disent les notes brutes du dossier courant ?",
  "Affiche les traitements actifs de la patiente sélectionnée.",
  "Y a-t-il un diagnostic principal enregistré pour la patiente sélectionnée ?",
  "Liste les diagnostics actifs et résolus de ce patient.",
  "Y a-t-il un traitement arrêté enregistré dans ce dossier ?",
  "Lis les diagnostics du patient courant, sans en proposer de nouveaux.",
  "Affiche les certificats de suivi médical de ce dossier.",
  "Prépare l’encaissement du paiement de la consultation ee000000-0000-4000-8000-000000000001 du patient courant."
])('keeps clinical qualifiers on the selected dossier: %s', text => {
  expect(parsePatientMention(text)).toEqual({ status: 'none' });
});
it.each([
 ['Lis les diagnostics actifs de Nadia Test.', 'Nadia Test'],
 ['Affiche les certificats de suivi médical de Test Nadia.', 'Test Nadia'],
 ['Lis les notes brutes de «Principal».', 'Principal'],
])('preserves an explicit identity after a clinical qualifier: %s', (text, name) => {
  expect(parsePatientMention(text)).toEqual({ status: 'named', name });
});
it('does not choose between two explicitly named patients after qualifiers', () => {
  expect(parsePatientMention('Lis les diagnostics actifs de Nadia Test et de Test Nadia.')).toEqual({ status: 'ambiguous' });
});

it.each([
 ['Quel est le téléphone de Patient 01 Evaluation ?', 'Patient 01 Evaluation'],
 ['Lis le dossier de Patient 12 Test.', 'Patient 12 Test'],
 ['Quel est le téléphone de Nadia Test ?', 'Nadia Test'],
])('grounds a stated alphanumeric label or administrative lookup: %s', (text, name) => {
 expect(parsePatientMention(text)).toEqual({status:'named',name});
});
it('keeps two explicit alphanumeric labels ambiguous', () => {
 expect(parsePatientMention('Compare Patient 01 Evaluation et Patient 02 Evaluation.')).toEqual({status:'ambiguous'});
});
it.each([
 ['Cherche la référence «REPERE-001-S06» dans les notes de Patient Test001.','Patient Test001'],
 ['Quel est le numéro de carte d’identité de Patient Test050 ?','Patient Test050'],
])('resolves a named synthetic test label with a trailing numeric suffix: %s',(text,name)=>{
 expect(parsePatientMention(text)).toEqual({status:'named',name});
});
it('keeps two named synthetic test labels ambiguous',()=>{
 expect(parsePatientMention('Compare les notes de Patient Test001 et Patient Test002.')).toEqual({status:'ambiguous'});
});
it('does not promote a patient age to an alphanumeric identity', () => {
 expect(parsePatientMention('Lis les notes du patient de 18 ans.')).toEqual({status:'none'});
});
it('does not treat a finance concept as a patient in a cabinet-wide count', () => {
 expect(parsePatientMention('Combien de consultations terminées n’ont pas de tarif ?')).toEqual({status:'none'});
});
it('does not mistake a treatment qualifier for a selected patient identity', () => {
 expect(parsePatientMention('Quels traitements suspendus sont documentés ?')).toEqual({status:'none'});
});


it.each([
 ['Prépare un certificat de bonne santé mentale pour le patient sélectionné.',{status:'none'}],
 ['Prépare un certificat de bonne santé mentale pour Nadia Test.',{status:'named',name:'Nadia Test'}],
 ['Cherche l’expression « sommeil bleu » dans les notes de travail de Nadia Test.',{status:'named',name:'Nadia Test'}],
 ['Cherche le mot « anxiété » dans ses notes.',{status:'none'}],
 ['Montre les notes du patient «Expression».',{status:'named',name:'Expression'}],
])('does not turn a document type or literal search into a patient: %s',(text,expected)=>expect(parsePatientMention(text)).toEqual(expected));
it.each(['Quelle est la situation familiale de Nadia Test ?','Quel est le sexe enregistré de Nadia Test ?'])('resolves an explicit administrative field owner: %s',text=>expect(parsePatientMention(text)).toEqual({status:'named',name:'Nadia Test'}));

it.each([
 ['Liste les consultations terminées de Test Nadia.','Test Nadia'],
 ['Compte les consultations clôturées de Nadia Test.','Nadia Test'],
 ['Montre les consultations ouvertes de Nadia Test.','Nadia Test'],
])('keeps a consultation state separate from the named person: %s',(text,name)=>expect(parsePatientMention(text)).toEqual({status:'named',name}));

it.each([['Montre les brouillons de documents de Test Nadia.',{status:'named',name:'Test Nadia'}],['Liste les documents émis de Nadia Test.',{status:'named',name:'Nadia Test'}],['Liste les brouillons de documents du dossier courant.',{status:'none'}]])('keeps document nouns and states out of patient identity: %s',(text,expected)=>expect(parsePatientMention(text)).toEqual(expected));
it.each(['Ouvre les ordonnances de Nadia Test.','Ouvre les ordonnances pour Nadia Test.'])('extracts patient identity from a plural prescription request: %s',text=>expect(parsePatientMention(text)).toEqual({status:'named',name:'Nadia Test'}));

it('does not mistake a secondary diagnosis qualifier for a second patient',()=>expect(parsePatientMention('Lis les diagnostics secondaires de Nadia Test.')).toEqual({status:'named',name:'Nadia Test'}));

it.each(['revue','relecture','validation','vérification','confirmation','signature','impression'])('keeps a workflow purpose out of patient identity: %s',purpose=>{
 expect(parsePatientMention('Montre les rendez-vous de demain et prépare les corrections pour '+purpose+'.')).toEqual({status:'none'});
 expect(parsePatientMention('Lis les notes de Nadia Test pour '+purpose+'.')).toEqual({status:'named',name:'Nadia Test'});
});
it.each(['Montre le dossier du patient Revue.','Montre les rendez-vous pour Revue Martin.','Montre le dossier de «Revue».'])('preserves an actual identity despite a workflow-purpose word: %s',text=>expect(parsePatientMention(text)).toEqual({status:'named',name:text.includes('Martin')?'Revue Martin':'Revue'}));

it.each([
 ['Ajoute un rendez-vous de 30 minutes à Nadia Test le jeudi 29 octobre 2026 à 10 h 30.',{status:'named',name:'Nadia Test'}],
 ['Planifie un rendez-vous à Nadia Test le jeudi 29 octobre 2026 à 10 h 30.',{status:'named',name:'Nadia Test'}],
 ['Ajoute un rendez-vous à 10 h 30 jeudi.',{status:'none'}],
 ['Montre les rendez-vous à Alger jeudi.',{status:'none'}],
])('resolves a patient after the appointment preposition without treating time or place as a patient: %s',(text,expected)=>expect(parsePatientMention(text)).toEqual(expected));
