/**
 * `endpointage-voix.ts` — QUAND LA PRATICIENNE A FINI DE PARLER.
 *
 * ═══ LE DÉFAUT QUE CE MODULE RÉPARE ═══
 *
 * `cloturerCommande()` existait sans appelant, et le contrat `DetecteurReveil`
 * ne porte AUCUN signal de fin de parole. Conséquence exacte : après le mot de
 * réveil, l'enregistrement démarrait et NE S'ARRÊTAIT JAMAIS. La boucle vocale
 * ne pouvait pas se fermer, quelle que soit l'interface posée par-dessus.
 *
 * ═══ POURQUOI UN MODULE SÉPARÉ ═══
 *
 * Pas dans `jarvis-voix.ts` : le `MediaRecorder` n'a pas de graphe audio, il ne
 * peut pas mesurer une énergie.
 *
 * Pas en élargissant `DetecteurReveil` : LA PAUVRETÉ DE CE CONTRAT EST LA
 * GARANTIE DE CONFIDENTIALITÉ. Il ne rend aucun échantillon, donc rien ne peut
 * fuir par ce chemin. Y ajouter une sortie audio détruirait la propriété qui le
 * rend acceptable dans un cabinet.
 *
 * Ce module suit la même discipline : il ÉMET UN SIGNAL, jamais des
 * échantillons. `niveau()` rend un scalaire lissé entre 0 et 1 — de quoi
 * animer un orbe, pas de quoi reconstituer une parole.
 *
 * ⚠️ `setInterval`, PAS `requestAnimationFrame`, POUR LA DÉCISION. Un onglet en
 * arrière-plan suspend `rAF` : la praticienne qui change d'onglet au milieu de
 * sa phrase laisserait un enregistrement qui ne se clôt jamais — exactement
 * l'état bloqué qu'on cherche à interdire. Les minuteurs, eux, continuent (au
 * pire ralentis). `rAF` ne sert qu'à LIRE `niveau()` pour l'animation, où une
 * pause en arrière-plan est sans conséquence.
 */

import { fr } from "@/i18n/fr";

import { log } from "./log";
import { sourcePartagee } from "./micro-partage";
import { err, ok, type Result } from "./result";

// ═══════════════════════════════════════════════════════════════════════════
// LES SEUILS — À RÉGLER SUR VOIX RÉELLE, PAS AU JUGÉ
// ═══════════════════════════════════════════════════════════════════════════

/**
 * RMS au-dessus duquel une trame est « voisée ». Le micro applique déjà
 * suppression de bruit et gain automatique (voir `micro-partage.ts`), donc le
 * plancher de silence est bas et stable.
 */
const SEUIL_VOIX = 0.02;

/** Durée de parole minimale avant qu'un silence puisse clore. Évite qu'un « euh… » hésitant coupe la phrase. */
const MIN_PAROLE_MS = 400;

/** Le silence qui signifie « j'ai fini ». Plus court, on coupe les pauses de réflexion. */
const SILENCE_MS = 1_200;

/**
 * ⚠️ PLAFOND DUR, INDÉPENDANT DE TOUTE LOGIQUE D'ÉNERGIE. Si la détection de
 * silence se trompe — micro saturé, bruit continu, seuil mal réglé — c'est LUI
 * qui garantit qu'aucun enregistrement ne dure indéfiniment. Un garde-fou qui
 * dépend du mécanisme qu'il garde n'en est pas un.
 */
const PLAFOND_MS = 15_000;

/** Aucune parole du tout après ce délai : c'était un faux réveil. */
const PATIENCE_INITIALE_MS = 3_000;

/** Cadence de mesure. 50 ms : assez fin pour 1200 ms de silence, assez lâche pour ne rien coûter. */
const PAS_MS = 50;

/** Lissage exponentiel du niveau affiché. Brut, il scintille et rend l'orbe nerveux. */
const LISSAGE = 0.25;

export type MotifFin = "silence" | "plafond" | "faux-reveil";

