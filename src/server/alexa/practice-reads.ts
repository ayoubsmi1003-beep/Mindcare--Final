import { z } from "zod";
import { practiceReadCopy as copy } from "@/i18n/alexa-practice-reads";
import { ajouterJours, aujourdHuiCabinet } from "@/services/finance-calendrier";

/**
 * Deterministic reads over existing gates. The gates decide scope and role, and return
 * NULL or no row to a caller outside it. No model reads or rewrites these facts.
 */
// Not z.coerce: it would turn a null from the gate into a measured zero.
const count = z.union([z.number(), z.string().regex(/^\d+$/u).transform(Number)]).pipe(z.number().int().nonnegative());
const date = z.preprocess(value => value instanceof Date ? value.toISOString() : value, z.string());
/** A timestamp is shown as the cabinet's day, never the UTC one. */
const cabinetDay = (value: string): string => aujourdHuiCabinet(new Date(value));
const DISPLAY_LIMIT = 20;

export interface PracticeRead { readonly text: string; readonly complete: boolean; readonly empty: boolean; readonly data: Readonly<Record<string, unknown>> }

const overview = z.object({
  periode: z.object({ du: z.string(), au: z.string(), precedente_du: z.string(), precedente_au: z.string() }).passthrough(),
  pulse: z.object({
    seances: count, patientes_vues: count, retours: count, nouveaux: count, absences: count, annulations: count, notes_signees: count, notes_manquantes: count, echelles: count, changements_traitement: count,
    patients_total: count, patients_suivis: count, rdv_a_venir: count, rdv_non_clotures: count, traitements_actifs: count,
  }).passthrough(),
  comparaison: z.object({ seances: count }).passthrough(),
  // ISO weekday (1 = Monday) with its closed sessions. Optional: an older gate may not return it.
  jours_semaine: z.array(z.object({ cle: z.union([z.number(), z.string()]), n: count }).passthrough()).max(7).optional(),
}).passthrough();

export function statisticsRead(raw: unknown): PracticeRead {
  const { periode, pulse, comparaison, jours_semaine } = overview.parse(raw), s = copy.statistics;
  const busiest = (jours_semaine ?? []).map(day => ({ name: s.weekdays[Number(day.cle) - 1] ?? "", n: day.n })).filter(day => day.name && day.n > 0).sort((a, b) => b.n - a.n).slice(0, 3);
  return {
    complete: true, empty: false,
    data: { du: periode.du, au: periode.au, seances: pulse.seances, absences: pulse.absences, nouveaux: pulse.nouveaux },
    text: [
      s.heading(periode.du, periode.au), s.sessions(pulse.seances), ...(busiest.length ? [s.busiestDays(busiest)] : []), s.patientsSeen(pulse.patientes_vues), s.returning(pulse.retours), s.newRecords(pulse.nouveaux), s.noShows(pulse.absences), s.cancellations(pulse.annulations),
      s.signedNotes(pulse.notes_signees), s.unsignedSessions(pulse.notes_manquantes), s.scales(pulse.echelles), s.treatmentChanges(pulse.changements_traitement), s.followed(pulse.patients_suivis), s.previous(periode.precedente_du, periode.precedente_au, comparaison.seances),
      s.currentHeading, s.totalRecords(pulse.patients_total), s.upcoming(pulse.rdv_a_venir), s.unclosed(pulse.rdv_non_clotures), s.activeTreatments(pulse.traitements_actifs),
    ].join("\n"),
  };
}

/** This month against the last full calendar month: two reads of the same gate, each over its own days; nothing is computed here but the gap. */
export function statisticsComparisonRead(currentRaw: unknown, previousRaw: unknown): PracticeRead {
  const current = overview.parse(currentRaw), previous = overview.parse(previousRaw), s = copy.statistics;
  const block = (read: z.infer<typeof overview>) => [s.heading(read.periode.du, read.periode.au), s.sessions(read.pulse.seances), s.patientsSeen(read.pulse.patientes_vues), s.newRecords(read.pulse.nouveaux), s.noShows(read.pulse.absences)];
  return {
    complete: true, empty: false,
    data: { du: current.periode.du, au: current.periode.au, seances: current.pulse.seances, precedente_du: previous.periode.du, precedente_au: previous.periode.au, precedente_seances: previous.pulse.seances },
    text: [s.compareHeading, ...block(current), ...block(previous), s.compareDifference(current.pulse.seances, previous.pulse.seances)].join("\n"),
  };
}

