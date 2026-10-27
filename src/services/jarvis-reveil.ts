/**
 * `jarvis-reveil.ts` — LA MACHINE À ÉTATS DE LA VOIX, ET LE MOT DE RÉVEIL.
 *
 * ═══ CE QUI EST LIVRÉ ICI, ET CE QUI NE L'EST PAS — SANS L'ADOUCIR ═══
 *
 * LIVRÉ : la machine à huit états, le chaînage réveil → écoute → traitement →
 * parole, l'interruption, la gestion du refus de micro, et le CONTRAT que tout
 * détecteur doit remplir.
 *
 * ⚠️ CE FICHIER NE SAIT PAS QUEL MOT RÉVEILLE JARVIS, ET C'EST VOULU. Il ne
 * connaît que le CONTRAT `DetecteurReveil` ; le mot, le moteur et le modèle
 * vivent derrière, dans `reveil-vosk.ts`. C'est ce qui a permis de
 * remplacer le modèle non commercial sans toucher à la machine à états.
 *
 *   Assistant .......... JARVIS — c'est lui qu'on réveille.
 *   Mot de réveil ...... ALEXA — l'étiquette sonore, rien de plus.
 *   Moteur ............. Vosk français, modèle local Apache-2.0, hors ligne.
 *
 * Le détecteur livré (`creerDetecteurVosk`) est LOCAL : son modèle vit dans
 * `resources/voix`, et rien ne part sur le réseau pendant l'écoute. Les
 * alternatives ont été écartées pour cette raison
 * précise : l'API Web Speech de Chrome écoute en continu et expédie l'audio
 * chez Google — la règle 1 tombe, et elle tombe sur le flux le plus intime qui
 * soit, celui d'un cabinet de psychiatrie au repos ; les moteurs sous licence
 * exigent une clé et une vérification en ligne.
 *
 * Le détecteur se branche par `installerDetecteur()`.
 *
 * ⚠️ TANT QU'AUCUN DÉTECTEUR N'EST INSTALLÉ, L'ÉTAT EST `desactive` AVEC UNE
 * RAISON NOMMÉE. L'orbe ne prétend jamais écouter : un composant qui afficherait
 * « à l'écoute » sans détecteur serait une donnée fictive dans une
 * fonctionnalité livrée (règle 8).
 *
 * ═══ CE QUI QUITTE LA MACHINE, À CHAQUE ÉTAPE ═══
 *
 *   veille / détection   RIEN — le détecteur est local, l'audio ne sort pas
 *   capture après réveil l'audio de la COMMANDE seule → `jarvis-voice-in`
 *   modèle               les DTO sûrs uniquement (jarvis-confidentialite)
 *   parole               texte sans jeton → TTS externe ; à jeton → LOCAL
 */

import { alexa } from "@/i18n/alexa";
import { fr } from "@/i18n/fr";

import { creerEndpointeurEnergie, type Endpointeur, type MotifFin } from "./endpointage-voix";
import {
  abonnerLecture,
  arreterEtTranscrire,
  arreterLecture,
  annulerDictee,
  attendreFinLecture,
  demarrerDictee,
  lireTexte,
  type SourceLecture,
} from "./jarvis-voix";
import { log } from "./log";
import { err, ok, type Result } from "./result";

// ═══════════════════════════════════════════════════════════════════════════
// 1 · LES HUIT ÉTATS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ⚠️ `interrompu` EST UN ÉTAT, PAS UN RETOUR IMMÉDIAT À `veille`. Quand la
 * praticienne dit « stop », l'orbe doit MONTRER qu'elle a été entendue avant de
 * se rendormir. Sans cet état, l'interruption serait indiscernable d'une panne :
 * dans les deux cas Jarvis se tait.
 */
export type EtatVoix =
  | "veille"
  | "reveille"
  | "ecoute"
  | "traitement"
  | "parole"
  | "interrompu"
  | "erreur"
  | "desactive";

export interface VueVoix {
  readonly etat: EtatVoix;
  /**
   * Pourquoi la voix est désactivée ou en erreur. TOUJOURS une chaîne d'`fr.ts`,
   * jamais un message technique : l'écran ne montre pas les entrailles.
   */
  readonly raison: string | null;
  /** Le détecteur de mot de réveil est-il réellement installé et armé ? */
  readonly reveilArme: boolean;
  /**
   * Par quelle voie sort le son pendant l'état `parole` — `null` sinon.
   *
   * ⚠️ CE CHAMP EXISTE PARCE QUE SON ABSENCE A COÛTÉ DES HEURES. Une réponse
   * nommant une patiente part en synthèse LOCALE (règle 1) et s'entend
   * parfaitement même quand la passerelle vocale est injoignable. Sans cette
   * distinction, on entend Alexa parler et on en déduit que la sortie
   * fonctionne — alors que seule la voie locale fonctionne, et que l'entrée
   * échoue à la MÊME porte. Voir `SourceLecture` dans `jarvis-voix.ts`.
   */
  readonly sourceParole: SourceLecture | null;
}

type Abonne = (vue: VueVoix) => void;

// ═══════════════════════════════════════════════════════════════════════════
// 2 · LE CONTRAT D'UN DÉTECTEUR
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Ce qu'un détecteur de mot de réveil doit fournir. Volontairement pauvre : il
 * démarre, il rappelle quand il a entendu, il s'arrête.
 *
 * ⚠️ CETTE INTERFACE INTERDIT STRUCTURELLEMENT L'ENVOI DE L'AUDIO DE VEILLE.
 * Elle ne rend AUCUN échantillon, aucun tampon, aucun flux — seulement un
 * signal « le mot a été prononcé ». Un détecteur conforme n'a physiquement rien
 * à transmettre à l'application, donc rien qui puisse fuir par ce chemin. C'est
 * la forme du contrat qui le garantit, pas une consigne d'usage.
 */
