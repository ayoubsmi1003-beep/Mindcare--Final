/**
 * `lexique-multilingue.ts` — DES DONNÉES, ET RIEN QUE DES DONNÉES.
 *
 * ═══ POURQUOI CE FICHIER NE CONTIENT AUCUNE FONCTION ═══
 * `routing.ts` est gelé et doit le rester : c'est la seule frontière qui décide
 * avant tout appel de modèle. Le rendre multilingue en y ajoutant des motifs
 * arabes reviendrait à faire grossir, langue après langue, le dictionnaire de
 * regex que ce dépôt paie déjà en français (voir les ajouts datés du
 * 2026-08-26 et du 2026-09-03, chacun trouvé en production, aucun à la
 * relecture).
 *
 * On prend l'autre chemin : une TABLE FERMÉE qui ramène un mot étranger — ou un
 * mot français déformé par la transcription — vers le mot français que la
 * frontière connaît déjà. Une entrée par CONCEPT, pas une par formulation.
 * Ajouter une langue, c'est ajouter des lignes ici ; ce n'est jamais toucher à
 * une règle de décision.
 *
 * ═══ LA DISCIPLINE QUI REND CETTE TABLE SÛRE ═══
 *
 *   1. AUCUNE ENTRÉE FRANÇAIS → FRANÇAIS QUI CHANGE LE SENS. Les seules
 *      entrées latines admises sont des RÉPARATIONS : une forme déformée vers
 *      sa forme correcte (`medicamens` → `medicaments`). Un mot français bien
 *      écrit traverse INCHANGÉ, donc une phrase française est son propre
 *      canonique, donc le corpus français ne peut pas changer de verdict.
 *
 *   2. AUCUN DÉTERMINANT, AUCUN MOT OUTIL n'est réécrit. `DEICTIQUES` de
 *      `routing.ts` distingue « le patient » (individu désigné) de « un
 *      patient » (classe de personnes) : une table qui normaliserait « un » en
 *      « le » transformerait « faut-il augmenter la dose quand un patient ne
 *      répond pas ? » — une question de SAVOIR — en refus. Ce piège est réel,
 *      il est dans le corpus d'évaluation (famille A), et c'est lui qui borne
 *      ce fichier.
 *
 *   3. LES CANONIQUES NE SE TERMINENT JAMAIS PAR UNE PRÉPOSITION.
 *      `NOM_PROPRE_COMPLEMENT` s'amorce sur `à|pour|chez|de|avec|sur` suivi
 *      d'une majuscule. Un canonique finissant par « pour » placerait une
 *      amorce devant le mot suivant — qui n'a pas été traduit et garde donc sa
 *      majuscule d'origine. On fabriquerait un individu désigné qui n'est pas
 *      dans la phrase.
 *
 * ═══ CE QUE CE FICHIER NE FAIT PAS ═══
 * Il ne lit aucune base, ne connaît aucun nom de patient, ne décide d'aucune
 * autorisation, n'appelle aucun modèle. Il n'a aucun import — comme
 * `routing.ts`, et pour la même raison : une frontière qu'on ne peut pas
 * compiler seule est une frontière qu'on ne peut pas éprouver hors ligne.
 */

/**
 * Une entrée du lexique.
 *
 * `formes` s'écrit NATURELLEMENT (accents français, orthographe arabe pleine) :
 * `normalisation.ts` applique la même normalisation Unicode aux formes qu'à la
 * demande, au chargement du module. Écrire les formes déjà repliées à la main
 * serait une source de désaccord silencieux entre la table et le normaliseur.
 *
 * `canonique` est du FRANÇAIS, en minuscules, tel que `classer()` le lit.
 */
export interface EntreeLexique {
  readonly formes: readonly string[];
  readonly canonique: string;
}

/**
 * Une forme peut compter plusieurs mots (« who do i have », « شكون جاي ») : la
 * recherche essaie les n-grammes du plus long au plus court. Trois mots
 * suffisent aux tournures interrogatives des quatre langues visées, et bornent
 * le coût de la recherche.
 */
export const LONGUEUR_MAX_NGRAMME = 3;

/**
 * ═══ 1 · INTERROGATIFS ET TOURNURES DE JOURNÉE ═══
 * Ce qui rend une question OPÉRATIONNELLE aux yeux de `routing.ts` : « ai-je »
 * + une borne de journée, « qui » + « prochain patient ».
 */
