/**
 * `reveil-vosk.ts` — the licence-clean wake-word detector.
 *
 * The pre-trained openWakeWord "Alexa" model is CC BY-NC-SA (non-commercial)
 * and cannot ship in a commercial clinic. This detector keeps the exact same
 * `DetecteurReveil` contract but uses a French Vosk model (Apache-2.0) with a
 * closed grammar containing only "alexa" and its French spelling variants.
 *
 * Audio stays in bounded 500 ms chunks and is decoded by the local Python
 * worker through the same-origin route. The route returns a boolean only; no
 * transcript is produced by this path.
 */
import { fr } from "@/i18n/fr";

import { db } from "./db";
import { log } from "./log";
import { prendreMicro, contexteAudioPartage, sourcePartagee, type PriseMicro } from "./micro-partage";
import { err, ok, type Result } from "./result";
import type { DetecteurReveil } from "./jarvis-reveil";

const TAUX = 16_000;
const ECHANTILLONS_PAR_BLOC = 8_000; // 500 ms
const BLOC_AUDIO = 8_192;
/** Two chunks in flight at most: a slow worker must never grow memory. */
const MAX_EN_ATTENTE = 2;
/** Bounded transport retries before the state machine is told to re-arm. */
const MAX_ECHECS = 5;
const PING_MS = 20_000;
const PING_TIMEOUT_MS = 10_000;

export type CodeErreurReveil = "micro" | "transport";
type ActionReveil = "start" | "audio" | "reset" | "ping" | "stop";

function base64(bytes: Uint8Array): string {
  let texte = "";
  for (const octet of bytes) texte += String.fromCharCode(octet);
  return btoa(texte);
}

export function floatVersPcm16(entree: Float32Array, sourceRate: number): Uint8Array {
  // The shared AudioContext normally honours 16 kHz, but a Windows device may
  // return 44.1/48 kHz. Resample before PCM16 so Vosk always sees 16 kHz.
  const taux = sourceRate === TAUX ? entree : (() => {
    const count = Math.round((entree.length * TAUX) / sourceRate);
    const sortie = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
      const position = (i * sourceRate) / TAUX;
      const gauche = Math.floor(position);
      const droite = Math.min(gauche + 1, entree.length - 1);
      sortie[i] = (entree[gauche] ?? 0) + (((entree[droite] ?? 0) - (entree[gauche] ?? 0)) * (position - gauche));
    }
    return sortie;
  })();
  const sortie = new Uint8Array(taux.length * 2);
  for (let i = 0; i < taux.length; i += 1) {
    const valeur = Math.max(-1, Math.min(1, taux[i] ?? 0));
    const pcm = valeur < 0 ? valeur * 0x8000 : valeur * 0x7fff;
    sortie[i * 2] = pcm & 0xff;
    sortie[i * 2 + 1] = (pcm >> 8) & 0xff;
  }
  return sortie;
}

