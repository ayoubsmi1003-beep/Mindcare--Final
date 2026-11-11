/**
 * The read intents Alexa can recognise by MEANING, with French development paraphrases.
 *
 * The deterministic frames (patient-question.ts, agenda-frame.ts, practice-frame.ts) already turn a recognised request into
 * the closed question the audited gates answer. They recognise words, so a request worded otherwise falls to the slow local
 * model. This catalogue lets semantic-intent.ts find WHICH of those closed questions a new wording means, by nearest
 * neighbours under the local embedding model; the frames' own renderers then write the closed question. Execution stays
 * deterministic and every read keeps its gate.
 *
 * Rules (tested in tests/unit/alexa-intent-catalogue.test.ts):
 *  - read intents only: nothing here can lead to a write or a proposal (règle 7);
 *  - paraphrases are development examples written from the coverage matrix (docs/alexa/19), never copied from an
 *    evaluation campaign; the test refuses any that resembles a C270 or H270 turn;
 *  - "[X]" stands for a patient's name: names are masked before embedding, so an intent is never learnt from a name.
 */
import type { AgendaIntent } from "./agenda-frame";
import type { PatientSectionKey } from "./patient-question";

export type IntentTarget =
  | { readonly family: "patient"; readonly section: PatientSectionKey }
  | { readonly family: "agenda"; readonly intent: AgendaIntent }
  | { readonly family: "finance"; readonly measure: "revenue" | "expenses" | "net" | "outstanding" }
  | { readonly family: "activity" };

export interface CatalogueIntent { readonly id: string; readonly label: string; readonly target: IntentTarget; readonly examples: readonly string[] }

const patient = (section: PatientSectionKey) => ({ family: "patient", section }) as const;
const agenda = (intent: AgendaIntent) => ({ family: "agenda", intent }) as const;