const INTERROGATIF: readonly EntreeLexique[] = [
  { formes: ["شكون", "شكون هو", "chkoun", "chkon", "chkoune", "who"], canonique: "qui" },
  { formes: ["شنو", "chnou", "chno", "what"], canonique: "quel" },
  { formes: ["ما هي", "ماهي", "what are"], canonique: "quels sont" },
  {
    formes: ["شحال", "قداش", "قداه", "chhal", "ch7al", "gaddach", "9addach", "how much", "how many"],
    canonique: "combien",
  },

  // « عندي » / « do i have » portent le POSSESSIF de première personne, seul
  // signal que `routing.ts` accepte pour une tournure de journée : « qu'ai-je
  // demain » interroge l'agenda, « que se passe-t-il demain » non.
  { formes: ["عندي", "3andi", "andi", "do i have", "have i got"], canonique: "ai-je" },
  { formes: ["شكون عندي", "who do i have"], canonique: "qui ai-je" },
];

/**
 * ═══ 1ter · IMPÉRATIFS ET LIAISON — LE PARLER MIXTE DU CABINET ═══
 *
 * ⚠️ AJOUTÉ LE 2026-09-08 APRÈS UNE EXPÉRIENCE CONTRÔLÉE, PAS PAR ANTICIPATION.
 * La praticienne ne parle pas une langue à la fois. Mesuré au navigateur, en
 * alternance dans la même fenêtre pour écarter une panne de fournisseur :
 *
 *     « وريني dossier تاع Mahmoud Saidi »   →  0 aboutissement sur 3
 *     « Montre-moi le dossier de Mahmoud Saidi. » →  3 sur 3, dossier lu
 *
 * Diagnostic : ces quatre mots-outils étaient ABSENTS de la table. La demande
 * mixte produisait donc ZÉRO marqueur, sa forme canonique était identique au
 * texte brut, et « عطيني les traitements تاع Karim » partait même en
 * `connaissance` là où son équivalent français part en `patient`.
 *
 * ⚠️ ET C'EST CE QUI A RÉORDONNÉ LA CORRECTION. On croyait le défaut situé dans
 * « le modèle reçoit le brut, jamais le canonique ». C'est vrai, mais ce n'était
 * pas la PREMIÈRE couche cassée : tant que la table ignore ces mots, le
 * canonique EST le brut, et lui transmettre le canonique n'aurait rien
 * transmis du tout.
 *
 * ═══ « تاع » → « de » : POURQUOI CE CANONIQUE FINIT PAR UNE PRÉPOSITION ═══
 *
 * ⚠️ LA DISCIPLINE N°3 DE CE FICHIER L'INTERDIT EN PRINCIPE, et l'exception est
 * assumée ici plutôt que dissimulée. Sa crainte : « un canonique finissant par
 * une préposition placerait une amorce devant le mot suivant […] on fabriquerait
 * un individu désigné qui n'est pas dans la phrase ».
 *
 * Ce risque ne se matérialise pas ici, pour une raison de fond : `تاع` EST une
 * préposition dans la langue source. La rendre par « de » ne FABRIQUE aucune
 * amorce — elle TRANSCRIT celle que la praticienne a réellement prononcée. Dans
 * « dossier تاع Mahmoud », le mot qui suit est bien le nom du patient, et c'est
 * exactement ce que `NOM_PROPRE_COMPLEMENT` doit voir.
 *
 * Et quand le mot suivant n'est PAS une personne — « الدوا تاع الصباح » (le
 * médicament du matin) — il reste en écriture arabe : `NOM_PROPRE_COMPLEMENT`
 * s'amorce sur `[A-ZÀ-Þ]`, une MAJUSCULE LATINE, et ne mord pas.
 *
 * Reste le cas résiduel : `تاع` suivi d'un mot latin capitalisé qui ne serait
 * pas un patient. Le verdict deviendrait alors « individu désigné », donc
 * `patient` ou `refus` au lieu de `connaissance` — c'est-à-dire PLUS
 * restrictif. L'union monotone garantit que ce sens-là est le seul possible :
 * cette entrée ne peut pas ouvrir un chemin, seulement en fermer un.
 */
