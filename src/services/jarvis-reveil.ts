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
 * vivent derrière, dans `reveil-openwakeword.ts`. C'est ce qui a permis de
 * passer de « Hey Jarvis » à « Alexa » sans toucher une ligne ici.
 *
 *   Assistant .......... JARVIS — c'est lui qu'on réveille.
 *   Mot de réveil ...... ALEXA — l'étiquette sonore, rien de plus.
 *   Moteur ............. openWakeWord, ONNX, exécuté en WASM, hors ligne.
 *
 * Le détecteur livré (`creerDetecteurOpenWakeWord`) est LOCAL : ses modèles et
 * son runtime sont servis depuis `public/wakeword/`, et rien ne part sur le
 * réseau pendant l'écoute. Les alternatives ont été écartées pour cette raison
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

import { fr } from "@/i18n/fr";

import { creerEndpointeurEnergie, type Endpointeur, type MotifFin } from "./endpointage-voix";
import {
  abonnerLecture,
  arreterEtTranscrire,
  arreterLecture,
  annulerDictee,
  demarrerDictee,
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
 * Branche un détecteur. Appelé au démarrage de l'application SI un moteur a été
 * retenu et que sa licence a été lue.
 */
export function installerDetecteur(d: DetecteurReveil | null): void {
  detecteur?.arreter();
  detecteur = d;
  publier();
}

/** Le moteur installé, ou `null`. Consommé par le rapport de mesure. */
export function detecteurInstalle(): DetecteurReveil | null {
  return detecteur;
}

// ═══════════════════════════════════════════════════════════════════════════
// 3 · L'ÉTAT
// ═══════════════════════════════════════════════════════════════════════════

let etat: EtatVoix = "desactive";
// L'état de départ est « pas encore allumée », PAS « moteur absent » : au
// premier chargement rien n'a été tenté, donc rien ne permet d'affirmer qu'un
// moteur manque. On ne diagnostique pas une panne qu'on n'a pas constatée.
let raison: string | null = fr.jarvis.voix.reveil.nonActivee;
const abonnes = new Set<Abonne>();

function vue(): VueVoix {
  return { etat, raison, reveilArme: detecteur !== null && etat !== "desactive" };
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
    aller("erreur", fr.jarvis.voix.reveil.microRefuse);
    return err(demarrage.error);
  }

  // L'état `parole` doit refléter une LECTURE RÉELLE, pas une intention. On
  // s'abonne à ce que le navigateur rapporte vraiment (`onplaying`/`onended`),
  // jamais au fait d'avoir demandé une lecture.
  quitterLecture?.();
  quitterLecture = abonnerLecture((enLecture) => {
    if (enLecture) signalerParole();
    else signalerFinParole();
  });

  aller("veille");
  log.info("jarvis.reveil.arme", { context: `moteur:${detecteur.nom}` });
  return ok(true);
}