export const INTENT_CATALOGUE: readonly CatalogueIntent[] = [
  { id: "patient.summary", label: "résumé du dossier d'un patient", target: patient("summary"), examples: [
    "Fais-moi un résumé de son dossier.", "Qu'est-ce que je dois savoir sur [X] avant de le recevoir ?", "Un topo rapide sur ce patient.",
    "Où on en est avec lui ?", "Remets-moi dans le contexte de ce dossier.", "Les points essentiels de son suivi.",
    "Je reçois [X] tout à l'heure, mets-moi au courant.", "Rappelle-moi sa situation en deux mots.", "Tu peux me briefer sur ce patient ?",
    "J'ai besoin d'une vue d'ensemble sur [X].", "Résume-moi sa prise en charge.", "De quoi parle son dossier ?",
    "Récapitule ce qu'on sait de lui.", "Donne-moi une synthèse clinique de [X].", "État des lieux de son dossier, vite fait.",
  ] },
  { id: "patient.history", label: "liste ou historique des consultations d'un patient", target: patient("history"), examples: [
    "Liste toutes ses consultations.", "Je veux voir le parcours de [X] chez nous.", "Son historique de suivi depuis le départ.",
    "Montre-moi toutes ses visites, de la plus ancienne à la plus récente.", "Le fil de ses séances, s'il te plaît.",
    "Retrace son suivi au cabinet.", "Quelles consultations a eues [X] ?", "Déroule-moi ses passages successifs.",
  ] },
  { id: "patient.treatments", label: "traitement en cours d'un patient (médicaments, dose, rythme, début)", target: patient("treatments"), examples: [
    "Qu'est-ce qu'il prend comme médicaments ?", "Quels sont ses traitements en ce moment ?", "Sous quoi est [X] actuellement ?",
    "Il est sous quel traitement ?", "Rappelle-moi ses prescriptions en cours.", "Quelle est sa posologie actuelle ?",
    "Il prend quoi le matin et le soir ?", "Ses médicaments du moment ?", "Quelle dose prend-il aujourd'hui ?",
    "Il a quoi comme ordonnance en cours ?", "Depuis quand il prend son traitement actuel ?", "Quels comprimés lui a-t-on prescrits ?",
  ] },
  { id: "patient.treatchanges", label: "modifications passées du traitement d'un patient", target: patient("treatchanges"), examples: [
    "Son traitement a-t-il été modifié ?", "Qu'est-ce qu'il prenait avant ?", "Quels changements de dose depuis le début ?",
    "La posologie a-t-elle évolué ?", "Historique des modifications de son traitement.", "On a augmenté sa dose à un moment ?",
    "Quelle était sa dose de départ ?", "A-t-on arrêté ou remplacé un de ses médicaments ?",
  ] },
  { id: "patient.count", label: "nombre de consultations d'un patient", target: patient("count"), examples: [
    "Combien de fois est-il venu ?", "Il a fait combien de séances chez nous ?", "Le nombre total de ses consultations ?",
    "On l'a reçu combien de fois au total ?", "Ça fait combien de rendez-vous honorés pour [X] ?", "Combien de passages au cabinet pour lui ?",
    "A-t-il déjà consulté ici ?", "Combien de consultations terminées dans son dossier ?",
  ] },
  { id: "patient.lastdate", label: "date de la dernière consultation d'un patient", target: patient("lastdate"), examples: [
    "Quand est-il venu pour la dernière fois ?", "La date de sa dernière séance ?", "On l'a vu quand en dernier ?",
    "Ça remonte à quand, sa dernière visite ?", "C'était quel jour, son dernier passage ?", "Dernier rendez-vous honoré de [X] ?",
    "Il est passé quand la dernière fois ?", "À quelle date l'ai-je reçu récemment ?",
  ] },
  { id: "patient.firstdate", label: "date de la première consultation d'un patient", target: patient("firstdate"), examples: [
    "Depuis quand le suit-on ?", "Quelle est la date de sa première consultation ?", "Il a commencé chez nous quand ?",
    "Sa toute première venue, c'était quand ?", "Le début de sa prise en charge ?", "Depuis combien de temps est-il suivi ici ?",
    "Quand [X] est-il arrivé au cabinet ?", "Date d'ouverture de son suivi ?",
  ] },
  { id: "patient.lastnote", label: "contenu de la dernière note de consultation d'un patient", target: patient("lastnote"), examples: [
    "Qu'est-ce que j'ai noté la dernière fois ?", "Relis-moi ma note de la séance précédente.", "Le compte rendu de son dernier passage.",
    "Ce qui s'est dit lors de la dernière consultation ?", "Montre-moi la dernière note clinique de [X].", "Les observations de la dernière séance.",
    "Qu'avait-on décidé la dernière fois ?", "Le contenu de mon dernier entretien avec lui.",
  ] },
  { id: "patient.prev", label: "les dernières consultations d'un patient, avec leurs dates", target: patient("prev"), examples: [
    "Ses trois dernières consultations ?", "Montre-moi ses dernières séances.", "Les dates de ses deux derniers passages.",
    "Quelles étaient ses visites récentes ?", "Liste ses quatre dernières venues.",
  ] },
  { id: "patient.nextappt", label: "prochain rendez-vous d'un patient", target: patient("nextappt"), examples: [
    "Quand doit-il revenir ?", "Son prochain rendez-vous est prévu quand ?", "On le revoit à quelle date ?",
    "A-t-il une consultation programmée ?", "La prochaine séance de [X] ?", "Il est reconvoqué pour quand ?",
  ] },
  { id: "patient.documents", label: "documents du dossier d'un patient", target: patient("documents"), examples: [
    "Quels documents a-t-on dans son dossier ?", "Des certificats émis pour lui ?", "Liste ses documents.", "Combien de papiers pour [X] ?",
  ] },
  { id: "patient.scales", label: "scores d'échelles d'évaluation d'un patient", target: patient("scales"), examples: [
    "Il a des résultats de questionnaires standardisés ?", "A-t-il passé un questionnaire d'évaluation ?", "Quels résultats aux tests psychométriques ?",
    "Montre-moi ses échelles et leurs scores.", "Le dernier score d'évaluation de [X] ?",
  ] },
  { id: "patient.diagnoses", label: "diagnostics enregistrés d'un patient", target: patient("diagnoses"), examples: [
    "Quel est son diagnostic ?", "Qu'est-ce qui a été diagnostiqué chez lui ?", "Les diagnostics retenus pour [X] ?",
    "Pour quoi est-il suivi, sur le plan diagnostique ?", "Son diagnostic principal, s'il te plaît.",
  ] },
  { id: "patient.identity", label: "identité ou profil administratif d'un patient", target: patient("identity"), examples: [
    "C'est qui ce patient ?", "Je suis avec qui, là ?", "Son profil, s'il te plaît.", "Quel âge a-t-il et où habite-t-il ?",
    "Ses coordonnées ?", "Il est né en quelle année ?", "Rappelle-moi l'identité de la personne en face.",
  ] },
  { id: "agenda.count", label: "nombre de rendez-vous sur une période", target: agenda("count"), examples: [
    "Combien de patients aujourd'hui ?", "J'ai combien de rendez-vous demain ?", "Il y a du monde cette semaine ?",
    "Ça fait combien de rendez-vous ce mois-ci ?", "Demain, combien de personnes à recevoir ?", "Mon nombre de consultations prévues jeudi ?",
    "La journée de demain est chargée ?", "Combien de créneaux occupés lundi ?",
  ] },
  { id: "agenda.list", label: "liste des rendez-vous sur une période", target: agenda("list"), examples: [
    "Qui je vois aujourd'hui ?", "Montre-moi le planning de demain.", "Mes rendez-vous de la semaine ?", "Qui est prévu mercredi ?",
    "Le programme de la journée, s'il te plaît.", "Quels patients viennent vendredi ?", "Affiche l'agenda de lundi prochain.",
    "Qui était au programme hier ?",
  ] },
  { id: "agenda.cancelled", label: "rendez-vous annulés sur une période", target: agenda("cancelled"), examples: [
    "Quels rendez-vous ont été annulés cette semaine ?", "Qui a annulé aujourd'hui ?", "Qui a décommandé depuis le début du mois ?",
    "Des désistements hier ?", "Qui s'est décommandé la semaine dernière ?",
  ] },
  { id: "agenda.next", label: "prochain rendez-vous du cabinet", target: agenda("next"), examples: [
    "C'est qui mon prochain patient ?", "À quelle heure est mon prochain rendez-vous ?", "Qui vient après ?", "Le patient suivant, c'est qui ?",
  ] },
  { id: "agenda.first", label: "premier rendez-vous d'une journée", target: agenda("first"), examples: [
    "Qui est mon premier patient aujourd'hui ?", "À quelle heure je commence demain ?", "Le premier rendez-vous de jeudi ?",
    "Qui ouvre ma journée ?",
  ] },
  { id: "agenda.last", label: "dernier rendez-vous d'une journée", target: agenda("last"), examples: [
    "Qui est mon dernier patient ce soir ?", "Le dernier rendez-vous de demain ?", "Ma journée se termine à quelle heure ?",
    "Qui termine la journée de vendredi ?",
  ] },
  { id: "agenda.free", label: "disponibilité ou créneau libre", target: agenda("free"), examples: [
    "Suis-je libre demain matin ?", "J'ai un créneau disponible jeudi ?", "Il me reste de la place cet après-midi ?",
  ] },
  { id: "agenda.pastcount", label: "nombre de consultations déjà faites sur une période", target: agenda("pastcount"), examples: [
    "Combien de consultations ont eu lieu hier ?", "Combien de séances terminées la semaine dernière ?", "Le nombre de consultations faites le mois dernier ?",
  ] },
  { id: "finance.revenue", label: "recettes encaissées sur une période", target: { family: "finance", measure: "revenue" }, examples: [
    "Combien avons-nous encaissé ce mois-ci ?", "Les recettes de la semaine ?", "Qu'est-ce qu'on a gagné hier ?",
    "Le chiffre d'affaires de septembre ?", "Combien d'argent est rentré aujourd'hui ?", "Ce que le cabinet a rapporté cette année ?",
  ] },
  { id: "finance.expenses", label: "dépenses ou charges sur une période", target: { family: "finance", measure: "expenses" }, examples: [
    "Nos dépenses du mois ?", "Combien de charges ce mois-ci ?", "Qu'est-ce qu'on a dépensé en août ?", "Le total des frais du cabinet ?",
  ] },
  { id: "finance.net", label: "résultat net ou bénéfice sur une période", target: { family: "finance", measure: "net" }, examples: [
    "Après déduction des charges, on gagne combien ce mois ?", "Quel bénéfice en septembre ?", "Combien il nous reste une fois les charges payées ce mois ?",
  ] },
  { id: "finance.outstanding", label: "montants restant à encaisser", target: { family: "finance", measure: "outstanding" }, examples: [
    "Quelles sommes nous sont encore dues ?", "Les impayés du cabinet ?", "Le montant que les patients nous doivent encore ?",
  ] },
  { id: "activity", label: "statistiques d'activité du cabinet", target: { family: "activity" }, examples: [
    "Combien de patients différents ce mois-ci ?", "Combien de nouveaux dossiers cette année ?", "Les statistiques d'activité du mois ?",
    "Quel jour de la semaine est le plus chargé ?", "Combien de patients suivis actuellement ?", "L'activité du cabinet le mois dernier ?",
  ] },
];
