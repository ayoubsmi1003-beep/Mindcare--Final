/**
 * `jarvis-contexte.ts` — LE BROKER DE CONTEXTE.
 *
 * ═══ CE QU'IL FAIT, ET CE QU'IL NE FAIT PAS ═══
 * Il assemble le contexte MINIMAL d'un tour, et il tient l'invariant de cible
 * unique. Il n'expédie JAMAIS le dossier entier : « lecture complète » veut dire
 * que la surface autorisée est ATTEIGNABLE, pas qu'elle est envoyée à chaque
 * tour. Le reste, le modèle le DEMANDE, capacité par capacité — c'est ce qui
 * rend la boucle utile plutôt que coûteuse.
 *
 * ⚠️ CE FICHIER NE REQUÊTE PRESQUE RIEN LUI-MÊME. Il appelle les services
 * existants et les capacités du registre. Toute requête écrite ici serait un
 * second chemin d'accès aux données, avec sa propre dérive.
 *
 * ═══ L'INVARIANT DE CIBLE UNIQUE ═══
 *
 *     À tout instant :  patientCible ∈ { ∅, un seul patient }
 *
 * Ce n'est pas une convention d'écriture, c'est la propriété qui empêche
 * l'erreur la plus grave que ce produit puisse commettre : parler du dossier de
 * Karim en croyant parler de celui de Nadia. Changer de patient REMPLACE la
 * cible, purge la carte d'identité et jette les résultats de capacité du patient
 * précédent. Rien n'est jamais accumulé.
 *
 * ⚠️ POURQUOI LA PURGE DE LA CARTE EST INDISPENSABLE ET PAS SEULEMENT PRUDENTE.
 * Les jetons sont attribués dans l'ordre de frappe : `PATIENT_001` désigne le
 * premier dossier rencontré du tour. Sans purge au changement de cible,
 * `PATIENT_001` continuerait de désigner Nadia pendant qu'on parle de Karim, et
 * le sidecar rendrait la réponse avec le mauvais nom — une erreur d'identité
 * dans un dossier médical, produite par une optimisation de cache.
 */

import { getOpenConsultation } from "./consultations";
import { aujourdHui } from "./jarvis-capacites";
import {
  carte as carteCourante,
  reinitialiserCarte,
  type CarteIdentite,
  type RefPatient,
} from "./jarvis-identite";
import { mesurerOctets } from "./jarvis-projections";
import type { PatientActif } from "./patient-actif";

// ═══════════════════════════════════════════════════════════════════════════
// 1 · LA CIBLE
// ═══════════════════════════════════════════════════════════════════════════

export interface CiblePatient {
  /** L'identifiant RÉEL. Ne franchit jamais — il sert aux capacités. */
  readonly id: string;
  /** Ce que la praticienne lit à l'écran. Ne franchit jamais non plus. */
  readonly libelle: string;
  readonly numeroDossier: string;
  /**
   * Comment la cible a été établie. Journalisé en télémétrie (§12) parce que
   * « d'où vient la cible » est la première question quand une réponse porte sur
   * le mauvais dossier.
   */
  readonly origine: "ecran" | "recherche" | "agenda" | "consultation";
}

let cible: CiblePatient | null = null;

export function cibleCourante(): CiblePatient | null {
  return cible;
}

/**
 * Établit — ou remplace — la cible. Rend `true` si la cible a CHANGÉ, ce qui
 * oblige l'appelant à repartir d'un contexte propre.
 *
 * ⚠️ REMPLACE, N'AJOUTE PAS. Il n'existe volontairement aucune fonction
 * `ajouterCible` : le type de `cible` est `CiblePatient | null`, jamais un
 * tableau, et c'est la forme même de l'état qui rend l'accumulation
 * impossible à écrire par distraction.
 */
