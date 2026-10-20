import { z } from "zod";
import type { ClientSql } from "@/server/jarvis/client-sql";
import { resoudreReferenceTemporelle } from "@/shared/jarvis/temporal";

const appointment = z.object({
  id: z.uuid(), patient_id: z.uuid().nullable(), starts_at: z.iso.datetime({ offset: true }),
  ends_at: z.iso.datetime({ offset: true }), status: z.enum(["confirmed", "arrived", "in_session", "completed", "no_show"]),
});
const dashboard = z.object({ suivant: appointment.nullable(), journee: z.array(appointment).max(500) });
const pgTimestamp = z.preprocess(value => value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString() : value,
  z.iso.datetime({ offset: true }));
const agendaEntry = appointment.extend({ status: z.enum(["requested", "confirmed", "arrived", "in_session", "completed", "no_show"]),
  starts_at: pgTimestamp, ends_at: pgTimestamp,
  first_name: z.string().max(200).nullable(), last_name: z.string().max(200).nullable() });

/** The existing nominative agenda gate authorizes, filters and audits every row. */
export async function readAgendaDay(client: ClientSql, day: string, requestedOnly: boolean, signal: AbortSignal) {
  const reference = resoudreReferenceTemporelle(day);
  if (reference?.type !== "jour" || reference.jour !== day) throw new Error("AgendaPeriodInvalid");
  signal.throwIfAborted();
  const tomorrow = new Date(`${day}T12:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const result = await client.rpc<unknown>("list_agenda", { p_from: `${day}T00:00:00+01:00`,
    p_to: `${tomorrow.toISOString().slice(0, 10)}T00:00:00+01:00`, p_practitioner: null,
    p_statuts: requestedOnly ? "{requested}" : "{confirmed,arrived,in_session,completed,no_show}" });
  signal.throwIfAborted();
  if (result.error) throw new Error("AgendaUnavailable");
  return z.array(agendaEntry).max(500).parse(result.data);
}
/** The existing dashboard gate decides visibility and the next appointment. No local reselection. */
export async function readAgenda(client: ClientSql, signal: AbortSignal) {
  signal.throwIfAborted();
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Algiers", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const result = await client.rpc<unknown>("dashboard_today", { p_day: day });
  signal.throwIfAborted();
  if (result.error) throw new Error("AgendaUnavailable");
  const raw: unknown = Array.isArray(result.data) ? result.data[0] : result.data;
  return dashboard.parse(raw);
}

export { requestsNextPatient } from "@/shared/alexa/request-plan";
