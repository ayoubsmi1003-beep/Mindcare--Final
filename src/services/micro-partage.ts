/**
 * `micro-partage.ts` — LE COURTIER DU MICROPHONE. UNE SEULE ACQUISITION.
 *
 * ═══ POURQUOI CE MODULE EXISTE ═══
 *
 * Trois consommateurs veulent le micro EN MÊME TEMPS :
 *
 *   · le détecteur de mot de réveil  (`reveil-openwakeword.ts`) — en continu ;
 *   · l'endpointeur de fin de parole (`endpointage-voix.ts`)    — pendant l'écoute ;
 *   · l'enregistreur de la commande  (`jarvis-voix.ts`)         — pendant l'écoute.
 *
 * ⚠️ AVANT CE MODULE, ILS OUVRAIENT CHACUN LEUR `getUserMedia`. Ce n'était pas
 * un gaspillage cosmétique : Firefox redemande la permission à CHAQUE appel,
 * Safari peut échouer la seconde acquisition, et deux captures du même
 * périphérique sous WASAPI se désynchronisent ou rendent du silence. Le défaut
 * ne se voit pas au développement — il se voit en consultation.
 *
 * Un flux physique, compté par références. Les pistes ne s'arrêtent qu'au
 * DERNIER relâchement.
 *
 * ═══ CE QUI NE SORT PAS D'ICI ═══
 *
 * Ce module rend un `MediaStream` et un nœud source. Il ne lit AUCUN
 * échantillon, n'en conserve aucun, n'en journalise aucun. Ce qu'on fait de
 * l'audio se décide chez l'appelant, sous son propre contrat.
 *
 * ⚠️ PAS DE `sampleRate` DANS LA CONTRAINTE `getUserMedia`. Safari le rejette et
 * Firefox l'ignore en silence — demander 16 kHz au périphérique produit soit une
 * exception, soit un flux qui n'est pas à la fréquence annoncée, ce qui est pire.
 * Le rééchantillonnage vit dans l'`AudioContext`, qui le fait correctement et
 * partout.
 */

import { fr } from "@/i18n/fr";

import { log } from "./log";
import { err, ok, type Result } from "./result";

/** La fréquence des modèles openWakeWord. Imposée au contexte, jamais au micro. */
const TAUX = 16_000;

/**
 * Une prise sur le micro partagé. La rendre est IDEMPOTENT : un appelant qui
 * relâche deux fois ne fait pas tomber le compteur sous le nombre réel de
 * consommateurs — sans quoi le détecteur perdrait son flux parce qu'un autre
 * module a été maladroit.
 */
export interface PriseMicro {
  readonly flux: MediaStream;
  readonly rendre: () => void;
}

interface EtatPartage {
  readonly flux: MediaStream;
  contexte: AudioContext | null;
  source: MediaStreamAudioSourceNode | null;
}

let partage: EtatPartage | null = null;
let compteur = 0;
/** L'acquisition en vol. Deux appels simultanés attendent la MÊME promesse. */
let acquisition: Promise<Result<MediaStream>> | null = null;

/**
 * Le périphérique a-t-il disparu sous nos pieds ? Une piste `ended` signifie
 * micro débranché, ou pris par une autre application. On le CONSTATE au lieu de
 * rendre un flux mort dont l'appelant ne saurait rien.
 */
function fluxMort(f: MediaStream): boolean {
  const pistes = f.getAudioTracks();
  return pistes.length === 0 || pistes.every((p) => p.readyState === "ended");
}

function liberer(): void {
  const etat = partage;
  if (etat === null) return;
  partage = null;
  // ⚠️ COUPER LES PISTES D'ABORD. Fermer le contexte sans arrêter les pistes
  // laisse le voyant micro du navigateur ALLUMÉ : la praticienne verrait son
  // micro actif alors que plus rien n'écoute.
  for (const p of etat.flux.getTracks()) p.stop();
  etat.source?.disconnect();
  etat.source = null;
  if (etat.contexte !== null) {
    void etat.contexte.close();
    etat.contexte = null;
  }
  log.info("micro.libere", { count: 0 });
}

