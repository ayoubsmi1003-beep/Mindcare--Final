/**
 * C270 · domain "book": 80 medical-knowledge turns in French, on topics used by none of C200, C201 or C202 (doc 19).
 * No question names a book: the doctor never does, and the answer may come from any approved book.
 * Each question was written after reading the approved passage that answers it (DSM-5 fr, Maudsley, Stahl) in the evaluation
 * database. The decisive words of that passage are the `facts` (folded: no accents, lower case, one kind of apostrophe).
 *
 * PASS needs a displayed passage that (1) is word for word part of an approved chunk, (2) whose chunk holds ALL the facts,
 * (3) whose displayed text itself holds ALL the facts, (4) with the right page. Finding a passage and not showing it fails;
 * showing a passage that only mentions the subject fails.
 * One conversation (myocarditis under clozapine) is counted turn by turn: its follow-up is one of the 80.
 */
import { c, t } from "./helpers.mjs";

const D = "book";
const G = { type: "global" };
const F = "fr";
const ex = (facts) => ({ k: "book", alts: [{ textAll: facts }], quoteFacts: facts, intent: "knowledge", requiredTools: ["search_knowledge"] });
const b = (id, form, say, ...facts) => c(id, D, "main", G, [t(say, ex(facts), [F, form])]);

export const cases = [
  // ── DSM-5, French (30) ─────────────────────────────────────────────────────────────
  b("L001", "direct", "Combien de temps doivent durer les idées délirantes pour parler de trouble délirant ?", "idees delirantes pendant une duree de 1 mois ou plus"),
  b("L002", "conversational", "Tu peux me rappeler ce qui définit un trouble schizoaffectif ?", "periode ininterrompue de maladie", "episode thymique caracterise"),
  b("L003", "formal", "Quelle durée retient-on pour poser un trouble psychotique bref ?", "au moins un jour mais moins d'un mois"),
  b("L004", "informal", "Le schizophréniforme, ça dure combien de temps au max ?", "au moins un mois mais moins de 6 mois"),
  b("L005", "direct", "Qu'appelle-t-on un trouble factice ?", "falsification de signes ou de symptomes"),
  b("L006", "short", "Critères du trouble de conversion", "alteration de la motricite volontaire ou des fonctions sensorielles"),
  b("L007", "synonym", "Sur quelle période doivent s'étendre les oscillations de l'humeur pour retenir une cyclothymie ?", "pendant au moins 2 ans"),
  b("L008", "direct", "Comment le trouble cauchemars est-il défini ?", "reves prolonges, extremement dysphoriques"),
  b("L009", "conversational", "À partir de quand on parle vraiment d'insomnie, d'un point de vue diagnostique ?", "insatisfaction liee a la quantite ou a la qualite du sommeil"),
  b("L010", "direct", "Quels signes faut-il pour un syndrome des jambes sans repos ?", "besoin pressant de bouger les jambes"),
  b("L011", "formal", "Comment se présente une personnalité obsessionnelle-compulsive ?", "le perfectionnisme et le controle mental et interpersonnel"),
  b("L012", "direct", "Combien de symptômes sont exigés pour un trouble dysphorique prémenstruel ?", "au moins cinq des symptomes suivants"),
  b("L013", "synonym", "Qu'est-ce qui caractérise les crises de boulimie sans comportement compensatoire, les accès hyperphagiques ?", "crises de gloutonnerie"),
  b("L014", "informal", "C'est quoi exactement le pica ?", "substances non nutritives et non comestibles"),
  b("L015", "direct", "Quels critères pour un trouble explosif intermittent ?", "incapacite a resister a des impulsions agressives"),
  b("L016", "conversational", "Chez un enfant, comment je reconnais un trouble oppositionnel avec provocation ?", "esprit vindicatif", "pendant au moins 6 mois"),
  b("L017", "direct", "Comment définit-on l'amnésie dissociative ?", "informations autobiographiques importantes"),
  b("L018", "formal", "Que recouvre le trouble de dépersonnalisation-déréalisation ?", "experiences prolongees ou recurrentes de depersonnalisation"),
  b("L019", "direct", "Sur quoi repose le diagnostic de trouble dissociatif de l'identité ?", "deux ou plusieurs etats de personnalite distincts"),
  b("L020", "typo", "criteres de l'enuresie chez l'enfant", "mictions repetees au lit ou dans les vetements"),
  b("L021", "conversational", "Le trouble stress aigu, il se situe dans quelle fenêtre de temps après le traumatisme ?", "de 3 jours a 1 mois apres l'exposition au traumatisme"),
  b("L022", "direct", "Quand peut-on parler de sevrage du cannabis ?", "massif et prolonge"),
  b("L023", "synonym", "Le jeu d'argent devient pathologique à partir de quand ?", "pratique inadaptee, persistante et repetee du jeu d'argent"),
  b("L024", "direct", "Comment s'installe un trouble neurocognitif à corps de Lewy ?", "debut insidieux et une progression graduelle", "corps de lewy"),
  b("L025", "formal", "Quelles formes cliniques distingue-t-on dans le trouble neurocognitif frontotemporal ?", "variante comportementale"),
  b("L026", "short", "Gilles de la Tourette : critères ?", "tics moteurs multiples"),
  b("L027", "conversational", "Une patiente obsédée par un défaut de son visage que personne ne voit, ça correspond à quel trouble et quels critères ?", "imperfections ou defauts percus dans son apparence physique"),
  b("L028", "direct", "À quelle fréquence la somnolence doit-elle survenir pour parler d'hypersomnolence ?", "au moins 3 fois par semaine, pendant au moins 3 mois"),
  b("L029", "direct", "Qu'est-ce que le mérycisme ?", "regurgitation repetee de la nourriture"),
  b("L030", "typo", "encopresie criteres diagnostic", "emissions fecales repetees"),

  // ── Stahl, English (25) ────────────────────────────────────────────────────────────
  b("L031", "conversational", "Si un patient sous trazodone a une érection qui ne passe pas, qu'est-ce qu'il faut faire ?", "prolonged penile erection", "permanent erectile dysfunction"),
  b("L032", "direct", "Quel bilan hépatique prévoir avant l'agomélatine ?", "liver function tests before initiation of treatment"),
  b("L033", "conversational", "Combien de temps faut-il attendre pour que la buspirone fasse effet sur l'anxiété ?", "takes 4 weeks for results"),
  b("L034", "direct", "Quelle est la demi-vie de la cariprazine ?", "half-life for cariprazine is 2", "long-lasting active metabolites"),
  b("L035", "formal", "Au-delà de quelle posologie le citalopram expose-t-il à un risque cardiaque ?", "doses greater than 40 mg/day"),
  b("L036", "direct", "Quel est le risque de convulsions avec la clomipramine à forte dose ?", "7/1000 incidence of seizures"),
  b("L037", "short", "Donépézil, dose de départ ?", "initial 5 mg/day"),
  b("L038", "direct", "Peut-on donner de la duloxétine en cas d'insuffisance hépatique ?", "not to be administered to patients with any hepatic insufficiency"),
  b("L039", "conversational", "Après une séance d'eskétamine en spray, on surveille le patient combien de temps ?", "monitoring for at least 2 hours"),
  b("L040", "direct", "Comment agit le lemborexant ?", "binds to orexin 1 and orexin 2 receptors"),
  b("L041", "synonym", "La guanfacine, on l'utilise dans quelle indication chez l'enfant ?", "nonstimulant for adhd"),
  b("L042", "conversational", "En dehors du TDAH, la lisdexamfétamine est prescrite pour quoi ?", "binge eating disorder"),
  b("L043", "direct", "Faut-il surveiller le sodium sous oxcarbazépine ?", "monitoring sodium levels", "first 3 months"),
  b("L044", "informal", "Sous phénelzine, il y a un régime à suivre, c'est ça ?", "low-tyramine diet"),
  b("L045", "direct", "Dans quelle situation prescrit-on la pimavansérine ?", "parkinson's disease psychosis"),
  b("L046", "conversational", "À quoi peut servir la prazosine chez un patient psychiatrique ?", "nightmares associated with ptsd"),
  b("L047", "direct", "Le propranolol a-t-il une place contre l'akathisie ?", "akathisia (antipsychotic induced)"),
  b("L048", "informal", "Le topiramate, ça fait grossir ou maigrir ?", "weight loss"),
  b("L049", "direct", "Que se passe-t-il quand on arrête la valbénazine ?", "tardive dyskinesia symptoms returned"),
  b("L050", "formal", "Quel est le mécanisme d'action du disulfirame ?", "irreversibly inhibits aldehyde dehydrogenase"),
  b("L051", "direct", "Quelle dose d'acamprosate en cas d'insuffisance rénale ?", "333 mg three times daily", "contraindicated in severe impairment"),
  b("L052", "direct", "Quelles sont les indications de l'oxybate de sodium ?", "cataplexy in patients with narcolepsy"),
  b("L053", "conversational", "Pourquoi l'amisulpride fait-il monter la prolactine ?", "dopamine 2 receptors in the pituitary"),
  b("L054", "direct", "Comment fonctionne le pitolisant ?", "histamine 3 antagonist/inverse agonist"),
  b("L055", "formal", "La tianeptine expose-t-elle à un risque d'abus ?", "abuse and dependence may occur"),

  // ── Maudsley, English (25, of which one two-turn conversation) ─────────────────────
  c("L056", D, "main", G, [
    t("Qu'est-ce que la myocardite sous clozapine ?", ex(["hypersensitivity response to clozapine"]), [F, "direct"]),
    t("Et pendant combien de temps faut-il la surveiller ?", ex(["first 2 months"]), [F, "followup"]),
  ]),
  b("L057", "direct", "Pourquoi les antipsychotiques font-ils monter la prolactine ?", "dopamine inhibits prolactin release"),
  b("L058", "conversational", "Une hyperprolactinémie mal tolérée sous antipsychotique, quelles options de traitement ?", "dopamine agonists or metformin"),
  b("L059", "direct", "Pour prévenir une encéphalopathie de Wernicke, quelle voie d'administration de la thiamine privilégier ?", "parenteral thiamine"),
  b("L060", "synonym", "La thiamine en intramusculaire est-elle moins risquée que par voie veineuse ?", "lower incidence of anaphylactic reactions"),
  b("L061", "direct", "Quand le sevrage de la méthadone atteint-il son pic ?", "between 4 and 6 days"),
  b("L062", "conversational", "Si un patient sous fluvoxamine arrête de fumer, qu'est-ce qui change ?", "decreased by around a third"),
  b("L063", "direct", "Une mère sous clozapine peut-elle allaiter ?", "advised against breastfeeding"),
  b("L064", "formal", "Quel traitement privilégier pour une manie aiguë pendant la grossesse ?", "use an antipsychotic"),
  b("L065", "informal", "Le café, ça joue sur les attaques de panique ?", "caffeine is avoided"),
  b("L066", "direct", "Pourquoi le sevrage du GHB est-il dangereux ?", "life-threatening"),
  b("L067", "direct", "Les cannabinoïdes de synthèse sont-ils plus dangereux que le cannabis ?", "30 times higher"),
  b("L068", "formal", "L'acétate de zuclopenthixol est-il un agent de tranquillisation rapide ?", "not a rapidly tranquillising agent"),
  b("L069", "conversational", "Un premier épisode psychotique, ça vaut le coup de passer tôt à un injectable retard ?", "relapse and readmission rates are vastly reduced"),
  b("L070", "direct", "Dans une démence frontotemporale avec troubles du comportement, la trazodone peut-elle aider ?", "frontotemporal dementia", "trazodone"),
  b("L071", "direct", "Quel risque particulier avec l'halopéridol chez un patient dément ?", "increased risk of stroke in patients with dementia"),
  b("L072", "synonym", "L'asénapine élève-t-elle la prolactine ?", "does not appear to significantly affect prolactin"),
  b("L073", "direct", "Existe-t-il une forme injectable prolongée de la naltrexone ?", "long-acting injectable naltrexone"),
  b("L074", "conversational", "Quels effets psychiatriques peut donner l'éfavirenz ?", "abnormal dreams"),
  b("L075", "direct", "Quand on passe d'un inhibiteur de la cholinestérase oral au patch de rivastigmine, faut-il une fenêtre thérapeutique ?", "1 week washout"),
  b("L076", "formal", "La buprénorphine retient-elle aussi bien les patients en traitement que la méthadone ?", "lower likelihood retention in treatment than methadone"),
  b("L077", "direct", "Quelle proportion de patients sous théophylline présente des effets neurologiques ?", "50% of patients on theophylline"),
  b("L078", "conversational", "Dans la microdélétion 22q11.2, la clozapine marche-t-elle à faible dose ?", "median of 200mg/day"),
  b("L079", "conversational", "Si un médicament est contre-indiqué pendant l'allaitement, faut-il pour autant arrêter le traitement de la mère ?", "treatment of maternal mental illness is the priority"),
];
