/**
 * C202 · domain "book": 35 NEW medical-knowledge questions, in French, on topics used by neither C200 nor C201. No question names a book
 * (the doctor never does) and the answer may come from any approved book. Each was written after reading the approved passage that
 * answers it (DSM-5 fr, Maudsley, Stahl) in the synthetic evaluation database; the decisive words of that passage are the `facts`.
 *
 * PASS needs a displayed passage that (1) is word for word part of an approved chunk, (2) whose chunk holds ALL the facts, (3) whose
 * displayed text itself holds ALL the facts (finding the passage and not showing it, or showing one that only mentions the subject, fails), (4) with the right page.
 * Facts are folded (accents, case) and avoid words the PDF extraction damaged (fi/fl ligatures).
 */
import { c, t } from "./helpers.mjs";

const D = "book";
const G = { type: "global" };
const b = (id, tag, say, ...facts) => c(id, D, "main", G, [t(say, { k: "book", alts: [{ textAll: facts }], quoteFacts: facts }, tag)]);
const F = "fr";

export const cases = [
  // DSM-5 (French)
  b("W156", [F, "direct"], "Comment définit-on la personnalité histrionique ?", "reponses emotionnelles excessives", "quete d'attention"),
  b("W157", [F, "conversational"], "Comment reconnaît-on une personnalité évitante ?", "inhibition sociale", "hypersensibilite"),
  b("W158", [F, "formal"], "À quoi correspond la personnalité narcissique ?", "comportements grandioses", "besoin d'etre admire"),
  b("W159", [F, "short"], "Critères d'une personnalité schizoïde", "detachement par rapport aux relations sociales"),
  b("W160", [F, "conversational"], "Qu'est-ce qui caractérise la personnalité dépendante ?", "besoin general et excessif d'etre pris en charge"),
  b("W161", [F, "direct"], "Sur quoi repose le diagnostic de personnalité paranoïaque ?", "soupconneuse envahissante envers les autres"),
  b("W162", [F, "direct"], "Quels sont les critères de la kleptomanie ?", "impossibilite repetee de resister a l'impulsion de voler"),
  b("W163", [F, "conversational"], "Comment diagnostique-t-on une pyromanie ?", "allumage delibere et reflechi d'incendies"),
  b("W164", [F, "formal"], "Quels critères permettent de retenir la crainte excessive d'avoir une maladie ?", "preoccupation concernant le fait d'avoir ou de developper une maladie grave"),
  b("W165", [F, "direct"], "Quels sont les critères des troubles de l'adaptation ?", "reponse a un ou plusieurs facteurs de stress identifiables"),
  b("W166", [F, "formal"], "Quels critères pour un trouble lié à des douleurs génito-pelviennes ou à la pénétration ?", "difficultes persistantes ou repetees"),
  b("W167", [F, "conversational"], "Quels signes associés évoquent un trouble de l'usage du tabac ?", "fumer dans les 30 minutes suivant le reveil"),
  b("W168", [F, "direct"], "Quelle est la cause de la narcolepsie avec cataplexie ?", "perte cellulaire de neurones hypothalamiques", "hypocretine"),

  // Maudsley Prescribing Guidelines (English)
  b("W169", [F, "direct"], "Quelle dose de lorazépam équivaut à 10 mg de diazépam ?", "diazepam equivalent", "lorazepam 1mg"),
  b("W170", [F, "formal"], "Quelle dose quotidienne initiale ne dépasse-t-on pas pour traiter une dépendance aux opiacés en service de psychiatrie ?", "initial daily dose", "30mg", "naloxone"),
  b("W171", [F, "direct"], "Quel est le traitement de première intention de la boulimie ?", "first line for bulimia", "fluoxetine"),
  b("W172", [F, "conversational"], "Existe-t-il un médicament homologué pour l'anorexie mentale ?", "none is currently licensed", "anorexia nervosa"),
  b("W173", [F, "direct"], "Pourquoi le valproate peut-il provoquer léthargie et confusion ?", "hyperammonaemia", "750mg/day"),
  b("W174", [F, "conversational"], "Un antidépresseur est-il à l'abri de l'hyponatrémie ?", "linked with hyponatraemia"),
  b("W175", [F, "direct"], "Quel bilan faire avant de débuter le lithium ?", "pre-lithium workup", "egfr and tfts"),
  b("W176", [F, "formal"], "Un inhibiteur de la cholinestérase est-il préférable pour limiter la bradycardie ?", "none of the ache-is", "chronotropic"),
  b("W177", [F, "conversational"], "Quels effets cardiovasculaires a-t-on rapportés avec la mémantine ?", "memantine", "bradycardia"),
  b("W178", [F, "direct"], "Que propose-t-on par injection contre l'hypersalivation sous clozapine ?", "parotid gland", "sialorrhoea"),
  b("W179", [F, "formal"], "Quels médicaments élèvent le seuil convulsif lors d'une sismothérapie ?", "elevate seizure threshold", "higher stimuli"),

  // Stahl's Prescriber's Guide (English)
  b("W180", [F, "direct"], "Quelle prise de poids attend-on avec la lurasidone ?", "weight gain greater than placebo", "52-week"),
  b("W181", [F, "conversational"], "Les fortes doses de lurasidone sont-elles plus efficaces dans la dépression bipolaire ?", "20 and 60 mg/day", "60 and 120 mg/day"),
  b("W182", [F, "direct"], "Que donner contre l'akathisie sous ziprasidone ?", "ziprasidone", "akathisia", "beta blockers"),
  b("W183", [F, "formal"], "L'allongement du QTc avec la ziprasidone injectable dépasse-t-il celui de l'halopéridol ?", "intramuscular ziprasidone", "haloperidol"),
  b("W184", [F, "direct"], "Quels effets secondaires fréquents provoque la mirtazapine ?", "mirtazapine", "increased appetite", "weight gain"),
  b("W185", [F, "conversational"], "Le sevrage de la venlafaxine est-il plus sévère que celui des autres antidépresseurs ?", "more severe with venlafaxine"),
  b("W186", [F, "direct"], "Quelle dose de clonazépam peut être nécessaire dans le trouble panique ?", "panic patients may require 4 mg/day"),
  b("W187", [F, "short"], "Demi-vie de la naltrexone orale ?", "oral naltrexone is approximately 13 hours"),
  b("W188", [F, "conversational"], "Quel est le principal avantage de la forme à libération contrôlée de la paroxétine ?", "main advantage of cr", "reduced side effects"),
  b("W189", [F, "formal"], "Quels récepteurs contribuent à l'effet de la clozapine sur les symptômes cognitifs et affectifs ?", "5ht2c and 5ht1a"),
  b("W190", [F, "direct"], "Le modafinil modifie-t-il la pharmacocinétique de la dextroamphétamine ?", "dextroamphetamine", "pharmacokinetics"),
];
