import {
  annulerSuivi,
  desarmerReveil,
  definirVoixSouhaitee,
  promesseArmement,
  retenirVoix,
  type RappelsVoix,
} from "./jarvis-reveil";
import { envoyer } from "./conversation";
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
  if (actif) return ok(true);
  const tenir = deps?.retenir ?? retenirVoix;

  stopLecture?.();
  stopLecture = abonnerLecture(() => {
    if (actif) toucher();
  });

  liberation = tenir({
    onCommande: async (texte: string) => {
      if (!actif) return;
      toucher();
      await envoyer(texte);
    },
  });
  actif = true;
  toucher();
  publier();

  // `retenirVoix` starts the arm asynchronously. Wait for that exact promise
  // instead of reporting success from the button click.
  const armement = promesseArmement();
  if (armement !== null) {
    const pret = await armement;
    if (!pret.ok) {
      actif = false;
      try {
        liberation();
      } finally {
        liberation = null;
      }
      if (minuteur !== null) {
        clearTimeout(minuteur);
        minuteur = null;
      }
      stopLecture?.();
      stopLecture = null;
      desarmerReveil();
      definirVoixSouhaitee(false);
      publier();
      return err(pret.error);
    }
  }

  definirVoixSouhaitee(true);
  return ok(true);
}

export function arreterMainsLibres(): void {
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
