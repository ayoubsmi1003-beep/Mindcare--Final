/**
 * Finance — tarif de séance, encaissement, recette du jour.
 *
 * ⚠️ CE FICHIER NE REQUÊTE AUCUNE TABLE. Ni `payments`, ni `notifications`, ni
 * `counters`. Il n'appelle que les quatre portes de la migration 029, et le
 * contrôle 1 du checkpoint S7 le vérifie.
 *
 * La raison est celle de S5, transposée à l'argent : `app.list_day_payments`
 * nomme des patients, donc elle écrit une trace `liste` dans `audit.log` AVANT
 * de lire. Requêter `app.payments` par PostgREST rendrait les mêmes lignes à la
 * praticienne, SANS cette trace — le chemin non audité qu'ADR-019 a fermé pour
 * les patients et 022 pour l'agenda.
 *
 * ═══ CE QUE CE FICHIER NE DÉCIDE PAS ═══════════════════════════════════════
 *
 * Il ne décide RIEN de la cloison des revenus. Qui voit quelle recette est
 * tranché par `app.current_role()` DANS la porte SQL (ADR-005, règle 4). Le
 * champ `perimetre` plus bas n'est pas un choix de l'interface : c'est la base
 * qui dit ce qu'elle a réellement filtré, et l'écran le recopie. Si jamais on
 * lisait ici `if (role === 'owner')` pour décider d'un affichage de montant, ce
 * serait un défaut de conception — la policy est l'endroit où corriger.
 *
 * Il ne décide RIEN non plus de la modifiabilité d'un montant. `montantModifiable`
 * dit ce que l'ÉCRAN AFFICHE ; ce que la base PERMET est décidé par
 * `app.set_consultation_price`, qui verrouille puis refuse. C'est la porte qui a
 * raison, et l'écran doit savoir encaisser un refus sur un champ qu'il croyait
 * ouvert. Même distinction qu'entre `noteEstVerrouillee` et `trg_note_immutable`.
 */

import { db } from "./db";
import { logFieldsFor } from "./errors";
import { log } from "./log";
import { err, ok, type Result } from "./result";

/**
 * La recette d'une journée, telle que la base l'a filtrée.
 *
 * `perimetre` vient de la porte, pas de l'interface : `'cabinet'` quand toutes
 * les praticiennes sont comptées, `'praticienne'` quand seule celle qui regarde
 * l'est. L'écran affiche ce mot-là, jamais une étiquette qu'il aurait devinée.
 */
export type PerimetreRecette = "cabinet" | "praticienne";

export interface RecetteDuJour {
  readonly totalDzd: number;
  readonly seances: number;
  readonly attenteNombre: number;
  readonly attenteDzd: number;
  readonly perimetre: PerimetreRecette;
}

export interface Paiement {
  readonly id: string;
  readonly receiptNumber: string;
  readonly montantDzd: number;
  /** `null` tant que la somme n'a pas été encaissée — c'est l'état initial. */
  readonly collectedAt: string | null;
  readonly createdAt: string;
  readonly patientPrenom: string | null;
  readonly patientNom: string | null;
  readonly recordNumber: string | null;
  readonly practitionerName: string | null;
}

interface RecetteRow {
  readonly total_dzd: number | string;
  readonly seances: number | string;
  readonly attente_nombre: number | string;
  readonly attente_dzd: number | string;
  readonly perimetre: string;
}

interface PaiementRow {
  readonly payment_id: string;
  readonly receipt_number: string;
  readonly amount_dzd: number;
  readonly collected_at: string | null;
  readonly created_at: string;
  readonly patient_first_name: string | null;
  readonly patient_last_name: string | null;
  readonly record_number: string | null;
  readonly practitioner_name: string | null;
}

/**
 * Les agrégats de `day_revenue` sont des `bigint` en base. PostgREST sérialise
 * un `bigint` en CHAÎNE, pas en nombre — un `bigint` dépasse `Number.MAX_SAFE_INTEGER`
 * et JSON ne le porterait pas fidèlement. Une recette de cabinet n'atteindra
 * jamais cette limite, mais lire `"12000"` comme un nombre par `+` silencieux
 * donnerait `NaN` au moindre changement de sérialisation. On convertit
 * explicitement, une fois, ici.
 */
