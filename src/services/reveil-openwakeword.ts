/**
 * `reveil-openwakeword.ts` — LE DÉTECTEUR DE MOT DE RÉVEIL, ENTIÈREMENT LOCAL.
 *
 * ═══ QUI EST QUI ═══
 *
 *   Assistant .......... JARVIS — l'orchestrateur, les outils, la voix, l'orbe.
 *   Mot de réveil ...... ALEXA — le mot prononcé pour le réveiller.
 *   Moteur ............. openWakeWord, modèles ONNX, ONNX Runtime Web (WASM).
 *   Exécution .......... locale, hors ligne, dans le navigateur.
 *
 * ⚠️ ALEXA N'EST PAS L'ASSISTANT. C'est une étiquette sonore, et rien d'autre :
 * aucun service Amazon n'est appelé, aucune donnée ne part. Dire « Alexa »
 * réveille JARVIS. Ce fichier est le seul du dépôt où le mot « Alexa » a un
 * sens ; partout ailleurs, « Jarvis » désigne l'assistant et doit le rester.
 *
 * ═══ CE QUI TOURNE, ET OÙ ═══
 *
 * Tout, sur la machine du cabinet. Le micro alimente trois modèles ONNX servis
 * depuis `public/wakeword/`. AUCUNE requête réseau n'est émise pendant
 * l'écoute — c'est la seule raison pour laquelle une écoute permanente est
 * acceptable dans un cabinet de psychiatrie (règle 1).
 *
 * ⚠️ LES FICHIERS WASM SONT AUTO-HÉBERGÉS, ET C'EST OBLIGATOIRE. Par défaut,
 * `onnxruntime-web` va chercher son runtime sur un CDN : l'orbe se mettrait
 * alors à écouter APRÈS avoir contacté un tiers, et le premier poste hors ligne
 * n'aurait pas de mot de réveil du tout. `wasmPaths` pointe donc sur
 * `public/wakeword/ort/`. Si ces fichiers manquent, `disponible()` rend `false`
 * et rien ne démarre — jamais un repli silencieux vers le réseau.
 *
 * ═══ LE PIPELINE, MESURÉ SUR LES MODÈLES RÉELLEMENT PRÉSENTS ═══
 *
 *   audio 16 kHz, 1280 échantillons (80 ms) + 480 de contexte gauche
 *     → melspectrogram.onnx   [1,1760]    → [1,1,8,32]
 *     → embedding_model.onnx  [1,76,32,1] → [1,1,1,96]
 *     → alexa.onnx            [1,16,96]   → [1,1]  = un score
 *
 * ⚠️ LES 480 ÉCHANTILLONS DE CONTEXTE NE SONT PAS UN DÉTAIL — voir
 * `CONTEXTE_GAUCHE`. Sans eux le mel rend 5 trames au lieu de 8, l'axe du temps
 * se dilate de 1,6× et le mot n'est plus reconnu, sans qu'aucune erreur ne soit
 * levée nulle part.
 *
 * ⚠️ LES NOMS DE TENSEURS SONT LUS DANS LE GRAPHE, JAMAIS ÉCRITS EN DUR. La
 * migration « Hey Jarvis » → « Alexa » l'a prouvé à nos dépens : les deux
 * modèles ont la même FORME d'entrée `[1,16,96]` mais des NOMS différents
 * (`x.1` contre `onnx::Flatten_0`). Un nom codé en dur transforme un simple
 * remplacement de fichier en panne à l'exécution — au moment précis où
 * quelqu'un croit n'avoir « changé qu'un modèle ».
 */

import type { DetecteurReveil } from "./jarvis-reveil";
import { contexteAudioPartage, prendreMicro, sourcePartagee, type PriseMicro } from "./micro-partage";
import { err, ok, type Result } from "./result";
import { fr } from "@/i18n/fr";
import { log } from "./log";

// ═══════════════════════════════════════════════════════════════════════════
// 1 · CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

/** Dossier des modèles, servi statiquement. Jamais une URL distante. */
const RACINE = "/wakeword";

