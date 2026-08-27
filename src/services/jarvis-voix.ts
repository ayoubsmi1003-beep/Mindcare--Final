/**
 * La voix de Jarvis — V-JARVIS-CORE.
 *
 * Dictée : `MediaRecorder` presser-pour-parler → base64 → Edge
 * `jarvis-voice-in` (Groq Whisper). Lecture : bouton par bulle → Edge
 * `jarvis-voice-out` (ElevenLabs) en flux binaire → Blob URL → élément audio.
 *
 * ═══ FRONTIÈRES, ET ELLES NE BOUGENT PAS ═══
 * · Le transport passe PAR LE PORT (`invokeFunction`/`invokeFunctionStream`)
 *   — aucun fetch direct ici ; l'adaptateur porte l'exemption nommée.
 * · AUCUN AUDIO SUR DISQUE : ni cache, ni IndexedDB, ni fichier (contrôle 3 du
 *   préflight). Les blobs vivent en mémoire et sont révoqués à la fin.
 * · Les capacités se DÉCOUVRENT par les codes d'erreur de la passerelle :
 *   `configuration` = non activée pour ce déploiement (bouton inerte nommé),
 *   `frontiere` = navigateur sans API requise. L'interface ne devine jamais
 *   une capacité, elle la constate.
 */

import { fr } from "@/i18n/fr";

import { db } from "./db";
import { logFieldsFor } from "./errors";
import { log } from "./log";
import { prendreMicro, type PriseMicro } from "./micro-partage";
import { err, ok, type Result } from "./result";

/** MIME acceptés des deux côtés (allowlist commune à la passerelle). */
const MIMES_DICTEE = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
] as const;

export interface CapacitesVoix {
  /** MediaRecorder + getUserMedia disponibles dans CE navigateur. */
  readonly dicteePossible: boolean;
  readonly mimeDictée: string | null;
}

export function detecterCapacitesVoix(): CapacitesVoix {
  if (typeof window === "undefined" || typeof MediaRecorder === "undefined") {
    return { dicteePossible: false, mimeDictée: null };
  }
  for (const mime of MIMES_DICTEE) {
    if (MediaRecorder.isTypeSupported(mime)) {
      return { dicteePossible: true, mimeDictée: mime };
    }
  }
  // Un recorder existe mais aucun conteneur connu : on tentera le défaut du
  // navigateur — la passerelle validera le MIME réel, pas la promesse.
  return { dicteePossible: true, mimeDictée: null };
}

// ═══════════════════════════════════════════════════════════════════════════
// DICTÉE — presser-pour-parler
// ═══════════════════════════════════════════════════════════════════════════

interface DicteeEnCours {
  recorder: MediaRecorder;
  prise: PriseMicro;
  fragments: Blob[];
  /** Horodatage de départ — sert la seule métrique de durée, jamais l'audio. */
  debut: number;
}

let dictee: DicteeEnCours | null = null;

/**
 * Démarre l'enregistrement. Le micro ne s'allume QUE sur un geste explicite ;
 * le flux caméra/micro est arrêté dès l'arrêt — jamais laissé ouvert derrière
 * un écran verrouillé.
 */
export async function demarrerDictee(): Promise<Result<true>> {
  if (dictee !== null) return err({ code: "conflit", message: fr.jarvis.voix.dejaEnCours });
  if (typeof MediaRecorder === "undefined") {
    return err({ code: "indisponible", message: fr.jarvis.voix.microIndisponible });
  }

  // ⚠️ LE MICRO VIENT DU COURTIER. Ouvrir un second `getUserMedia` pendant que
  // le détecteur de mot de réveil tient déjà le sien fait redemander la
  // permission sous Firefox et peut échouer sous Safari — au moment précis où
  // la praticienne vient de dire « Alexa » et attend d'être entendue.
  const acces = await prendreMicro();
  if (!acces.ok) return err(acces.error);
  const prise = acces.data;

  const capacites = detecterCapacitesVoix();
  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(
      prise.flux,
      capacites.mimeDictée === null ? undefined : { mimeType: capacites.mimeDictée },
    );
  } catch {
    // Conteneur refusé par CE navigateur : on rend le micro plutôt que de le
    // laisser ouvert derrière un enregistreur qui n'existe pas.
    prise.rendre();
    return err({ code: "indisponible", message: fr.jarvis.voix.microIndisponible });
  }
  const fragments: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) fragments.push(e.data);
  };
  recorder.start(250); // fragment toutes les 250 ms — stop net, pas de queue perdue

  dictee = { recorder, prise, fragments, debut: Date.now() };

  // ⚠️ DIAGNOSTIC : DES MÉTADONNÉES, JAMAIS UN ÉCHANTILLON.
  // Ce qui a manqué le 2026-08-27 n'était pas l'audio — c'était de savoir si
  // un octet partait seulement. Le conteneur réellement retenu par CE
  // navigateur est un repère de format, pas une donnée de patiente ; il change
  // d'un navigateur à l'autre et décide de l'extension envoyée au fournisseur.
  // `LogFields` reste FERMÉE : aucun champ nouveau, donc aucun canal nouveau.
  log.info("jarvis.voix.enregistrementDemarre", { context: recorder.mimeType || "inconnu" });
  return ok(true);
}