const LIAISON: readonly EntreeLexique[] = [
  { formes: ["وريني", "ورّيني", "وريلي"], canonique: "montre-moi" },
  { formes: ["عطيني", "أعطيني", "اعطيني"], canonique: "donne-moi" },
  { formes: ["تاع", "نتاع", "ديال"], canonique: "de" },
];

/** ═══ 2 · TEMPS ═══ Les bornes de journée du groupe OPÉRATIONNEL. */
const TEMPS: readonly EntreeLexique[] = [
  { formes: ["اليوم", "lyoum", "lioum", "elyoum", "el youm", "today"], canonique: "aujourd'hui" },
  { formes: ["غدا", "غدوا", "بكرا", "ghedwa", "ghadwa", "bekra", "tomorrow"], canonique: "demain" },
  { formes: ["الصباح", "sbah", "essbah", "morning", "this morning"], canonique: "matin" },
  { formes: ["العشية", "l3chiya", "afternoon", "this afternoon"], canonique: "apres-midi" },
  { formes: ["الاسبوع", "this week"], canonique: "semaine" },
];

/** ═══ 3 · AGENDA ═══ */
const AGENDA: readonly EntreeLexique[] = [
  { formes: ["موعد", "مواعيد", "appointment", "appointments"], canonique: "rendez-vous" },
  { formes: ["الاجندة", "اجندة", "البرنامج", "schedule", "my schedule"], canonique: "agenda" },
  { formes: ["الجاي", "جاي", "jay", "jaye", "next"], canonique: "prochain" },

  // Formes composées : elles rendent d'un coup le motif complet
  // `(prochain|suivant)\s+(patient|consultation|rendez-vous)` du groupe
  // OPÉRATIONNEL, que les mots pris isolément ne formeraient pas.
  {
    formes: ["شكون جاي", "شكون الجاي", "chkoun jay", "chkoun eljay", "who is next", "next patient"],
    canonique: "prochain patient",
  },
  { formes: ["قاعة الانتظار", "waiting room"], canonique: "salle d'attente" },
];

/**
 * ═══ 3bis · REFORMULATIONS D'AGENDA EN FRANÇAIS ═══
 *
 * ⚠️ C'EST LA SEULE ENTORSE À LA DISCIPLINE N°1 DE CE FICHIER, ET ELLE EST
 * ÉCRITE ICI PLUTÔT QUE DISSIMULÉE. Ailleurs, aucune entrée français →
 * français ne change le sens ; ce groupe le fait. Voici pourquoi, et ce que ça
 * coûte.
 *
 * MESURÉ le 2026-09-05, en comparant les langues :
 *
 *     « Qui j'ai aujourd'hui ? »        → patient
 *     « Qui ai-je aujourd'hui ? »       → patient
 *     « Qui vient aujourd'hui ? »       → CONNAISSANCE
 *     « Qui arrive aujourd'hui ? »      → CONNAISSANCE
 *     « Qui est prévu aujourd'hui ? »   → CONNAISSANCE
 *     « Qui je vois aujourd'hui ? »     → CONNAISSANCE
 *
 * `OPERATIONNEL` n'accepte la tournure de journée qu'à travers un POSSESSIF
 * (`ai-je`, `j'ai`, `il me reste`). La distinction est délibérée et juste —
 * elle sépare « qu'ai-je demain » de « que se passe-t-il demain » — mais elle
 * laisse dehors les quatre façons les plus naturelles de demander son agenda.
 *
 * ⚠️ ET LE TRAVAIL MULTILINGUE A RENDU CE TROU PIRE, PAS MEILLEUR. Depuis que
 * « who do I have today » et « شكون عندي اليوم » atteignent l'agenda, l'anglais
 * et l'arabe sont MIEUX servis que le français. Un dispositif qui dessert la
 * langue de travail du cabinet pour avoir voulu en servir d'autres est un
 * dispositif qu'on a rendu bancal.
 *
 * POURQUOI ICI ET NON DANS `routing.ts` : ce fichier gelé a déjà été élargi
 * deux fois pour ce motif exact (2026-08-26, 2026-09-03), donc le précédent
 * existe. Mais toute la sûreté de la passe multilingue repose sur le fait
 * qu'il n'a PAS été touché — l'union ne peut qu'ajouter des refus tant que la
 * règle de décision ne bouge pas. On ne dépense pas cet argument-là pour
 * quatre tournures. La réécriture vit donc ici, où le corpus de non-régression
 * la surveille.
 *
 * CE QUE ÇA COÛTE, SANS L'ADOUCIR : la garantie « une phrase française est son
 * propre canonique » devient « … sauf ces quatre tournures ». Elle n'est plus
 * vraie par construction, elle est vraie par TEST — le corpus français rejoué
 * à chaque évaluation. C'est un cran de moins, et il est assumé.
 *
 * Le complément de journée reste EXIGÉ par le fichier gelé : « Qui vient de
 * partir ? » devient « qui ai-je de partir » et reste connaissance, faute de
 * borne de journée. La réécriture ne décide de rien, elle rend seulement la
 * phrase lisible par la règle qui, elle, n'a pas changé.
 */