export function desarmerReveil(): void {
  captureCourante += 1; // invalide toute clôture en vol
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
export async function declencherEcoute(): Promise<void> {
  if (etat === "parole") arreterLecture();
  // Une activation pendant l'écoute ou le traitement est IGNORÉE : la commande
  // en cours a la priorité, sinon deux captures se chevaucheraient sur un seul
  // micro et la seconde échouerait en « déjà en cours ».
  if (etat === "ecoute" || etat === "traitement" || etat === "desactive") return;

  aller("reveille");
  // Le détecteur se tait pendant la capture : la commande de la praticienne ne
  // doit pas se réveiller elle-même.
  detecteur?.suspendre();

  const demarrage = await demarrerDictee();
  if (!demarrage.ok) {
    detecteur?.reprendre();
    aller("erreur", demarrage.error.message);
    return;
  }

  const jeton = (captureCourante += 1);
  aller("ecoute");

  // ⚠️ SANS CECI, L'ENREGISTREMENT NE S'ARRÊTE JAMAIS. C'était le maillon
  // manquant de toute la boucle vocale : `cloturerCommande` existait sans
  // appelant, et le contrat du détecteur ne porte aucun signal de fin de parole.
  endpointeur ??= creerEndpointeurEnergie();
  const mesure = endpointeur.demarrer((motif: MotifFin) => {
    void cloturerCommande(jeton, motif);
  });
  if (!mesure.ok) {
    // Pas de mesure d'énergie : on ne laisse PAS un micro ouvert sans horizon.
    // Le plafond dur reste, porté par un minuteur simple.
    log.warn("voix.endpointIndisponible", { code: mesure.error.code });
    setTimeout(() => void cloturerCommande(jeton, "plafond"), 15_000);
  }
}

/**
 * Clôt la capture et transmet la commande. Appelé par la détection de fin de
 * parole du détecteur, ou par un geste de l'interface.
 */
export async function cloturerCommande(jeton?: number, motif?: MotifFin): Promise<void> {
  // ── LES TROIS VERROUS D'IDEMPOTENCE ──
  // 1 · un appel d'une capture PÉRIMÉE ne clôt pas la capture courante ;
  if (jeton !== undefined && jeton !== captureCourante) return;
  // 2 · on ne clôt que ce qui est en cours d'écoute ;
  if (etat !== "ecoute") return;
  // 3 · la transition est SYNCHRONE et précède tout `await` : un second appelant
  //     arrivé dans le même tour de boucle voit déjà « traitement » et repart.
  aller("traitement");

  endpointeur?.arreter();

  // Un faux réveil n'a produit aucune parole. On JETTE l'audio au lieu de payer
  // une transcription pour du silence — et on ne montre aucune erreur : afficher
  // un échec ferait croire à une panne à chaque claquement de porte.
  if (motif === "faux-reveil") {
    annulerDictee();
    detecteur?.reprendre();
    aller("veille");
    log.info("jarvis.reveil.fauxReveil", { count: 1 });
    return;
  }

  // `arreterEtTranscrire` porte le contrat de finalisation : arrêt du recorder,
  // attente du dernier fragment ET de `onstop`, assemblage, validation du
  // non-vide, puis UNE seule requête. Voir `jarvis-voix.ts`.
  const transcription = await arreterEtTranscrire();
  if (!transcription.ok) {
    detecteur?.reprendre();
    aller("erreur", transcription.error.message);
    return;
  }
  const texte = transcription.data.trim();
  if (texte === "") {
    detecteur?.reprendre();
    aller("veille");
    log.info("jarvis.reveil.fauxReveil", { count: 1 });
    return;
  }

  // ⚠️ LE DÉTECTEUR RESTE SUSPENDU PENDANT LA RÉPONSE. Il reprendra à la fin de
  // `parole` (voir `signalerFinParole`) ou ici même si rien n'est lu. Le
  // réveiller maintenant le ferait entendre la voix de Jarvis.
  try {
    await rappels?.onCommande(texte);
  } catch (cause) {
    // ⚠️ AUCUNE EXCEPTION NE DOIT LAISSER LA MACHINE EN « traitement ». C'est
    // exactement l'état bloqué qu'on s'interdit : l'orbe tournerait
    // indéfiniment et plus aucun mot de réveil ne passerait.
    log.error("jarvis.reveil.commande", {
      code: "indisponible",
      context: "onCommande",
      causeName: cause instanceof Error ? cause.name : "inconnue",
    });
    detecteur?.reprendre();
    aller("erreur", fr.jarvis.voix.indisponible);
    return;
  }

  // Si la réponse a déclenché une lecture, `signalerParole` a déjà fait passer
  // la machine en « parole » — on ne l'écrase pas. Sinon, retour en veille.
  //
  // ⚠️ ON RELIT PAR `etatVoix()`, PAS PAR `etat`. TypeScript garde l'affinement
  // établi plus haut (« forcément `ecoute` ») à travers l'`await`, alors que la
  // valeur réelle, elle, a changé plusieurs fois entre-temps. Passer par la
  // fonction lit le FAIT plutôt que la déduction du compilateur.
  if (etatVoix() === "traitement") {
    detecteur?.reprendre();
    aller("veille");
  }
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
  if (etat !== "parole") return;
  detecteur?.reprendre();
  aller("veille");
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
let armement: Promise<Result<true>> | null = null;

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

  if (references === 1 && armement === null) {
    armement = (async (): Promise<Result<true>> => {
      // Import dynamique : l'ONNX et son WASM ne doivent entrer ni dans le
      // rendu serveur, ni dans le bundle initial. L'application s'affiche sans
      // attendre 16 Mio de runtime.
      const { creerDetecteurOpenWakeWord } = await import("./reveil-openwakeword");
      installerDetecteur(creerDetecteurOpenWakeWord());
      return await armerReveil(r);
    })();
    void armement.then((resultat) => {
      if (!resultat.ok) log.warn("jarvis.reveil.armementEchoue", { code: resultat.error.code });
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
