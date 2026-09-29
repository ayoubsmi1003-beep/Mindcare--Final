/**
 * Booking agent — le LLM comprend, l'Agenda décide.
 *
 * Ce service ne devine JAMAIS une disponibilité : chaque écriture passe par
 * les portes Agenda, et la confirmation par `confirmer_apres_reverification`
 * (117), qui revérifie le créneau sous verrou — le résultat d'un
 * `check_slot` antérieur n'est jamais réutilisé tel quel.
 *
 * `deciderActionRdv` est pure (testée sans base) ; l'exécution appelle les
 * portes. La création d'un NOUVEAU rendez-vous reste humaine (réception) :
 * l'agent confirme, annule et reprogramme l'existant, il n'invente rien.
 */

import { db } from "../db";
import { logFieldsFor } from "../errors";
import { log } from "../log";
import { err, ok, type Result } from "../result";
import {
  cancelAppointment,
  getAppointment,
  listAgenda,
  updateAppointment,
  type AgendaEntry,
} from "../appointments";

import { analyserDemandeRdv, type AnalyseRdv, type Periode } from "./analyse";

export interface RdvProche {
  readonly id: string;
  readonly startsAt: string;
  readonly status: string;
  readonly patientId: string | null;
  readonly practitionerId: string;
  readonly durationMinutes: number;
}

export type ActionRdv =
  | { readonly action: "confirmer"; readonly appointmentId: string }
  | { readonly action: "annuler"; readonly appointmentId: string; readonly proposeReprogrammation: true }
  | {
      readonly action: "reprogrammer";
      readonly appointmentId: string;
      readonly jour: string | null;
      readonly periode: Periode | null;
      readonly heure: string | null;
    }
  | { readonly action: "aucun_rdv" }
  | { readonly action: "ambiguite"; readonly candidats: readonly string[] }
  | { readonly action: "nouveau_rdv"; readonly jour: string | null; readonly periode: Periode | null }
  | { readonly action: "question" }
  | { readonly action: "inconnu" };

function versProche(entree: AgendaEntry): RdvProche {
  return {
    id: entree.id,
    startsAt: entree.startsAt,
    status: entree.status,
    patientId: entree.patientId,
    practitionerId: entree.practitionerId,
    durationMinutes: entree.durationMinutes,
  };
}

/** Demandes en attente du cabinet sur une fenêtre (file de l'agent). */
export async function demandesDeConfirmation(
  debutIso: string,
  finIso: string,
): Promise<Result<readonly RdvProche[]>> {
  const result = await listAgenda({ from: debutIso, to: finIso });
  if (!result.ok) return err(result.error);
  return ok(result.data.filter((e) => e.status === "requested").map(versProche));
}

/** Demandes à venir d'UN patient (fenêtre 60 jours, borne base). */
export async function demandesDuPatient(
  patientId: string,
  maintenantIso: string,
): Promise<Result<readonly RdvProche[]>> {
  const fin = new Date(Date.parse(maintenantIso) + 60 * 86_400_000).toISOString();
  const result = await listAgenda({ from: maintenantIso, to: fin });
  if (!result.ok) return err(result.error);
  return ok(
    result.data
      .filter((e) => e.status === "requested" && e.patientId === patientId)
      .map(versProche),
  );
}

function estListe(v: RdvProche | readonly RdvProche[]): v is readonly RdvProche[] {
  return Array.isArray(v);
}

function choisirParJour(
  rdvs: readonly RdvProche[],
  jour: string | null,
): RdvProche | readonly RdvProche[] | null {
  if (rdvs.length === 0) return null;
  if (rdvs.length === 1) {
    const seul = rdvs[0];
    return seul === undefined ? null : seul;
  }
  if (jour !== null) {
    const vise = rdvs.filter((r) => r.startsAt.slice(0, 10) === jour);
    if (vise.length === 1) {
      const un = vise[0];
      return un === undefined ? rdvs : un;
    }
  }
  return rdvs;
}

/**
 * Décide face à une analyse et aux demandes connues. Pure : le jour exprimé
 * désambiguïse (« pas mercredi, plutôt jeudi » vise le RDV de mercredi pour
 * l'annulation, et jeudi pour la cible).
 */
export function deciderActionRdv(
  analyse: AnalyseRdv,
  rdvs: readonly RdvProche[],
): ActionRdv {
  switch (analyse.intent) {
    case "CONFIRMER":
    case "ANNULER": {
      const choix = choisirParJour(rdvs, analyse.jour);
      if (choix === null) return { action: "aucun_rdv" };
      if (estListe(choix)) {
        return { action: "ambiguite", candidats: choix.map((r) => r.id) };
      }
      return analyse.intent === "CONFIRMER"
        ? { action: "confirmer", appointmentId: choix.id }
        : { action: "annuler", appointmentId: choix.id, proposeReprogrammation: true };
    }
    case "REPROGRAMMER": {
      const choix = choisirParJour(rdvs, null);
      if (choix === null) return { action: "aucun_rdv" };
      if (estListe(choix)) {
        return { action: "ambiguite", candidats: choix.map((r) => r.id) };
      }
      return {
        action: "reprogrammer",
        appointmentId: choix.id,
        jour: analyse.jour,
        periode: analyse.periode,
        heure: analyse.heure,
      };
    }
    case "DEMANDER_RDV":
      return { action: "nouveau_rdv", jour: analyse.jour, periode: analyse.periode };
    case "QUESTION":
      return { action: "question" };
    case "INCONNU":
      return { action: "inconnu" };
  }
}