export function creerDetecteurVosk(
  surErreur?: (code: CodeErreurReveil) => void,
): DetecteurReveil {
  let prise: PriseMicro | null = null;
  let noeud: ScriptProcessorNode | null = null;
  let muet: GainNode | null = null;
  let revele: (() => void) | null = null;
  let actif = false;
  let suspendu = false;
  let declenche = false;
  let restes = new Uint8Array(0);
  /**
   * ⚠️ CHAQUE TRANSITION INVALIDE LES RÉPONSES EN VOL. Sans ce jeton, l'audio
   * envoyé avant une suspension pouvait revenir après le réveil suivant et
   * déclencher sur une phrase déjà consommée. La machine à états reçoit un
   * signal qui ne correspond plus à rien.
   */
  let generation = 0;
  let echecs = 0;
  let erreurSignalee = false;
  let echecsPing = 0;
  /** Audio en file ou en vol. Au-delà de deux, on jette le bloc entrant. */
  let enAttente = 0;
  let file: Promise<void> = Promise.resolve();
  let minuteurReprise: ReturnType<typeof setTimeout> | null = null;
  let minuteurPing: ReturnType<typeof setInterval> | null = null;

  const requete = async (
    action: ActionReveil,
    pcm?: string,
    signal?: AbortSignal,
  ): Promise<{ ok: boolean; detected: boolean }> => {
    const corps = { action, ...(pcm ? { pcmBase64: pcm } : {}) };
    try {
      const resultat =
        signal === undefined
          ? await db().invokeFunction<{ detected?: boolean; ready?: boolean; pong?: boolean }>("jarvis-wake", corps)
          : await db().invokeFunction<{ detected?: boolean; ready?: boolean; pong?: boolean }>(
              "jarvis-wake",
              corps,
              signal,
            );
      if (!resultat.ok) throw new Error(resultat.error.code);
      return { ok: true, detected: resultat.data.detected === true };
    } catch {
      return { ok: false, detected: false };
    }
  };

  function effacerReprise(): void {
    if (minuteurReprise !== null) {
      clearTimeout(minuteurReprise);
      minuteurReprise = null;
    }
  }

  /**
   * Une panne de transport ne ferme PLUS le micro. Le worker local peut mourir
   * (timeout, processus tué) alors que la praticienne est en train de parler :
   * couper le périphérique rendrait le mot de réveil inopérant jusqu'au
   * prochain geste. On réessaie `start` avec un recul borné, micro ouvert.
   */
  function echecTransport(): void {
    echecs += 1;
    log.warn("reveil.vosk.transport", { code: "indisponible", count: echecs });
    if (!actif) return;
    if (echecs >= MAX_ECHECS) {
      if (!erreurSignalee) {
        erreurSignalee = true;
        surErreur?.("transport");
      }
      // Nouvel épisode borné : la supervision peut repartir d'elle-même sans
      // qu'un second signal soit nécessaire à chaque bloc.
      echecs = 0;
      return;
    }
    planifierReprise();
  }

  function planifierReprise(): void {
    effacerReprise();
    const delai = Math.min(2_000, 250 * 2 ** echecs);
    minuteurReprise = setTimeout(() => {
      minuteurReprise = null;
      if (!actif) return;
      void requete("start").then((reponse) => {
        if (!actif) return;
        if (!reponse.ok) {
          echecTransport();
          return;
        }
        echecs = 0;
        erreurSignalee = false;
        log.info("reveil.vosk.reprise", { context: "vosk-fr-FR-small" });
      });
    }, delai);
  }

  /** Une requête de contrôle qui ne revient pas signifie un worker figé. */
  async function ping(): Promise<void> {
    if (!actif) return;
    const reponse = await requete("ping", undefined, AbortSignal.timeout(PING_TIMEOUT_MS));
    if (!actif) return;
    if (reponse.ok) {
      echecsPing = 0;
      return;
    }
    echecsPing += 1;
    log.warn("reveil.vosk.ping", { code: "indisponible", count: echecsPing });
    if (echecsPing < 2) return;
    echecsPing = 0;
    surErreur?.("transport");
  }

  function envoyerAudio(pcm: string): void {
    if (enAttente >= MAX_EN_ATTENTE) {
      // File BORNÉE : on préfère perdre un bloc de 500 ms à une file qui
      // grossit pendant que le worker est lent ou injoignable.
      log.warn("reveil.vosk.file", { code: "saturee" });
      return;
    }
    enAttente += 1;
    const g = generation;
    const tache = file.then(async () => {
      try {
        if (g !== generation || !actif || suspendu || declenche) return;
        const reponse = await requete("audio", pcm);
        if (g !== generation) return;
        if (!reponse.ok) {
          echecTransport();
          return;
        }
        echecs = 0;
        erreurSignalee = false;
        if (!reponse.detected || !actif || suspendu || declenche) return;
        declenche = true;
        log.info("reveil.detecte", { count: 1 });
        revele?.();
      } finally {
        enAttente = Math.max(0, enAttente - 1);
      }
    });
    file = tache.catch(() => {});
  }

  function pisteTerminee(): void {
    if (!actif) return;
    log.warn("reveil.micro.perdu", { code: "indisponible" });
    // Le graphe est mort : on le ferme avant de rendre la main à la
    // supervision, qui rouvrira le périphérique par `prendreMicro`.
    arreter();
    surErreur?.("micro");
  }

  function fermer(): void {
    if (noeud !== null) {
      noeud.onaudioprocess = null;
      noeud.disconnect();
      noeud = null;
    }
    muet?.disconnect();
    muet = null;
    for (const piste of prise?.flux.getTracks() ?? []) piste.removeEventListener("ended", pisteTerminee);
    prise?.rendre();
    prise = null;
    restes = new Uint8Array(0);
  }

  function arreter(): void {
    generation += 1;
    effacerReprise();
    if (minuteurPing !== null) {
      clearInterval(minuteurPing);
      minuteurPing = null;
    }
    echecsPing = 0;
    if (!actif) return;
    actif = false;
    suspendu = false;
    declenche = false;
    revele = null;
    fermer();
    void requete("stop");
  }

  function suspendre(): void {
    if (!actif || suspendu) return;
    generation += 1;
    suspendu = true;
    restes = new Uint8Array(0);
    void requete("reset");
  }

  function reprendre(): void {
    if (!actif) return;
    generation += 1;
    declenche = false;
    if (!suspendu) return;
    suspendu = false;
    restes = new Uint8Array(0);
    void requete("reset");
  }

  return {
    nom: "vosk/fr-FR-small",

    disponible: async () => {
      if (typeof window === "undefined") return false;
      if (typeof navigator?.mediaDevices?.getUserMedia !== "function") return false;
      return typeof AudioContext !== "undefined";
    },

    demarrer: async (surReveil: () => void): Promise<Result<true>> => {
      generation += 1;
      revele = surReveil;
      if (actif) {
        // Ré-armement après une panne de transport : le micro est resté
        // ouvert. `reprendre` lève le verrou de détection sans réacquérir le
        // périphérique ni repartir de zéro.
        if (suspendu) {
          // ⚠️ UNE SUSPENSION APPARTIENT À LA MACHINE À ÉTATS. Elle couvre la
          // capture de la commande ou la voix de Jarvis ; une reprise de
          // transport ne doit pas remettre le scoring en marche par-dessus.
          declenche = false;
          restes = new Uint8Array(0);
        } else {
          reprendre();
        }
        return ok(true);
      }
      const acces = await prendreMicro();
      if (!acces.ok) return err({ code: "interdit", message: fr.jarvis.voix.reveil.microRefuse });
      prise = acces.data;
      for (const piste of prise.flux.getTracks()) piste.addEventListener("ended", pisteTerminee);
      const contexte = contexteAudioPartage();
      const source = sourcePartagee();
      if (contexte === null || source === null) {
        fermer();
        return err({ code: "indisponible", message: fr.jarvis.voix.reveil.moteurIndisponible });
      }
      if (contexte.sampleRate < 8_000 || contexte.sampleRate > 96_000) {
        fermer();
        return err({ code: "indisponible", message: fr.jarvis.voix.reveil.frequenceIncompatible });
      }
      const sourceRate = contexte.sampleRate;
      void contexte.resume().catch(() => {});
      if (!(await requete("start")).ok) {
        fermer();
        return err({ code: "indisponible", message: fr.jarvis.voix.reveil.moteurIndisponible });
      }

      actif = true;
      suspendu = false;
      declenche = false;
      echecs = 0;
      erreurSignalee = false;
      echecsPing = 0;
      restes = new Uint8Array(0);
      effacerReprise();
      noeud = contexte.createScriptProcessor(BLOC_AUDIO, 1, 1);
      noeud.onaudioprocess = (evenement) => {
        if (!actif || suspendu || declenche) return;
        const entrant = floatVersPcm16(evenement.inputBuffer.getChannelData(0), sourceRate);
        const fusion = new Uint8Array(restes.length + entrant.length);
        fusion.set(restes, 0);
        fusion.set(entrant, restes.length);
        let debut = 0;
        while (fusion.length - debut >= ECHANTILLONS_PAR_BLOC * 2) {
          const bloc = fusion.slice(debut, debut + ECHANTILLONS_PAR_BLOC * 2);
          debut += ECHANTILLONS_PAR_BLOC * 2;
          envoyerAudio(base64(bloc));
        }
        restes = fusion.slice(debut);
      };
      muet = contexte.createGain();
      muet.gain.value = 0;
      source.connect(noeud);
      noeud.connect(muet);
      muet.connect(contexte.destination);
      if (minuteurPing !== null) clearInterval(minuteurPing);
      minuteurPing = setInterval(() => void ping(), PING_MS);
      log.info("reveil.demarre", { context: "vosk-fr-FR-small" });
      return ok(true);
    },

    suspendre,

    reprendre,

    arreter,
  };
}