/**
 * Le modèle du mot de réveil. Configurable parce que le mot est une DÉCISION
 * PRODUIT, pas une constante technique : en changer se fait en déposant un
 * fichier et en réglant cette variable, sans toucher une ligne de ce module.
 *
 * Valeur par défaut : le fichier réellement présent au dépôt, `alexa.onnx`.
 * Pas `alexa_v0.1.onnx` — le nom d'archive amont — parce que ce module doit
 * viser le fichier QUI EXISTE, pas celui qu'on croit avoir téléchargé.
 */
const MODELE_MOT = process.env["NEXT_PUBLIC_WAKEWORD_MODELE"] ?? "alexa.onnx";

/**
 * Le seuil de déclenchement, entre 0 et 1.
 *
 * ⚠️ CE N'EST PAS UN BOUTON POUR « FAIRE MARCHER » UN MODÈLE QUI NE CONVIENT
 * PAS. Baisser le seuil ne rend pas un détecteur plus juste : il le rend plus
 * bavard. Dans un cabinet où la praticienne parle une heure d'affilée, chaque
 * point de seuil perdu se paie en micros qui s'ouvrent au milieu d'une
 * consultation. On ne l'ajuste qu'après avoir MESURÉ faux réveils et réveils
 * manqués, jamais pour rattraper un mauvais modèle.
 */
const SEUIL = Number(process.env["NEXT_PUBLIC_WAKEWORD_SEUIL"] ?? "0.5");

/**
 * La fréquence d'entraînement des modèles. Le courtier impose la même au
 * contexte partagé ; la constante reste ici pour VÉRIFIER cette concordance au
 * démarrage plutôt que de la supposer — un contexte à 48 kHz produirait des
 * scores absurdes sans jamais lever d'erreur.
 */
const TAUX = 16_000;
const ECHANTILLONS_PAR_TRAME = 1280; // 80 ms

/**
 * ⚠️ LE CONTEXTE GAUCHE — TROIS SAUTS DE 160 ÉCHANTILLONS, ET C'EST OBLIGATOIRE.
 *
 * DÉFAUT MESURÉ LE 2026-08-27, ET IL EXPLIQUE POURQUOI « ALEXA » N'ÉTAIT PAS
 * RECONNU ALORS QUE TOUTE LA CHAÎNE ONNX TOURNAIT. `melspectrogram.onnx` rend
 * un nombre de trames qui dépend de la LONGUEUR qu'on lui donne :
 *
 *     1280 échantillons  →  5 trames mel     ← ce que faisait ce fichier
 *     1760 échantillons  →  8 trames mel     ← ce que fait openWakeWord
 *
 * openWakeWord appelle le modèle sur `raw_data_buffer[-n_samples - 160*3:]`
 * (`utils.py`, `_streaming_melspectrogram`) : les 1280 échantillons du pas
 * COURANT, précédés de 480 échantillons DÉJÀ CONSOMMÉS. Ce recouvrement n'est
 * pas un raffinement — il produit les 8 trames que la suite du graphe attend,
 * et il évite le remplissage par zéros au bord de chaque bloc de 80 ms.
 *
 * En n'envoyant que 1280, on produisait 5 trames là où il en faut 8. La fenêtre
 * de 76 trames couvrait alors 76/5 × 80 ms = 1216 ms d'audio au lieu de
 * 76/8 × 80 ms = 760 ms : L'AXE DU TEMPS ÉTAIT DILATÉ D'UN FACTEUR 1,6. Le
 * détecteur cherchait un « Alexa » prononcé 1,6 fois trop lentement. Rien
 * n'échoue, rien ne lève : les scores restent simplement au plancher.
 *
 * Mesuré sur de la parole réelle, seuil 0,5 (`eval-reveil-pipeline`) :
 *
 *                        sans contexte      avec contexte
 *     « Alexa »              0,999986          0,999995
 *     « Alexa » (2)          0,957989          0,999999
 *     « Alexa, bonjour »     0,094701  RATÉ    0,847221  DÉTECTÉ
 *     phrase témoin          0,000006          0,000004
 *
 * La troisième ligne est le défaut en entier : le mot suivi de n'importe quoi
 * — c'est-à-dire l'usage RÉEL, où l'on enchaîne « Alexa, ... » — passait sous
 * le seuil. Le témoin reste au plancher : le correctif ne rend pas le
 * détecteur bavard, il le rend juste.
 */
