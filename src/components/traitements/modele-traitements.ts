/**
 * Modèle pur de l'espace traitements.
 *
 * Aucun JSX, aucun service, aucune horloge implicite. Les règles qui décident
 * ce qu'on affiche — et surtout ce qu'on refuse d'inventer — vivent ici et
 * sont éprouvables sans base ni navigateur.
 */

import type { Treatment, TreatmentAction } from "@/services/patient-treatments";

export interface EvenementPosologie {
  readonly id: string;
  readonly treatmentId: string;
  readonly occurredAt: string;
  readonly action: TreatmentAction;
  readonly dose: string | null;
  readonly doseUnit: string | null;
}

export interface PointPosologie {
  readonly cle: string;
  readonly date: string;
  readonly valeur: number;
  readonly libelle: string;
  readonly titre: string;
}

export interface VariationNonNumerique {
  readonly cle: string;
  readonly date: string;
  readonly libelle: string;
}

export interface EvolutionPosologie {
  readonly points: readonly PointPosologie[];
  readonly unite: string | null;
  readonly nonNumeriques: readonly VariationNonNumerique[];
}

export interface PlanPrises {
  readonly matin: readonly Treatment[];
  readonly midi: readonly Treatment[];
  readonly soir: readonly Treatment[];
  readonly nonPrecise: readonly Treatment[];
}

export type CodeAttention =
  | "fin_depassee"
  | "fin_proche"
  | "posologie_incomplete"
  | "polypharmacie";

export interface AttentionItem {
  readonly code: CodeAttention;
  readonly traitementId: string | null;
  readonly priorite: number;
  readonly sourceDate: string | null;
  readonly params: Readonly<Record<string, string | number>>;
}

export interface ResumePolypharmacie {
  readonly actifs: number;
  readonly categories: number;
  readonly chevauchements: number;
  readonly posologiesIncompletes: number;
}

export interface EpisodeComparable {
  readonly id: string;
  readonly nom: string;
  readonly dose: string | null;
  readonly statut: "active" | "paused" | "stopped";
  readonly debut: string;
  readonly fin: string | null;
}

export interface EpisodeCompare {
  readonly id: string;
  readonly nom: string;
  readonly dose: string | null;
  readonly statut: "active" | "paused" | "stopped";
  readonly debut: string;
  readonly fin: string | null;
  readonly dureeJours: number;
}

export interface ComparaisonEpisodes {
  readonly a: EpisodeCompare;
  readonly b: EpisodeCompare;
}

const SLOTS = [
  { cle: "matin", motif: /matin/u },
  { cle: "midi", motif: /midi/u },
  { cle: "soir", motif: /soir/u },
] as const;

function jourUtc(iso: string): number | null {
  const parties = iso.slice(0, 10).split("-");
  const [annee, mois, jour] = parties;
  if (annee === undefined || mois === undefined || jour === undefined) return null;
  const valeur = Date.UTC(Number(annee), Number(mois) - 1, Number(jour));
  return Number.isFinite(valeur) ? valeur : null;
}

function ajouterJours(iso: string, jours: number): string | null {
  const base = jourUtc(iso);
  if (base === null) return null;
  return new Date(base + jours * 86_400_000).toISOString().slice(0, 10);
}