export interface Endpointeur {
  /**
   * Démarre la mesure. `surFin` est appelé AU PLUS UNE FOIS par démarrage —
   * l'endpointeur s'arrête lui-même avant de rappeler, pour qu'un plafond et un
   * silence simultanés ne produisent pas deux clôtures.
   */
  readonly demarrer: (surFin: (motif: MotifFin) => void) => Result<true>;
  readonly arreter: () => void;
  /** 0..1, lissé. Lu par `rAF` pour l'animation, JAMAIS publié dans un état React. */
  readonly niveau: () => number;
}

export function creerEndpointeurEnergie(): Endpointeur {
  let analyseur: AnalyserNode | null = null;
  // `Float32Array<ArrayBuffer>` explicite : sans le paramètre, TypeScript infère
  // `ArrayBufferLike`, qui couvre `SharedArrayBuffer` et que `getFloatTimeDomainData`
  // refuse.
  let tampon: Float32Array<ArrayBuffer> | null = null;
  let minuteur: ReturnType<typeof setInterval> | null = null;
  let plafond: ReturnType<typeof setTimeout> | null = null;
  let lisse = 0;

  let debut = 0;
  let msParole = 0;
  let dernierVoise = 0;
  let aParle = false;

  function arreter(): void {
    if (minuteur !== null) {
      clearInterval(minuteur);
      minuteur = null;
    }
    if (plafond !== null) {
      clearTimeout(plafond);
      plafond = null;
    }
    // On déconnecte NOTRE nœud, jamais la source : elle est partagée avec le
    // détecteur de mot de réveil, qui écoute encore.
    analyseur?.disconnect();
    analyseur = null;
    tampon = null;
    lisse = 0;
  }

  return {
    demarrer: (surFin: (motif: MotifFin) => void): Result<true> => {
      arreter(); // repartir propre : un démarrage sur un état sale doublerait les minuteurs

      const source = sourcePartagee();
      if (source === null) {
        return err({ code: "indisponible", message: fr.jarvis.voix.microIndisponible });
      }

      const contexte = source.context;
      analyseur = contexte.createAnalyser();
      analyseur.fftSize = 512;
      // Le lissage intégré de l'analyseur porte sur le SPECTRE ; on calcule un
      // RMS temporel et on lisse nous-mêmes, donc on le neutralise ici.
      analyseur.smoothingTimeConstant = 0;
      source.connect(analyseur);
      tampon = new Float32Array(analyseur.fftSize);

      debut = Date.now();
      msParole = 0;
      dernierVoise = 0;
      aParle = false;

      // ⚠️ LE PREMIER APPELANT GAGNE. Le plafond et le silence peuvent conclure
      // dans le même tour de boucle ; sans ce verrou, `cloturerCommande` serait
      // appelé deux fois et deux transcriptions partiraient.
      let conclu = false;
      function conclure(motif: MotifFin): void {
        if (conclu) return;
        conclu = true;
        const duree = Date.now() - debut;
        arreter();
        log.info("voix.endpoint", { context: `motif:${motif}`, durationMs: duree });
        surFin(motif);
      }

      plafond = setTimeout(() => conclure("plafond"), PLAFOND_MS);

      minuteur = setInterval(() => {
        const a = analyseur;
        const t = tampon;
        if (a === null || t === null) return;

        a.getFloatTimeDomainData(t);
        let somme = 0;
        for (const v of t) somme += v * v;
        const rms = Math.sqrt(somme / t.length);
        lisse = lisse + (Math.min(1, rms * 8) - lisse) * LISSAGE;

        const maintenant = Date.now();
        if (rms >= SEUIL_VOIX) {
          msParole += PAS_MS;
          dernierVoise = maintenant;
          if (msParole >= MIN_PAROLE_MS) aParle = true;
          return;
        }

        if (aParle) {
          // On a parlé, puis plus rien depuis assez longtemps : c'est fini.
          if (maintenant - dernierVoise >= SILENCE_MS) conclure("silence");
          return;
        }

        // Jamais parlé. Un bruit a réveillé le détecteur — porte, chaise,
        // raclement de gorge. On rend la main SANS erreur : afficher un échec
        // ferait croire à une panne à chaque claquement de porte.
        if (maintenant - debut >= PATIENCE_INITIALE_MS) conclure("faux-reveil");
      }, PAS_MS);

      return ok(true);
    },

    arreter,

    niveau: () => lisse,
  };
}