export interface DetecteurReveil {
  /** Nom et version du moteur — pour la télémétrie et le rapport de mesure. */
  readonly nom: string;
  /** `false` si les assets manquent : on le CONSTATE, on ne le suppose pas. */
  readonly disponible: () => Promise<boolean>;
  readonly demarrer: (surReveil: () => void) => Promise<Result<true>>;
  /**
   * Ignore le scoring SANS lâcher le micro. Appelé pendant que la praticienne
   * dicte et pendant que Jarvis parle : sans cela, la commande elle-même et la
   * voix de synthèse redéclencheraient le mot de réveil en boucle.
   */
  readonly suspendre: () => void;
  readonly reprendre: () => void;
  readonly arreter: () => void;
}

let detecteur: DetecteurReveil | null = null;

/**
 * Jeton de la reprise en cours. Toute installation ou désinstallation le
 * périme : une boucle de relance ne doit jamais rallumer un détecteur que la
 * praticienne vient de retirer.
 */
let repriseGeneration = 0;

/**
 * Branche un détecteur. Appelé au démarrage de l'application SI un moteur a été
 * retenu et que sa licence a été lue.
 */
export function installerDetecteur(d: DetecteurReveil | null): void {
  repriseGeneration += 1;
  detecteur?.arreter();
  detecteur = d;
  publier();
}

/** Le moteur installé, ou `null`. Consommé par le rapport de mesure. */
export function detecteurInstalle(): DetecteurReveil | null {
  return detecteur;
}

/** The in-flight explicit arm attempt, so the UI cannot claim success early. */
export function promesseArmement(): Promise<Result<true>> | null {
  return armement;
}

// ═══════════════════════════════════════════════════════════════════════════
// 3 · L'ÉTAT
// ═══════════════════════════════════════════════════════════════════════════

let etat: EtatVoix = "desactive";
// L'état de départ est « pas encore allumée », PAS « moteur absent » : au
// premier chargement rien n'a été tenté, donc rien ne permet d'affirmer qu'un
// moteur manque. On ne diagnostique pas une panne qu'on n'a pas constatée.
let raison: string | null = fr.jarvis.voix.reveil.nonActivee;
/** Renseignée par l'abonnement à la lecture réelle, jamais par une intention. */
let sourceParole: SourceLecture | null = null;
const abonnes = new Set<Abonne>();

function vue(): VueVoix {
  return {
    etat,
    raison,
    reveilArme: detecteur !== null && etat !== "desactive",
    sourceParole: etat === "parole" ? sourceParole : null,
  };
}

function publier(): void {
  const v = vue();
  for (const a of abonnes) a(v);
}

function aller(suivant: EtatVoix, motif: string | null = null): void {
  etat = suivant;
  raison = motif;
  publier();
}

export function abonnerVoix(abonne: Abonne): () => void {
  abonnes.add(abonne);
  abonne(vue());
  return () => {
    abonnes.delete(abonne);
  };
}

export function etatVoix(): EtatVoix {
  return etat;
}

// ═══════════════════════════════════════════════════════════════════════════
// 4 · LE CYCLE
// ═══════════════════════════════════════════════════════════════════════════

/** Ce que la machine remet à l'appelant quand une commande a été captée. */
export interface RappelsVoix {
  /** Le texte transcrit — l'appelant le passe à la boucle Jarvis. */
  readonly onCommande: (texte: string) => Promise<void>;
}

let rappels: RappelsVoix | null = null;

/**
 * L'endpointeur. Un seul pour le module : deux mesures concurrentes sur le même
 * micro concluraient deux fois.
 */
let endpointeur: Endpointeur | null = null;

/** Désabonnement de l'état de lecture réelle. Voir `armerReveil`. */
let quitterLecture: (() => void) | null = null;

/**
 * ⚠️ LE JETON DE CAPTURE — LA GARANTIE D'IDEMPOTENCE.
 *
 * `cloturerCommande` peut être déclenché par le silence, le plafond, un clic,
 * une interruption, un démontage de composant, ou une erreur. Le premier
 * appelant gagne ; les suivants sont des no-op.
 *
 * Un simple booléen ne suffirait pas : un endpointeur PÉRIMÉ, appartenant à la
 * capture précédente, pourrait clore la capture SUIVANTE — deux transcriptions
 * partiraient pour une seule phrase. Le jeton rend cet appel tardif inoffensif.
 */
let captureCourante = 0;

/**
 * ⚠️ UNE SEULE TRANSITION ASYNCHRONE À LA FOIS.
 *
 * Un réveil joue l'accusé puis ouvre le micro ; une clôture transcrit puis
 * répond. Ces deux séquences attendent le réseau et le TTS. Sans file, la fin
 * d'une réponse pouvait atterrir au milieu du réveil suivant — c'est le défaut
 * qui rendait « Alexa » efficace une fois sur deux. La file ne sérialise que
 * les séquences ASYNCHRONES ; les signaux `parole`/`fin de parole` restent
 * synchrones parce qu'ils rapportent un fait observé (voir `signalerParole`).
 */
let operation: Promise<void> = Promise.resolve();

function serialiser(tache: () => Promise<void>): Promise<void> {
  const suivant = operation.then(tache, tache);
  // La file ne doit jamais rester rejetée : une transition en échec est déjà
  // traduite en état `erreur` par la tâche elle-même.
  operation = suivant.catch(() => {});
  return suivant;
}

/**
 * Le docteur a demandé une commande au mot de réveil : après la réponse, le
 * micro se rouvre 8 s SANS redire « Alexa ». Ce drapeau ne survit ni à un
 * arrêt manuel ni à un faux réveil.
 */
