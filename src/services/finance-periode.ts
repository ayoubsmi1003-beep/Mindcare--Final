/**
 * Finance — la PÉRIODE. Aperçu, série, composition, journal paginé.
 *
 * ⚠️ CE FICHIER NE REQUÊTE AUCUNE TABLE, exactement comme `finance.ts` : il
 * n'appelle que les deux portes de la migration 036. La raison est celle de
 * S5 et de S7a, transposée à la période — `app.list_period_payments` nomme des
 * patients, donc elle écrit une trace `liste` dans `audit.log` AVANT de lire.
 * Requêter `app.payments` par PostgREST rendrait les mêmes lignes SANS cette
 * trace : le chemin non audité qu'ADR-019 a fermé.
 *
 * ⚠️ POURQUOI UN FICHIER SÉPARÉ DE `finance.ts`.
 * `finance.ts` porte la JOURNÉE et l'ÉCRITURE (tarif, encaissement) — il est
 * appelé par l'écran de séance autant que par `/finances`. Ce fichier-ci ne
 * porte que la LECTURE ANALYTIQUE d'une période, et n'a qu'un seul appelant.
 * Les fusionner aurait donné un fichier de 700 lignes dont l'écran de séance
 * n'utiliserait qu'un quart. Ils partagent `formaterDzd` et le type `Paiement`,
 * importés — jamais recopiés (leçon de `repartition()` en S4 : deux calculs
 * pour une même vérité finissent par diverger, et ici ils divergeraient sur un
 * MONTANT).
 *
 * ═══ CE QUE CE FICHIER NE DÉCIDE PAS ═══════════════════════════════════════
 *
 * Il ne décide RIEN de la cloison. `perimetre` vient de la porte (036 §3), pas
 * d'une déduction locale. `parPraticienne` arrive VIDE pour une praticienne
 * parce que la BASE l'a vidé, pas parce que l'écran l'aurait filtré : un
 * `if (role === 'owner')` ici serait un défaut de conception (règle 4).
 *
 * Il ne décide RIEN du grain ni de la fenêtre de comparaison : les deux sont
 * calculés en SQL et rendus. L'écran les AFFICHE.
 *
 * ═══ CE QU'IL N'Y A PAS, ET QUI N'EST PAS UN OUBLI ═════════════════════════
 *
 * Ni charges, ni résultat net, ni objectif, ni remboursement, ni annulation :
 * AUCUNE table du dépôt ne les porte (ADR-010 — espèces, aucune facture). Les
 * cinq dettes sont datées dans `DOC-AUTHORITY.md` §4. Calculer un « net » à
 * partir du seul chiffre d'affaires afficherait un montant BRUT sous une
 * étiquette NETTE, ce qui est pire que de ne rien afficher.
 */

import { z } from "zod";

import { fr } from "@/i18n/fr";

import { db } from "./db";
import { logFieldsFor, type AppError } from "./errors";
import { log } from "./log";
import { err, ok, type Result } from "./result";
import { versNombre, type Paiement, type PerimetreRecette } from "./finance";

// ---------------------------------------------------------------------------
// Le calendrier du cabinet — délégué, jamais recopié
// ---------------------------------------------------------------------------
// Tout vit dans `finance-calendrier.ts`, qui n'importe RIEN et se compile donc
// seul pour les tests (`scripts/test-finance-calendrier.mjs`). Ré-exporté ici
// pour que l'écran n'ait qu'un seul module finance à importer.
export {
  aujourdHuiCabinet,
  ajouterJours,
  nombreDeJours,
  estAvantOuEgal,
  bornesDePeriode,
  periodeEstValide,
  PLAGE_MAX_JOURS,
} from "./finance-calendrier";
export type { NomPeriode, Periode } from "./finance-calendrier";

// ---------------------------------------------------------------------------
// Le contrat de la porte — types
// ---------------------------------------------------------------------------

export type Grain = "jour" | "semaine" | "mois";

