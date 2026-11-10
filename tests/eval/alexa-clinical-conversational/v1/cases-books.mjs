/**
 * C200 · domain "book": 35 common psychiatric reference questions. French only, and NONE names a book:
 * the doctor never says which book to look in, so Alexa must search all approved sources.
 *
 * Expectations are NOT clinical judgments. Each `alts` entry describes a passage of the approved sources
 * that would be a relevant answer (source, section path and/or heading text), and generate-oracles.mjs
 * checks by SQL that it exists. A passage counts only if it is shown to the doctor, word for word, from
 * a chunk that satisfies one alternative. No clinician has reviewed these expectations.
 * The sources are French (DSM) and English (Maudsley, Stahl): passages stay in their original language.
 */
import { c, t } from "./helpers.mjs";

const D = "book";
const G = { type: "global" };
const dsm = (extra) => ({ sourceLike: "DSM", ...extra });
const stahl = (extra) => ({ sourceLike: "Prescriber", ...extra });
const b = (id, say, alts) => c(id, D, "main", G, [t(say, { k: "book", alts })]);

export const cases = [
  // ── Diagnostic criteria, definitions, duration, distinctions (15) ──────────
  b("C156", "Quels sont les critères diagnostiques de la dépression majeure ?", [dsm({ textAll: ["Trouble dépressif caractérisé — critères diagnostiques"] })]),
  b("C157", "Quels sont les critères du trouble anxieux généralisé ?", [dsm({ sectionAll: ["Troubles anxieux", "Anxiété généralisée"] })]),
  b("C158", "Comment définit-on une attaque de panique ?", [dsm({ textAll: ["Attaque de panique"] }), dsm({ sectionAll: ["Trouble panique"] })]),
  b("C159", "Quels sont les critères diagnostiques de la schizophrénie ?", [dsm({ textAll: ["Schizophrénie — critères diagnostiques"] })]),
  b("C160", "Qu'est-ce qui définit un épisode maniaque ?", [dsm({ textAll: ["Épisode maniaque — critères diagnostiques"] })]),
  b("C161", "Quels sont les critères du TDAH ?", [dsm({ sectionAll: ["Déficit de l", "Critères diagnostiques"] }), dsm({ textAll: ["Déficit de l’attention/hyperactivité — critères diagnostiques"] })]),
  b("C162", "Comment diagnostique-t-on un trouble obsessionnel-compulsif ?", [dsm({ sectionAll: ["Trouble obsessionnel-compulsif"] })]),
  b("C163", "Quels sont les critères du stress post-traumatique ?", [dsm({ sectionAll: ["stress post-traumatique"] })]),
  b("C164", "Quels sont les critères de l'anorexie mentale ?", [dsm({ textAll: ["Anorexie mentale — critères diagnostiques"] })]),
  b("C165", "Combien de temps les symptômes doivent-ils durer pour parler de schizophrénie ?", [dsm({ textAll: ["Schizophrénie — critères diagnostiques", "6 mois"] })]),
  b("C166", "Quelle durée faut-il pour un trouble dépressif persistant ?", [dsm({ textAll: ["Trouble dépressif persistant (dysthymie) — critères diagnostiques", "2 ans"] })]),
  b("C167", "Quelle est la différence entre un épisode maniaque et un épisode hypomaniaque ?", [dsm({ textAll: ["Épisode hypomaniaque — critères diagnostiques"] }), dsm({ textAll: ["Épisode maniaque — critères diagnostiques"] })]),
  b("C168", "Qu'est-ce que l'agoraphobie ?", [dsm({ sectionAll: ["Agoraphobie"] })]),
  b("C169", "Quels sont les symptômes de la boulimie ?", [dsm({ sectionAll: ["Boulimie"] })]),
  b("C170", "Quels sont les critères du trouble bipolaire de type II ?", [dsm({ textAll: ["Trouble bipolaire de type II — critères diagnostiques"] })]),

  // ── Mechanisms, dosing, precautions of common medications (20) ─────────────
  b("C171", "Quel est le mécanisme d'action de la fluoxétine ?", [stahl({ sectionAll: ["Fluoxetine", "How the Drug Works"] })]),
  b("C172", "Comment agit l'aripiprazole ?", [stahl({ sectionAll: ["Aripiprazole", "How the Drug Works"] })]),
  b("C173", "Quelle est la dose habituelle de sertraline ?", [stahl({ sectionAll: ["Sertraline", "Dosing and Use"] })]),
  b("C174", "Quelles sont les contre-indications de l'halopéridol ?", [stahl({ sectionAll: ["Haloperidol", "Do Not Use"] })]),
  b("C175", "Quels sont les effets indésirables graves de la lamotrigine ?", [stahl({ sectionAll: ["Lamotrigine", "Side Effects"] })]),
  b("C176", "Quelles précautions prendre avec le méthylphénidate ?", [stahl({ sectionAll: ["Methylphenidate", "Precautions"] })]),
  b("C177", "Comment doser l'escitalopram ?", [stahl({ sectionAll: ["Escitalopram", "Dosing and Use"] })]),
  b("C178", "Quels sont les effets secondaires notables de la quétiapine ?", [stahl({ sectionAll: ["Quetiapine", "Side Effects"] })]),
  b("C179", "Quels effets indésirables l'olanzapine provoque-t-elle ?", [stahl({ sectionAll: ["Olanzapine", "Side Effects"] })]),
  b("C180", "Quelles sont les contre-indications du bupropion ?", [stahl({ sectionAll: ["Bupropion", "Do Not Use"] })]),
  b("C181", "Quelles sont les contre-indications de la carbamazépine ?", [stahl({ sectionAll: ["Carbamazepine", "Do Not Use"] })]),
  b("C182", "Quelles sont les doses de rispéridone ?", [stahl({ sectionAll: ["Risperidone", "Dosing and Use"] })]),
  b("C183", "Quelle surveillance faut-il pour un patient sous lithium ?", [{ sectionAll: ["Lithium"], textAll: ["monitor"] }]),
  b("C184", "Que faire en cas de neutropénie sous clozapine ?", [{ sourceLike: "Maudsley", sectionAll: ["Clozapine"], textAll: ["neutropenia"] }]),
  b("C185", "Quels sont les risques du valproate pendant la grossesse ?", [{ sectionAll: ["Valpro"], textAll: ["pregnan"] }]),
  b("C186", "Comment arrêter une benzodiazépine sans syndrome de sevrage ?", [{ sourceLike: "Maudsley", textAll: ["benzodiazepine", "withdrawal"] }]),
  b("C187", "Quel est le risque d'allongement du QT avec les antipsychotiques ?", [{ textAll: ["QT", "prolong", "antipsychotic"] }]),
  b("C188", "Quels sont les effets métaboliques des antipsychotiques et comment les surveiller ?", [{ textAll: ["antipsychotic", "metabolic"] }]),
  b("C189", "Qu'est-ce que le syndrome sérotoninergique ?", [{ textAll: ["serotonin syndrome"] }]),
  b("C190", "Que faire en cas de dépression résistante au traitement ?", [{ textAll: ["treatment-resistant depression"] }]),
];