const AGENDA_FRANCAIS: readonly EntreeLexique[] = [
  // ⚠️ LES FORMES « SUIVANT » VIENNENT EN PREMIER, ET L'ORDRE N'EST PAS CE QUI
  // LES FAIT GAGNER — c'est la recherche du n-gramme le PLUS LONG d'abord
  // (`normaliserDemande`). « qui arrive ensuite » (3 mots) l'emporte donc sur
  // « qui arrive » (2 mots). Sans cela, la règle courte s'appliquerait et
  // produirait « qui ai-je ensuite », qui ne correspond à RIEN : le groupe
  // OPERATIONNEL exige une borne de JOURNÉE après un possessif, et « ensuite »
  // n'en est pas une.
  //
  // MESURÉ à l'écran le 2026-09-06 : « Qui arrive ensuite ? » partait en
  // connaissance et Jarvis répondait « précisez le nom du patient » — pour une
  // question d'agenda qui ne nomme personne, et n'a pas à le faire.
  {
    formes: [
      "qui arrive ensuite",
      "qui vient ensuite",
      "qui passe ensuite",
      "qui arrive apres",
      "qui vient apres",
      "qui ensuite",
      "qui apres",
    ],
    canonique: "prochain patient",
  },
  // « le suivant » se rend AVEC son déterminant : `OPERATIONNEL` cherche
  // `(prochain|suivant)\s+(patient|consultation|rendez-vous)`, donc il faut le
  // NOM derrière. « Qui est le suivant ? » devient « Qui est le prochain
  // patient ? », que le fichier gelé reconnaît déjà.
  { formes: ["le suivant", "la suivante"], canonique: "le prochain patient" },

  { formes: ["qui vient", "qui arrive", "qui est prevu", "qui est prevue", "qui je vois"], canonique: "qui ai-je" },
];

/** ═══ 4 · FINANCE ═══ */
const FINANCE: readonly EntreeLexique[] = [
  {
    formes: ["خلصت", "خلص", "khalles", "khallest", "5allest", "collect", "collected", "cashed"],
    canonique: "encaisse",
  },
  { formes: ["المدخول", "الدخل", "revenue", "takings", "earnings"], canonique: "recette" },
  { formes: ["الدفع", "payment", "payments"], canonique: "paiement" },
  { formes: ["unpaid", "outstanding", "لم يدفع"], canonique: "impayes" },
];

/**
 * ═══ 5 · LECTURE DE DOSSIER ═══
 *
 * ⚠️ « المريض » et « lmrid » portent l'article défini dans leur propre langue :
 * les rendre par « le patient » n'ajoute pas un déterminant, il le TRADUIT.
 * C'est ce qui fait de « شكون المريض الجاي » un individu désigné — exactement
 * comme « le patient » en français, et par la même règle.
 */
const DOSSIER: readonly EntreeLexique[] = [
  { formes: ["المريض", "المريضة", "lmrid", "elmrid", "the patient"], canonique: "le patient" },
  { formes: ["مرضى", "المرضى", "patients"], canonique: "patients" },
  { formes: ["الملف", "ملف", "record", "chart"], canonique: "dossier" },
  {
    formes: ["دواء", "الدواء", "دوا", "الدوا", "dwa", "eddwa", "medication", "medications", "meds", "medicine"],
    canonique: "medicaments",
  },
  { formes: ["العلاج", "علاج", "3ilaj", "ilaj", "treatment"], canonique: "traitement" },
  { formes: ["وصفة", "الوصفة"], canonique: "ordonnance" },
  { formes: ["الجرعة", "الدوز", "دوز"], canonique: "la dose" },
  { formes: ["حصة", "الحصة"], canonique: "seance" },
];