function ecartJours(debut: string, fin: string): number | null {
  const a = jourUtc(debut);
  const b = jourUtc(fin);
  if (a === null || b === null) return null;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

function normaliserUnite(unite: string | null): string {
  return (unite ?? "").trim().toLocaleLowerCase("fr");
}

/**
 * Un motif d'arrêt est stocké en code (`decision_clinique`). L'écran affiche
 * le libellé ; un code inconnu est rendu tel quel plutôt que masqué.
 */
export function motifArretLisible(
  reason: string | null,
  libelles: Readonly<Record<string, string>>,
): string | null {
  if (reason === null) return null;
  const texte = reason.trim();
  if (texte === "") return null;
  return libelles[texte] ?? texte;
}

/**
 * La dose PRESCRITE, et rien d'autre.
 *
 * ⚠️ Le dosage du catalogue (`strength`) n'entre jamais ici : « 50 mg » au
 * catalogue ne prouve pas que 50 mg ont été prescrits. Une dose absente reste
 * absente, même si le médicament existe en 50 mg.
 */
export function dosePrescrite(dose: string | null, unite: string | null): string | null {
  const d = dose?.trim() ?? "";
  if (d === "") return null;
  const u = unite?.trim() ?? "";
  return u === "" ? d : `${d} ${u}`;
}

/**
 * Lit une dose strictement numérique. Une dose libre (« 1 comprimé », « 50-100 »)
 * n'est PAS convertie : le graphique ne doit jamais suggérer une précision que
 * la saisie n'a pas.
 */
export function analyserDose(
  dose: string | null,
  unite: string | null,
): { valeur: number; unite: string } | null {
  if (dose === null) return null;
  const texte = dose.trim();
  if (texte === "") return null;
  const resultat = /^([0-9]+(?:[.,][0-9]+)?)\s*([a-zA-Zµ%]+)?$/u.exec(texte);
  if (resultat === null) return null;
  const valeur = Number((resultat[1] ?? "").replace(",", "."));
  if (!Number.isFinite(valeur)) return null;
  const uniteTexte = (resultat[2] ?? unite ?? "").trim();
  if (unite !== null && uniteTexte !== "" && normaliserUnite(unite) !== normaliserUnite(uniteTexte)) {
    return null;
  }
  return { valeur, unite: uniteTexte === "" ? "unité" : uniteTexte };
}

/**
 * Construit les points RÉELS de la posologie. Les événements sont triés par
 * date, jamais interpolés. Si les unités diffèrent, aucun tracé n'est produit :
 * une courbe 50 mg → 1 comprimé n'a pas de sens.
 */
export function construireEvolutionPosologie(
  evenements: readonly EvenementPosologie[],
  treatmentId: string,
): EvolutionPosologie {
  const retenus = evenements
    .filter((e) => e.treatmentId === treatmentId)
    .filter((e) => e.action === "started" || e.action === "dose_changed")
    .slice()
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));

  const points: PointPosologie[] = [];
  const nonNumeriques: VariationNonNumerique[] = [];
  const unites = new Set<string>();

  for (const evenement of retenus) {
    const dose = analyserDose(evenement.dose, evenement.doseUnit);
    const libelle = [evenement.dose, evenement.doseUnit].filter(Boolean).join(" ") || "Dose non renseignée";
    if (dose === null) {
      nonNumeriques.push({
        cle: evenement.id,
        date: evenement.occurredAt,
        libelle,
      });
      continue;
    }
    unites.add(normaliserUnite(dose.unite));
    points.push({
      cle: evenement.id,
      date: evenement.occurredAt,
      valeur: dose.valeur,
      libelle: `${String(dose.valeur)} ${dose.unite}`.trim(),
      titre: evenement.occurredAt.slice(0, 10),
    });
  }

  if (unites.size > 1) {
    return {
      points: [],
      unite: null,
      nonNumeriques: retenus.map((e) => ({
        cle: e.id,
        date: e.occurredAt,
        libelle: [e.dose, e.doseUnit].filter(Boolean).join(" ") || "Dose non renseignée",
      })),
    };
  }

  return {
    points,
    unite: unites.size === 1 ? (points[0]?.libelle.split(" ").slice(-1)[0] ?? null) : null,
    nonNumeriques,
  };
}

/**
 * Le schéma PRESCRIT, pas une prise vérifiée. Un horaire absent reste absent :
 * `frequency` ne permet pas de le déduire.
 */
export function construirePlanPrises(traitements: readonly Treatment[]): PlanPrises {
  const actifs = traitements.filter((t) => t.status === "active");
  const plan: Record<"matin" | "midi" | "soir" | "nonPrecise", Treatment[]> = {
    matin: [],
    midi: [],
    soir: [],
    nonPrecise: [],
  };

  for (const traitement of actifs) {
    const horaires = traitement.timing.map((h) => h.toLocaleLowerCase("fr"));
    let place = false;
    for (const slot of SLOTS) {
      if (horaires.some((h) => slot.motif.test(h))) {
        plan[slot.cle].push(traitement);
        place = true;
      }
    }
    if (!place) plan.nonPrecise.push(traitement);
  }

  return plan;
}

