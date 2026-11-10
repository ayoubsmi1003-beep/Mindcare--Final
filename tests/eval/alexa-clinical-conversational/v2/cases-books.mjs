/**
 * C201 · domain "book": 35 NEW medical-knowledge questions. None repeats a C200 topic. Each one was written after reading the approved
 * passage that answers it (DSM-5 fr, Maudsley, Stahl) in the synthetic evaluation database; the decisive words of that passage are the
 * `facts`. No question names a book (the doctor never does) and the answer may come from any approved book.
 *
 * PASS needs a displayed passage that (1) is word for word part of an approved chunk, (2) whose chunk holds ALL the facts, (3) whose
 * displayed text itself holds ALL the facts (a passage that only mentions the subject does not answer), (4) with the right page.
 * Facts are folded (accents, case) and avoid words the PDF extraction damaged (fi/fl ligatures).
 */
import { c, t } from "./helpers.mjs";

const D = "book";
const G = { type: "global" };
const b = (id, tag, say, ...facts) => c(id, D, "main", G, [t(say, { k: "book", alts: [{ textAll: facts }], quoteFacts: facts }, tag)]);

export const cases = [
  // ── DSM-5 (French): criteria, essential features, prevalence, comorbidity, culture ─────
  b("V156", ["fr", "direct"], "Quels sont les critères de la personnalité borderline ?", "instabilite des relations interpersonnelles", "impulsivite marquee"),
  b("V157", ["fr", "informal"], "C'est quoi les critères d'une personnalité antisociale ?", "mepris et de transgression des droits", "tromper pour un profit personnel"),
  b("V158", ["fr", "conversational"], "À quoi reconnaît-on une personnalité schizotypique ?", "deficit social et interpersonnel", "gene aigue"),
  b("V159", ["fr", "direct"], "Quels sont les critères du délirium ?", "perturbation de l'attention", "quelques heures a quelques jours"),
  b("V160", ["fr", "formal"], "Quels critères faut-il pour parler de trouble neurocognitif dû à la maladie d'Alzheimer ?", "debut insidieux et une progression graduelle", "maladie d'alzheimer"),
  b("V161", ["fr", "short"], "Critères du trouble fétichisme", "objets", "parties non genitales du corps"),
  b("V162", ["fr", "conversational"], "Comment diagnostique-t-on une phobie spécifique ?", "peur ou anxiete intenses a propos d'un objet ou d'une situation", "avoir une injection"),
  b("V163", ["fr", "direct"], "Quelle est la caractéristique essentielle de l'anxiété de séparation ?", "caracteristique essentielle", "separation d'avec la maison"),
  b("V164", ["fr", "direct"], "Quelle est la prévalence du mutisme sélectif ?", "relativement rare", "0,03 et 1 %"),
  b("V165", ["fr", "conversational"], "Avec quels autres troubles le mutisme sélectif est-il souvent associé ?", "mutisme selectif", "anxiete sociale", "anxiete de separation"),
  b("V166", ["fr", "conversational"], "Un enfant immigré qui refuse de parler la nouvelle langue a-t-il forcément un mutisme sélectif ?", "refuser de parler la nouvelle langue", "comprehension de la nouvelle langue"),
  b("V167", ["fr", "direct"], "Dans quels troubles peut-on utiliser la spécification catatonique ?", "neurodeveloppemental, psychotique, bipolaire, depressif"),
  b("V168", ["fr", "formal"], "Quels sont les critères du trouble neurocognitif lié à la maladie de Huntington ?", "maladie de huntington est cliniquement etablie", "debut insidieux et une progression graduelle"),
  b("V169", ["fr", "direct"], "Comment pose-t-on le diagnostic d'un trouble neurocognitif dû à une maladie à prions ?", "myoclonies ou une ataxie", "progression rapide"),

  // ── Maudsley Prescribing Guidelines (English): pregnancy, adverse effects, smoking, alcohol, special settings ─────
  b("V170", ["fr", "direct"], "Quel risque cardiaque associe-t-on au lithium pendant la grossesse ?", "ebstein"),
  b("V171", ["fr", "conversational"], "Existe-t-il des données sur le linaclotide pour la constipation due aux antipsychotiques ?", "linaclotide", "constipation"),
  b("V172", ["fr", "direct"], "Comment prescrire le bupropion pour arrêter de fumer ?", "150mg po bupropion daily", "stopping date"),
  b("V173", ["fr", "conversational"], "Peut-on prolonger la varénicline pour maintenir l'abstinence tabagique ?", "varenicline", "additional 12 weeks"),
  b("V174", ["fr", "formal"], "Quels médicaments sont autorisés en première intention pour le TDAH de l'adulte ?", "atomoxetine, lisdexamfetamine", "first-time use in adults"),
  b("V175", ["fr", "direct"], "Quel traitement intraveineux existe pour la dépression du post-partum ?", "brexanolone", "postpartum depression"),
  b("V176", ["fr", "informal"], "Que se passe-t-il avec le lithium après une chirurgie bariatrique ?", "lithium toxicity", "sleeve gastrectomy"),
  b("V177", ["fr", "conversational"], "Quels mécanismes expliquent le risque de thrombose avec les antipsychotiques ?", "venous thromboembolism", "platelet aggregation"),
  b("V178", ["fr", "direct"], "Faut-il surveiller la calcémie sous lithium au long cours ?", "hyperparathyroidism", "calcium levels"),
  b("V179", ["fr", "direct"], "Quand utiliser un schéma de sevrage alcoolique déclenché par les symptômes ?", "symptom-triggered", "ciwa-ar"),
  b("V180", ["fr", "conversational"], "Comment traiter un delirium tremens par rapport à la tranquillisation rapide habituelle ?", "delirium tremens", "rapid tranquillisation"),

  // ── Stahl's Prescriber's Guide (English): mechanisms, interactions, monitoring, stopping ─────
  b("V181", ["fr", "direct"], "Sur quelle cible agit la prégabaline ?", "alpha 2 delta", "calcium channels"),
  b("V182", ["fr", "direct"], "Comment le valproate agit-il sur les canaux ioniques ?", "voltage-sensitive sodium channels"),
  b("V183", ["fr", "conversational"], "Quelle région du cerveau le modafinil active-t-il pour favoriser l'éveil ?", "tuberomammillary", "histamine"),
  b("V184", ["fr", "direct"], "Comment la lamotrigine agit-elle sur les canaux sodiques ?", "use-dependent blocker", "voltage-sensitive sodium channels"),
  b("V185", ["fr", "short"], "Classe pharmacologique de l'atomoxétine ?", "strattera", "norepinephrine reuptake inhibitor"),
  b("V186", ["fr", "formal"], "Que provoque l'antagonisme des récepteurs sérotoninergiques 3 de la vortioxétine ?", "serotonin 3 receptors", "nausea"),
  b("V187", ["fr", "conversational"], "Quels anti-inflammatoires font monter le taux de lithium ?", "nonsteroidal anti-inflammatory", "plasma lithium concentrations"),
  b("V188", ["fr", "direct"], "À quel moment faut-il doser le lithium dans le sang ?", "trough", "12 hours after the last dose"),
  b("V189", ["fr", "conversational"], "Comment arrêter la paroxétine quand le sevrage est sévère ?", "more severe with paroxetine", "slowly taper paroxetine"),
  b("V190", ["fr", "direct"], "Le zolpidem peut-il entraîner une dépendance ?", "zolpidem is a schedule iv drug", "dependence"),
];
