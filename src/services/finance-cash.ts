/**
 * Finance — la COMPTABILITÉ DE CAISSE. Une seule notion de recette.
 *
 * ⚠️ CE FICHIER NE REQUÊTE AUCUNE TABLE. Il n'appelle que les trois portes des
 * migrations 039/040. La raison est celle d'ADR-019 :
 * `app.get_sessions_payments_list` nomme des patientes, donc elle écrit une
 * trace `liste` dans `audit.log` AVANT de lire. Requêter `app.payments` par
 * PostgREST rendrait les mêmes lignes SANS cette trace — le chemin non audité
 * qu'ADR-019 a fermé.
 *
 * ═══ POURQUOI CE FICHIER REMPLACE `finance-periode.ts` ═════════════════════
 *
 * `finance-periode.ts` (V6) modélisait `facturé / encaissé / en attente / taux
 * d'encaissement` : un cabinet qui FACTURE puis se fait payer plus tard. Ce
 * cabinet-ci est au COMPTANT — la patiente règle à la séance. Il n'y a donc pas
 * deux axes comptables, il y en a UN : l'argent entré en caisse.
 *
 * Les impayés existent (un virement promis, une patiente partie sans régler)
 * mais ce sont des EXCEPTIONS. Ils vivent dans le panneau Attention et dans
 * l'onglet Séances & paiements — jamais comme un second total en tête d'écran.
 *
 * ═══ AUCUNE ARITHMÉTIQUE ICI, NI DANS L'ÉCRAN ══════════════════════════════
 *
 * Tout arrive DÉJÀ CALCULÉ : les totaux, le résultat net, les pourcentages de
 * répartition (`partPct`), l'âge du plus ancien impayé. Ce fichier VALIDE et
 * RENOMME, il ne calcule pas. Un chiffre recalculé dans le navigateur est un
 * chiffre qui peut diverger de la base — et ici il divergerait sur un MONTANT.
 *
 * ═══ CE QUE CE FICHIER NE DÉCIDE PAS ═══════════════════════════════════════
 *
 * Il ne décide rien de la cloison. La porte rend `null` pour l'assistante ; ce
 * n'est pas une absence de donnée, c'est une absence de DROIT, et les deux
 * s'affichent pareil, exprès (ADR-003). Un `if (role === …)` ici serait un
 * défaut de conception (règle 4).
 */

import { z } from "zod";

import { fr } from "@/i18n/fr";

import { db } from "./db";
import { logFieldsFor, type AppError } from "./errors";
import { log } from "./log";
import { err, ok, type Result } from "./result";

// Le calendrier du cabinet — délégué, jamais recopié. Tout vit dans
// `finance-calendrier.ts`, qui n'importe rien et se compile donc seul pour
// `scripts/test-finance-calendrier.mjs`.
export {
  aujourdHuiCabinet,
  ajouterJours,
  nombreDeJours,
  estAvantOuEgal,
  bornesDePeriode,
  periodeEstValide,
  PLAGE_MAX_JOURS,
  type NomPeriode,
  type Periode,
} from "./finance-calendrier";

export { formaterDzd } from "./finance";

// ---------------------------------------------------------------------------
// Le schéma — la frontière de confiance
// ---------------------------------------------------------------------------
// `bigint` de Postgres arrive en JSON comme un NOMBRE quand il tient, et comme
// une CHAÎNE au-delà de 2^53. `z.coerce.number()` absorbe les deux sans que
// l'écran ait à s'en soucier.
const NOMBRE = z.coerce.number();

const PULSE = z.object({
  revenu_aujourdhui: NOMBRE,
  revenu_semaine: NOMBRE,
  revenu_mois: NOMBRE,
  revenu_periode: NOMBRE,
  charges_periode: NOMBRE,
  resultat_net_periode: NOMBRE,
  nb_seances_periode: NOMBRE,
  nb_charges_recurrentes: NOMBRE,
  // NULL VOULU : un panier moyen sans séance n'existe pas. L'écran affiche
  // « — ». Jamais 0, qui serait un chiffre faux, jamais NaN.
  panier_moyen: NOMBRE.nullable(),
  impayes_total: NOMBRE,
  impayes_count: NOMBRE,
});

const SEAU_MOIS = z.object({
  mois_label: z.string(),
  mois_iso: z.string(),
  revenu: NOMBRE,
  charges: NOMBRE,
  resultat_net: NOMBRE,
});

const PART_REVENU = z.object({
  cle: z.string(),
  libelle: z.string(),
  montant: NOMBRE,
  nb_seances: NOMBRE,
  part_pct: NOMBRE,
});

const PART_CHARGE = z.object({
  cle: z.string(),
  libelle: z.string(),
  montant: NOMBRE,
  part_pct: NOMBRE,
});