function versNombre(valeur: number | string): number {
  const n = typeof valeur === "number" ? valeur : Number.parseInt(valeur, 10);
  return Number.isFinite(n) ? n : 0;
}

function toRecette(row: RecetteRow): RecetteDuJour {
  return {
    totalDzd: versNombre(row.total_dzd),
    seances: versNombre(row.seances),
    attenteNombre: versNombre(row.attente_nombre),
    attenteDzd: versNombre(row.attente_dzd),
    // Union fermée miroir de ce que rend la porte 029 §4. Une valeur inattendue
    // retombe sur le périmètre le plus étroit : mieux vaut sous-annoncer ce que
    // l'écran montre que laisser croire « cabinet » à qui ne voit que sa part.
    perimetre: row.perimetre === "cabinet" ? "cabinet" : "praticienne",
  };
}

function toPaiement(row: PaiementRow): Paiement {
  return {
    id: row.payment_id,
    receiptNumber: row.receipt_number,
    montantDzd: row.amount_dzd,
    collectedAt: row.collected_at,
    createdAt: row.created_at,
    patientPrenom: row.patient_first_name,
    patientNom: row.patient_last_name,
    recordNumber: row.record_number,
    practitionerName: row.practitioner_name,
  };
}

// ---------------------------------------------------------------------------
// Dérivations pures — une seule source de vérité par calcul
// ---------------------------------------------------------------------------

/**
 * Un montant en dinars, tel qu'il s'affiche.
 *
 * ⚠️ UNE SEULE, lue par l'écran de séance ET par `/finances`. C'est la leçon de
 * `repartition()` en S4 : deux calculs pour une même vérité finissent par
 * diverger, et ici ils divergeraient sur un MONTANT — l'un affichant 12 000 là
 * où l'autre affiche 1 200.
 *
 * Groupement écrit à la main plutôt que par `Intl.NumberFormat` : le séparateur
 * de milliers d'ICU varie selon la locale résolue par l'environnement (espace
 * fine insécable, espace normale, virgule), donc le même montant ne se lirait
 * pas pareil sur le poste du cabinet et dans un test. Un montant se lit en une
 * demi-seconde avec un patient qui parle ; il ne peut pas dépendre de l'ICU
 * embarqué dans la version de Node du jour.
 *
 * ADR-018 : dinars ENTIERS, aucun centime à afficher. Une valeur non entière
 * signalerait un défaut ailleurs — on l'arrondit plutôt que d'inventer une
 * décimale, et le montant réel reste celui de la base.
 */
export function formaterDzd(montant: number): string {
  if (!Number.isFinite(montant)) return "— DZD";

  const entier = Math.round(montant);
  const signe = entier < 0 ? "-" : "";
  const chiffres = Math.abs(entier).toString();

  let groupe = "";
  for (let i = 0; i < chiffres.length; i += 1) {
    // Séparateur tous les trois chiffres en partant de la droite. ` ` est
    // l'espace fine insécable : le montant ne se coupe pas en fin de ligne.
    if (i > 0 && (chiffres.length - i) % 3 === 0) groupe += " ";
    groupe += chiffres[i];
  }

  return `${signe}${groupe} DZD`;
}

/**
 * Le montant d'un paiement est-il encore modifiable ?
 *
 * Dit ce que l'écran AFFICHE. La base, elle, verrouille la ligne puis refuse
 * (029 §2) — c'est elle qui a raison, et l'écran doit savoir encaisser ce refus.
 */
export function montantModifiable(paiement: Paiement | null): boolean {
  if (paiement === null) return true;
  return paiement.collectedAt === null;
}

// ---------------------------------------------------------------------------
// Les portes
// ---------------------------------------------------------------------------

/**
 * Fixe le tarif d'une séance, ou le corrige tant qu'il n'est pas encaissé.
 *
 * Rend `null` quand la séance est introuvable OU hors périmètre : la base ne
 * distingue pas les deux (ADR-003), et l'interface ne doit pas non plus.
 *
 * Rejouable : un double clic ou un rechargement met à jour le même paiement, il
 * n'en crée pas un second et ne consomme pas un second numéro de reçu. La
 * décision est prise en base, sous verrou — pas ici.
 */