/**
 * `nouveau` — il y a quelque chose maintenant, il n'y avait rien avant. AUCUN
 * ratio ne décrit ça, donc `pourcentage` est `null` et l'écran affiche « — ».
 * `indisponible` — l'une des deux valeurs manque (un taux sans assiette).
 */
export type SensVariation = "hausse" | "baisse" | "stable" | "nouveau" | "indisponible";

export interface Variation {
  readonly sens: SensVariation;
  /** `null` quand aucun pourcentage n'a de sens. JAMAIS 0, JAMAIS l'infini. */
  readonly pourcentage: number | null;
  readonly joursCompares: number;
}

export interface Pulse {
  /** Somme des tarifs FIXÉS sur la période — encaissés ou non. */
  readonly factureDzd: number;
  /** Ce qui est réellement entré en caisse, fenêtre sur `collected_at`. */
  readonly encaissePeriodeDzd: number;
  /** De ce qui a été facturé sur la période, ce qui a été reçu. */
  readonly encaisseAssietteDzd: number;
  readonly attenteDzd: number;
  readonly attenteNombre: number;
  readonly seancesTarifees: number;
  readonly revenuMoyenDzd: number | null;
  /** `null` — jamais 0 — quand rien n'a été facturé. */
  readonly tauxEncaissement: number | null;
  readonly varFacture: Variation;
  readonly varEncaisse: Variation;
  readonly varTaux: Variation;
}

export interface Seau {
  readonly debut: string;
  readonly factureDzd: number;
  readonly encaisseDzd: number;
  readonly attenteDzd: number;
  readonly seances: number;
}

export interface Groupe {
  readonly cle: string;
  /** Rendu par la base pour les praticiennes uniquement ; sinon traduit côté écran. */
  readonly libelle?: string;
  readonly montantDzd: number;
  readonly seances: number;
  readonly nonRattache: boolean;
}

export type CodeAttention = "attente-elevee" | "corrections" | "baisse-marquee";

export interface PointAttention {
  readonly code: CodeAttention;
  readonly severite: "info" | "attention";
  readonly valeur: number;
  readonly nombre: number;
}

export interface ApercuFinancier {
  readonly perimetre: PerimetreRecette;
  readonly grain: Grain;
  readonly du: string;
  readonly au: string;
  readonly joursPeriode: number;
  readonly joursEcoules: number;
  readonly comparaisonDu: string;
  readonly comparaisonAu: string;
  readonly pulse: Pulse;
  readonly serie: readonly Seau[];
  readonly parType: readonly Groupe[];
  readonly parPraticienne: readonly Groupe[];
  readonly points: readonly PointAttention[];
}

// ---------------------------------------------------------------------------
// La validation de la charge — Zod, comme sur une entrée de formulaire
// ---------------------------------------------------------------------------
//
// ⚠️ POURQUOI VALIDER UNE RÉPONSE DE NOTRE PROPRE BASE.
// Parce que `jsonb` n'a AUCUN type à la compilation : `result.data[0]` est un
// `unknown` que TypeScript croira volontiers être un `ApercuFinancier` si on
// le lui affirme. Le jour où la porte change une clé, l'écran afficherait
// `undefined` formaté en « — DZD » sans que rien ne le signale. Zod transforme
// ce silence en erreur nommée, au seul endroit où on peut encore la traiter.
//
// C'est la même discipline que sur une entrée utilisateur, appliquée à une
// sortie de base : les deux sont des frontières de type.


const VARIATION = z.object({
  sens: z.enum(["hausse", "baisse", "stable", "nouveau", "indisponible"]),
  pourcentage: z.number().nullable(),
  joursCompares: z.number().int(),
});

const GROUPE = z.object({
  cle: z.string(),
  libelle: z.string().optional(),
  montantDzd: z.number().int(),
  seances: z.number().int(),
  nonRattache: z.boolean(),
});