const CONTEXTE_GAUCHE = 160 * 3; // 480 échantillons, 30 ms
const MEL_PAR_FENETRE = 76;
const MEL_PAR_PAS = 8;
const EMBEDDINGS_ATTENDUS = 16;
const LARGEUR_MEL = 32;
const TAILLE_EMBEDDING = 96;

/** Silence imposé après un réveil : sans lui, un seul mot en déclencherait dix. */
const REFRACTAIRE_MS = 2_000;

// ═══════════════════════════════════════════════════════════════════════════
// 1 bis · L'INSTRUMENT — CE QU'ON PEUT CONSTATER SANS ENTENDRE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ⚠️ CET INSTRUMENT EXISTE PARCE QUE « ÇA NE MARCHE PAS » N'EST PAS UN
 * DIAGNOSTIC. Quand la praticienne dit « Alexa » et que rien ne se passe, il y
 * a au moins six causes possibles — micro muet, mauvaise fréquence, trames
 * jetées, chaîne ONNX morte, score sous le seuil, réfractaire actif — et rien à
 * l'écran ne permet de les distinguer. Elles se distinguent ici.
 *
 * ⚠️ AUCUN ÉCHANTILLON, AUCUN SPECTRE, AUCUN AUDIO. Uniquement des scalaires
 * agrégés : un niveau, des compteurs, un score maximal. Il n'y a rien ici dont
 * on puisse reconstituer une parole — la règle 1 tient par la FORME de cet
 * objet, pas par une consigne d'usage.
 */
export interface DiagnosticReveil {
  /** La fréquence RÉELLE du contexte audio, pas celle qu'on a demandée. */
  readonly frequence: number;
  /** Échantillons reçus du micro depuis l'armement. Zéro = micro muet. */
  readonly echantillons: number;
  /** Niveau efficace de la dernière trame. Proche de 0 = micro coupé ou silence. */
  readonly rms: number;
  /** Crête de la dernière trame. Proche de 1 = saturation. */
  readonly crete: number;
  /** Nombre de scores calculés. Zéro alors que `echantillons` monte = chaîne bloquée. */
  readonly inferences: number;
  /**
   * Trames JETÉES parce que l'inférence précédente durait encore. Voir le
   * commentaire de `enCours` : ce rejet est délibéré, mais il était jusqu'ici
   * INVISIBLE. S'il grimpe avec les échantillons, le poste n'a pas les moyens de
   * scorer en temps réel et le mot de réveil sera manqué SANS AUCUNE ERREUR.
   */
  readonly tramesJetees: number;
  /** Le plus haut score vu depuis l'armement. À comparer au seuil. */
  readonly scoreMax: number;
  readonly seuil: number;
}

const diagnostic = {
  frequence: 0,
  echantillons: 0,
  rms: 0,
  crete: 0,
  inferences: 0,
  tramesJetees: 0,
  scoreMax: 0,
};

/**
 * L'état mesuré du détecteur. Destiné au développement et au rapport de mesure.
 * Sûr à appeler en production — il ne rend que les scalaires ci-dessus.
 */
export function diagnosticReveil(): DiagnosticReveil {
  return { ...diagnostic, seuil: SEUIL };
}

// ═══════════════════════════════════════════════════════════════════════════
// 2 · L'ADAPTATEUR
// ═══════════════════════════════════════════════════════════════════════════

type Ort = typeof import("onnxruntime-web");
type Session = Awaited<ReturnType<Ort["InferenceSession"]["create"]>>;

interface Modules {
  readonly mel: Session;
  readonly emb: Session;
  readonly mot: Session;
  readonly Tensor: Ort["Tensor"];
}

/**
 * Le nom de l'unique entrée d'un modèle, lu dans le graphe.
 *
 * Voir l'avertissement en tête de fichier : c'est ce qui rend le détecteur
 * indifférent au modèle qu'on lui donne, tant que la FORME concorde.
 */
function nomEntree(s: Session): string {
  return s.inputNames[0] ?? "input";
}

/**
 * La première sortie d'une session, en flottants.
 *
 * ⚠️ ON VÉRIFIE LE TYPE À L'EXÉCUTION plutôt que de l'affirmer par un cast. Un
 * modèle remplacé — c'est exactement ce qui vient d'arriver — pourrait rendre
 * un autre type ; un cast le laisserait passer et produirait des scores
 * absurdes en silence.
 */