/**
 * ═══ 5ter · LES HOMOGRAPHES RETIRÉS, ET POURQUOI ═══
 *
 * ⚠️ QUATRE FORMES LATINES ONT ÉTÉ RETIRÉES LE 2026-09-08 : `prescription`,
 * `dosage`, `session`, `depression`. Elles avaient été inscrites pour
 * l'ANGLAIS. Mais ces quatre mots s'écrivent À L'IDENTIQUE en français, et le
 * normaliseur ne prétend pas — délibérément — identifier une langue. Elles
 * capturaient donc aussi le français correct, et leur canonique le réécrivait :
 *
 *     « de la dépression »  →  « de la LA depression »   (article doublé)
 *     « la prescription »   →  « la ORDONNANCE »          (grammaire cassée)
 *     « le dosage »         →  « le LA DOSE »             (article doublé)
 *     « la session »        →  « la SEANCE »              (synonyme imposé)
 *
 * C'était une violation DIRECTE de la discipline n°1 — et non déclarée, au
 * contraire du groupe `AGENDA_FRANCAIS` qui assume la sienne. Trouvée par la
 * famille M de `eval-jarvis-routage`, le jour même où cette famille est née.
 *
 * ⚠️ CE QUE LE RETRAIT COÛTE, SANS L'ADOUCIR : un anglophone qui écrit
 * « the prescription » n'obtient plus « ordonnance ». Le coût est faible parce
 * que les tournures anglaises qui comptent vraiment passent par le groupe
 * POSSESSIF ci-dessus — « his prescription », « his dosage », « his last
 * session » y sont, en n-grammes, et ceux-là ne peuvent pas capturer du
 * français. Et le défaut restant est SÛR : un mot anglais non traduit ne
 * produit aucun marqueur, donc le chemin par défaut, `connaissance`.
 *
 * La règle qui en sort, et qu'il faut tenir : UNE FORME LATINE D'UN SEUL MOT
 * QUI EST AUSSI UN MOT FRANÇAIS CORRECT N'A PAS SA PLACE ICI. Si l'anglais doit
 * la rendre, elle s'écrit en n-gramme avec un mot qui, lui, n'est pas français.
 */

/**
 * ═══ 5bis · RÉFÉRENCES POSSESSIVES — « de qui parle-t-on ? » ═══
 *
 * ⚠️ CE GROUPE NE SERT PAS AU ROUTAGE, IL SERT À LA CLARIFICATION.
 * `besoinDeClarification` (`src/services/jarvis-contexte.ts`) reconnaît une
 * référence à un patient qu'on ne nomme pas : un POSSESSIF suivi d'un nom
 * clinique. Sans cible valide, elle demande « de quel patient parlez-vous ? »
 * au lieu de laisser le modèle deviner.
 *
 * ⚠️ MESURÉ LE 2026-09-07, sonde hors ligne sur 22 cas : 11 trous, 0 faux
 * positif. « دواءه؟ », « dwa dyalou? », « And his medication? » ne
 * déclenchaient RIEN et partaient au modèle. Et la normalisation seule n'en
 * refermait AUCUN (0/11) : le groupe 5 rend bien « دواء » par « medicaments »,
 * mais il rend le NOM sans le POSSESSIF — et c'est le possessif, pas le nom,
 * qui dit qu'une personne est visée. Un dossier clinique lu pour la mauvaise
 * personne est la faute la plus grave de ce produit, et elle était silencieuse.
 *
 * C'est exactement le dédoublement que « التشخيص » / « تشخيصه » tenait déjà
 * seul dans le groupe 9 : la forme NUE reste nue, la forme POSSESSIVE rend le
 * possessif explicite. On l'étend ici aux noms cliniques du groupe 5.
 *
 * ⚠️ AUCUN POSSESSIF ISOLÉ N'EST TRADUIT. « ديالو », « his », « dyalou » seuls
 * ne sont PAS des entrées : le normaliseur substitue en place sans réordonner,
 * et « medicaments son » ne correspondrait à rien. Le possessif ne se rend
 * qu'AVEC son nom, en n-gramme — et le canonique sort dans l'ordre français.
 */
