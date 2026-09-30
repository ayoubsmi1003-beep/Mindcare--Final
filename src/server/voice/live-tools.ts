import { z } from "zod";
import type { ClientSql, ArgsJarvis } from "@/server/jarvis/client-sql";

export interface ContexteLive { currentPatientId: string | null; referencedPatientId: string | null; targetUnresolved?: boolean }
const PatientArgs = z.object({ patient_id: z.guid().optional(), query: z.string().trim().min(2).max(80).optional() }).strict()
  .refine((a) => !(a.patient_id && a.query));
const Recherche = z.object({ query: z.string().trim().min(2).max(80) }).strict();
const unavailable = () => ({ status: "unavailable" as const });
function objet(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
}
function lignes(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? v.map(objet).filter((p): p is Record<string, unknown> => p !== null) : [];
}
async function lire(client: ClientSql, name: string, args: ArgsJarvis): Promise<unknown> {
  const r = await client.rpc(name, args); if (r.error) throw new Error("live-read-unavailable"); return r.data;
}
export async function patientFictif(client: ClientSql, id: string): Promise<Record<string, unknown> | null> {
  const p = lignes(await lire(client, "get_patient", { p_id: id }))[0];
  // The audited SQL gate arbitrates visibility. Unknown synthetic status refuses.
  return p?.is_synthetic === true && p.id === id ? p : null;
}
function identite(p: Record<string, unknown>): Record<string, unknown> {
  return { patient_id: p.id, first_name: p.first_name ?? null, last_name: p.last_name ?? null,
    birth_date: p.birth_date ?? null, sex: p.sex ?? null, marital_status: p.marital_status ?? null };
}
async function chercher(client: ClientSql, query: string) {
  const rows = lignes(await lire(client, "search_patients", { p_query: query, p_limit: 5, p_offset: 0 }));
  const patients: Record<string, unknown>[] = [];
  for (const row of rows) {
    if (typeof row.id !== "string") continue;
    const patient = await patientFictif(client, row.id);
    if (patient === null) return unavailable();
    patients.push(identite(patient));
  }
  // A truncated search is still ambiguous, even if only one returned row exists.
  return { status: patients.length === 0 ? "unavailable" : patients.length > 1 || Number(rows[0]?.total_count ?? rows.length) > 1 ? "ambiguous" : "ok", patients };
}