/** Arrête et transcrit. Résout le texte reconnu, ou une erreur nommée. */
export async function arreterEtTranscrire(): Promise<Result<string>> {
  const enCours = dictee;
  if (enCours === null) return err({ code: "regle-metier", message: fr.jarvis.voix.aucuneDictee });
  dictee = null;

  // ═══ LE CONTRAT DE FINALISATION ═══
  //
  // ⚠️ `stop()` NE SIGNIFIE PAS « LE BLOB EXISTE ». Le dernier `dataavailable`
  // est émis APRÈS l'appel, juste avant `onstop`. Assembler le blob sans
  // attendre `onstop` fait perdre le dernier fragment — donc la fin de la
  // phrase, systématiquement, et sans aucune erreur visible.
  const fini = new Promise<void>((resoudre) => {
    enCours.recorder.onstop = () => resoudre();
    // Un `onstop` qui n'arrive jamais laisserait cette promesse en suspens et
    // la machine à états bloquée en « traitement ». On borne l'attente.
    setTimeout(resoudre, 2_000);
  });
  try {
    enCours.recorder.stop();
  } catch {
    // Déjà arrêté : la promesse est résolue par le minuteur ci-dessus.
  }
  await fini;
  enCours.prise.rendre();

  if (enCours.fragments.length === 0) {
    return err({ code: "regle-metier", message: fr.jarvis.voix.aucuneDictee });
  }
  const blob = new Blob(enCours.fragments, { type: enCours.recorder.mimeType || "audio/webm" });

  // Octets, durée, conteneur — de quoi distinguer « le micro n'a rien capté »
  // de « le fournisseur a refusé un audio valide », qui étaient jusqu'ici le
  // même écran. Ni transcription, ni base64, ni échantillon.
  log.info("jarvis.voix.enregistrementClos", {
    count: blob.size,
    durationMs: Date.now() - enCours.debut,
    context: blob.type,
  });

  // Audio vide malgré des fragments : conteneur sans piste. On le CONSTATE
  // plutôt que de payer une transcription pour du néant.
  if (blob.size === 0) {
    return err({ code: "regle-metier", message: fr.jarvis.voix.aucuneDictee });
  }

  // Plafond aligné sur la passerelle (10 Mio APRÈS décodage) : on refuse plus
  // tôt avec un mot clair plutôt qu'un 413 opaque après coup.
  if (blob.size > 8_000_000) {
    return err({ code: "regle-metier", message: fr.jarvis.voix.tropLongue });
  }

  const base64 = await blobEnBase64(blob);
  const resultat = await db().invokeFunction<{ texte: string }>("jarvis-voice-in", {
    audioBase64: base64,
    mimeType: blob.type,
  });

  if (!resultat.ok) {
    log.warn("jarvis.voix.dictation", logFieldsFor(resultat.error));
    return err(resultat.error);
  }
  return ok(resultat.data.texte);
}

/** Annule sans envoyer : le fragment jeté, le micro rendu. */
export function annulerDictee(): void {
  const enCours = dictee;
  if (enCours === null) return;
  dictee = null;
  try {
    enCours.recorder.stop();
  } catch {
    // déjà arrêté
  }
  enCours.prise.rendre();
}

