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
import { preparerVoixReveil } from "./alexa-local";
import { err, ok, type Result } from "./result";

/**
 * Voix mains-libres — le pont entre le réveil local et la conversation.
 *
 * ON : le détecteur Vosk local écoute le mot « Alexa ». Au réveil, la machine
 * à états joue elle-même l'accusé AVANT d'ouvrir le micro de commande (voir
 * `declencherEcoute` dans `jarvis-reveil.ts`), puis capture → STT local → le
 * texte part aussitôt. Après chaque tour le détecteur reste armé, jusqu'à ce
 * que la praticienne coupe le mains-libres : « Alexa » doit répondre à toute
 * heure de la journée (aucun arrêt sur inactivité — l'armement est déjà
 * restauré à chaque démarrage). La veille n'envoie l'audio qu'au repéreur
 * local de mot de réveil ; Whisper n'écoute qu'une conversation ouverte.
 *
 * ⚠️ LE BOUTON NE PASSE PAS À « ACTIF » AVANT LE DÉTECTEUR. On attend le
 * résultat réel de l'armement ; un micro refusé ou un modèle absent reste une
 * erreur visible, jamais un faux voyant vert.
 */

let actif = false;
let liberation: (() => void) | null = null;
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


  const mienLiberation = tenir({
    onCommande: async (texte: string) => {
      if (!actif) return;
      await envoyer(texte);
    },
  });
  liberation = mienLiberation;
  actif = true;
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
  // Models and the cached acknowledgement load in the background, before the first "Alexa".
  void preparerVoixReveil();
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
  if (actif) {
    actif = false;
    publier();
  }
  annulerSuivi();
  definirVoixSouhaitee(false);
  desarmerReveil();
}
