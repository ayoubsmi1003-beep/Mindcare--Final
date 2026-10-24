/**
 * La cadence de recherche du cabinet et la connexion manuelle.
 *
 * ═══ POURQUOI CE FICHIER EXISTE ══════════════════════════════════════════════
 *
 * L'écran d'appairage affichait « Recherche du cabinet MindCare… » pendant
 * dix secondes sans aucun signe de vie : trois découvertes de 1,8 s séparées de
 * 1,5 s, et le bouton « Utiliser ce PC comme PC médecin » n'apparaissait qu'à
 * la fin. Rien ne distinguait une recherche en cours d'un écran gelé.
 *
 * Deux corrections, et elles sont ici plutôt que dans `bureau-cabinet.ts`
 * pour être VÉRIFIABLES sans Electron :
 *   · les trois premières recherches sont courtes (900 ms, 300 ms d'écart) :
 *     une décision arrive en ~3,6 s au lieu de ~10 s ;
 *   · passé ce délai, la cadence ralentit (1,5 s / 2,5 s) au lieu de marteler
 *     le réseau toutes les 1,5 s pendant des heures.
 *
 * ═══ LA CONNEXION MANUELLE, SANS NOUVELLE SURFACE ════════════════════════════
 *
 * Quand un routeur isole les postes (multicast ET broadcast coupés), la
 * découverte ne trouve rien — mais l'unicast, lui, passe. `decouvrirCabinets`
 * accepte déjà une liste de cibles (`targets`, `decouverte-cabinet.ts:64`).
 * Il suffit donc de résoudre le nom du PC médecin et d'envoyer la MÊME requête
 * à cette adresse : l'appairage continue ensuite exactement comme aujourd'hui,
 * chiffré et à usage unique. Aucune route HTTP non authentifiée n'est ajoutée.
 */

import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

/** Nombre de recherches rapides avant de proposer « ce PC est le PC médecin ». */
export const RECHERCHES_RAPIDES = 3;

/** Fenêtre d'écoute d'une découverte rapide, puis d'une découverte lente. */
const FENETRE_RAPIDE_MS = 900;
const FENETRE_LENTE_MS = 1_500;
const PAUSE_RAPIDE_MS = 300;
const PAUSE_LENTE_MS = 2_500;

/** Un libellé DNS valide : 1 à 63 caractères, alphanumériques et tirets. */
const LIBELLE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;

/**
 * Le nom saisi par l'accueil peut être un nom NetBIOS (`CABINET-PC`), un nom
 * DNS (`cabinet-pc.clinic.local`) ou une adresse IPv4. Rien d'autre : une URL,
 * un chemin, un nom vide ou un IPv6 sont refusés — l'IPv6 n'a pas de cible
 * UDP dans ce module (`createSocket('udp4')`).
 */
export function nomHoteValide(nom: string): boolean {
  const propre = nom.trim();
  if (propre.length === 0 || propre.length > 253) return false;
  const version = isIP(propre);
  if (version === 4) return true;
  if (version !== 0) return false;
  const morceaux = propre.split(".");
  return morceaux.every((morceau) => LIBELLE.test(morceau));
}

export type Resolveur = (nom: string) => Promise<string | null>;

/** La seule signature DNS dont ce module dépend — injectable en test. */
export type RechercheDns = (
  nom: string,
  options: { readonly family: 4; readonly all: true },
) => Promise<readonly { readonly address: string; readonly family: number }[]>;

/**
 * Résout un nom en adresse IPv4 utilisable comme cible UDP. Rend `null` — et
 * ne lève jamais — pour que l'écran puisse afficher « introuvable » au lieu
 * d'une erreur technique.
 */
export function creerResolveur(recherche: RechercheDns = lookup): Resolveur {
  return async (nom: string): Promise<string | null> => {
    const propre = nom.trim();
    if (!nomHoteValide(propre)) return null;
    if (isIP(propre) === 4) return propre;
    try {
      const resultat = await recherche(propre, { family: 4, all: true });
      const adresse = resultat[0]?.address;
      return typeof adresse === "string" && isIP(adresse) === 4 ? adresse : null;
    } catch {
      return null;
    }
  };
}

/** Durée d'écoute de la recherche `iteration` (0-indexée). */
export function fenetreRecherche(iteration: number): number {
  return iteration < RECHERCHES_RAPIDES ? FENETRE_RAPIDE_MS : FENETRE_LENTE_MS;
}

/** Pause entre deux recherches — longue seulement une fois la décision prise. */
export function delaiEntreRecherches(iteration: number): number {
  return iteration < RECHERCHES_RAPIDES ? PAUSE_RAPIDE_MS : PAUSE_LENTE_MS;
}

/**
 * « Ce PC est-il le PC médecin ? » — la décision qui ouvre le bouton d'hôte.
 *
 * Trois conditions, et aucune n'est cosmétique : trois recherches réellement
 * effectuées, aucun cabinet trouvé, et aucune base locale existante. Une base
 * existante interdit de proposer l'hôte : ce poste est un poste d'accueil ou un
 * cabinet déjà initialisé, jamais une installation neuve.
 */
export function proposerHote(
  recherches: number,
  candidats: number,
  baseExistante: boolean,
): boolean {
  return recherches >= RECHERCHES_RAPIDES && candidats === 0 && !baseExistante;
}
