import { z } from "zod";
import type { ClientSql } from "@/server/jarvis/client-sql";

const appointment = z.object({
  id: z.uuid(), patient_id: z.uuid().nullable(), starts_at: z.iso.datetime({ offset: true }),
  ends_at: z.iso.datetime({ offset: true }), status: z.enum(["confirmed", "arrived", "in_session", "completed", "no_show"]),
});
const dashboard = z.object({ suivant: appointment.nullable(), journee: z.array(appointment).max(500) });
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