const JOUR = z.object({
  jour_iso: z.string(),
  montant: NOMBRE,
  nb_seances: NOMBRE,
  a_impaye: z.boolean(),
});

const ECHEANCE = z.object({
  intitule: z.string(),
  montant: NOMBRE,
  date_echeance: z.string(),
  jours_restants: NOMBRE,
});

const APERCU = z.object({
  du: z.string(),
  au: z.string(),
  jours: NOMBRE,
  pulse: PULSE,
  evolution: z.array(SEAU_MOIS),
  composition: z.object({
    revenus_par_type: z.array(PART_REVENU),
    charges_par_categorie: z.array(PART_CHARGE),
  }),
  calendrier: z.array(JOUR),
  attention: z.object({
    impayes_total: NOMBRE,
    impayes_count: NOMBRE,
    echeances_a_venir: z.array(ECHEANCE),
    plus_ancien_impaye_jours: NOMBRE,
  }),
});

export type Pulse = z.infer<typeof PULSE>;
export type SeauMois = z.infer<typeof SEAU_MOIS>;
export type PartRevenu = z.infer<typeof PART_REVENU>;
export type PartCharge = z.infer<typeof PART_CHARGE>;
export type JourCaisse = z.infer<typeof JOUR>;
export type Echeance = z.infer<typeof ECHEANCE>;
export type ApercuCaisse = z.infer<typeof APERCU>;

const LIGNE_CHARGE = z.object({
  id: z.string(),
  intitule: z.string(),
  categorie: z.string(),
  montant: NOMBRE,
  type: z.string(),
  frequence: z.string().nullable(),
  date_charge: z.string(),
  date_prochaine_echeance: z.string().nullable(),
});

const LISTE_CHARGES = z.object({
  lignes: z.array(LIGNE_CHARGE),
  // ⚠️ DEUX TOTAUX, JAMAIS ADDITIONNÉS. Un rythme mensuel récurrent et des
  // dépenses ponctuelles ne sont pas la même unité ; les sommer produirait un
  // nombre sans signification sur lequel on déciderait quand même.
  total_recurrent_mensuel: NOMBRE,
  total_ponctuel_periode: NOMBRE,
});

export type LigneCharge = z.infer<typeof LIGNE_CHARGE>;
export type ListeCharges = z.infer<typeof LISTE_CHARGES>;

const LIGNE_SEANCE = z.object({
  id: z.string(),
  date: z.string(),
  patient: z.string(),
  type: z.string(),
  montant: NOMBRE,
  mode: z.string(),
  receipt_number: z.string(),
  paye: z.boolean(),
});

const LISTE_SEANCES = z.object({
  lignes: z.array(LIGNE_SEANCE),
  total: NOMBRE,
  impayes_total: NOMBRE,
  impayes_count: NOMBRE,
});

export type LigneSeance = z.infer<typeof LIGNE_SEANCE>;
export type ListeSeances = z.infer<typeof LISTE_SEANCES>;

// ---------------------------------------------------------------------------
// L'erreur de schéma — nommée, jamais générique
// ---------------------------------------------------------------------------
// ⚠️ PAS `inattendu`, et le préflight a raison de le refuser : une réponse qui
// ne respecte pas le contrat de la porte n'a rien d'inattendu, elle est NOMMÉE.
// `technical` dit LAQUELLE des portes a dévié, ce qu'aucun aveu générique ne
// permettrait de retrouver six mois plus tard dans un journal.
function erreurDeSchema(porte: string): AppError {
  return {
    code: "regle-metier",
    message: fr.finances.incoherence,
    technical: "schema",
    context: `rpc:${porte}`,
  };
}

// ---------------------------------------------------------------------------
// Lecture — une porte par onglet
// ---------------------------------------------------------------------------

/**
 * Le seul appel de l'onglet Vue d'ensemble. UNE porte, tout l'écran.
 * Rend `null` quand la porte a rendu NULL : hors périmètre. Ce n'est pas une
 * absence de donnée, c'est une absence de droit — l'écran affiche un état vide,
 * jamais « accès refusé », qui apprendrait qu'il y a un chiffre à ne pas voir.
 */
export async function getFinanceOverview(
  du: string,
  au: string,
): Promise<Result<ApercuCaisse | null>> {
  const result = await db().rpc<unknown>("get_finance_overview", {
    p_period_start: du,
    p_period_end: au,
  });

  if (!result.ok) {
    // Ni montant, ni identifiant dans le journal : règle 1 et I5.
    log.error("finance.apercu", logFieldsFor(result.error));
    return err(result.error);
  }

  const brut = result.data[0];
  if (brut === undefined || brut === null) return ok(null);

  const analyse = APERCU.safeParse(brut);
  if (!analyse.success) {
    // Le CHEMIN des clés, jamais une valeur : citer les données reçues ferait
    // sortir des MONTANTS dans un journal.
    log.error("finance.apercu", {
      code: "regle-metier",
      context: `zod:${analyse.error.issues.map((i) => i.path.join(".")).join(",")}`,
    });
    return err(erreurDeSchema("get_finance_overview"));
  }

  log.info("finance.apercu", { count: 1 });
  return ok(analyse.data);
}