const APERCU = z.object({
  perimetre: z.enum(["cabinet", "praticienne"]),
  grain: z.enum(["jour", "semaine", "mois"]),
  du: z.string(),
  au: z.string(),
  joursPeriode: z.number().int(),
  joursEcoules: z.number().int(),
  comparaisonDu: z.string(),
  comparaisonAu: z.string(),
  pulse: z.object({
    factureDzd: z.number().int(),
    encaissePeriodeDzd: z.number().int(),
    encaisseAssietteDzd: z.number().int(),
    attenteDzd: z.number().int(),
    attenteNombre: z.number().int(),
    seancesTarifees: z.number().int(),
    revenuMoyenDzd: z.number().nullable(),
    tauxEncaissement: z.number().nullable(),
    varFacture: VARIATION,
    varEncaisse: VARIATION,
    varTaux: VARIATION,
  }),
  serie: z.array(z.object({
    debut: z.string(),
    factureDzd: z.number().int(),
    encaisseDzd: z.number().int(),
    attenteDzd: z.number().int(),
    seances: z.number().int(),
  })),
  parType: z.array(GROUPE),
  parPraticienne: z.array(GROUPE),
  points: z.array(z.object({
    code: z.enum(["attente-elevee", "corrections", "baisse-marquee"]),
    severite: z.enum(["info", "attention"]),
    valeur: z.number().int(),
    nombre: z.number().int(),
  })),
});

/**
 * Une erreur de cohérence n'est PAS une erreur technique — mais elle se traite
 * comme telle : on refuse d'afficher. Un chiffre faux sur un écran de caisse est
 * pire qu'un écran en erreur, parce qu'il se recopie dans un carnet.
 *
 * Trois temps, comme l'impose `05-UX-CONTRACT.md` §4.
 */
function erreurDeCoherence(quoi: string): AppError {
  return {
    // ⚠️ PAS `inattendu`, ET LE PRÉFLIGHT A RAISON DE LE REFUSER (V1.1) : une
    // rupture d'invariant n'a rien d'inattendu, elle est NOMMÉE. `regle-metier`
    // dit ce qui s'est produit — une règle comptable du dossier n'est pas
    // respectée — et `technical` dit LAQUELLE, ce qu'aucun aveu générique ne
    // permettrait de retrouver six mois plus tard dans un journal.
    code: "regle-metier",
    message: fr.finances.incoherence,
    technical: `invariant:${quoi}`,
    context: "rpc:finance_overview",
  };
}

/**
 * Les invariants, vérifiés AVANT que le moindre chiffre atteigne l'écran.
 *
 * Ils sont déjà tenus en SQL — ce sont les mêmes que les contrôles C2, C8, C9,
 * C18 du checkpoint. Les redire ici n'est pas une redondance inutile : le
 * checkpoint prouve la porte À UN INSTANT, cette fonction protège l'écran À
 * CHAQUE APPEL, y compris après une migration future qui aurait changé la porte
 * sans rejouer le checkpoint.
 *
 * ⚠️ ÉGALITÉ EXACTE, AUCUNE TOLÉRANCE. Ce sont des entiers (ADR-018) : un écart
 * d'un dinar est un défaut, pas un arrondi.
 */
