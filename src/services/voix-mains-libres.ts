import { abonnerVoix, desarmerReveil, retenirVoix, type EtatVoix, type RappelsVoix } from "./jarvis-reveil";
import { envoyer } from "./conversation";
import { abonnerLecture, lireTexte } from "./jarvis-voix";
import { alexa } from "@/i18n/alexa";
import { ok, type Result } from "./result";
import { log } from "./log";

/**
 * Voix mains-libres — le pont entre le réveil local et la conversation.
 *
 * ON : le détecteur openWakeWord (local, déjà livré) écoute le mot « Alexa ».
 * Au réveil : accusé « Oui docteur » (TTS, phrase fixe sans identité),
 * capture → STT → le texte part aussitôt (`envoyer`, envoi instantané choisi).
 * Après chaque tour le détecteur reste armé (veille) pour les questions
 * enchaînées ; 15 min sans rien → arrêt. Le détecteur se suspend/reprend
 * dans `jarvis-reveil` (inchangé) ; le micro vient du courtier (inchangé).
 *
 * RIEN d'écrit au dossier ici : `envoyer` ne fait que parler. Les cartes de
 * confirmation restent l'unique voie d'écriture, tapées par la praticienne.
 */

/** L'accusé ne part qu'au réveil — jamais deux fois, jamais sur parole. */
export function fautAccuser(etat: EtatVoix): boolean {
  return etat === "reveille";
}

const INACTIVITE_MS = 15 * 60_000;

let actif = false;
let liberation: (() => void) | null = null;
let minuteur: ReturnType<typeof setTimeout> | null = null;
let stopEtat: (() => void) | null = null;
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

  stopEtat?.();
  stopEtat = abonnerVoix((vue) => {
    if (!actif) return;
    if (!fautAccuser(vue.etat)) return;
    toucher();
    void lireTexte(alexa.reveilAccuse).then((r) => {
      if (!r.ok) log.warn("voix.mains-libres.accuse", { code: r.error.code });
    });
  });
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
  stopEtat?.();
  stopEtat = null;
  stopLecture?.();
  stopLecture = null;
  if (actif) {
    actif = false;
    publier();
  }
  desarmerReveil();
}