/** Onglet Charges. Une porte. */
export async function getChargesList(
  du: string,
  au: string,
): Promise<Result<ListeCharges | null>> {
  const result = await db().rpc<unknown>("get_charges_list", {
    p_period_start: du,
    p_period_end: au,
  });

  if (!result.ok) {
    log.error("finance.charges", logFieldsFor(result.error));
    return err(result.error);
  }

  const brut = result.data[0];
  if (brut === undefined || brut === null) return ok(null);

  const analyse = LISTE_CHARGES.safeParse(brut);
  if (!analyse.success) {
    log.error("finance.charges", {
      code: "regle-metier",
      context: `zod:${analyse.error.issues.map((i) => i.path.join(".")).join(",")}`,
    });
    return err(erreurDeSchema("get_charges_list"));
  }

  log.info("finance.charges", { count: analyse.data.lignes.length });
  return ok(analyse.data);
}

/** Onglet Séances & paiements. Une porte — qui TRACE avant de nommer. */
export async function getSessionsPaymentsList(
  du: string,
  au: string,
  limite = 50,
  decalage = 0,
): Promise<Result<ListeSeances | null>> {
  const result = await db().rpc<unknown>("get_sessions_payments_list", {
    p_period_start: du,
    p_period_end: au,
    p_limit: limite,
    p_offset: decalage,
  });

  if (!result.ok) {
    log.error("finance.seances", logFieldsFor(result.error));
    return err(result.error);
  }

  const brut = result.data[0];
  if (brut === undefined || brut === null) return ok(null);

  const analyse = LISTE_SEANCES.safeParse(brut);
  if (!analyse.success) {
    log.error("finance.seances", {
      code: "regle-metier",
      context: `zod:${analyse.error.issues.map((i) => i.path.join(".")).join(",")}`,
    });
    return err(erreurDeSchema("get_sessions_payments_list"));
  }

  log.info("finance.seances", { count: analyse.data.lignes.length });
  return ok(analyse.data);
}

// ---------------------------------------------------------------------------
// Écriture — les trois portes CRUD des charges
// ---------------------------------------------------------------------------

export type SaisieCharge = {
  readonly intitule: string;
  readonly montantDzd: number;
  readonly categorie: string;
  readonly type: "recurrente" | "ponctuelle";
  // NULL quand `type === 'ponctuelle'` — la contrainte `charge_type_coherent`
  // de 038 refuse toute autre combinaison. La barrière est en base.
  readonly frequence: string | null;
  readonly dateCharge: string;
};

export async function createCharge(saisie: SaisieCharge): Promise<Result<string | null>> {
  const result = await db().rpc<string>("create_charge", {
    p_intitule: saisie.intitule,
    p_montant_dzd: saisie.montantDzd,
    p_categorie: saisie.categorie,
    p_type: saisie.type,
    p_frequence: saisie.frequence,
    p_date_charge: saisie.dateCharge,
  });

  if (!result.ok) {
    log.error("finance.charge.creer", logFieldsFor(result.error));
    return err(result.error);
  }
  const id = result.data[0] ?? null;
  log.info("finance.charge.creer", { count: id === null ? 0 : 1 });
  return ok(id);
}

export async function updateCharge(
  id: string,
  saisie: SaisieCharge,
): Promise<Result<string | null>> {
  const result = await db().rpc<string>("update_charge", {
    p_id: id,
    p_intitule: saisie.intitule,
    p_montant_dzd: saisie.montantDzd,
    p_categorie: saisie.categorie,
    p_type: saisie.type,
    p_frequence: saisie.frequence,
    p_date_charge: saisie.dateCharge,
  });

  if (!result.ok) {
    log.error("finance.charge.modifier", logFieldsFor(result.error));
    return err(result.error);
  }
  const rendu = result.data[0] ?? null;
  log.info("finance.charge.modifier", { count: rendu === null ? 0 : 1 });
  return ok(rendu);
}

/** Désactivation, jamais suppression : règle 3. */
export async function deleteCharge(id: string): Promise<Result<string | null>> {
  const result = await db().rpc<string>("delete_charge", { p_id: id });

  if (!result.ok) {
    log.error("finance.charge.desactiver", logFieldsFor(result.error));
    return err(result.error);
  }
  const rendu = result.data[0] ?? null;
  log.info("finance.charge.desactiver", { count: rendu === null ? 0 : 1 });
  return ok(rendu);
}