export function definirCible(nouvelle: CiblePatient | null): boolean {
  const change = (cible?.id ?? null) !== (nouvelle?.id ?? null);
  if (change) {
    cible = nouvelle;
    // La purge est SOLIDAIRE du changement de cible — même instruction, même
    // ligne de code. Les séparer laisserait un chemin où l'une a lieu sans
    // l'autre, et ce chemin serait exactement le bogue de contamination.
    reinitialiserCarte();
  }
  return change;
}

/** Efface la cible. Appelé quand la praticienne retire le contexte patient. */
export function effacerCible(): void {
  definirCible(null);
}

// ═══════════════════════════════════════════════════════════════════════════
// 2 · LES BUDGETS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * §6.1 du plan. Budgets INDÉPENDANTS : un seul plafond global laisserait un
 * tour consommer sa totalité en un appel, ou boucler indéfiniment sur des
 * appels minuscules. Chacun borne une dimension différente de la dérive.
 */
export const BUDGETS = {
  /** Allers-retours modèle → outil → modèle dans un même tour. */
  MAX_TOURS_OUTIL: 3,
  /** Appels de capacité cumulés sur le tour, toutes itérations confondues. */
  MAX_APPELS_OUTIL: 6,
  /** Taille sérialisée du contexte envoyé au modèle. */
  MAX_OCTETS_CONTEXTE: 24_000,
  /** Durée d'une capacité, puis du tour entier. */
  MAX_MS_CAPACITE: 20_000,
  MAX_MS_TOUR: 60_000,
  /**
   * ⚠️ UNE SEULE ÉCRITURE PAR TOUR, SANS EXCEPTION. Deux écritures enchaînées
   * sans reprise de parole humaine, ce serait une confirmation qui vaut pour
   * une action que l'humaine n'a pas lue. L2 tombe.
   */
  MAX_ECRITURES_PAR_TOUR: 1,
} as const;

// ═══════════════════════════════════════════════════════════════════════════
// 3 · LES FAITS DÉTERMINISTES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ⚠️ LE MODÈLE NE CALCULE AUCUNE DATE (§7.2). « Demain », « jeudi », « ce
 * matin » se résolvent ICI, en TypeScript, dans le calendrier du cabinet, et
 * partent comme des FAITS. Un modèle qui calcule une date se trompe d'un jour
 * une fois sur vingt, en silence, et un rendez-vous décalé d'un jour est une
 * patiente qui se déplace pour rien.
 *
 * ⚠️ AUCUNE DE CES VALEURS N'EST IDENTIFIANTE : ce sont des dates et un fuseau.
 * Elles traversent la frontière sans transformation, et c'est légitime.
 */
export interface FaitsTemporels {
  /** `YYYY-MM-DD`, calendrier du cabinet. */
  readonly aujourdHui: string;
  /** Instant courant, ISO 8601 avec décalage d'Alger. */
  readonly maintenant: string;
  readonly decalage: string;
  readonly bornesAujourdHui: { readonly du: string; readonly au: string };
  readonly bornesDemain: { readonly du: string; readonly au: string };
}

const FUSEAU = "Africa/Algiers";

/**
 * Le décalage d'Alger à cet instant, calculé par différence entre l'heure
 * murale et l'instant absolu — jamais codé en dur à `+01:00`.
 *
 * L'Algérie n'observe pas l'heure d'été aujourd'hui, mais un décalage écrit en
 * dur est une hypothèse silencieuse sur une décision politique. Le calcul coûte
 * trois lignes et ne peut pas devenir faux.
 */