let suiviDemande = false;
let minuteurSuivi: ReturnType<typeof setTimeout> | null = null;
/**
 * Le minuteur qui attend qu'une lecture DÉMARRE après la réponse. Il ne doit
 * JAMAIS ouvrir le micro : il ne sert qu'à abandonner proprement le suivi si
 * aucune lecture ne vient. Seul `signalerFinParole` ouvre une fenêtre de suivi.
 */
let minuteurAttenteParole: ReturnType<typeof setTimeout> | null = null;
/** Invalide un démarrage de suivi déjà sorti du minuteur mais pas encore exécuté. */
let generationSuivi = 0;

const SUIVI_MS = 8_000;
const PATIENCE_REVEIL_MS = 3_000;
const PLAFOND_CAPTURE_MS = 15_000;
const DELAI_SUIVI_MS = 250;
/**
 * Fenêtre accordée à la synthèse locale pour publier son premier son après une
 * réponse. Kokoro prépare parfois l'audio en plusieurs secondes ; passé ce
 * délai sans `parole`, aucun suivi ne doit s'ouvrir — le docteur redira
 * « Alexa ». Ce minuteur ne capture jamais rien.
 */
const ATTENTE_PAROLE_MS = 5_000;

function effacerMinuteurSuivi(): void {
  if (minuteurSuivi !== null) {
    clearTimeout(minuteurSuivi);
    minuteurSuivi = null;
  }
}

function effacerAttenteParole(): void {
  if (minuteurAttenteParole !== null) {
    clearTimeout(minuteurAttenteParole);
    minuteurAttenteParole = null;
  }
}

/**
 * Attend qu'une lecture démarre, sans jamais ouvrir le micro. À l'expiration,
 * le suivi est abandonné : la machine reste en veille et le mot de réveil
 * reste disponible.
 */
function attendreParole(): void {
  effacerAttenteParole();
  if (!suiviDemande) return;
  const generation = generationSuivi;
  minuteurAttenteParole = setTimeout(() => {
    minuteurAttenteParole = null;
    if (generation !== generationSuivi || !suiviDemande) return;
    // ⚠️ CE MINUTEUR N'APPARTIENT QU'À LA VEILLE. S'il survit à un nouveau
    // réveil (accusé muet, aucun `signalerFinParole`), il ne doit pas arracher
    // l'état d'une commande en cours : `traitement`, `parole`, `ecoute` et
    // `reveille` appartiennent à la nouvelle activation.
    if (etatVoix() !== "veille") return;
    annulerSuivi();
    detecteur?.reprendre();
    aller("veille");
  }, ATTENTE_PAROLE_MS);
}

/** Programme l'ouverture du suivi. Un seul minuteur, jamais deux. */
function programmerSuivi(): void {
  if (!suiviDemande) return;
  effacerMinuteurSuivi();
  const generation = generationSuivi;
  minuteurSuivi = setTimeout(() => {
    minuteurSuivi = null;
    if (generation !== generationSuivi || !suiviDemande) return;
    void declencherEcoute({ suivi: true });
  }, DELAI_SUIVI_MS);
}

/**
 * Annule toute fenêtre de suivi. Appelé par un envoi tapé (Task 5) : une
 * question au clavier ne doit jamais hériter du micro laissé ouvert par la
 * réponse précédente.
 *
 * ⚠️ UN APPELANT QUI PEUT AVOIR UNE CAPTURE OUVERTE DOIT AUSSI APPELER
 * `interrompreVoix()`. `annulerSuivi()` ne coupe pas un micro déjà ouvert : il
 * retire seulement la fenêtre FUTURE. Sans la paire, le micro continuerait
 * d'enregistrer derrière l'envoi tapé.
 */
export function annulerSuivi(): void {
  suiviDemande = false;
  generationSuivi += 1;
  effacerMinuteurSuivi();
  effacerAttenteParole();
}

/** The one in-flight arm attempt; cleared by an explicit disarm so a quick
 * stop/start cannot reuse a resolved promise and leave the detector off. */
let armement: Promise<Result<true>> | null = null;

/**
 * Plafond de l'état `parole`. Une lecture qui cale n'émet ni `ended` ni
 * `error` — sans ce chien de garde, l'orbe resterait « parle » indéfiniment.
 * Large : il n'est pas là pour couper une réponse longue, seulement pour qu'un
 * blocage finisse par se voir.
 */
const PAROLE_MAX_MS = 120_000;
let chienDeGardeParole: ReturnType<typeof setTimeout> | null = null;

/**
 * Arme le mot de réveil.
 *
 * ⚠️ ÉCHOUE EXPLICITEMENT SI AUCUN DÉTECTEUR N'EST INSTALLÉ. On ne dégrade PAS
 * silencieusement vers l'API du navigateur : ce serait remplacer un détecteur
 * local absent par une écoute continue expédiée chez un tiers, c'est-à-dire
 * faire exactement le contraire de ce que l'appelante croit demander.
 */