const POSSESSIF: readonly EntreeLexique[] = [
  // ── Arabe : le possessif est un SUFFIXE, il n'y a aucun mot à traduire ──
  {
    formes: ["دواءه", "دواؤه", "دواءها", "دواه", "دواها", "أدويته", "ادويته", "ادويتها"],
    canonique: "ses medicaments",
  },
  { formes: ["علاجه", "علاجها"], canonique: "son traitement" },
  { formes: ["ملفه", "ملفها"], canonique: "son dossier" },
  { formes: ["وصفته", "وصفتها"], canonique: "son ordonnance" },
  { formes: ["حصته", "حصتها"], canonique: "sa seance" },
  { formes: ["جرعته", "جرعتها"], canonique: "sa posologie" },
  { formes: ["متابعته", "متابعتها"], canonique: "son suivi" },

  // ── Darija : « ديال + pronom » est POSTPOSÉ, donc il se prend en n-gramme ──
  { formes: ["دوا ديالو", "الدوا ديالو", "الدواء ديالو", "دوا ديالها"], canonique: "ses medicaments" },
  { formes: ["ملف ديالو", "الملف ديالو", "الملف ديالها"], canonique: "son dossier" },
  { formes: ["علاج ديالو", "العلاج ديالو"], canonique: "son traitement" },
  { formes: ["حصة ديالو", "الحصة ديالو"], canonique: "sa seance" },
  { formes: ["اخر حصة", "آخر حصة"], canonique: "derniere seance" },

  // ── Darija latine ──
  {
    formes: ["dwa dyalou", "dwa dialou", "dwa dyalha", "eddwa dyalou", "3andou dwa", "3andha dwa"],
    canonique: "ses medicaments",
  },
  { formes: ["melf dyalou", "lmelf dyalou", "melf dialou"], canonique: "son dossier" },
  { formes: ["3ilaj dyalou", "ilaj dyalou"], canonique: "son traitement" },
  { formes: ["hessa dyalou", "l7essa dyalou", "hessa dialou"], canonique: "sa seance" },
  { formes: ["akher hessa", "akher h7essa"], canonique: "derniere seance" },

  // ── Anglais : le déterminant possessif porte la référence ──
  {
    formes: ["his medication", "her medication", "his medications", "her medications", "his meds", "her meds"],
    canonique: "ses medicaments",
  },
  { formes: ["his treatment", "her treatment"], canonique: "son traitement" },
  {
    formes: ["his file", "her file", "his record", "her record", "his chart", "her chart"],
    canonique: "son dossier",
  },
  { formes: ["his prescription", "her prescription"], canonique: "son ordonnance" },
  { formes: ["his notes", "her notes"], canonique: "ses notes" },
  { formes: ["his dose", "her dose", "his dosage", "her dosage"], canonique: "sa posologie" },
  {
    formes: ["his last session", "her last session", "his previous session"],
    canonique: "sa derniere seance",
  },
];

/**
 * ═══ 6 · SAVOIR GÉNÉRAL ═══
 * Ces entrées existent pour que l'arabe et l'anglais restent DU CÔTÉ
 * CONNAISSANCE. Une langue nouvelle ne doit pas transformer une question
 * pédagogique en opération sur un dossier.
 */
const SAVOIR: readonly EntreeLexique[] = [
  { formes: ["أعراض", "اعراض", "symptoms"], canonique: "symptomes" },
  { formes: ["معايير", "criteria"], canonique: "criteres" },
  { formes: ["الاكتئاب", "اكتئاب"], canonique: "la depression" },
  { formes: ["نوبة هوس", "manic episode"], canonique: "episode maniaque" },
  { formes: ["الآثار الجانبية", "side effects"], canonique: "effets secondaires" },
];

/**
 * ═══ 7 · MODAUX DE DÉCISION ═══
 *
 * Moitié gauche du produit cartésien de `FORMES_CONCLUSIVES_DEPENDANTES`. Seuls,
 * ils ne refusent rien — « dois-je appeler le laboratoire ? » est
 * administratif. C'est leur CROISEMENT avec une action thérapeutique, et la
 * présence d'un individu désigné, qui produit le refus. La règle reste dans
 * `routing.ts` ; on ne fournit ici que le vocabulaire.
 */
