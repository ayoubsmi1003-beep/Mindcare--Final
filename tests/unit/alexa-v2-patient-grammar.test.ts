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
    ["notes de la consultation passée de Nadia Belkacem", "Nadia Belkacem"],
    ["notes de la patiente Nadia Belkacem", "Nadia Belkacem"],
    ["traitement de la Nadia Belkacem", "Nadia Belkacem"],
    ["notes d'Inès Haddad", "Inès Haddad"],
    ["notes d’Inès Haddad", "Inès Haddad"],
    ["notes de l'Inès Haddad", "Inès Haddad"],
    ["notes de l’Inès Haddad", "Inès Haddad"],
    ["notes des consultations passées de Nadia Belkacem", "Nadia Belkacem"],
    ["traitement du patient Lithium", "Lithium"],
    ["traitement de «Nadia Belkacem»", "Nadia Belkacem"],
    ["Explique le traitement selon le livre de Stahl pour Nadia Belkacem", "Nadia Belkacem"],
    ["notes de Nadia Belkacem d'après la dernière consultation", "Nadia Belkacem"],
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
    ["Lis les notes de travail de Ayoub Salmi", "Ayoub Salmi"],
    ["Lis le dossier du patient «Travail»", "Travail"],
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
    "traitement du Nadia Belkacem et du Karim Haddad",
    "notes d'Inès Haddad et de Nadia Belkacem",
    "notes de la Nadia Belkacem pour Karim Haddad",
    "traitement de «Nadia Belkacem» pour Karim Haddad",
    "Quels sont les symptômes de Nadia Belkacem et de Karim Haddad ?",
  ])("keeps multiple explicit identities ambiguous: %s", text => {
    expect(parsePatientMention(text)).toEqual({ status: "ambiguous" });
  });
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
 ['Lis les diagnostics actifs de Ayoub Salmi.', 'Ayoub Salmi'],
 ['Affiche les certificats de suivi médical de Belkacem Nadia.', 'Belkacem Nadia'],
 ['Lis les notes brutes de «Principal».', 'Principal'],
])('preserves an explicit identity after a clinical qualifier: %s', (text, name) => {
  expect(parsePatientMention(text)).toEqual({ status: 'named', name });
});
it('does not choose between two explicitly named patients after qualifiers', () => {
  expect(parsePatientMention('Lis les diagnostics actifs de Ayoub Salmi et de Belkacem Nadia.')).toEqual({ status: 'ambiguous' });
});

it.each([
 ['Quel est le téléphone de Patient 01 Evaluation ?', 'Patient 01 Evaluation'],
 ['Lis le dossier de Patient 12 Test.', 'Patient 12 Test'],
 ['Quel est le téléphone de Ayoub Salmi ?', 'Ayoub Salmi'],
])('grounds a stated alphanumeric label or administrative lookup: %s', (text, name) => {
 expect(parsePatientMention(text)).toEqual({status:'named',name});
});
it('keeps two explicit alphanumeric labels ambiguous', () => {
 expect(parsePatientMention('Compare Patient 01 Evaluation et Patient 02 Evaluation.')).toEqual({status:'ambiguous'});
});
it('does not promote a patient age to an alphanumeric identity', () => {
 expect(parsePatientMention('Lis les notes du patient de 18 ans.')).toEqual({status:'none'});
});


it.each([
 ['Prépare un certificat de bonne santé mentale pour le patient sélectionné.',{status:'none'}],
 ['Prépare un certificat de bonne santé mentale pour Ayoub Salmi.',{status:'named',name:'Ayoub Salmi'}],
 ['Cherche l’expression « sommeil bleu » dans les notes de travail de Ayoub Salmi.',{status:'named',name:'Ayoub Salmi'}],
 ['Cherche le mot « anxiété » dans ses notes.',{status:'none'}],
 ['Montre les notes du patient «Expression».',{status:'named',name:'Expression'}],
])('does not turn a document type or literal search into a patient: %s',(text,expected)=>expect(parsePatientMention(text)).toEqual(expected));
it.each(['Quelle est la situation familiale de Ayoub Salmi ?','Quel est le sexe enregistré de Ayoub Salmi ?'])('resolves an explicit administrative field owner: %s',text=>expect(parsePatientMention(text)).toEqual({status:'named',name:'Ayoub Salmi'}));

it.each(['Liste les consultations terminées de Belkacem Nadia.','Compte les consultations clôturées de Ayoub Salmi.','Montre les consultations ouvertes de Ayoub Salmi.'])('keeps a consultation state separate from the named person: %s',text=>expect(parsePatientMention(text)).toMatchObject({status:'named',name:text.includes('Belkacem')?'Belkacem Nadia':'Ayoub Salmi'}));

it.each([['Montre les brouillons de documents de Belkacem Nadia.',{status:'named',name:'Belkacem Nadia'}],['Liste les documents émis de Ayoub Salmi.',{status:'named',name:'Ayoub Salmi'}],['Liste les brouillons de documents du dossier courant.',{status:'none'}]])('keeps document nouns and states out of patient identity: %s',(text,expected)=>expect(parsePatientMention(text)).toEqual(expected));

it('does not mistake a secondary diagnosis qualifier for a second patient',()=>expect(parsePatientMention('Lis les diagnostics secondaires de Ayoub Salmi.')).toEqual({status:'named',name:'Ayoub Salmi'}));

it.each(['revue','relecture','validation','vérification','confirmation','signature','impression'])('keeps a workflow purpose out of patient identity: %s',purpose=>{
 expect(parsePatientMention('Montre les rendez-vous de demain et prépare les corrections pour '+purpose+'.')).toEqual({status:'none'});
 expect(parsePatientMention('Lis les notes de Ayoub Salmi pour '+purpose+'.')).toEqual({status:'named',name:'Ayoub Salmi'});
});
it.each(['Montre le dossier du patient Revue.','Montre les rendez-vous pour Revue Martin.','Montre le dossier de «Revue».'])('preserves an actual identity despite a workflow-purpose word: %s',text=>expect(parsePatientMention(text)).toEqual({status:'named',name:text.includes('Martin')?'Revue Martin':'Revue'}));