/** Règles d'attention explicables, toutes adossées à une donnée réelle. */
export function construireAttention(
  traitements: readonly Treatment[],
  aujourdHui: string,
): readonly AttentionItem[] {
  const actifs = traitements.filter((t) => t.status === "active");
  const items: AttentionItem[] = [];
  const dansQuatorzeJours = ajouterJours(aujourdHui, 14);

  for (const traitement of actifs) {
    if (traitement.endDate !== null) {
      if (traitement.endDate < aujourdHui) {
        items.push({
          code: "fin_depassee",
          traitementId: traitement.id,
          priorite: 1,
          sourceDate: traitement.endDate,
          params: { dateFin: traitement.endDate, traitement: traitement.medicationRaw },
        });
      } else if (dansQuatorzeJours !== null && traitement.endDate <= dansQuatorzeJours) {
        const joursRestants = ecartJours(aujourdHui, traitement.endDate);
        items.push({
          code: "fin_proche",
          traitementId: traitement.id,
          priorite: 2,
          sourceDate: traitement.endDate,
          params: {
            dateFin: traitement.endDate,
            joursRestants: joursRestants ?? 0,
            traitement: traitement.medicationRaw,
          },
        });
      }
    }

    if ((traitement.dose === null || traitement.dose.trim() === "") || (traitement.frequency === null || traitement.frequency.trim() === "")) {
      items.push({
        code: "posologie_incomplete",
        traitementId: traitement.id,
        priorite: 3,
        sourceDate: traitement.updatedAt,
        params: { traitement: traitement.medicationRaw },
      });
    }
  }

  if (actifs.length >= 5) {
    items.push({
      code: "polypharmacie",
      traitementId: null,
      priorite: 4,
      sourceDate: null,
      params: { actifs: actifs.length },
    });
  }

  return items.sort((a, b) => a.priorite - b.priorite || (a.sourceDate ?? "").localeCompare(b.sourceDate ?? ""));
}

function chevauche(a: Treatment, b: Treatment): boolean {
  const debutA = jourUtc(a.startDate);
  const debutB = jourUtc(b.startDate);
  if (debutA === null || debutB === null) return false;
  const finA = a.endDate === null ? Number.POSITIVE_INFINITY : (jourUtc(a.endDate) ?? Number.POSITIVE_INFINITY);
  const finB = b.endDate === null ? Number.POSITIVE_INFINITY : (jourUtc(b.endDate) ?? Number.POSITIVE_INFINITY);
  return debutA <= finB && debutB <= finA;
}

export function resumerPolypharmacie(traitements: readonly Treatment[]): ResumePolypharmacie {
  const actifs = traitements.filter((t) => t.status === "active");
  const categories = new Set(
    actifs.map((t) => t.atcClass).filter((v): v is string => v !== null && v.trim() !== ""),
  );
  let chevauchements = 0;
  for (let i = 0; i < actifs.length; i += 1) {
    for (let j = i + 1; j < actifs.length; j += 1) {
      const a = actifs[i];
      const b = actifs[j];
      if (a !== undefined && b !== undefined && chevauche(a, b)) chevauchements += 1;
    }
  }
  return {
    actifs: actifs.length,
    categories: categories.size,
    chevauchements,
    posologiesIncompletes: actifs.filter(
      (t) => !t.dose || !t.frequency,
    ).length,
  };
}

/** Durée d'un épisode, en jours civils. Un épisode actif s'arrête à aujourd'hui. */
export function comparerEpisodes(
  a: EpisodeComparable,
  b: EpisodeComparable,
  aujourdHui: string,
): ComparaisonEpisodes {
  return {
    a: {
      ...a,
      dureeJours: ecartJours(a.debut, a.fin ?? aujourdHui) ?? 0,
    },
    b: {
      ...b,
      dureeJours: ecartJours(b.debut, b.fin ?? aujourdHui) ?? 0,
    },
  };
}
