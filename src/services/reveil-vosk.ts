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

export function creerDetecteurVosk(surErreur?: () => void): DetecteurReveil {
  let prise: PriseMicro | null = null;
  let noeud: ScriptProcessorNode | null = null;
  let muet: GainNode | null = null;
  let actif = false;
  let suspendu = false;
  let declenche = false;
  let restes = new Uint8Array(0);
  let echecs = 0;

  const requete = async (
    action: "start" | "audio" | "reset" | "stop",
    pcm?: string,
  ): Promise<{ ok: boolean; detected: boolean }> => {
    try {
      const resultat = await db().invokeFunction<{ detected?: boolean; ready?: boolean }>("jarvis-wake", {
        action,
        ...(pcm ? { pcmBase64: pcm } : {}),
      });
      if (!resultat.ok) throw new Error(resultat.error.code);
      echecs = 0;
      return { ok: true, detected: resultat.data.detected === true };
    } catch {
      echecs += 1;
      // A local transport failure must not leave the mic open forever.
      if (echecs >= 3) {
        log.warn("reveil.vosk.transport", { code: "indisponible" });
        arreter();
      }
      return { ok: false, detected: false };
    }
  };

  function pisteTerminee(): void {
    if (!actif) return;
    log.warn("reveil.micro.perdu", { code: "indisponible" });
    arreter();
    surErreur?.();
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
    if (!actif) return;
    actif = false;
    suspendu = false;
    declenche = false;
    fermer();
    void requete("stop");
  }

  return {
    nom: "vosk/fr-FR-small",

    disponible: async () => {
      if (typeof window === "undefined") return false;
      if (typeof navigator?.mediaDevices?.getUserMedia !== "function") return false;
      return typeof AudioContext !== "undefined";
    },

    demarrer: async (surReveil: () => void): Promise<Result<true>> => {
      if (actif) return ok(true);
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
      restes = new Uint8Array(0);
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
          void requete("audio", base64(bloc)).then((reponse) => {
            if (!reponse.detected || !actif || suspendu || declenche) return;
            declenche = true;
            log.info("reveil.detecte", { count: 1 });
            surReveil();
          });
        }
        restes = fusion.slice(debut);
      };
      muet = contexte.createGain();
      muet.gain.value = 0;
      source.connect(noeud);
      noeud.connect(muet);
      muet.connect(contexte.destination);
      log.info("reveil.demarre", { context: "vosk-fr-FR-small" });
      return ok(true);
    },

    suspendre: () => {
      if (!actif || suspendu) return;
      suspendu = true;
      restes = new Uint8Array(0);
      void requete("reset");
    },

    reprendre: () => {
      if (!actif || !suspendu) return;
      suspendu = false;
      declenche = false;
      restes = new Uint8Array(0);
      void requete("reset");
    },

    arreter,
  };
}