const workload = z.object({
  total: count,
  resume: z.object({ patients: count, actifs: count, revue: count, changements: count }).passthrough(),
  rows: z.array(z.object({ first_name: z.string(), last_name: z.string(), active_count: count, has_missing_posology: z.boolean(), has_overdue_end_date: z.boolean(), next_end_date: z.string().nullable() }).passthrough()).max(100),
}).passthrough();

export type WorkloadAttention = "missing_dose" | "review" | null;

/** Filtered here: migration 211 defines p_attention, but the evaluation database's gate takes only three arguments. */
export function medicationWorkloadRead(raw: unknown, options: { readonly attention: WorkloadAttention; readonly today: string }): PracticeRead {
  const value = workload.parse(raw), w = copy.workload;
  if (!value.total) return { text: w.empty, complete: true, empty: true, data: { total: 0 } };
  // Same rule as the gate's `revue` count: incomplete dose, end date passed or within 14 days.
  const limit = ajouterJours(options.today, 14);
  const concerned = value.rows.filter(row => options.attention === "missing_dose" ? row.has_missing_posology : options.attention === "review" ? row.has_missing_posology || row.has_overdue_end_date || (row.next_end_date !== null && row.next_end_date.slice(0, 10) <= limit) : true);
  const allRead = value.total <= value.rows.length, shown = concerned.slice(0, DISPLAY_LIMIT), complete = allRead && concerned.length <= DISPLAY_LIMIT;
  return {
    complete, empty: false,
    data: { practiceList: true, total: value.total, read: value.rows.length, concerned: concerned.length, resume: value.resume, hasMore: !complete },
    text: [
      w.summary(value.resume.actifs, value.resume.patients, value.resume.revue, value.resume.changements),
      ...(options.attention === "missing_dose" ? [w.missingDoseHeading(concerned.length, allRead)] : options.attention === "review" ? [w.reviewHeading(concerned.length, allRead)] : []),
      ...shown.map(row => w.row(`${row.first_name} ${row.last_name}`.trim(), row.active_count, [...(row.has_missing_posology ? [w.missingDose] : []), ...(row.has_overdue_end_date ? [w.overdue] : []), ...(!row.has_overdue_end_date && row.next_end_date ? [w.nextEnd(row.next_end_date.slice(0, 10))] : [])])),
      ...(concerned.length > DISPLAY_LIMIT ? [w.more(shown.length, concerned.length)] : []),
      ...(!allRead ? [w.scanned(value.rows.length, value.total)] : []),
    ].join("\n"),
  };
}

const timelineEvent = z.object({ occurred_at: date, action: z.string(), medication_name: z.string().nullable(), reason: z.string().nullable(), document_number: z.string().nullable() }).passthrough();

export function medicationTimelineRead(rows: unknown): PracticeRead {
  const events = z.array(timelineEvent).max(DISPLAY_LIMIT + 1).parse(rows ?? []), t = copy.medicationTimeline, shown = events.slice(0, DISPLAY_LIMIT), complete = events.length <= DISPLAY_LIMIT;
  if (!events.length) return { text: t.empty, complete: true, empty: true, data: { rows: 0 } };
  return {
    complete, empty: false,
    data: { practiceList: true, rows: shown.length, hasMore: !complete },
    text: [
      t.heading(shown.length, !complete),
      ...shown.map(event => `- ${t.row(cabinetDay(event.occurred_at), t.actions[event.action] ?? t.otherAction, event.medication_name ?? event.document_number, event.reason)}`),
      ...(complete ? [] : [t.more]),
    ].join("\n"),
  };
}

const savedSummary = z.object({ version: z.coerce.number().int().positive(), genere_le: date, aJour: z.boolean() }).passthrough();

/** Only the summary's state: its content came from a model, so it isn't presented as a recorded fact. */
export function caseSummaryStatusRead(raw: unknown): PracticeRead {
  if (raw === null || raw === undefined) return { text: copy.caseSummary.none, complete: true, empty: true, data: { exists: false } };
  const value = savedSummary.parse(raw);
  return { text: copy.caseSummary.status(value.version, cabinetDay(value.genere_le), value.aJour), complete: true, empty: false, data: { exists: true, version: value.version, current: value.aJour } };
}
