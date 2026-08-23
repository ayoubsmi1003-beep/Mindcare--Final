/**
 * Le poste d'accueil — le tableau de bord de l'assistante (D-08).
 *
 * ⚠️ CE FICHIER NE REQUÊTE AUCUNE TABLE. Il appelle la porte
 * `app.reception_board` (046) et deux transitions d'accueil — et c'est tout.
 * Le contrôle 1 du checkpoint du lot le vérifie.
 *
 * ═══ LE CONTRAT DE LECTURE EST ÉTROIT, ET IL EST FIGÉ ICI ══════════════════
 *
 * `reception_board` rend exactement trois files :
 *   · `journee`  — les RDV opérationnels d'une journée, champs administratifs ;
 *   · `demandes` — les demandes web en attente (`requested`, 60 jours) ;
 *   · `paiements`— les paiements des dernières 24 h, dus et encaissés.
 *
 * Ce qui N'Y FIGURE PAS, par conception de la porte : motif de consultation
 * (ADR-017), notes cliniques, contenu de séance, agrégats de recette. Le
 * typage ci-dessous est la contrepartie honnête : un champ absent de
 * l'interface ne peut pas être affiché, et un champ présent ici est un champ
 * que l'assistante a le droit de voir (ADR-005).
 *
 * ⚠️ ZÉRO DÉCISION D'AUTORISATION ICI. La porte est SECURITY DEFINER possédée
 * par `app_gatekeeper` (sans BYPASSRLS) : les policies de 006 et 011 décident
 * des lignes. Un écran vide signifie « rien de VISIBLE par vous », jamais
 * « rien ».
 */

import { db } from "./db";
import { logFieldsFor } from "./errors";
import { log } from "./log";
import { err, ok, type Result } from "./result";

import type { AppointmentStatus, AppointmentSource, ConsultationKind } from "./appointments";

/** Une ligne RDV du board — même vérité que `AgendaEntry`, sans le calcul de durée. */
export interface RdvAccueil {
  readonly id: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly status: AppointmentStatus;
  readonly source: AppointmentSource;
  readonly kind: ConsultationKind | null;
  readonly notesAdmin: string | null;
  readonly arrivedAt: string | null;
  readonly patientId: string | null;
  readonly recordNumber: string | null;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly practitionerId: string;
  readonly practitionerName: string | null;
}

/** Un paiement vu de l'accueil : dû ou encaissé des dernières 24 h. */
export interface PaiementAccueil {
  readonly paymentId: string;
  readonly receiptNumber: string;
  /** Dinars entiers (ADR-018). Affiché par `formaterDzd`, jamais recomposé ici. */
  readonly amountDzd: number;
  readonly collectedAt: string | null;
  readonly setAt: string;
  readonly patientId: string | null;
  readonly recordNumber: string | null;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly practitionerId: string;
  readonly practitionerName: string | null;
}

export interface TableauAccueil {
  readonly journee: readonly RdvAccueil[];
  readonly demandes: readonly RdvAccueil[];
  readonly paiements: readonly PaiementAccueil[];
}

interface RdvRow {
  readonly id: string;
  readonly starts_at: string;
  readonly ends_at: string;
  readonly status: AppointmentStatus;
  readonly source: AppointmentSource;
  readonly kind: ConsultationKind | null;
  readonly notes_admin: string | null;
  readonly arrived_at: string | null;
  readonly patient_id: string | null;
  readonly record_number: string | null;
  readonly first_name: string | null;
  readonly last_name: string | null;
  readonly practitioner_id: string;
  readonly practitioner_name: string | null;
}

interface PaiementRow {
  readonly payment_id: string;
  readonly receipt_number: string;
  readonly amount_dzd: number;
  readonly collected_at: string | null;
  readonly set_at: string;
  readonly patient_id: string | null;
  readonly record_number: string | null;
  readonly first_name: string | null;
  readonly last_name: string | null;
  readonly practitioner_id: string;
  readonly practitioner_name: string | null;
}