const MODAL: readonly EntreeLexique[] = [
  { formes: ["هل", "واش", "وش", "wach", "wech"], canonique: "est-ce que" },
  { formes: ["should i", "do i need to", "must i"], canonique: "dois-je" },
  { formes: ["can i", "may i"], canonique: "puis-je" },
  { formes: ["is he", "is she", "is this patient"], canonique: "est-il" },
  { formes: ["does he have", "does she have"], canonique: "a-t-il un" },
  { formes: ["do you recommend", "what do you suggest"], canonique: "recommandes-tu" },
];

/** ═══ 8 · ACTIONS THÉRAPEUTIQUES ═══ Moitié droite du même produit. */
const ACTION: readonly EntreeLexique[] = [
  { formes: ["increase", "raise", "titrate"], canonique: "augmenter" },
  { formes: ["decrease", "reduce", "lower", "taper"], canonique: "diminuer" },
  { formes: ["stop", "discontinue", "withdraw"], canonique: "arreter" },
  { formes: ["switch", "swap"], canonique: "changer" },
  { formes: ["initiate"], canonique: "instaurer" },
  { formes: ["prescribe"], canonique: "prescrire" },
  { formes: ["hospitalize", "hospitalise", "admit"], canonique: "hospitaliser" },
  { formes: ["refer"], canonique: "orienter" },
];

/**
 * ═══ 9 · VERDICTS SUR UNE PERSONNE ═══ LE GROUPE LE PLUS SENSIBLE.
 *
 * ⚠️ POURQUOI L'ARABE PORTE ICI LA GRAMMAIRE ET L'ANGLAIS NON — ASYMÉTRIE
 * DÉLIBÉRÉE, ET C'EST LE POINT LE PLUS FACILE À CASSER PAR MÉGARDE.
 *
 * L'anglais dispose d'une COPULE explicite : « is he depressed » se découpe en
 * `is he` → « est-il » (groupe MODAL) et `depressed` → « déprimé ». La forme
 * conclusive est portée par le mot grammatical, comme en français.
 *
 * L'arabe, lui, forme ses phrases nominales SANS copule : « هل كريم مكتئب »
 * n'a aucun mot à traduire par « est-il ». Et « هل » seul ne peut pas jouer ce
 * rôle : c'est la particule interrogative de TOUTE question fermée, y compris
 * « هل السيرترالين آمن؟ » (« la sertraline est-elle sûre ? »), une question de
 * savoir. La rendre par « est-il » refuserait la moitié du savoir clinique
 * demandé en arabe.
 *
 * On attache donc la forme conclusive à l'ADJECTIF D'ÉTAT CLINIQUE, qui ne
 * qualifie qu'une personne — jamais une molécule. C'est l'équivalent exact, en
 * arabe, de ce que `FORMES_CONCLUSIVES_PERSONNELLES` fait en français : refuser
 * sur la GRAMMAIRE, sans disposer d'une liste de prénoms.
 *
 * ⚠️ DE MÊME POUR LE SUFFIXE `-lo` / `-lha` DE LA DARIJA (« nzidlo »,
 * « نزيدلو »). Ce suffixe EST le complément d'objet indirect de la troisième
 * personne — « lui », « à elle ». Le rendre par un possessif (« sa posologie »)
 * n'invente pas un individu : il transcrit celui que le verbe porte déjà dans
 * sa morphologie. Sans cela, « nzidlo la dose ? » sortirait au chemin patient —
 * décision thérapeutique reconnue, personne désignée perdue — et c'est le
 * modèle qu'on chargerait du refus. Un refus confié au modèle n'est pas une
 * frontière.
 */