export async function armerReveil(r: RappelsVoix): Promise<Result<true>> {
  rappels = r;

  if (detecteur === null) {
    aller("desactive", fr.jarvis.voix.reveil.aucunDetecteur);
    return err({ code: "regle-metier", message: fr.jarvis.voix.reveil.aucunDetecteur });
  }

  // « Disponible » se CONSTATE — assets présents, WASM chargeable — jamais ne
  // se suppose. Un détecteur déclaré mais sans modèle échouerait au premier mot.
  if (!(await detecteur.disponible())) {
    aller("desactive", fr.jarvis.voix.reveil.moteurIndisponible);
    return err({ code: "indisponible", message: fr.jarvis.voix.reveil.moteurIndisponible });
  }

  const demarrage = await detecteur.demarrer(() => {
    void surReveil();
  });
  if (!demarrage.ok) {
    // ⚠️ NE PAS ACCUSER LE MICRO DE TOUT CE QUI RATE ICI.
    //
    // DÉFAUT MESURÉ LE 2026-08-27 : le runtime ONNX manquait (404 sur le
    // chargeur jsep), et l'orbe annonçait « L'accès au micro a été refusé ».
    // `getUserMedia` avait pourtant parfaitement réussi — vérifié dans la même
    // session. Le message envoyait chercher une permission de navigateur
    // pendant que le vrai défaut était un fichier absent du déploiement.
    //
    // Le code porté par le détecteur DIT lequel des deux : `interdit` est le
    // seul refus de permission ; tout le reste est un moteur qui n'a pas pu
    // démarrer. On ne devine plus, on relaie.
    aller(
      "erreur",
      demarrage.error.code === "interdit"
        ? fr.jarvis.voix.reveil.microRefuse
        : fr.jarvis.voix.reveil.moteurIndisponible,
    );
    return err(demarrage.error);
  }

  // L'état `parole` doit refléter une LECTURE RÉELLE, pas une intention. On
  // s'abonne à ce que le navigateur rapporte vraiment (`onplaying`/`onended`),
  // jamais au fait d'avoir demandé une lecture.
  quitterLecture?.();
  quitterLecture = abonnerLecture((enLecture, source) => {
    sourceParole = source;
    if (enLecture) signalerParole();
    else signalerFinParole();
  });

  aller("veille");
  log.info("jarvis.reveil.arme", { context: `moteur:${detecteur.nom}` });
  return ok(true);
}

/**
 * Délais de reprise bornés. Après le dernier, l'échec est visible : on ne
 * prétend pas écouter quand le détecteur n'a pas pu redémarrer.
 */
const DELAIS_REPRISE = [250, 500, 1_000, 2_000] as const;