/** La forme brute du jsonb rendu par la porte — une ligne, un objet. */
interface BoardRow {
  readonly journee: unknown;
  readonly demandes: unknown;
  readonly paiements: unknown;
}

function estTableau(valeur: unknown): valeur is readonly unknown[] {
  return Array.isArray(valeur);
}

/**
 * Conversion défensive d'une liste jsonb. La porte garantit sa propre forme ;
 * ce garde existe pour qu'une divergence future se voie comme un écran vide
 * explicite plutôt que comme un plantage de rendu au pire moment.
 */
function versRdvs(valeur: unknown): readonly RdvAccueil[] {
  if (!estTableau(valeur)) return [];
  return valeur.map((brut) => {
    const r = brut as RdvRow;
    return {
      id: r.id,
      startsAt: r.starts_at,
      endsAt: r.ends_at,
      status: r.status,
      source: r.source,
      kind: r.kind ?? null,
      notesAdmin: r.notes_admin ?? null,
      arrivedAt: r.arrived_at ?? null,
      patientId: r.patient_id ?? null,
      recordNumber: r.record_number ?? null,
      firstName: r.first_name ?? null,
      lastName: r.last_name ?? null,
      practitionerId: r.practitioner_id,
      practitionerName: r.practitioner_name ?? null,
    };
  });
}

function versPaiements(valeur: unknown): readonly PaiementAccueil[] {
  if (!estTableau(valeur)) return [];
  return valeur.map((brut) => {
    const p = brut as PaiementRow;
    return {
      paymentId: p.payment_id,
      receiptNumber: p.receipt_number,
      amountDzd: Number(p.amount_dzd),
      collectedAt: p.collected_at ?? null,
      setAt: p.set_at,
      patientId: p.patient_id ?? null,
      recordNumber: p.record_number ?? null,
      firstName: p.first_name ?? null,
      lastName: p.last_name ?? null,
      practitionerId: p.practitioner_id,
      practitionerName: p.practitioner_name ?? null,
    };
  });
}

export async function getReceptionBoard(
  jour: string,
): Promise<Result<TableauAccueil | null>> {
  const result = await db().rpc<BoardRow>("reception_board", { p_day: jour });

  if (!result.ok) {
    // Ni identifiant patient, ni montant dans le journal (règle 1, I5). La
    // trace légale de lecture est écrite par la porte elle-même.
    log.error("accueil.tableau", logFieldsFor(result.error));
    return err(result.error);
  }

  const row = result.data[0];
  if (row === undefined) return ok(null);

  log.info("accueil.tableau", { count: 1 });
  return ok({
    journee: versRdvs(row.journee),
    demandes: versRdvs(row.demandes),
    paiements: versPaiements(row.paiements),
  });
}

/**
 * Marque un rendez-vous arrivé. Rejoué sur un RDV déjà arrivé, il rend `true`
 * sans réécrire l'heure ; introuvable ou hors périmètre → `false`, jamais une
 * erreur qui distinguerait les deux (ADR-003).
 */
export async function markAppointmentArrived(id: string): Promise<Result<boolean>> {
  const result = await db().rpc<string>("mark_appointment_arrived", { p_id: id });

  if (!result.ok) {
    log.error("accueil.arrivee", logFieldsFor(result.error));
    return err(result.error);
  }

  const touche = result.data[0] !== undefined && result.data[0] !== null;
  log.info("accueil.arrivee", { count: touche ? 1 : 0 });
  return ok(touche);
}

/** Même contrat que l'arrivée, depuis `confirmed` ou `arrived`. */
export async function markAppointmentNoShow(id: string): Promise<Result<boolean>> {
  const result = await db().rpc<string>("mark_appointment_no_show", { p_id: id });

  if (!result.ok) {
    log.error("accueil.absent", logFieldsFor(result.error));
    return err(result.error);
  }

  const touche = result.data[0] !== undefined && result.data[0] !== null;
  log.info("accueil.absent", { count: touche ? 1 : 0 });
  return ok(touche);
}