function decalageAlger(maintenantMurale: string, maintenantMs: number): string {
  const murAlger = Date.parse(`${maintenantMurale.replace(" ", "T")}Z`);
  const minutes = Math.round((murAlger - maintenantMs) / 60_000);
  const signe = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  return `${signe}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

function ajouterJours(jour: string, n: number): string {
  const d = new Date(`${jour}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function faitsTemporels(maintenant: Date = new Date()): FaitsTemporels {
  const murale = maintenant.toLocaleString("sv-SE", { timeZone: FUSEAU });
  const decalage = decalageAlger(murale, maintenant.getTime());
  const jour = aujourdHui();
  const demain = ajouterJours(jour, 1);
  const bornes = (j: string) => ({
    du: `${j}T00:00:00${decalage}`,
    au: `${ajouterJours(j, 1)}T00:00:00${decalage}`,
  });
  return {
    aujourdHui: jour,
    maintenant: `${murale.replace(" ", "T")}${decalage}`,
    decalage,
    bornesAujourdHui: bornes(jour),
    bornesDemain: bornes(demain),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 4 · LE CONTEXTE D'AMORÇAGE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Ce que le modèle reçoit AVANT d'avoir demandé quoi que ce soit. Volontairement
 * maigre : une référence de patient s'il y en a une, les faits temporels, et
 * rien d'autre. Le dossier lui-même ne part que si le modèle appelle
 * `get_patient_context` — c'est-à-dire quand la question le justifie.
 *
 * ⚠️ « QUI EST LE PROCHAIN PATIENT ? » NE DOIT PAS COÛTER UN DOSSIER COMPLET.
 * C'est la mesure du succès de ce fichier : deux kilo-octets pour une question
 * d'agenda, douze pour une préparation de consultation, zéro pour une question
 * de connaissance générale.
 */
export interface ContexteAmorce {
  readonly temps: FaitsTemporels;
  /** La cible, si elle existe — en RÉFÉRENCE, jamais en nom. */
  readonly patientCible?: RefPatient;
  /** Une séance est-elle ouverte ? Un booléen, pas le dossier. */
  readonly consultationOuverte: boolean;
  readonly octets: number;
}

/**
 * Assemble l'amorce et frappe le jeton de la cible s'il y en a une.
 *
 * La carte reçue est celle du TOUR : c'est ici qu'elle apprend l'identité de la
 * cible, donc c'est à partir d'ici que le pare-feu saura la masquer dans le
 * message libre de la praticienne (§1.5 — « Ouvre le dossier de Nadia » devient
 * « Ouvre le dossier de {{PATIENT_001}} »).
 */
export async function assemblerAmorce(
  carte: CarteIdentite = carteCourante(),
): Promise<ContexteAmorce> {
  const temps = faitsTemporels();

  let patientCible: RefPatient | undefined;
  if (cible !== null) {
    patientCible = carte.patient(cible.id, cible.libelle, [
      cible.libelle,
      cible.numeroDossier,
      ...cible.libelle.split(/\s+/).filter((m) => m.length >= 3),
    ]);
  }

  // Un booléen, pas la séance. Savoir QU'IL Y A une consultation ouverte suffit
  // au modèle pour proposer `get_consultation` ; lui envoyer la note d'office
  // serait envoyer un dossier que personne n'a demandé.
  const ouverte = await getOpenConsultation();
  const consultationOuverte = ouverte.ok && ouverte.data !== null;

  const amorce = {
    temps,
    ...(patientCible === undefined ? {} : { patientCible }),
    consultationOuverte,
  };
  return { ...amorce, octets: mesurerOctets(amorce) };
}

/**
 * Adopte le dossier ouvert à l'écran comme cible.
 *
 * ⚠️ CE N'EST JAMAIS UNE AUTORISATION (L3). C'est une CIBLE pré-résolue, pour
 * éviter au modèle de deviner de qui l'on parle. La RLS décide de tout le reste
 * sous le JWT de l'appelante, et une cible pointant vers un dossier hors
 * périmètre ne rendra rien — « introuvable ≡ hors périmètre » (ADR-003).
 */
export function adopterPatientActif(patient: PatientActif | null): boolean {
  if (patient === null) return definirCible(null);
  return definirCible({
    id: patient.id,
    libelle: patient.nom,
    numeroDossier: patient.numero,
    origine: "ecran",
  });
}
