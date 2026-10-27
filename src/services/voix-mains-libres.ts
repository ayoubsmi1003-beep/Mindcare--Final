import {
  annulerSuivi,
  desarmerReveil,
  definirVoixSouhaitee,
  installerDetecteur,
  promesseArmement,
  retenirVoix,
  type RappelsVoix,
} from "./jarvis-reveil";
import { envoyer } from "./conversation";
import { fr } from "@/i18n/fr";
import { abonnerLecture } from "./jarvis-voix";
import { err, ok, type Result } from "./result";

/**
 * Voix mains-libres — le pont entre le réveil local et la conversation.
 *
 * ON : le détecteur Vosk local écoute le mot « Alexa ». Au réveil, la machine
 * à états joue elle-même l'accusé AVANT d'ouvrir le micro de commande (voir
 * `declencherEcoute` dans `jarvis-reveil.ts`), puis capture → STT local → le
 * texte part aussitôt. Après chaque tour le détecteur reste armé ; 15 min sans
 * rien → arrêt.
 *
 * ⚠️ LE BOUTON NE PASSE PAS À « ACTIF » AVANT LE DÉTECTEUR. On attend le
 * résultat réel de l'armement ; un micro refusé ou un modèle absent reste une
 * erreur visible, jamais un faux voyant vert.
 */

const INACTIVITE_MS = 15 * 60_000;

let actif = false;
let liberation: (() => void) | null = null;
let minuteur: ReturnType<typeof setTimeout> | null = null;
let stopLecture: (() => void) | null = null;
/**
 * ⚠️ CHAQUE DÉMARRAGE APPARTIENT À UNE ÉPOQUE. L'armement du détecteur attend
 * un import dynamique puis le chargement du modèle ; un arrêt pendant cette
 * attente ne doit pas laisser la continuation écrire `voixSouhaitee(true)` ou
 * déclarer « veille » après coup. L'incrément d'`arreterMainsLibres` périme
 * tous les départs en vol.
 */
let demarrageGeneration = 0;
const abonnes = new Set<(actif: boolean) => void>();

function publier(): void {
  for (const a of abonnes) a(actif);
}

function toucher(): void {
  if (minuteur !== null) clearTimeout(minuteur);
  minuteur = setTimeout(() => {
    arreterMainsLibres();
  }, INACTIVITE_MS);
}

export function abonnerMainsLibres(abonne: (actif: boolean) => void): () => void {
  abonnes.add(abonne);
  abonne(actif);
  return () => {
    abonnes.delete(abonne);
  };
}

export function mainsLibresActif(): boolean {
  return actif;
}

export interface DependancesMainsLibres {
  readonly retenir?: (r: RappelsVoix) => () => void;
}

export async function demarrerMainsLibres(
  deps?: DependancesMainsLibres,
): Promise<Result<true>> {
  // Un second clic pendant l'armement ne crée pas une seconde époque : le
  // premier départ est déjà `actif` et reste propriétaire de son attente.
  if (actif) return ok(true);
  const generation = ++demarrageGeneration;
  const tenir = deps?.retenir ?? retenirVoix;

  const eteint = (): boolean => generation !== demarrageGeneration || !actif;

  stopLecture?.();
  const mienStopLecture = abonnerLecture(() => {
    if (actif) toucher();
  });
  stopLecture = mienStopLecture;

  const mienLiberation = tenir({
    onCommande: async (texte: string) => {
      if (!actif) return;
      toucher();
      await envoyer(texte);
    },
  });
  liberation = mienLiberation;
  actif = true;
  toucher();
  const mienMinuteur = minuteur;
  publier();

  /** Ne rendre que CE démarrage — jamais les ressources d'un successeur. */
  const rendreLesMiennes = (): void => {
    if (liberation === mienLiberation) {
      try {
        mienLiberation();
      } finally {
        liberation = null;
      }
    }
    if (stopLecture === mienStopLecture) {
      mienStopLecture();
      stopLecture = null;
    }
    if (minuteur !== null && minuteur === mienMinuteur) {
      clearTimeout(minuteur);
      minuteur = null;
    }
  };

  const annuler = (): Result<true> => {
    rendreLesMiennes();
    if (generation === demarrageGeneration) {
      actif = false;
      publier();
    }
    // Un successeur possède déjà l'antenne : on ne le désarme pas. Sinon plus
    // personne n'est propriétaire et l'on s'assure qu'aucun détecteur ne reste
    // installé/armé derrière l'arrêt.
    if (generation === demarrageGeneration || !actif) {
      desarmerReveil();
      installerDetecteur(null);
    }
    return err({ code: "indisponible", message: fr.jarvis.voix.indisponible });
  };

  // `retenirVoix` starts the arm asynchronously. Wait for that exact promise
  // instead of reporting success from the button click.
  const armement = promesseArmement();
  if (armement !== null) {
    const pret = await armement;
    if (eteint()) return annuler();
    if (!pret.ok) {
      rendreLesMiennes();
      actif = false;
      publier();
      desarmerReveil();
      installerDetecteur(null);
      definirVoixSouhaitee(false);
      return err(pret.error);
    }
  }
  if (eteint()) return annuler();

  definirVoixSouhaitee(true);
  return ok(true);
}

export function arreterMainsLibres(): void {
  // Périme tout démarrage en vol AVANT de rendre les ressources : sa
  // continuation verra l'époque changée et ne rallumera pas le détecteur.
  demarrageGeneration += 1;
  if (liberation !== null) {
    try {
      liberation();
    } catch {
      // libération idempotente : un second arrêt ne relance rien
    }
    liberation = null;
  }
  if (minuteur !== null) {
    clearTimeout(minuteur);
    minuteur = null;
  }
  stopLecture?.();
  stopLecture = null;
  if (actif) {
    actif = false;
    publier();
  }
  annulerSuivi();
  definirVoixSouhaitee(false);
  desarmerReveil();
}