function verifierInvariants(a: ApercuFinancier): AppError | null {
  const p = a.pulse;

  // I-1 · facturé = encaissé(assiette) + en attente
  if (p.factureDzd !== p.encaisseAssietteDzd + p.attenteDzd) {
    return erreurDeCoherence("I1");
  }

  // I-5 · le taux reste dans ses bornes ; I-6 · pas de taux sans assiette
  if (p.tauxEncaissement !== null && (p.tauxEncaissement < 0 || p.tauxEncaissement > 100)) {
    return erreurDeCoherence("I5");
  }
  if (p.factureDzd === 0 && p.tauxEncaissement !== null) {
    return erreurDeCoherence("I6");
  }

  // I-4 · la série réconcilie avec le total
  const totalSerie = a.serie.reduce((s, b) => s + b.factureDzd, 0);
  if (totalSerie !== p.factureDzd) {
    return erreurDeCoherence("I4");
  }

  // I-2 · la composition par type réconcilie — c'est le seau « Non rattaché »
  // qui le permet, et c'est pour ça qu'il ne se masque pas.
  const totalType = a.parType.reduce((s, g) => s + g.montantDzd, 0);
  if (totalType !== p.factureDzd) {
    return erreurDeCoherence("I2");
  }

  // I-3 · la composition par praticienne réconcilie QUAND elle existe. Vide
  // pour une praticienne : c'est la base qui l'a vidée, pas une anomalie.
  if (a.parPraticienne.length > 0) {
    const totalPrat = a.parPraticienne.reduce((s, g) => s + g.montantDzd, 0);
    if (totalPrat !== p.factureDzd) {
      return erreurDeCoherence("I3");
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Les portes
// ---------------------------------------------------------------------------

/**
 * TOUT l'écran en UN appel — `06-PERF-BUDGET.md` §2 plafonne `/finances` à un
 * seul aller-retour, et §3 prescrit nommément la porte composite.
 *
 * Rend `null` pour l'assistante : la porte lui donne zéro ligne, et ce n'est
 * pas une erreur — un écran vide, pas un message d'interdiction. Lui dire
 * « accès refusé » lui apprendrait qu'il y a un chiffre à ne pas voir.
 */
export async function getFinanceOverview(
  du: string,
  au: string,
): Promise<Result<ApercuFinancier | null>> {
  const result = await db().rpc<unknown>("finance_overview", { p_from: du, p_to: au });

  if (!result.ok) {
    // Ni montant, ni identifiant : règle 1 et I5. Un montant dans un journal,
    // c'est une donnée de cabinet qui sort de la machine.
    log.error("finance.apercu", logFieldsFor(result.error));
    return err(result.error);
  }

  const brut = result.data[0];
  // La porte a rendu NULL : hors périmètre. Ce n'est pas une absence de donnée,
  // c'est une absence de DROIT — et les deux s'affichent pareil, exprès.
  if (brut === undefined || brut === null) return ok(null);

  const analyse = APERCU.safeParse(brut);
  if (!analyse.success) {
    // Le chemin des clés, jamais une valeur : un message d'erreur Zod porterait
    // des MONTANTS s'il citait les données reçues.
    log.error("finance.apercu", {
      code: "regle-metier",
      context: `zod:${analyse.error.issues.map((i) => i.path.join(".")).join(",")}`,
    });
    return err(erreurDeCoherence("schema"));
  }

  const apercu = analyse.data as ApercuFinancier;

  const rupture = verifierInvariants(apercu);
  if (rupture !== null) {
    log.error("finance.apercu", { code: rupture.code, context: rupture.context ?? "" });
    return err(rupture);
  }

  log.info("finance.apercu", { count: apercu.serie.length });
  return ok(apercu);
}

export interface PageJournal {
  readonly lignes: readonly Paiement[];
  readonly total: number;
}

interface LignePeriodeRow {
  readonly payment_id: string;
  readonly receipt_number: string;
  readonly amount_dzd: number;
  readonly collected_at: string | null;
  readonly created_at: string;
  readonly patient_first_name: string | null;
  readonly patient_last_name: string | null;
  readonly record_number: string | null;
  readonly practitioner_name: string | null;
  readonly total_count: number | string;
}

/**
 * Le journal nominatif d'une période, paginé.
 *
 * ⚠️ CET APPEL ÉCRIT UNE TRACE `liste` EN BASE, une par patient distinct de la
 * page. C'est le SECOND appel réseau de l'écran, et il n'est légitime que parce
 * qu'il dépend d'un choix de l'utilisatrice — ouvrir le journal
 * (`06-PERF-BUDGET.md` §3). Il ne part JAMAIS au chargement.
 */
export async function listPeriodPayments(
  du: string,
  au: string,
  limite = 50,
  decalage = 0,
): Promise<Result<PageJournal>> {
  const result = await db().rpc<LignePeriodeRow>("list_period_payments", {
    p_from: du,
    p_to: au,
    p_limit: limite,
    p_offset: decalage,
  });

  if (!result.ok) {
    log.error("finance.journalPeriode", logFieldsFor(result.error));
    return err(result.error);
  }

  const lignes: readonly Paiement[] = result.data.map((r) => ({
    id: r.payment_id,
    receiptNumber: r.receipt_number,
    montantDzd: r.amount_dzd,
    collectedAt: r.collected_at,
    createdAt: r.created_at,
    patientPrenom: r.patient_first_name,
    patientNom: r.patient_last_name,
    recordNumber: r.record_number,
    practitionerName: r.practitioner_name,
  }));

  // `total_count` est répété sur chaque ligne (036 §4) : on le lit une fois.
  // Page vide → la porte ne rend rien, donc pas de total : 0 est alors la
  // vérité, puisque l'écran ne propose jamais une page au-delà de la fin.
  const total = versNombre(result.data[0]?.total_count);

  log.info("finance.journalPeriode", { count: lignes.length });
  return ok({ lignes, total });
}

// ---------------------------------------------------------------------------
// Le résumé — DÉTERMINISTE, et c'est un choix d'architecture
// ---------------------------------------------------------------------------

/**
 * Une phrase française composée de fragments d'`fr.finances`, à partir des
 * SEULS chiffres déjà rendus par la porte.
 *
 * ⚠️ AUCUN MODÈLE DE LANGAGE N'INTERVIENT ICI, ET CE N'EST PAS UN MANQUE.
 * Trois raisons, dans l'ordre :
 *
 *   1. `finance.ts` refuse déjà d'écrire un montant dans un journal LOCAL
 *      (« une donnée de cabinet qui sort de la machine »). Envoyer le profil
 *      financier d'une période à OpenRouter est une sortie plus large, pas plus
 *      étroite. Il faudrait un ADR, pas une fonction.
 *   2. Tout chiffre de cet écran est DÉTERMINISTE. Il ne resterait à un modèle
 *      que la paraphrase — et `03-JARVIS-TOOLS.md` gèle l'allowlist à cinq
 *      outils, verrouillée jusque dans une contrainte CHECK (033).
 *   3. Cette fonction est testable et rend deux fois la même phrase pour la
 *      même entrée. Une narration générée ne l'est ni l'un ni l'autre.
 *
 * Elle n'introduit AUCUNE information absente de son argument : chaque
 * fragment nomme une métrique affichée à l'écran, deux centimètres plus haut.
 * C'est ce qui rend « voir les preuves » inutile ici — les preuves SONT la page.
 */
export function resumerPeriode(a: ApercuFinancier): string {
  const t = fr.finances.resume;
  const p = a.pulse;

  if (p.seancesTarifees === 0) return t.aucuneSeance;

  const phrases: string[] = [];

  phrases.push(
    p.seancesTarifees === 1
      ? t.uneSeance
      : t.nSeances.replace("{n}", String(p.seancesTarifees)),
  );

  if (p.attenteNombre === 0) {
    phrases.push(t.toutEncaisse);
  } else {
    phrases.push(
      t.resteAEncaisser
        .replace("{n}", String(p.attenteNombre))
        .replace("{mot}", p.attenteNombre === 1 ? t.seance : t.seances),
    );
  }

  // La tendance n'est nommée QUE si elle a un sens : `nouveau` et
  // `indisponible` ne se racontent pas en pourcentage.
  const v = p.varFacture;
  if (v.pourcentage !== null && (v.sens === "hausse" || v.sens === "baisse")) {
    phrases.push(
      (v.sens === "hausse" ? t.enHausse : t.enBaisse)
        .replace("{pct}", Math.abs(v.pourcentage).toFixed(1).replace(".", ","))
        .replace("{jours}", String(v.joursCompares)),
    );
  } else if (v.sens === "nouveau") {
    phrases.push(t.aucunPrecedent);
  }

  return phrases.join(" ");
}