export async function setConsultationPrice(
  consultationId: string,
  montantDzd: number,
): Promise<Result<string | null>> {
  const result = await db().rpc<string>("set_consultation_price", {
    p_consultation_id: consultationId,
    p_amount_dzd: montantDzd,
  });

  if (!result.ok) {
    // Ni identifiant patient, ni montant : règle 1 et I5. Un montant dans un
    // journal, c'est une donnée de cabinet qui sort de la machine.
    log.error("finance.tarif", logFieldsFor(result.error));
    return err(result.error);
  }

  const id = result.data[0] ?? null;
  log.info("finance.tarif", { count: id === null ? 0 : 1 });
  return ok(id);
}

/**
 * Le paiement d'UNE séance, ou `null` si aucun tarif n'a encore été fixé.
 *
 * Appelée à chaque ouverture de l'écran de séance, donc délibérément pauvre :
 * aucun nom, aucune trace de lecture en base. Journaliser une ouverture de
 * dossier à chaque rendu rendrait `audit.log` illisible (I4) — même raisonnement
 * que `getOpenConsultation`.
 *
 * Les champs de nom de `Paiement` sont `null` ici : cette porte ne joint pas
 * `app.patients`, et l'écran de séance connaît déjà son patient.
 */
export async function getConsultationPayment(
  consultationId: string,
): Promise<Result<Paiement | null>> {
  const result = await db().rpc<Omit<PaiementRow, "patient_first_name" | "patient_last_name" | "record_number" | "practitioner_name">>(
    "get_consultation_payment",
    { p_consultation_id: consultationId },
  );

  if (!result.ok) {
    log.error("finance.tarifLecture", logFieldsFor(result.error));
    return err(result.error);
  }

  const row = result.data[0];
  if (row === undefined) return ok(null);

  return ok(
    toPaiement({
      ...row,
      patient_first_name: null,
      patient_last_name: null,
      record_number: null,
      practitioner_name: null,
    }),
  );
}

/**
 * Enregistre l'encaissement d'un paiement.
 *
 * Idempotente : rejouée sur un paiement déjà encaissé, elle rend son
 * identifiant SANS réécrire l'horodatage — l'heure réelle de l'encaissement est
 * la seule qui vaille quelque chose dans une caisse. Introuvable ou hors
 * périmètre : `null`.
 */
export async function recordPaymentCollected(
  paymentId: string,
): Promise<Result<string | null>> {
  const result = await db().rpc<string>("record_payment_collected", {
    p_payment_id: paymentId,
  });

  if (!result.ok) {
    log.error("finance.encaissement", logFieldsFor(result.error));
    return err(result.error);
  }

  const id = result.data[0] ?? null;
  log.info("finance.encaissement", { count: id === null ? 0 : 1 });
  return ok(id);
}

/**
 * La recette d'une journée.
 *
 * `jour` est une date au format `AAAA-MM-JJ`. C'est un ARGUMENT DE LECTURE, pas
 * une source de temps : il choisit la journée à afficher, il n'horodate rien.
 * Aucune écriture financière ne prend l'heure du poste (029 §2quater).
 *
 * Rend `null` pour l'assistante : la porte lui donne zéro ligne, et ce n'est pas
 * une erreur — un écran vide, pas un message d'interdiction.
 */
export async function getDayRevenue(jour: string): Promise<Result<RecetteDuJour | null>> {
  const result = await db().rpc<RecetteRow>("day_revenue", { p_day: jour });

  if (!result.ok) {
    log.error("finance.recette", logFieldsFor(result.error));
    return err(result.error);
  }

  const row = result.data[0];
  if (row === undefined) return ok(null);

  return ok(toRecette(row));
}

/** Les paiements d'une journée, avec les noms. Écrit une trace `liste` en base, par la porte. */
export async function listDayPayments(jour: string): Promise<Result<readonly Paiement[]>> {
  const result = await db().rpc<PaiementRow>("list_day_payments", { p_day: jour });

  if (!result.ok) {
    log.error("finance.journee", logFieldsFor(result.error));
    return err(result.error);
  }

  log.info("finance.journee", { count: result.data.length });
  return ok(result.data.map(toPaiement));
}