/** Confirme via 117 : revérification sous verrou, un seul gagnant. */
export async function executerConfirmation(appointmentId: string): Promise<Result<boolean>> {
  const result = await db().rpc<boolean>("confirmer_apres_reverification", {
    p_appointment_id: appointmentId,
  });
  if (!result.ok) {
    log.error("reservation.confirmation", logFieldsFor(result.error));
    return err(result.error);
  }
  log.info("reservation.confirmation", { count: 1 });
  return ok(result.data[0] ?? false);
}

/** Annule (motif obligatoire, porte 022) et propose la reprogrammation. */
export async function executerAnnulation(
  appointmentId: string,
  motif: string,
): Promise<Result<boolean>> {
  return cancelAppointment(appointmentId, motif);
}

interface LigneDisponibilite {
  readonly disponible: boolean;
  readonly motif: string | null;
}

const HEURES_PAR_PERIODE: Readonly<Record<Periode, readonly number[]>> = {
  matin: [9, 10, 11],
  apres_midi: [14, 15, 16, 17],
  soir: [17, 18],
};

/**
 * Reprogramme : cherche le premier créneau libre (jour visé puis +7 jours,
 * heures de la période), déplace via 022, reconfirme via 117. Rend le nouvel
 * ISO ou null si rien de libre — jamais un créneau inventé.
 */
export async function reprogrammerRdv(
  appointmentId: string,
  jourIso: string | null,
  periode: Periode | null,
  heure: string | null,
  maintenantIso: string,
): Promise<Result<string | null>> {
  const actuel = await getAppointment(appointmentId);
  if (!actuel.ok) return err(actuel.error);
  if (actuel.data === null) return err({ code: "introuvable", message: "Rendez-vous introuvable." });

  const duree = actuel.data.durationMinutes;
  const praticien = actuel.data.practitionerId;
  const periodes: readonly Periode[] = periode === null ? ["matin", "apres_midi"] : [periode];

  const jours: string[] = [];
  if (jourIso !== null) {
    jours.push(jourIso);
  } else {
    const base = new Date(Date.parse(maintenantIso));
    for (let n = 1; n <= 14; n++) {
      jours.push(new Date(base.getTime() + n * 86_400_000).toISOString().slice(0, 10));
    }
  }

  for (const jour of jours) {
    const heures =
      heure !== null && jours[0] === jour ? [Number.parseInt(heure.slice(0, 2), 10)] : null;
    for (const p of periodes) {
      for (const h of heuresFixes(heures, p)) {
        const debut = `${jour}T${String(h).padStart(2, "0")}:00:00+01:00`;
        if (Date.parse(debut) <= Date.parse(maintenantIso)) continue;
        const dispo = await db().rpc<LigneDisponibilite>("check_slot_available", {
          p_practitioner_id: praticien,
          p_starts_at: debut,
          p_duration_minutes: duree,
          p_exclude_id: appointmentId,
        });
        if (!dispo.ok) {
          log.error("reservation.recherche", logFieldsFor(dispo.error));
          return err(dispo.error);
        }
        if (dispo.data[0]?.disponible === true) {
          const deplace = await updateAppointment(appointmentId, { startsAt: debut });
          if (!deplace.ok) return err(deplace.error);
          const confirme = await executerConfirmation(appointmentId);
          if (!confirme.ok) return err(confirme.error);
          log.info("reservation.reprogrammation", { count: 1 });
          return ok(debut);
        }
      }
    }
    // Jour visé unique sans heure : on ne balaye pas au-delà (proposition
    // ciblée, pas une chasse). Jour absent : on continue les 14 jours.
    if (jourIso !== null && heure === null) break;
  }
  return ok(null);
}

function heuresFixes(
  explicites: readonly number[] | null,
  periode: Periode,
): readonly number[] {
  if (explicites !== null) {
    const h = explicites[0];
    return h === undefined || !Number.isFinite(h) || h < 0 || h > 23 ? [] : [h];
  }
  return HEURES_PAR_PERIODE[periode];
}

export interface IssueTraitement {
  readonly analyse: AnalyseRdv;
  readonly action: ActionRdv;
  readonly execute: boolean;
}

/**
 * Traite la réponse d'un patient : analyse → décide → exécute (confirmer /
 * annuler). La reprogrammation n'est exécutée que si un jour est exprimé ;
 * sinon l'action est rendue pour l'humaine. Rend toujours l'analyse pour audit.
 */
export async function traiterReponse(
  patientId: string,
  texte: string,
  maintenant: Date,
  motifAnnulation: string,
): Promise<Result<IssueTraitement>> {
  const analyse = analyserDemandeRdv(texte, maintenant);
  const rdvs = await demandesDuPatient(patientId, maintenant.toISOString());
  if (!rdvs.ok) return err(rdvs.error);
  const action = deciderActionRdv(analyse, rdvs.data);

  if (action.action === "confirmer") {
    const fait = await executerConfirmation(action.appointmentId);
    if (!fait.ok) return err(fait.error);
    return ok({ analyse, action, execute: fait.data });
  }
  if (action.action === "annuler") {
    const fait = await executerAnnulation(action.appointmentId, motifAnnulation);
    if (!fait.ok) return err(fait.error);
    return ok({ analyse, action, execute: fait.data });
  }
  if (action.action === "reprogrammer" && action.jour !== null) {
    const slot = await reprogrammerRdv(
      action.appointmentId,
      action.jour,
      action.periode,
      action.heure,
      maintenant.toISOString(),
    );
    if (!slot.ok) return err(slot.error);
    return ok({ analyse, action, execute: slot.data !== null });
  }
  return ok({ analyse, action, execute: false });
}
