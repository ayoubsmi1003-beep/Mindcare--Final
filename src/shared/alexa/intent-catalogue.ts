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
    "Fais le tour de son dossier.", "Qu'est-ce qui ressort de son suivi ?", "Les grandes lignes de son dossier ?",
    "Je ne connais pas ce dossier, résume-le-moi.", "Un récapitulatif sur [X], s'il te plaît.", "En bref, c'est quoi son parcours de soins ?",
  ] },
  { id: "patient.history", label: "liste ou historique des consultations d'un patient", target: patient("history"), examples: [
    "Liste toutes ses consultations.", "Je veux voir le parcours de [X] chez nous.", "Son historique de suivi depuis le départ.",
    "Montre-moi toutes ses visites, de la plus ancienne à la plus récente.", "Le fil de ses séances, s'il te plaît.",
    "Retrace son suivi au cabinet.", "Quelles consultations a eues [X] ?", "Déroule-moi ses passages successifs.",
    "Toutes ses séances, du début à aujourd'hui.", "Énumère les consultations de [X].", "La liste complète de ses rendez-vous passés.",
    "Ses consultations successives, avec les dates.", "Je veux l'historique complet de ses venues.", "Chaque fois qu'il est venu, liste-les-moi.",
  ] },
  { id: "patient.treatments", label: "traitement en cours d'un patient (médicaments, dose, rythme, début)", target: patient("treatments"), examples: [
    "Qu'est-ce qu'il prend comme médicaments ?", "Quels sont ses traitements en ce moment ?", "Sous quoi est [X] actuellement ?",
    "Il est sous quel traitement ?", "Rappelle-moi ses prescriptions en cours.", "Quelle est sa posologie actuelle ?",
    "Il prend quoi le matin et le soir ?", "Ses médicaments du moment ?", "Quelle dose prend-il aujourd'hui ?",
    "Il a quoi comme ordonnance en cours ?", "Depuis quand il prend son traitement actuel ?", "Quels comprimés lui a-t-on prescrits ?",
    "Ses molécules actuelles et leurs doses ?", "Qu'est-ce qui figure sur son ordonnance en ce moment ?", "Quel antidépresseur prend-il en ce moment ?",
    "Le traitement de fond de [X] ?",
  ] },
  { id: "patient.treatchanges", label: "modifications passées du traitement d'un patient", target: patient("treatchanges"), examples: [
    "Son traitement a-t-il été modifié ?", "Il était sous quoi auparavant ?", "Quels changements de dose depuis le début ?",
    "La posologie a-t-elle évolué ?", "Historique des modifications de son traitement.", "On a augmenté sa dose à un moment ?",
    "Quelle était sa dose de départ ?", "A-t-on arrêté ou remplacé un de ses médicaments ?",
    "Ses traitements antérieurs ?", "Quels médicaments a-t-il essayés avant celui-ci ?", "Le traitement de [X] a changé quand ?",
    "Quand a-t-on modifié sa posologie ?", "L'évolution de ses prescriptions depuis le début.", "Il a déjà pris autre chose avant ?",
  ] },
  { id: "patient.count", label: "nombre de consultations d'un patient", target: patient("count"), examples: [
    "Le nombre de ses passages chez nous ?", "Il a fait combien de séances chez nous ?", "Le nombre total de ses consultations ?",
    "On l'a reçu combien de fois au total ?", "Ça fait combien de rendez-vous honorés pour [X] ?", "Combien de passages au cabinet pour lui ?",
    "A-t-il déjà consulté ici ?", "Combien de consultations terminées dans son dossier ?",
    "Combien de rendez-vous a-t-il honorés jusqu'ici ?", "Le total de ses venues au cabinet ?", "Il est venu souvent ou pas ?",
    "Combien de fois l'a-t-on reçue depuis le premier jour ?", "Le compteur de ses consultations ?",
  ] },
  { id: "patient.lastdate", label: "date de la dernière consultation d'un patient", target: patient("lastdate"), examples: [
    "De quand date sa dernière consultation ?", "Sa dernière séance a eu lieu quel jour ?", "On l'a vu quand en dernier ?",
    "Ça remonte à quand, sa dernière visite ?", "C'était quel jour, son dernier passage ?", "Dernier rendez-vous honoré de [X] ?",
    "Sa visite la plus récente remonte à quel jour ?", "À quelle date l'ai-je reçu récemment ?",
    "Il n'est pas venu depuis quand ?", "Depuis sa dernière visite, combien de temps s'est écoulé ?", "Date du dernier passage de [X] ?",
    "Ça fait longtemps qu'on ne l'a pas vu ?",
  ] },
  { id: "patient.firstdate", label: "date de la première consultation d'un patient", target: patient("firstdate"), examples: [
    "Depuis quand le suit-on ?", "Quelle est la date de sa première consultation ?", "Il a commencé chez nous quand ?",
    "Sa toute première venue, c'était quand ?", "Le début de sa prise en charge ?", "Depuis combien de temps est-il suivi ici ?",
    "Quand [X] est-il arrivé au cabinet ?", "Date d'ouverture de son suivi ?",
    "À partir de quand le cabinet le prend-il en charge ?", "Quand l'avons-nous reçu pour la première fois ?", "Son premier rendez-vous au cabinet remonte à quand ?",
    "Depuis combien d'années vient-il ?",
  ] },
  { id: "patient.lastnote", label: "contenu de la dernière note de consultation d'un patient", target: patient("lastnote"), examples: [
    "Mes notes de la fois précédente ?", "Relis-moi ma note de la séance précédente.", "Le compte rendu de son dernier passage.",
    "Ce qui s'est dit lors de la dernière consultation ?", "Affiche la note la plus récente de [X].", "Les observations de la dernière séance.",
    "Qu'avait-on décidé la dernière fois ?", "Le contenu de mon dernier entretien avec lui.",
    "Que dit ma note de la dernière fois ?", "Lis-moi le dernier compte rendu.", "Ce que j'ai consigné à son dernier rendez-vous ?",
    "Les notes de sa dernière consultation, s'il te plaît.", "La dernière observation clinique écrite pour lui ?", "Qu'est-ce qui a été dit à la séance d'avant ?",
  ] },
  { id: "patient.prev", label: "les dernières consultations d'un patient, avec leurs dates", target: patient("prev"), examples: [
    "Ses trois passages les plus récents ?", "Montre-moi ses dernières séances.", "Les dates de ses deux derniers passages.",
    "Quelles étaient ses visites récentes ?", "Liste ses quatre dernières venues.",
    "Ses consultations les plus récentes, avec les dates ?", "Les trois derniers rendez-vous de [X] ?", "Ses dernières venues au cabinet ?",
    "Les deux dernières fois qu'il est venu, c'était quand ?", "Montre ses six dernières séances.",
  ] },
  { id: "patient.nextappt", label: "prochain rendez-vous d'un patient", target: patient("nextappt"), examples: [
    "Quand doit-il revenir ?", "Son prochain rendez-vous est prévu quand ?", "On le revoit à quelle date ?",
    "A-t-il une consultation programmée ?", "La prochaine séance de [X] ?", "Il est reconvoqué pour quand ?",
    "Son retour au cabinet est prévu pour quand ?", "Sa prochaine venue est fixée à quand ?", "A-t-on déjà programmé son retour ?",
    "Quand est-ce qu'on le revoit ?", "Le prochain rendez-vous de [X] ?",
  ] },
  { id: "patient.documents", label: "documents du dossier d'un patient", target: patient("documents"), examples: [
    "Quels documents contient son dossier ?", "Des certificats émis pour lui ?", "Liste ses documents.", "Combien de papiers pour [X] ?",
    "Quels papiers a-t-on rédigés pour lui ?", "Ses certificats et ordonnances émis ?", "Les documents établis au nom de [X] ?",
    "Qu'est-ce qu'on lui a déjà délivré comme documents ?", "A-t-il reçu un certificat médical de notre part ?", "La liste des pièces de son dossier.",
  ] },
  { id: "patient.scales", label: "scores d'échelles d'évaluation d'un patient", target: patient("scales"), examples: [
    "Il a des résultats de questionnaires standardisés ?", "A-t-il passé un questionnaire d'évaluation ?", "Quels résultats aux tests psychométriques ?",
    "Montre-moi ses échelles et leurs scores.", "Le dernier score d'évaluation de [X] ?",
    "Ses scores au PHQ-9 ou au GAD-7 ?", "Il a été évalué avec une échelle ?", "Quels questionnaires a-t-il remplis ?",
    "Le dernier résultat d'échelle de [X] ?", "Ses cotations aux échelles cliniques ?",
  ] },
  { id: "patient.diagnoses", label: "diagnostics enregistrés d'un patient", target: patient("diagnoses"), examples: [
    "Quel est son diagnostic ?", "Qu'est-ce qui a été diagnostiqué chez lui ?", "Les diagnostics retenus pour [X] ?",
    "Pour quoi est-il suivi, sur le plan diagnostique ?", "Son diagnostic principal, s'il te plaît.",
    "Quelle pathologie a-t-on retenue pour lui ?", "Le diagnostic posé chez [X] ?", "Il souffre de quoi, d'après son dossier ?",
    "Quels troubles figurent dans son dossier ?", "Ses diagnostics enregistrés ?",
  ] },
  { id: "patient.identity", label: "identité ou profil administratif d'un patient", target: patient("identity"), examples: [
    "De qui s'agit-il ?", "Je suis avec qui, là ?", "Son profil, s'il te plaît.", "Il a quel âge et il habite où ?",
    "Ses coordonnées ?", "Il est né en quelle année ?", "Rappelle-moi l'identité de la personne en face.",
    "Quel est son âge ?", "Son numéro de téléphone ?", "Il habite dans quelle ville ?",
    "Son état civil ?", "Il est marié, il travaille ?", "Ses informations administratives ?",
    "Présente-moi la personne : âge, adresse, profession.",
  ] },
  { id: "agenda.count", label: "nombre de rendez-vous sur une période", target: agenda("count"), examples: [
    "Combien de personnes à voir dans la journée ?", "Demain, j'en ai combien au planning ?", "Beaucoup de consultations prévues cette semaine ?",
    "Le total des rendez-vous programmés ce mois-ci ?", "Demain, combien de personnes à recevoir ?", "Mon nombre de consultations prévues jeudi ?",
    "La journée de demain est chargée ?", "Combien de créneaux occupés lundi ?",
    "Combien de rendez-vous au total la semaine prochaine ?", "Ça fait combien de consultations à assurer demain ?", "Le nombre de patients attendus vendredi ?",
    "Combien de personnes sont inscrites pour lundi ?", "Est-ce que demain est une grosse journée ?", "Combien de consultations au planning de cet après-midi ?",
    "Il y a combien de rendez-vous de prévus mardi ?",
  ] },
  { id: "agenda.list", label: "liste des rendez-vous sur une période", target: agenda("list"), examples: [
    "Les patients du jour, s'il te plaît.", "Montre-moi le planning de demain.", "Mes rendez-vous de la semaine ?", "Qui est prévu mercredi ?",
    "Le programme de la journée, s'il te plaît.", "Quels patients viennent vendredi ?", "Affiche l'agenda de lundi prochain.",
    "Qui était au programme hier ?",
    "Quels rendez-vous ai-je demain ?", "Donne-moi la liste des patients de jeudi.", "Qui vient me voir cet après-midi ?",
    "Les noms des patients prévus vendredi ?", "Mon agenda de la semaine prochaine ?", "Avec qui ai-je rendez-vous lundi ?",
    "Qui j'ai vu avant-hier ?",
  ] },
  { id: "agenda.cancelled", label: "rendez-vous annulés sur une période", target: agenda("cancelled"), examples: [
    "Quels rendez-vous ont été annulés cette semaine ?", "Qui a annulé aujourd'hui ?", "Qui a décommandé depuis le début du mois ?",
    "Des désistements hier ?", "Qui s'est décommandé la semaine dernière ?",
    "Des rendez-vous décommandés la semaine passée ?", "Des rendez-vous tombés à l'eau aujourd'hui ?", "Quels patients se sont désistés ce mois-ci ?",
    "Y a-t-il des rendez-vous annulés pour demain ?",
  ] },
  { id: "agenda.next", label: "prochain rendez-vous du cabinet", target: agenda("next"), examples: [
    "C'est qui mon prochain patient ?", "Mon rendez-vous suivant est à quelle heure ?", "Qui vient après ?", "Le patient suivant, c'est qui ?",
    "Mon rendez-vous suivant ?", "Qui dois-je recevoir maintenant ?", "Le prochain sur la liste ?",
    "Quelle est ma prochaine consultation ?", "Qui passe ensuite ?",
  ] },
  { id: "agenda.first", label: "premier rendez-vous d'une journée", target: agenda("first"), examples: [
    "Par quel patient débute ma matinée ?", "À quelle heure je commence demain ?", "Le premier rendez-vous de jeudi ?",
    "Qui ouvre ma journée ?",
    "Par qui je commence la journée ?", "Ma première consultation de demain ?", "Qui est le premier sur le planning de lundi ?",
    "À quelle heure est mon premier rendez-vous vendredi ?", "Je démarre à quelle heure ce matin ?",
  ] },
  { id: "agenda.last", label: "dernier rendez-vous d'une journée", target: agenda("last"), examples: [
    "Qui est mon dernier patient ce soir ?", "Le dernier rendez-vous de demain ?", "Ma journée se termine à quelle heure ?",
    "Qui termine la journée de vendredi ?",
    "Demain soir, qui est mon dernier rendez-vous ?", "Qui clôture ma journée ?", "À quelle heure se termine ma dernière consultation jeudi ?",
    "Qui est le dernier sur la liste de vendredi ?", "Quand est-ce que je termine demain ?",
  ] },
  { id: "agenda.free", label: "disponibilité ou créneau libre", target: agenda("free"), examples: [
    "Ma matinée de demain est-elle libre ?", "J'ai un créneau disponible jeudi ?", "Il me reste de la place cet après-midi ?",
    "Des trous dans mon planning de mercredi ?", "Un créneau de libre cette semaine ?", "Mon après-midi de jeudi est-il libre ?",
    "Il reste des disponibilités lundi matin ?", "Quand suis-je disponible demain ?",
  ] },
  { id: "agenda.pastcount", label: "nombre de consultations déjà faites sur une période", target: agenda("pastcount"), examples: [
    "Combien de consultations ont eu lieu hier ?", "Combien de séances terminées la semaine dernière ?", "Le nombre de consultations faites le mois dernier ?",
    "Combien de consultations se sont tenues mardi ?", "Combien de consultations ai-je assurées la semaine passée ?", "Le nombre de séances réalisées ce mois-ci jusqu'à présent ?",
    "Combien de rendez-vous ont été honorés lundi ?", "Combien de personnes ai-je reçues avant-hier ?",
  ] },
  { id: "finance.revenue", label: "recettes encaissées sur une période", target: { family: "finance", measure: "revenue" }, examples: [
    "Combien avons-nous encaissé ce mois-ci ?", "Ce que la semaine a rapporté ?", "Qu'est-ce qu'on a gagné hier ?",
    "Le chiffre d'affaires de septembre ?", "L'argent encaissé depuis ce matin ?", "Ce que le cabinet a rapporté cette année ?",
    "Le total des paiements reçus ce mois-ci ?", "Les entrées d'argent d'hier ?", "Combien les consultations ont rapporté en août ?",
    "Ce qu'on a touché aujourd'hui ?", "Le montant encaissé depuis le début de l'année ?", "Nos recettes du trimestre ?",
  ] },
  { id: "finance.expenses", label: "dépenses ou charges sur une période", target: { family: "finance", measure: "expenses" }, examples: [
    "Nos dépenses du mois ?", "Le montant des charges pour ce mois ?", "Qu'est-ce qu'on a dépensé en août ?", "Le total des frais du cabinet ?",
    "Combien avons-nous payé en frais ce mois-ci ?", "Combien de frais réglés la semaine passée ?", "Ce qui est sorti de la caisse en juillet ?",
    "Le total des charges depuis janvier ?", "Combien coûte le fonctionnement du cabinet ce mois ?", "Nos frais du trimestre ?",
  ] },
  { id: "finance.net", label: "résultat net ou bénéfice sur une période", target: { family: "finance", measure: "net" }, examples: [
    "Après déduction des charges, on gagne combien ce mois ?", "Quel bénéfice en septembre ?", "Combien il nous reste une fois les charges payées ce mois ?",
    "Ce qu'il nous reste une fois les dépenses déduites en août ?", "Le gain net sur douze mois ?", "Est-on bénéficiaire ce mois-ci ?",
    "La rentabilité du cabinet sur le trimestre ?", "Le solde entre encaissements et dépenses cette semaine ?", "Une fois les frais payés, que gagne le cabinet cette année ?",
  ] },
  { id: "finance.outstanding", label: "montants restant à encaisser", target: { family: "finance", measure: "outstanding" }, examples: [
    "Quelles sommes nous sont encore dues ?", "Les impayés du cabinet ?", "Le montant que les patients nous doivent encore ?",
    "Combien de consultations restent impayées ?", "Le reste à recouvrer ?", "Quels montants sont en attente de paiement ?",
    "Les dettes des patients envers le cabinet ?", "Combien d'argent n'a pas encore été réglé ?", "Les soldes non payés ?",
  ] },
  { id: "activity", label: "statistiques d'activité du cabinet", target: { family: "activity" }, examples: [
    "Le nombre de patients distincts sur le mois ?", "Combien de nouveaux dossiers cette année ?", "Les statistiques d'activité du mois ?",
    "Mon jour le plus rempli de la semaine ?", "Combien de patients suivis actuellement ?", "L'activité du cabinet le mois dernier ?",
    "Combien de patients avons-nous suivis cette année ?", "Le nombre de nouveaux patients ce mois ?", "Le jour où je reçois le plus de monde ?",
    "Comment évolue l'activité depuis janvier ?", "Combien de patients différents ont consulté la semaine dernière ?", "Les indicateurs d'activité du trimestre ?",
    "Combien de premières consultations cette année ?",
  ] },
];