/** A closed read allowlist, using the existing SQL gates and caller's RLS only. */
export async function lireOutilLive(client: ClientSql, name: string, args: unknown, context: ContexteLive,
  signal?: AbortSignal): Promise<Record<string, unknown>> {
  try {
    if (signal?.aborted) return unavailable();
    if (name === "search_patient") {
      const v = Recherche.safeParse(args); if (!v.success) return unavailable();
      const result = await chercher(client, v.data.query);
      const found = result.status === "ok" && "patients" in result ? result.patients[0]?.patient_id : null;
      context.referencedPatientId = typeof found === "string" ? found : null;
      context.targetUnresolved = result.status !== "ok";
      return result;
    }
    if (name === "get_today_agenda" || name === "get_next_patient") {
      if (!z.object({}).strict().safeParse(args).success) return unavailable();
      const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Algiers", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
      const rawDashboard = await lire(client, "dashboard_today", { p_day: day });
      const dashboard = objet(rawDashboard) ?? lignes(rawDashboard)[0];
      if (!dashboard) return unavailable();
      const appointments = name === "get_next_patient" ? (dashboard.suivant ? [dashboard.suivant] : []) : dashboard.journee;
      const safe: Record<string, unknown>[] = [];
      for (const appointment of lignes(appointments)) {
        const id = appointment.patient_id;
        if (typeof id !== "string") return unavailable();
        const p = await patientFictif(client, id); if (!p) return unavailable();
        safe.push({ patient: identite(p), starts_at: appointment.starts_at ?? null,
          ends_at: appointment.ends_at ?? null, status: appointment.status ?? null, kind: appointment.kind ?? null });
      }
      if (signal?.aborted) return unavailable();
      if (name === "get_next_patient") {
        const patient = objet(safe[0]?.patient);
        context.referencedPatientId = safe.length === 1 && typeof patient?.patient_id === "string" ? patient.patient_id : null;
        context.targetUnresolved = context.referencedPatientId === null;
      }
      return { status: "ok", day, appointments: safe };
    }
    if (!["get_patient", "get_current_patient", "get_patient_summary", "get_patient_consultations", "get_patient_treatments"].includes(name)) return unavailable();
    const v = PatientArgs.safeParse(args); if (!v.success) return unavailable();
    if (name === "get_current_patient" && Object.keys(v.data).length > 0) return unavailable();
    if (name !== "get_current_patient" && !v.data.patient_id && !v.data.query && context.targetUnresolved) return unavailable();
    let id = name === "get_current_patient" ? context.currentPatientId : v.data.patient_id ?? context.referencedPatientId ?? context.currentPatientId;
    if (v.data.query) {
      const search = await chercher(client, v.data.query);
      if (search.status !== "ok" || !("patients" in search)) {
        context.referencedPatientId = null; context.targetUnresolved = true; return search;
      }
      const match = search.patients[0]; id = typeof match?.patient_id === "string" ? match.patient_id : null;
    }
    if (!id || signal?.aborted) return unavailable();
    const p = await patientFictif(client, id); if (!p) return unavailable();
    let result: Record<string, unknown>;
    if (name === "get_patient" || name === "get_current_patient") result = { status: "ok", patient: identite(p) };
    else if (name === "get_patient_consultations") {
      const timeline = lignes(await lire(client, "list_patient_timeline", { p_id: id, p_before_at: null, p_before_id: null, p_limit: 50 }));
      const visits = timeline.filter((e) => e.label_key === "consultation_close" || e.label_key === "consultation_ouverte");
      const consultations: Record<string, unknown>[] = [];
      const seen = new Set<string>();
      for (const visit of visits) {
        if (typeof visit.event_id !== "string" || seen.has(visit.event_id)) continue;
        seen.add(visit.event_id); if (consultations.length >= 5) break;
        const c = lignes(await lire(client, "get_consultation", { p_id: visit.event_id }))[0];
        if (!c || c.patient_id !== id) continue;
        consultations.push({ started_at: c.started_at, ended_at: c.ended_at, status: c.status, kind: c.appointment_kind,
          note_signed: c.signed_at != null, note: c.signed_at != null ? {
            subjective: c.subjective, objective: c.objective, assessment: c.assessment, plan: c.plan,
          } : null });
      }
      result = { status: "ok", patient: identite(p), consultations, partial: timeline.length === 50 || seen.size > 5 };
    } else {
      const w = objet(await lire(client, "get_patient_workspace", { p_id: id }));
      if (!w || w.clinique === null) return unavailable();
      result = name === "get_patient_summary"
        ? { status: "ok", patient: identite(p), resume: w.resume ?? null, clinical_history: w.clinique }
        : { status: "ok", patient: identite(p), treatments: w.traitements_v2 ?? null, last_prescription: w.traitements ?? null };
    }
    if (signal?.aborted || new TextEncoder().encode(JSON.stringify(result)).length > 24_000) return unavailable();
    context.referencedPatientId = id;
    context.targetUnresolved = false;
    return result;
  } catch { return unavailable(); }
}

const patientParameters = { type: "OBJECT", properties: { patient_id: { type: "STRING", description: "Référence retournée par MindCare." },
  query: { type: "STRING", description: "Nom ou numéro, uniquement si un patient est nommé explicitement." } } };
export const OUTILS_LIVE = [
  { name: "search_patient", description: "Recherche le patient nommé. Si ambigu, demander lequel.", parameters: { type: "OBJECT", properties: { query: { type: "STRING" } }, required: ["query"] } },
  { name: "get_patient", description: "Identité et démographie du patient autorisé.", parameters: patientParameters },
  { name: "get_patient_summary", description: "Lit le résumé du cas exact existant et l’histoire clinique. Sans cible, reprend le patient précédent.", parameters: patientParameters },
  { name: "get_patient_consultations", description: "Lit les cinq dernières séances et leurs notes signées.", parameters: patientParameters },
  { name: "get_patient_treatments", description: "Lit les traitements actuels, en pause et arrêtés, séparément.", parameters: patientParameters },
  { name: "get_today_agenda", description: "Lit les rendez-vous d’aujourd’hui en heure d’Alger.", parameters: { type: "OBJECT", properties: {} } },
  { name: "get_next_patient", description: "Lit le prochain patient déterminé par l’agenda MindCare.", parameters: { type: "OBJECT", properties: {} } },
  { name: "get_current_patient", description: "Lit le patient actuellement ouvert, pour ce patient ou cette consultation.", parameters: { type: "OBJECT", properties: {} } },
] as const;