function attendre(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * ⚠️ UNE PANNE DU DÉTECTEUR NE DOIT PAS DÉSARMER LA VOIX.
 *
 * `reveil-vosk` signale une perte de micro ou un transport mort. La réaction
 * évidente — `installerDetecteur(null)` / `desarmerReveil()` — transforme une
 * panne récupérable en fonctionnalité éteinte jusqu'au prochain geste. On
 * relance donc l'armement, borné, tant que la praticienne veut la voix :
 * 250/500/1000/2000 ms, puis `erreur` SEULEMENT si le détecteur ne redémarre
 * pas. Sur un `micro`, le graphe mort a déjà été fermé par le détecteur et
 * `prendreMicro` dans `demarrer` réacquiert le périphérique.
 */
export async function relancerArmement(code: "micro" | "transport"): Promise<void> {
  const jeton = (repriseGeneration += 1);
  log.warn("jarvis.reveil.reprise", { code, count: DELAIS_REPRISE.length });
  let dernierCode = "indisponible";
  for (let tentative = 0; tentative < DELAIS_REPRISE.length; tentative += 1) {
    await attendre(DELAIS_REPRISE[tentative]!);
    if (jeton !== repriseGeneration) return;
    const d = detecteur;
    // La praticienne a pu arrêter la voix pendant l'attente : on ne rouvre pas
    // le micro dans son dos.
    if (d === null || rappels === null || references === 0 || etat === "desactive") return;
    const resultat = await d.demarrer(() => void surReveil());
    if (jeton !== repriseGeneration) return;
    if (resultat.ok) {
      // La reprise ne concerne QUE l'écoute de fond. Si une capture, un
      // traitement ou une réponse est en cours, son état prime : le déclarer
      // « veille » ici ferait croire que le micro de commande est fermé. La
      // suspension appartenait à ce tour et a disparu avec l'ancien graphe —
      // on la rétablit au lieu de laisser le détecteur écouter la commande ou
      // la voix de Jarvis.
      if (etat === "reveille" || etat === "ecoute" || etat === "traitement" || etat === "parole") {
        d.suspendre();
      } else if (etat === "veille" || etat === "erreur") {
        aller("veille");
      }
      log.info("jarvis.reveil.reprise.ok", { context: d.nom, count: tentative + 1 });
      return;
    }
    dernierCode = resultat.error.code;
    log.warn("jarvis.reveil.reprise.echec", { code: resultat.error.code, count: tentative + 1 });
  }
  if (jeton !== repriseGeneration) return;
  if (detecteur === null || rappels === null) return;
  // ⚠️ NE JAMAIS ARRACHER UNE CAPTURE EN COURS. Poser `erreur` pendant
  // `ecoute` laisserait l'enregistreur ouvert sans plus aucun chemin pour le
  // clore (`cloturerCommande` exige l'état `ecoute`). Une panne constatée hors
  // veille est donc journalisée, et l'état actif garde la priorité.
  if (etat !== "veille" && etat !== "erreur") {
    log.error("jarvis.reveil.reprise.abandon", { code: dernierCode, context: etat });
    return;
  }
  aller(
    "erreur",
    dernierCode === "interdit" ? fr.jarvis.voix.reveil.microRefuse : fr.jarvis.voix.reveil.moteurIndisponible,
  );
}

export function desarmerReveil(): void {
  repriseGeneration += 1;
  captureCourante += 1; // invalide toute clôture en vol
  annulerSuivi();
  if (chienDeGardeParole !== null) {
    clearTimeout(chienDeGardeParole);
    chienDeGardeParole = null;
  }
  // A resolved arm promise is not a state. If the caller disarms, the next
  // explicit start must spawn/arm again rather than reuse this old result.
  armement = null;
  endpointeur?.arreter();
  endpointeur = null;
  quitterLecture?.();
  quitterLecture = null;
  detecteur?.arreter();
  annulerDictee();
  arreterLecture();
  rappels = null;
  aller("desactive", fr.jarvis.voix.reveil.desarme);
}

/**
 * Le mot a été entendu. Enchaîne réveil → écoute → traitement.
 *
 * ⚠️ UN RÉVEIL PENDANT QU'ON PARLE COUPE LA PAROLE. C'est le comportement
 * attendu d'un assistant : dire « Jarvis » pendant qu'il récite un dossier veut
 * dire « arrête-toi, j'ai autre chose à demander ». Le laisser finir sa phrase
 * ferait répéter le mot de réveil dans le vide.
 */
async function surReveil(): Promise<void> {
  await declencherEcoute();
}

/**
 * LE CHEMIN CANONIQUE D'ACTIVATION. Le mot de réveil ET le clic sur l'orbe
 * passent tous les deux par ici.
 *
 * ⚠️ UN SEUL CHEMIN, PAS DEUX. Deux chemins d'activation divergent toujours :
 * l'un finit par oublier de suspendre le détecteur, ou de démarrer
 * l'endpointeur, et le défaut ne se manifeste que sur l'un des deux gestes —
 * donc au pire moment, une fois sur deux.
 */
export interface OptionsEcoute {
  /** Fenêtre de suivi ouverte APRÈS une réponse : pas d'accusé, patience 8 s. */
  readonly suivi?: boolean;
}

export function declencherEcoute(options?: OptionsEcoute): Promise<void> {
  return serialiser(() => declencherEcouteSerialise(options));
}

async function declencherEcouteSerialise(options?: OptionsEcoute): Promise<void> {
  // Un suivi annulé (envoi tapé, arrêt manuel) ne doit pas rouvrir le micro,
  // même si son minuteur a déjà été vidé. On le vérifie AVANT de couper une
  // réponse en cours : une activation annulée ne doit rien interrompre.
  if (options?.suivi === true) {
    if (!suiviDemande) return;
    // ⚠️ UN SUIVI NE COUPE JAMAIS UNE RÉPONSE. S'il tombe pendant que Jarvis
    // parle (ou prépare sa réponse), sa fin programmera elle-même la fenêtre.
    // Le traiter comme un réveil manuel couperait la réponse en pleine phrase.
    if (etat !== "veille") return;
  }

  // Un réveil pendant la réponse coupe la lecture : c'est le « stop » naturel.
  if (etat === "parole") arreterLecture();
  // Une activation pendant l'écoute ou le traitement est IGNORÉE : la commande
  // en cours a la priorité, sinon deux captures se chevaucheraient sur un seul
  // micro et la seconde échouerait en « déjà en cours ».
  if (
    etat === "ecoute" ||
    etat === "traitement" ||
    etat === "reveille" ||
    etat === "desactive"
  ) {
    return;
  }

  // Une activation explicite remplace toute fenêtre de suivi ET toute attente
  // de lecture en cours. Sans cela, un accusé muet peut laisser le minuteur de
  // l'ancienne réponse expirer pendant la NOUVELLE commande et la forcer en
  // veille. Le nouveau réveil possède désormais l'attente de parole.
  effacerMinuteurSuivi();
  effacerAttenteParole();

  aller("reveille");
  // Le détecteur se tait pendant la capture : la commande de la praticienne ne
  // doit pas se réveiller elle-même.
  detecteur?.suspendre();

  const generationDemarrage = captureCourante;

  // ⚠️ L'ACCUSÉ EST PRONONCÉ AVANT D'OUVRIR LE MICRO, JAMAIS DEDANS. Il ne
  // part pas sur un suivi : le docteur vient d'entendre la réponse et sait
  // qu'il peut parler. Un échec de l'accusé est journalisé et IGNORÉ — un
  // haut-parleur muet ne doit pas empêcher la consultation.
  if (options?.suivi !== true) {
    try {
      const accuse = await lireTexte(alexa.reveilAccuse);
      if (accuse.ok) {
        await attendreFinLecture(5_000);
      } else {
        log.warn("jarvis.reveil.accuse", { code: accuse.error.code });
      }
    } catch (cause) {
      log.warn("jarvis.reveil.accuse", {
        code: "indisponible",
        causeName: cause instanceof Error ? cause.name : "inconnue",
      });
    }
  }

  // Un arrêt, un démontage ou une interruption a pu changer l'état pendant
  // l'accusé. On ne rouvre pas le micro dans le dos de la praticienne.
  if (etatVoix() !== "reveille" || generationDemarrage !== captureCourante) return;

  const demarrage = await demarrerDictee();
  if (!demarrage.ok) {
    if (generationDemarrage !== captureCourante) return;
    annulerSuivi();
    detecteur?.reprendre();
    aller("erreur", demarrage.error.message);
    return;
  }
  if (generationDemarrage !== captureCourante) {
    annulerDictee();
    return;
  }

  const jeton = (captureCourante += 1);
  aller(
    "ecoute",
    options?.suivi === true ? fr.jarvis.voix.reveil.voixSuivi : null,
  );

  // ⚠️ SANS CECI, L'ENREGISTREMENT NE S'ARRÊTE JAMAIS. C'était le maillon
  // manquant de toute la boucle vocale : `cloturerCommande` existait sans
  // appelant, et le contrat du détecteur ne porte aucun signal de fin de parole.
  endpointeur ??= creerEndpointeurEnergie();
  const mesure = endpointeur.demarrer(
    (motif: MotifFin) => {
      void cloturerCommande(jeton, motif);
    },
    {
      patienceMs: options?.suivi === true ? SUIVI_MS : PATIENCE_REVEIL_MS,
      plafondMs: PLAFOND_CAPTURE_MS,
    },
  );
  if (!mesure.ok) {
    // Pas de mesure d'énergie : on ne laisse PAS un micro ouvert sans horizon.
    // Le plafond dur reste, porté par un minuteur simple.
    log.warn("voix.endpointIndisponible", { code: mesure.error.code });
    setTimeout(() => void cloturerCommande(jeton, "plafond"), PLAFOND_CAPTURE_MS);
  }
}

/**
 * Clôt la capture et transmet la commande. Appelé par la détection de fin de
 * parole du détecteur, ou par un geste de l'interface.
 */
export function cloturerCommande(jeton?: number, motif?: MotifFin): Promise<void> {
  // ── LES TROIS VERROUS D'IDEMPOTENCE ──
  // 1 · un appel d'une capture PÉRIMÉE ne clôt pas la capture courante ;
  if (jeton !== undefined && jeton !== captureCourante) return Promise.resolve();
  // 2 · on ne clôt que ce qui est en cours d'écoute ;
  if (etat !== "ecoute") return Promise.resolve();
  // 3 · la transition est SYNCHRONE et précède tout `await` : un second appelant
  //     arrivé dans le même tour de boucle voit déjà « traitement » et repart.
  aller("traitement");

  endpointeur?.arreter();
  const generation = captureCourante;

  return serialiser(async () => {
    // Une interruption a pu vider la capture entre-temps : on ne transcrit pas
    // un audio que la praticienne a déjà arrêté.
    if (etat !== "traitement" || generation !== captureCourante) return;

    // Un faux réveil n'a produit aucune parole. On JETTE l'audio au lieu de
    // payer une transcription pour du silence — et on ne montre aucune erreur :
    // afficher un échec ferait croire à une panne à chaque claquement de porte.
    if (motif === "faux-reveil") {
      annulerDictee();
      annulerSuivi();
      detecteur?.reprendre();
      aller("veille");
      log.info("jarvis.reveil.fauxReveil", { count: 1 });
      return;
    }

    // `arreterEtTranscrire` porte le contrat de finalisation : arrêt du
    // recorder, attente du dernier fragment ET de `onstop`, assemblage,
    // validation du non-vide, puis UNE seule requête. Voir `jarvis-voix.ts`.
    const transcription = await arreterEtTranscrire();
    if (!transcription.ok) {
      if (etat !== "traitement" || generation !== captureCourante) return;
      annulerSuivi();
      detecteur?.reprendre();
      aller("erreur", transcription.error.message);
      return;
    }
    if (etat !== "traitement" || generation !== captureCourante) return;
    await acheminerTranscription(transcription.data.trim(), generation);
  });
}

/**
 * Le segment post-STT, PARTAGÉ entre la vraie transcription
 * (`cloturerCommande`) et la transcription SYNTHÉTIQUE du harnais
 * (`simulerTranscription`, §29). Un seul code pour les deux voies : une voix
 * simulée qui divergerait de la voix réelle ne prouverait rien.
 *
 * Précondition : la machine est déjà en `traitement` (posée par l'appelant).
 * Vide = faux réveil (silence jeté, retour veille, sans erreur). Le détecteur
 * reste suspendu pendant la réponse, comme en réel.
 */
async function acheminerTranscription(texte: string, generation: number): Promise<void> {
  if (texte === "") {
    detecteur?.reprendre();
    annulerSuivi();
    aller("veille");
    log.info("jarvis.reveil.fauxReveil", { count: 1 });
    return;
  }

  // ⚠️ LE SUIVI EST DEMANDÉ AVANT LA RÉPONSE, PAS APRÈS. La boucle peut lire la
  // réponse et publier `parole` avant que `onCommande` ne rende la main ; si le
  // drapeau était posé ensuite, `signalerFinParole` aurait déjà décidé de ne
  // rien programmer. Un envoi tapé l'annule par `annulerSuivi()`.
  suiviDemande = true;

  // ⚠️ LE DÉTECTEUR RESTE SUSPENDU PENDANT LA RÉPONSE. Il reprendra à la fin de
  // `parole` (voir `signalerFinParole`) ou ici même si rien n'est lu. Le
  // réveiller maintenant le ferait entendre la voix de Jarvis.
  try {
    await rappels?.onCommande(texte);
  } catch (cause) {
    // ⚠️ UNE INTERRUPTION OU UN DÉMONTAGE N'EST PAS UNE PANNE. Si le docteur a
    // cliqué « stop », démonté la voix ou si l'état a déjà quitté `traitement`,
    // remplacer son geste par `erreur` serait lui mentir sur ce qui s'est passé.
    if (generation !== captureCourante || etatVoix() !== "traitement") return;
    // ⚠️ AUCUNE EXCEPTION NE DOIT LAISSER LA MACHINE EN « traitement ». C'est
    // exactement l'état bloqué qu'on s'interdit : l'orbe tournerait
    // indéfiniment et plus aucun mot de réveil ne passerait.
    log.error("jarvis.reveil.commande", {
      code: "indisponible",
      context: "onCommande",
      causeName: cause instanceof Error ? cause.name : "inconnue",
    });
    annulerSuivi();
    detecteur?.reprendre();
    aller("erreur", fr.jarvis.voix.indisponible);
    return;
  }

  // Si la réponse a déclenché une lecture, `signalerParole` a déjà fait passer
  // la machine en « parole ». Sinon, retour en veille et attente BORNÉE de la
  // première lecture : aucun suivi n'est ouvert tant qu'aucun son n'est sorti.
  //
  // ⚠️ ON RELIT PAR `etatVoix()`, PAS PAR `etat`. TypeScript garde l'affinement
  // établi plus haut (« forcément `ecoute` ») à travers l'`await`, alors que la
  // valeur réelle, elle, a changé plusieurs fois entre-temps. Passer par la
  // fonction lit le FAIT plutôt que la déduction du compilateur.
  if (etatVoix() === "traitement" && generation === captureCourante) {
    detecteur?.reprendre();
    aller("veille");
    attendreParole();
  }
}

/**
 * Harnais voix §29 — rejoue une transcription SYNTHÉTIQUE comme si le STT
 * venait de la rendre : même `traitement`, même `acheminerTranscription`,
 * même retour veille/erreur. C'est par ici que les tests exercent, SANS
 * micro, le pipeline exact que l'audio réel empruntera.
 *
 * Sans objet quand la machine n'est pas armée (`desactive`, `erreur`,
 * `interrompu`) : un harnais qui parlerait à une machine éteinte
 * fabriquerait des verdicts sur du vide. `false` = événement ignoré.
 */
export async function simulerTranscription(texte: string): Promise<boolean> {
  if (detecteur === null) return false;
  if (etat === "desactive" || etat === "erreur" || etat === "interrompu") return false;
  const generation = captureCourante;
  aller("traitement");
  await acheminerTranscription(texte.trim(), generation);
  return true;
}

/**
 * Jarvis parle RÉELLEMENT — appelé sur `onplaying`, jamais sur l'intention de
 * lire. Voir `abonnerLecture` dans `jarvis-voix.ts`.
 *
 * ⚠️ LE DÉTECTEUR RESTE SUSPENDU PENDANT LA PAROLE. C'est un arbitrage assumé :
 * on perd la possibilité de couper Jarvis en disant « Alexa » par-dessus lui,
 * et on gagne la certitude qu'il ne se réveille pas tout seul en s'entendant.
 * L'annulation d'écho du navigateur ne couvre pas le cas d'un haut-parleur
 * externe, courant sur un poste de cabinet. Pour l'interrompre : le clic sur
 * l'orbe, qui appelle `interrompreVoix`.
 */
export function signalerParole(): void {
  if (etat === "desactive") return;

  // ⚠️ LA PAROLE DE L'ACCUSÉ N'EST PAS UNE RÉPONSE. Elle précède l'ouverture
  // du micro ; la prendre pour un tour de parole ferait basculer l'orbe en
  // `parole` puis en `veille` PENDANT la capture. On l'ignore explicitement.
  if (etat === "reveille") {
    log.info("jarvis.voix.paroleIgnoree", { context: "accuse" });
    return;
  }

  // ⚠️ AUCUN TTS NE DOIT DÉMARRER PENDANT LA CAPTURE. Le micro de commande est
  // ouvert : sa propre voix de synthèse s'y enregistrerait, et l'état `parole`
  // masquerait l'écoute en cours.
  if (etat === "ecoute") {
    log.info("jarvis.voix.paroleIgnoree", { context: "capture" });
    return;
  }

  // L'interruption est un état VISIBLE qui doit le rester : une lecture tardive
  // ne le remplace pas.
  if (etat === "interrompu") return;

  // Une lecture commence : ni l'attente bornée ni un suivi déjà programmé ne
  // doivent ouvrir le micro par-dessus elle. C'est sa FIN qui programmera le
  // suivi. L'état `traitement` est explicitement ACCEPTÉ ici : la synthèse peut
  // démarrer après le retour de `onCommande`.
  effacerAttenteParole();
  effacerMinuteurSuivi();

  detecteur?.suspendre();
  aller("parole");

  // Chien de garde : une lecture qui CALE n'émet ni `ended` ni `error`. Sans ce
  // minuteur, l'orbe resterait « parle » pour toujours et plus aucun mot de
  // réveil ne passerait.
  if (chienDeGardeParole !== null) clearTimeout(chienDeGardeParole);
  chienDeGardeParole = setTimeout(() => {
    if (etat !== "parole") return;
    log.warn("jarvis.voix.paroleBloquee", { code: "indisponible" });
    signalerFinParole();
  }, PAROLE_MAX_MS);
}

/** La parole s'est achevée — normalement, ou par erreur, ou par arrêt. */
export function signalerFinParole(): void {
  if (chienDeGardeParole !== null) {
    clearTimeout(chienDeGardeParole);
    chienDeGardeParole = null;
  }
  effacerAttenteParole();
  if (etat !== "parole") return;
  detecteur?.reprendre();
  aller("veille");

  // La réponse est finie : le docteur peut enchaîner sans redire « Alexa ».
  // `annulerSuivi()` (envoi tapé, arrêt manuel) a déjà posé le drapeau à faux.
  programmerSuivi();
}

/**
 * « Stop » — coupe la parole ET la capture en cours.
 *
 * ⚠️ COUPER LES DEUX, TOUJOURS. Ne couper que la lecture laisserait le micro
 * ouvert derrière un assistant qu'on vient de faire taire — un micro ouvert
 * qu'on croit fermé, dans un cabinet, est un défaut d'une autre nature que
 * technique.
 */
export function interrompreVoix(): void {
  if (etat === "desactive") return;
  // Invalide toute clôture en vol : l'endpointeur de la capture qu'on coupe ne
  // doit pas conclure après coup sur la suivante.
  captureCourante += 1;
  annulerSuivi();
  if (chienDeGardeParole !== null) {
    clearTimeout(chienDeGardeParole);
    chienDeGardeParole = null;
  }
  endpointeur?.arreter();
  arreterLecture();
  annulerDictee();
  detecteur?.reprendre();
  aller("interrompu");
  // Retour en veille après un battement : l'état `interrompu` existe pour être
  // VU, pas pour durer.
  setTimeout(() => {
    if (etat === "interrompu") aller("veille");
  }, 800);
}

/** Remet la machine au repos après une erreur, sans la désarmer. */
export function acquitterErreur(): void {
  if (etat !== "erreur") return;
  detecteur?.reprendre();
  aller(
    detecteur === null ? "desactive" : "veille",
    detecteur === null ? fr.jarvis.voix.reveil.aucunDetecteur : null,
  );
}

/**
 * Le niveau sonore courant, 0..1 lissé. Lu par l'orbe dans une boucle `rAF`.
 *
 * ⚠️ CE N'EST PAS DE L'AUDIO. Un scalaire lissé permet d'animer un cercle ; il
 * ne permet de reconstituer aucune parole. C'est la raison pour laquelle il
 * peut traverser la frontière du composant alors que les échantillons, eux, ne
 * le peuvent pas.
 */
export function niveauEcoute(): number {
  return endpointeur?.niveau() ?? 0;
}

// ═══════════════════════════════════════════════════════════════════════════
// 5 · LE CYCLE DE VIE — UN SINGLETON DE MODULE, PAS UN ÉTAT REACT
// ═══════════════════════════════════════════════════════════════════════════

let references = 0;
let demontage: ReturnType<typeof setTimeout> | null = null;

/**
 * Le délai de grâce avant démontage. React en mode strict monte, démonte et
 * remonte immédiatement ; une route qui change fait de même. Fermer les
 * sessions ONNX et rendre le micro dans cet intervalle, pour tout rouvrir
 * 16 ms plus tard, coûte une seconde de chargement à chaque navigation et fait
 * clignoter le voyant micro du navigateur.
 */
const GRACE_MS = 1_500;

/**
 * Retient la voix. Le PREMIER appelant installe le détecteur et l'arme ; les
 * suivants réutilisent. Rend la fonction de relâchement.
 *
 * ⚠️ LE COMPTEUR VIT DANS LE MODULE, PAS DANS REACT. C'est le singleton qui
 * détient la vérité : un `useState` par composant produirait autant de vérités
 * que de montages, et deux d'entre elles finiraient par se contredire.
 */
// ── LE SOUHAIT DE LA PRATICIENNE ──

/**
 * ⚠️ LE MOT DE RÉVEIL NE S'ARME PAS TOUT SEUL AU PREMIER CHARGEMENT.
 *
 * L'armer d'office ouvrirait le micro — et déclencherait la demande de
 * permission du navigateur — à chaque ouverture de MindCare, sans que personne
 * ne l'ait demandé. Dans un cabinet, un micro qui s'allume de lui-même n'est
 * pas un détail d'ergonomie.
 *
 * La praticienne l'active UNE FOIS, d'un clic sur l'orbe. Le choix est retenu
 * sur ce poste et rejoué aux ouvertures suivantes : elle dit « Alexa » sans
 * plus rien avoir à cliquer.
 */
const CLE_SOUHAIT = "mindcare.voix.active";
const abonnesSouhait = new Set<(actif: boolean) => void>();

export function voixSouhaitee(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(CLE_SOUHAIT) === "1";
  } catch {
    // Stockage refusé (navigation privée, politique d'entreprise) : la voix
    // reste utilisable pour la session, simplement non mémorisée.
    return false;
  }
}