const VERDICT: readonly EntreeLexique[] = [
  { formes: ["مكتئب", "مكتئبة"], canonique: "est-il deprime" },
  { formes: ["مهووس", "هوسي"], canonique: "est-il maniaque" },
  { formes: ["ذهاني"], canonique: "est-il psychotique" },
  {
    formes: ["انتحاري", "خطر الانتحار", "suicidal", "at risk of suicide"],
    canonique: "a risque suicidaire",
  },
  // ⚠️ LE DIAGNOSTIC SE DÉDOUBLE, ET C'EST LE FICHIER GELÉ QUI L'EXIGE.
  // Mesuré : `classer("Quel est le diagnostic ?")` rend CONNAISSANCE, et
  // `classer("Quel est le diagnostic de ce patient ?")` rend REFUS. La forme
  // interrogative seule est une question de SAVOIR — « quel est le diagnostic
  // d'un épisode maniaque » s'enseigne. C'est la personne désignée qui en fait
  // un verdict, jamais le mot « diagnostic ».
  //
  // La forme NUE se rend donc nue, et hérite exactement de cette nuance. La
  // forme POSSESSIVE — « تشخيصه » porte le suffixe de troisième personne, « his
  // diagnosis » le déterminant — désigne quelqu'un dans sa morphologie même :
  // on rend ce quelqu'un explicite, sinon la personne se perdrait à la
  // traduction et le refus avec elle.
  { formes: ["التشخيص", "تشخيص", "diagnosis"], canonique: "quel est le diagnostic" },
  {
    formes: ["تشخيصه", "تشخيصها", "his diagnosis", "her diagnosis"],
    canonique: "quel est le diagnostic de ce patient",
  },

  { formes: ["depressed"], canonique: "deprime" },
  { formes: ["manic"], canonique: "maniaque" },
  { formes: ["psychotic"], canonique: "psychotique" },

  { formes: ["نزيدلو", "نزيدلها", "nzidlo", "nzidlha", "nzidlou"], canonique: "dois-je augmenter sa posologie" },
  {
    formes: ["نوقفلو", "نوقفلها", "nwa9eflo", "nwakeflo", "nwa9eflha"],
    canonique: "dois-je arreter son traitement",
  },
  { formes: ["نبدلو", "نبدلها", "nbedlo", "nbedlou"], canonique: "dois-je changer son traitement" },
  { formes: ["نزيد", "nzid"], canonique: "dois-je augmenter" },
  { formes: ["نوقف", "نحبس", "nwa9ef", "nwakef", "nweqef"], canonique: "dois-je arreter" },
  { formes: ["نبدل", "nbedel", "nbeddel"], canonique: "dois-je changer" },
];

/**
 * ═══ 10 · RÉPARATIONS DE TRANSCRIPTION ═══
 *
 * Les déformations MESURÉES, écrites explicitement. Elles ne remplacent pas la
 * réparation par distance d'édition de `normalisation.ts` — elles la doublent
 * là où la déformation dépasse la tolérance, ou là où on veut une garantie
 * plutôt qu'une heuristique.
 *
 * ⚠️ TOUTES SONT DÉFORMÉ → CORRECT. Aucune n'est correct → autre chose : c'est
 * la discipline n°1 de l'en-tête, et c'est elle qui garantit qu'une phrase
 * française bien écrite est son propre canonique.
 */
const REPARATION_STT: readonly EntreeLexique[] = [
  {
    formes: ["medicamens", "medicamants", "medicamant", "medicamen", "medikament", "medikaments"],
    canonique: "medicaments",
  },
  { formes: ["traitemnt", "traitemen", "traitment", "tretement"], canonique: "traitement" },
  { formes: ["ordonance", "ordonence", "ordonnace"], canonique: "ordonnance" },
  { formes: ["posologi", "posolojie"], canonique: "posologie" },
  { formes: ["rendezvous", "randezvous", "rendevous", "rendez vous"], canonique: "rendez-vous" },
  { formes: ["consultacion", "consultasion"], canonique: "consultation" },
];

/**
 * LA TABLE. L'ordre des groupes n'a aucune importance : `normalisation.ts`
 * indexe par forme et cherche du n-gramme le plus long au plus court.
 */
export const LEXIQUE: readonly EntreeLexique[] = [
  ...INTERROGATIF,
  ...LIAISON,
  ...TEMPS,
  ...AGENDA,
  ...AGENDA_FRANCAIS,
  ...FINANCE,
  ...DOSSIER,
  ...POSSESSIF,
  ...SAVOIR,
  ...MODAL,
  ...ACTION,
  ...VERDICT,
  ...REPARATION_STT,
];