function premiereSortie(sortie: Record<string, { data: unknown }>): Float32Array | null {
  const t = Object.values(sortie)[0];
  return t !== undefined && t.data instanceof Float32Array ? t.data : null;
}

/**
 * Les fichiers sont-ils RÉELLEMENT là ? On le constate par une requête `HEAD`
 * sur chacun. Un détecteur déclaré disponible mais sans modèle échouerait au
 * premier mot prononcé — c'est-à-dire en consultation, au pire moment.
 */
async function fichiersPresents(): Promise<boolean> {
  const requis = [
    `${RACINE}/melspectrogram.onnx`,
    `${RACINE}/embedding_model.onnx`,
    `${RACINE}/${MODELE_MOT}`,
    // ⚠️ LE FICHIER VÉRIFIÉ DOIT ÊTRE CELUI QUI EST RÉELLEMENT CHARGÉ.
    //
    // DÉFAUT MESURÉ AU NAVIGATEUR LE 2026-08-27, ET LE MOT DE RÉVEIL N'A DONC
    // JAMAIS PU S'ARMER. Ce contrôle testait `ort-wasm-simd-threaded.wasm`,
    // présent — mais `import("onnxruntime-web")` charge la variante **jsep**
    // (celle qui sait parler WebGPU), et SEULE celle-là est demandée à
    // l'exécution. `public/wakeword/ort/` ne la contenait pas :
    //   GET /wakeword/ort/ort-wasm-simd-threaded.jsep.mjs → 404
    // `disponible()` rendait donc `true`, puis `InferenceSession.create`
    // échouait — c'est-à-dire au pire endroit : après avoir promis que ça
    // marchait. Un contrôle de présence qui regarde un autre fichier que celui
    // qu'on charge ne contrôle rien ; il rassure.
    //
    // Le `.mjs` SUFFIT et le `.wasm` est volontairement omis : le premier est
    // le chargeur, il échoue en 404 lisible, alors que les 27 Mio du second
    // coûteraient une requête `HEAD` inutile à chaque armement.
    `${RACINE}/ort/ort-wasm-simd-threaded.jsep.mjs`,
  ];
  for (const u of requis) {
    try {
      const r = await fetch(u, { method: "HEAD" });
      if (!r.ok) {
        log.warn("reveil.actifManquant", { context: `asset:${u.split("/").pop() ?? ""}` });
        return false;
      }
    } catch {
      return false;
    }
  }
  return true;
}

async function chargerModules(): Promise<Modules | null> {
  try {
    const ort: Ort = await import("onnxruntime-web");
    // Auto-hébergement du runtime — voir l'avertissement en tête de fichier.
    ort.env.wasm.wasmPaths = `${RACINE}/ort/`;
    // Un seul fil : les threads exigent des en-têtes COOP/COEP que
    // l'application ne pose pas, et un détecteur qui échoue à s'initialiser est
    // pire qu'un détecteur un peu plus lent.
    ort.env.wasm.numThreads = 1;

    const [mel, emb, mot] = await Promise.all([
      ort.InferenceSession.create(`${RACINE}/melspectrogram.onnx`),
      ort.InferenceSession.create(`${RACINE}/embedding_model.onnx`),
      ort.InferenceSession.create(`${RACINE}/${MODELE_MOT}`),
    ]);
    return { mel, emb, mot, Tensor: ort.Tensor };
  } catch (cause) {
    log.error("reveil.chargement", {
      code: "indisponible",
      causeName: cause instanceof Error ? cause.name : "inconnue",
    });
    return null;
  }
}

/**
 * Construit le détecteur. Il remplit le contrat `DetecteurReveil` de
 * `jarvis-reveil.ts` — la machine à huit états de l'assistant — et n'en sait
 * rien d'autre : il signale un réveil, il ne décide de rien.
 */