export function definirVoixSouhaitee(actif: boolean): void {
  if (typeof window !== "undefined") {
    try {
      if (actif) window.localStorage.setItem(CLE_SOUHAIT, "1");
      else window.localStorage.removeItem(CLE_SOUHAIT);
    } catch {
      // Voir ci-dessus : on n'échoue pas sur un stockage indisponible.
    }
  }
  for (const a of abonnesSouhait) a(actif);
}

export function abonnerSouhait(abonne: (actif: boolean) => void): () => void {
  abonnesSouhait.add(abonne);
  abonne(voixSouhaitee());
  return () => {
    abonnesSouhait.delete(abonne);
  };
}

export function retenirVoix(r: RappelsVoix): () => void {
  references += 1;
  if (demontage !== null) {
    clearTimeout(demontage);
    demontage = null;
  }

  // ⚠️ `armement` N'EST QUE LA TENTATIVE EN VOL, PAS UN ÉTAT ACQUIS. Une fois
  // résolue, elle doit disparaître : sinon un remontage (ou un arrêt/relance)
  // réutilise une promesse déjà tenue, le détecteur reste éteint, et le mot de
  // réveil ne marche plus qu'une fois. On ré-arme donc aussi quand le détecteur
  // a disparu ou que la machine est explicitement désactivée.
  const doitArmer = references === 1 && armement === null &&
    (detecteur === null || etat === "desactive");

  if (doitArmer) {
    const tentative = (async (): Promise<Result<true>> => {
      // Import dynamique : l'ONNX et son WASM ne doivent entrer ni dans le
      // rendu serveur, ni dans le bundle initial. L'application s'affiche sans
      // attendre 16 Mio de runtime.
      const { creerDetecteurVosk } = await import("./reveil-vosk");
      installerDetecteur(creerDetecteurVosk((code) => void relancerArmement(code)));
      return await armerReveil(r);
    })();
    armement = tentative;
    void tentative.then((resultat) => {
      if (!resultat.ok) log.warn("jarvis.reveil.armementEchoue", { code: resultat.error.code });
    }).finally(() => {
      if (armement === tentative) armement = null;
    });
  }

  let relachee = false;
  return () => {
    if (relachee) return; // idempotent : un double démontage ne fait pas tomber le compteur
    relachee = true;
    references -= 1;
    if (references > 0) return;
    references = 0;
    demontage ??= setTimeout(() => {
      demontage = null;
      if (references > 0) return; // quelqu'un est revenu pendant la grâce
      armement = null;
      desarmerReveil();
      installerDetecteur(null);
    }, GRACE_MS);
  };
}