function blobEnBase64(blob: Blob): Promise<string> {
  return new Promise((resoudre, rejeter) => {
    const lecteur = new FileReader();
    lecteur.onloadend = () => {
      const brut = lecteur.result;
      if (typeof brut !== "string") {
        rejeter(new Error("lecture-audio-vide"));
        return;
      }
      const virgule = brut.indexOf(",");
      resoudre(virgule >= 0 ? brut.slice(virgule + 1) : "");
    };
    lecteur.onerror = () => rejeter(new Error("lecture-audio"));
    lecteur.readAsDataURL(blob);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// LECTURE — un bouton par bulle, un seul son à la fois
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Délai au-delà duquel une lecture qui n'a émis aucun son est déclarée en
 * échec. Assez large pour un décodage lent, assez court pour qu'un orbe ne
 * reste pas « en train de parler » devant une praticienne qui n'entend rien.
 */
const DELAI_PREMIER_SON_MS = 5_000;

let lectureEnCours: { audio: HTMLAudioElement; url: string } | null = null;

// ═══════════════════════════════════════════════════════════════════════════
// L'ÉTAT DE LECTURE — CE QUE LE NAVIGATEUR FAIT, PAS CE QU'ON LUI A DEMANDÉ
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ⚠️ « JARVIS PARLE » EST UN FAIT OBSERVÉ, PAS UNE INTENTION.
 *
 * `await audio.play()` ne veut dire que « la requête a été acceptée ». Entre
 * cette acceptation et le premier échantillon audible, il y a le décodage, le
 * tampon, et la politique d'autoplay du navigateur — chacun capable d'échouer.
 * Annoncer la parole sur `play()` afficherait un orbe qui parle dans le silence.
 *
 * On ne publie donc `true` que sur `playing` (élément audio) ou `start`
 * (synthèse locale) : les deux seuls événements qui signifient qu'un son sort
 * réellement du haut-parleur.
 */
type AbonneLecture = (enLecture: boolean) => void;
const abonnesLecture = new Set<AbonneLecture>();
let enLecture = false;

function publierLecture(valeur: boolean): void {
  if (enLecture === valeur) return; // pas de doublon : `pause` suit `ended`
  enLecture = valeur;
  for (const a of abonnesLecture) a(valeur);
}

export function abonnerLecture(abonne: AbonneLecture): () => void {
  abonnesLecture.add(abonne);
  abonne(enLecture);
  return () => {
    abonnesLecture.delete(abonne);
  };
}

/** Une lecture est-elle réellement en cours ? Un FAIT, pas une supposition. */
export function lectureActive(): boolean {
  return enLecture;
}

/** Stoppe toute lecture en cours et révoque le blob — avant d'en lancer une autre. */
export function arreterLecture(): void {
  // La synthèse LOCALE aussi : « Stop » doit couper la voix quelle qu'en soit
  // la source. Une seule des deux coupées, et l'orbe afficherait « arrêté »
  // pendant que Jarvis continue de parler.
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
  const enCours = lectureEnCours;
  if (enCours === null) {
    publierLecture(false);
    return;
  }
  lectureEnCours = null;
  // On détache les gestionnaires AVANT `pause()` : sinon `onpause` republierait
  // un état qu'on vient déjà de clore.
  enCours.audio.onplaying = null;
  enCours.audio.onended = null;
  enCours.audio.onerror = null;
  enCours.audio.onpause = null;
  enCours.audio.pause();
  URL.revokeObjectURL(enCours.url);
  publierLecture(false);
}

/**
 * ═══ LA SYNTHÈSE LOCALE — ET POURQUOI ELLE N'EST PAS UN REPLI DE CONFORT ═══
 *
 * ⚠️ FUITE RÉELLE, CORRIGÉE ICI. Jusqu'à cette passe, `lireTexte` recevait le
 * texte DÉJÀ RÉHYDRATÉ — donc portant les vrais noms — et l'envoyait à
 * ElevenLabs. Le franchissement était journalisé sous `voix-sortie`, mais la
 * pseudonymisation, elle, n'intervenait nulle part sur ce chemin. Toute
 * l'architecture de jetons protégeait le modèle de raisonnement et laissait le
 * synthétiseur vocal recevoir « BELKACEM Nadia » en clair.
 *
 * La bascule est STRUCTURELLE, pas heuristique : on regarde si le texte porte
 * un `{{JETON}}` AVANT rendu. Une heuristique sur le contenu (« est-ce que ça
 * ressemble à un nom ? ») se tromperait en silence ; la présence d'un jeton est
 * un fait, pas une estimation.
 *
 * ⚠️ EN CAS DE DOUTE, LOCAL. La voix locale est moins belle. Une voix moins
 * belle est un inconvénient ; un nom de patiente chez un fournisseur tiers est
 * une infraction à la règle 1. Le sens du défaut n'est pas discutable.
 */
function synthetiseurLocalDisponible(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

async function lireEnLocal(texte: string): Promise<Result<true>> {
  if (!synthetiseurLocalDisponible()) {
    // Ni voix externe (interdite ici — le texte porte une identité), ni voix
    // locale. On le DIT, on ne dégrade pas vers l'externe en silence.
    return err({ code: "indisponible", message: fr.jarvis.voix.localeIndisponible });
  }
  return await new Promise<Result<true>>((resoudre) => {
    const enonce = new SpeechSynthesisUtterance(texte);
    enonce.lang = "fr-FR";
    enonce.onstart = () => publierLecture(true);
    enonce.onend = () => {
      publierLecture(false);
      resoudre(ok(true));
    };
    enonce.onerror = () => {
      publierLecture(false);
      resoudre(err({ code: "indisponible", message: fr.jarvis.voix.indisponible }));
    };
    window.speechSynthesis.speak(enonce);
  });
}

/**
 * Lit un texte à voix haute.
 *
 * `porteUneIdentite` est décidé par l'APPELANT, qui seul sait si le texte
 * provenait d'une réponse à jetons (voir `CarteIdentite.porteUneReference`).
 * Ce fichier ne devine pas : deviner ici serait remettre une décision de
 * frontière à une heuristique de chaîne de caractères.
 */
export async function lireTexte(
  texte: string,
  porteUneIdentite = false,
): Promise<Result<true>> {
  arreterLecture(); // un seul son à la fois — relire A remplace B, sans doublon

  // Plafond côté client, aligné sur la passerelle (2000 car.) : refus immédiat
  // lisible plutôt qu'un aller-retour voué à l'échec.
  if (texte.length > 2000) {
    return err({ code: "regle-metier", message: fr.jarvis.voix.texteTropLong });
  }
  if (texte.trim() === "") {
    return err({ code: "regle-metier", message: fr.jarvis.voix.indisponible });
  }

  // ── LA BASCULE ──
  // Interrupteur d'exploitation : tout en local, quel que soit le contenu.
  const toutEnLocal =
    typeof process !== "undefined" &&
    process.env["NEXT_PUBLIC_JARVIS_TTS_LOCAL_ONLY"] === "true";
  if (porteUneIdentite || toutEnLocal) {
    return await lireEnLocal(texte);
  }

  const flux = await db().invokeFunctionStream("jarvis-voice-out", { texte: texte.slice(0, 2000) });
  if (!flux.ok) return err(flux.error);

  try {
    const tampon = await new Response(flux.data).arrayBuffer();
    // ElevenLabs rend du MP3 ; la passerelle ne change pas le conteneur.
    if (tampon.byteLength === 0) {
      // ⚠️ UN FLUX VIDE N'EST PAS UNE LECTURE RÉUSSIE. Le déclarer tel quel
      // ferait dire à l'orbe que Jarvis parle alors que rien ne sortira jamais.
      return err({ code: "indisponible", message: fr.jarvis.voix.indisponible });
    }
    const url = URL.createObjectURL(new Blob([tampon], { type: "audio/mpeg" }));
    const audio = new Audio(url);
    lectureEnCours = { audio, url };

    // On attend le PREMIER SON, pas l'acceptation de la requête. Voir le
    // commentaire d'`abonnerLecture`.
    const demarre = new Promise<boolean>((resoudre) => {
      audio.onplaying = () => {
        publierLecture(true);
        resoudre(true);
      };
      audio.onerror = () => resoudre(false);
      // Un `playing` qui n'arrive jamais — flux qui cale, périphérique de sortie
      // absent — laisserait cette promesse en suspens et la machine bloquée.
      setTimeout(() => resoudre(false), DELAI_PREMIER_SON_MS);
    });
    audio.onended = () => arreterLecture();
    audio.onpause = () => publierLecture(false);

    await audio.play();
    if (!(await demarre)) {
      arreterLecture();
      log.warn("jarvis.voix.jamaisDemarree", { code: "indisponible" });
      return err({ code: "indisponible", message: fr.jarvis.voix.indisponible });
    }
    return ok(true);
  } catch (cause) {
    arreterLecture();
    // Autoplay bloqué sans geste utilisateur : erreur nommée, pas un aveu.
    if (cause instanceof DOMException && cause.name === "NotAllowedError") {
      return err({ code: "interdit", message: fr.jarvis.voix.lectureBloquee });
    }
    const echec = { code: "indisponible" as const, message: fr.jarvis.voix.indisponible };
    log.warn("jarvis.voix.lecture", logFieldsFor(echec));
    return err(echec);
  }
}