export function creerDetecteurOpenWakeWord(): DetecteurReveil {
  let prise: PriseMicro | null = null;
  let noeud: ScriptProcessorNode | null = null;
  let modules: Modules | null = null;
  let actif = false;
  /**
   * ⚠️ SUSPENDU N'EST PAS ARRÊTÉ. Pendant que la praticienne dicte sa commande
   * — et pendant que Jarvis parle — le scoring est ignoré, mais le micro et les
   * sessions ONNX restent en place. Sans cette distinction, la commande
   * elle-même redéclencherait le mot de réveil, et la voix de Jarvis réveillerait
   * Jarvis : une boucle qui s'entretient toute seule.
   */
  let suspendu = false;
  let dernierReveil = 0;

  // Tampons de travail. Circulaires et écrasés : rien n'est conservé.
  let restes = new Float32Array(0);
  /**
   * Les 480 derniers échantillons DÉJÀ scorés, réinjectés en tête de la trame
   * suivante. Voir `CONTEXTE_GAUCHE` : sans eux le mel rend 5 trames au lieu de
   * 8 et l'axe du temps se dilate. Écrasé à chaque tour — rien n'est conservé.
   */
  let contexteGauche = new Float32Array(0);
  let mel: number[][] = [];
  let melDepuisPas = 0;
  let embeddings: number[][] = [];

  function reinitialiser(): void {
    restes = new Float32Array(0);
    // Le contexte gauche se jette AVEC les tampons : à la reprise on repart
    // d'un silence, pas de la fin de la phrase qu'on venait d'ignorer.
    contexteGauche = new Float32Array(0);
    mel = [];
    melDepuisPas = 0;
    embeddings = [];
  }

  async function traiterTrame(trame: Float32Array, surReveil: () => void): Promise<void> {
    const m = modules;
    if (m === null || !actif || suspendu) return;

    // ── 1 · mel-spectrogramme, SUR LA TRAME PRÉCÉDÉE DE SON CONTEXTE GAUCHE ──
    //
    // Voir l'avertissement de `CONTEXTE_GAUCHE` : 1280 seuls rendent 5 trames
    // mel, 1760 en rendent 8, et c'est 8 que la fenêtre de 76 suppose. Les 480
    // échantillons de tête sont ceux du pas PRÉCÉDENT — déjà scorés, jamais
    // conservés au-delà du tour suivant.
    const avecContexte = new Float32Array(CONTEXTE_GAUCHE + ECHANTILLONS_PAR_TRAME);
    // Au tout premier tour, `contexte` est encore vide : le début reste à zéro,
    // exactement comme le tampon initial d'openWakeWord. Le décalage garantit
    // que la trame COURANTE occupe toujours la fin du tenseur.
    avecContexte.set(contexteGauche, CONTEXTE_GAUCHE - contexteGauche.length);
    avecContexte.set(trame, CONTEXTE_GAUCHE);
    contexteGauche = trame.slice(-CONTEXTE_GAUCHE);

    const sortieMel = await m.mel.run({
      [nomEntree(m.mel)]: new m.Tensor("float32", avecContexte, [1, avecContexte.length]),
    });
    const brut = premiereSortie(sortieMel);
    if (brut === null) return;

    // ⚠️ NORMALISATION `x/10 + 2` — celle d'openWakeWord. Le modèle d'embedding
    // a été entraîné sur des mels ainsi mis à l'échelle ; l'omettre donne un
    // détecteur qui tourne parfaitement et ne reconnaît rien.
    for (let i = 0; i < brut.length; i += LARGEUR_MEL) {
      const ligne: number[] = [];
      for (let j = 0; j < LARGEUR_MEL; j += 1) ligne.push((brut[i + j] ?? 0) / 10 + 2);
      mel.push(ligne);
      melDepuisPas += 1;
    }
    if (mel.length > MEL_PAR_FENETRE * 4) mel = mel.slice(-MEL_PAR_FENETRE * 4);

    // ── 2 · embedding, tous les 8 mels, sur la fenêtre glissante de 76 ──
    while (melDepuisPas >= MEL_PAR_PAS && mel.length >= MEL_PAR_FENETRE) {
      melDepuisPas -= MEL_PAR_PAS;
      const fenetre = mel.slice(-MEL_PAR_FENETRE);
      const plat = new Float32Array(MEL_PAR_FENETRE * LARGEUR_MEL);
      let k = 0;
      for (const ligne of fenetre) for (const v of ligne) plat[k++] = v;

      const sortieEmb = await m.emb.run({
        [nomEntree(m.emb)]: new m.Tensor("float32", plat, [
          1,
          MEL_PAR_FENETRE,
          LARGEUR_MEL,
          1,
        ]),
      });
      const e = premiereSortie(sortieEmb);
      if (e === null) continue;
      embeddings.push(Array.from(e));
      if (embeddings.length > EMBEDDINGS_ATTENDUS) {
        embeddings = embeddings.slice(-EMBEDDINGS_ATTENDUS);
      }

      // ── 3 · le score du mot de réveil ──
      if (embeddings.length === EMBEDDINGS_ATTENDUS) {
        const entree = new Float32Array(EMBEDDINGS_ATTENDUS * TAILLE_EMBEDDING);
        let p = 0;
        for (const emb of embeddings) for (const v of emb) entree[p++] = v;
        const sortie = await m.mot.run({
          [nomEntree(m.mot)]: new m.Tensor("float32", entree, [
            1,
            EMBEDDINGS_ATTENDUS,
            TAILLE_EMBEDDING,
          ]),
        });
        const score = premiereSortie(sortie)?.[0] ?? 0;
        diagnostic.inferences += 1;
        if (score > diagnostic.scoreMax) diagnostic.scoreMax = score;

        const maintenant = Date.now();
        if (score >= SEUIL && maintenant - dernierReveil > REFRACTAIRE_MS) {
          dernierReveil = maintenant;
          // On repart de zéro : sans ça, les embeddings du mot qu'on vient de
          // reconnaître redéclencheraient au tour suivant.
          embeddings = [];
          // ⚠️ ON NE JOURNALISE QUE LE SCORE, jamais l'audio. `LogFields` est
          // une interface fermée, et rien ici ne doit l'ouvrir.
          log.info("reveil.detecte", { count: Math.round(score * 100) });
          surReveil();
        }
      }
    }
  }

  return {
    // Le nom sert la télémétrie et le rapport de mesure : il doit dire QUEL
    // modèle a réellement tourné, pas quel mot on espérait détecter.
    nom: `openwakeword/${MODELE_MOT}`,

    disponible: async () => {
      if (typeof window === "undefined") return false;
      if (typeof navigator?.mediaDevices?.getUserMedia !== "function") return false;
      return await fichiersPresents();
    },

    demarrer: async (surReveil: () => void): Promise<Result<true>> => {
      if (actif) return ok(true);

      modules = await chargerModules();
      if (modules === null) {
        return err({ code: "indisponible", message: fr.jarvis.voix.reveil.moteurIndisponible });
      }

      // ⚠️ LE MICRO VIENT DU COURTIER, PLUS DE `getUserMedia` ICI. Le détecteur
      // partage un unique flux physique avec l'endpointeur et l'enregistreur ;
      // ouvrir le sien redemanderait la permission sous Firefox et pourrait
      // échouer sous Safari.
      const acces = await prendreMicro();
      if (!acces.ok) {
        return err({ code: "interdit", message: fr.jarvis.voix.reveil.microRefuse });
      }
      prise = acces.data;

      // Le contexte partagé impose déjà 16 kHz — les modèles sont entraînés à
      // cette fréquence, et un rééchantillonnage approximatif décale tout le
      // spectre.
      const source = sourcePartagee();
      const contexte = contexteAudioPartage();
      if (source === null || contexte === null) {
        prise.rendre();
        prise = null;
        return err({ code: "indisponible", message: fr.jarvis.voix.reveil.moteurIndisponible });
      }

      // ⚠️ ON CONSTATE LA FRÉQUENCE, ON NE LA SUPPOSE PAS. Un navigateur peut
      // refuser 16 kHz et rendre un contexte à 48 kHz : le détecteur tournerait
      // parfaitement et ne reconnaîtrait plus rien, en silence. Mieux vaut un
      // refus nommé qu'un mot de réveil qui ne répond plus sans raison visible.
      if (contexte.sampleRate !== TAUX) {
        log.error("reveil.frequence", { code: "indisponible", count: contexte.sampleRate });
        prise.rendre();
        prise = null;
        return err({ code: "indisponible", message: fr.jarvis.voix.reveil.frequenceIncompatible });
      }
      // `ScriptProcessorNode` est déprécié mais universellement disponible.
      // Un `AudioWorklet` exigerait un fichier servi à part et une politique de
      // contenu adaptée ; pour un détecteur à 80 ms, le gain ne vaut pas la
      // fragilité ajoutée.
      noeud = contexte.createScriptProcessor(1024, 1, 1);
      actif = true;
      reinitialiser();

      // L'instrument repart de zéro à chaque armement : des compteurs cumulés
      // d'une session à l'autre feraient lire un ancien score maximal comme
      // celui du mot qu'on vient de prononcer.
      diagnostic.frequence = contexte.sampleRate;
      diagnostic.echantillons = 0;
      diagnostic.rms = 0;
      diagnostic.crete = 0;
      diagnostic.inferences = 0;
      diagnostic.tramesJetees = 0;
      diagnostic.scoreMax = 0;

      let enCours = false;
      noeud.onaudioprocess = (ev) => {
        if (!actif) return;
        // Suspendu : on JETTE l'audio au lieu de l'accumuler. L'accumuler ferait
        // rescorer, à la reprise, la commande qu'on venait justement d'ignorer.
        if (suspendu) {
          restes = new Float32Array(0);
          return;
        }
        const entrant = ev.inputBuffer.getChannelData(0);

        // ── L'instrument, avant tout traitement : ce qui ARRIVE du micro. ──
        // Mesuré ici et pas plus bas, pour que le niveau reste vrai même quand
        // la trame finit jetée — c'est précisément ce cas qu'il faut pouvoir
        // distinguer d'un micro muet.
        diagnostic.echantillons += entrant.length;
        let somme = 0;
        let crete = 0;
        for (const v of entrant) {
          somme += v * v;
          const a = v < 0 ? -v : v;
          if (a > crete) crete = a;
        }
        diagnostic.rms = Math.sqrt(somme / entrant.length);
        diagnostic.crete = crete;

        const fusion = new Float32Array(restes.length + entrant.length);
        fusion.set(restes, 0);
        fusion.set(entrant, restes.length);

        let decalage = 0;
        const trames: Float32Array[] = [];
        while (fusion.length - decalage >= ECHANTILLONS_PAR_TRAME) {
          trames.push(fusion.slice(decalage, decalage + ECHANTILLONS_PAR_TRAME));
          decalage += ECHANTILLONS_PAR_TRAME;
        }
        restes = fusion.slice(decalage);

        // ⚠️ ON NE FAIT PAS LA QUEUE. Si l'inférence prend plus de 80 ms, on
        // JETTE la trame plutôt que d'accumuler un retard qui grandirait sans
        // fin : un détecteur qui réagit avec dix secondes de retard est pire
        // qu'un détecteur qui rate un mot.
        if (enCours) {
          diagnostic.tramesJetees += trames.length;
          return;
        }
        enCours = true;
        void (async () => {
          try {
            for (const t of trames) await traiterTrame(t, surReveil);
          } finally {
            enCours = false;
          }
        })();
      };

      source.connect(noeud);
      // Le nœud doit être connecté à une destination pour que les callbacks
      // soient appelés ; un gain à zéro évite de renvoyer le micro aux
      // haut-parleurs, ce qui provoquerait un larsen.
      const muet = contexte.createGain();
      muet.gain.value = 0;
      noeud.connect(muet);
      muet.connect(contexte.destination);

      log.info("reveil.demarre", { context: `modele:${MODELE_MOT}` });
      return ok(true);
    },

    /**
     * Ignore le scoring sans lâcher le micro ni les sessions ONNX. Les tampons
     * sont remis à zéro : à la reprise on repart d'un silence, pas de la fin de
     * la phrase qu'on vient d'ignorer.
     */
    suspendre: () => {
      if (!actif || suspendu) return;
      suspendu = true;
      reinitialiser();
      log.info("reveil.suspendu", { count: 1 });
    },

    reprendre: () => {
      if (!actif || !suspendu) return;
      suspendu = false;
      reinitialiser();
      dernierReveil = Date.now(); // réfractaire au retour : la fin de la réponse ne doit pas réveiller
      log.info("reveil.repris", { count: 1 });
    },

    arreter: () => {
      actif = false;
      if (noeud !== null) {
        noeud.onaudioprocess = null;
        noeud.disconnect();
        noeud = null;
      }
      // ⚠️ ON REND LA PRISE, ON NE COUPE PAS LE FLUX. Couper ici arrêterait le
      // micro sous les pieds de l'enregistreur qui s'en sert peut-être encore.
      // Le courtier coupe les pistes au DERNIER relâchement, et lui seul le sait.
      suspendu = false;
      prise?.rendre();
      prise = null;
      modules = null;
      reinitialiser();
    },
  };
}