async function acquerir(): Promise<Result<MediaStream>> {
  if (typeof navigator?.mediaDevices?.getUserMedia !== "function") {
    return err({ code: "indisponible", message: fr.jarvis.voix.microIndisponible });
  }
  try {
    const flux = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    return ok(flux);
  } catch {
    // Permission refusée OU aucun périphérique : même message. La conduite à
    // tenir est identique (utiliser le clavier), et distinguer les deux serait
    // un oracle sur l'équipement du poste.
    return err({ code: "interdit", message: fr.jarvis.voix.microRefuse });
  }
}

/**
 * Prend une référence sur le micro. La PREMIÈRE prise l'ouvre réellement ; les
 * suivantes réutilisent le même flux physique.
 */
export async function prendreMicro(): Promise<Result<PriseMicro>> {
  // Un flux mort ne se recycle pas : on repart d'une acquisition propre plutôt
  // que de rendre des pistes `ended` que l'appelant croirait vivantes.
  if (partage !== null && fluxMort(partage.flux)) {
    log.warn("micro.perdu", { code: "indisponible" });
    liberer();
    compteur = 0;
  }

  if (partage === null) {
    // Deux appelants simultanés partagent la MÊME promesse : sans cela, le
    // détecteur et l'enregistreur démarrant ensemble déclencheraient deux
    // `getUserMedia` avant que le premier n'ait posé `partage`.
    acquisition ??= acquerir();
    const resultat = await acquisition;
    acquisition = null;
    if (!resultat.ok) return err(resultat.error);
    // Une autre prise a pu s'installer pendant l'attente : on garde la sienne et
    // on referme la nôtre, plutôt que d'écraser un flux déjà distribué.
    if (partage !== null) {
      for (const p of resultat.data.getTracks()) p.stop();
    } else {
      partage = { flux: resultat.data, contexte: null, source: null };
      log.info("micro.ouvert", { count: 1 });
    }
  }

  const etat = partage;
  if (etat === null) {
    return err({ code: "indisponible", message: fr.jarvis.voix.microIndisponible });
  }

  compteur += 1;
  let rendue = false;
  return ok({
    flux: etat.flux,
    rendre: () => {
      if (rendue) return; // idempotent — voir le commentaire de `PriseMicro`
      rendue = true;
      compteur -= 1;
      if (compteur <= 0) {
        compteur = 0;
        liberer();
      }
    },
  });
}

/**
 * Le contexte audio partagé, à 16 kHz. Paresseux : le créer sans micro ouvert
 * poserait un contexte suspendu que rien ne reprendrait.
 *
 * ⚠️ REND `null` SI AUCUNE PRISE N'EST ACTIVE. L'appelant doit avoir pris le
 * micro AVANT. Rendre un contexte sans source serait un objet qui a l'air de
 * marcher et ne produit rien.
 */
export function contexteAudioPartage(): AudioContext | null {
  const etat = partage;
  if (etat === null) return null;
  etat.contexte ??= new AudioContext({ sampleRate: TAUX });
  return etat.contexte;
}

/**
 * Le nœud source partagé. UN SEUL pour tout le graphe : appeler
 * `createMediaStreamSource` deux fois sur le même flux crée deux nœuds
 * indépendants, ce qui double le travail de décodage sans rien apporter.
 *
 * Les consommateurs s'y branchent en éventail (`source.connect(monNoeud)`) et
 * déconnectent LEUR nœud, jamais la source.
 */
export function sourcePartagee(): MediaStreamAudioSourceNode | null {
  const etat = partage;
  if (etat === null) return null;
  const contexte = contexteAudioPartage();
  if (contexte === null) return null;
  etat.source ??= contexte.createMediaStreamSource(etat.flux);
  return etat.source;
}

/** Le nombre de prises actives. Consommé par les évals et le rapport de mesure. */
export function prisesActives(): number {
  return compteur;
}

/** Le micro est-il physiquement ouvert ? Un FAIT, pas une supposition. */
export function microOuvert(): boolean {
  return partage !== null;
}
