import { z } from "zod";
import type { ClientSql } from "@/server/jarvis/client-sql";

const integer = z.union([z.number(), z.string().regex(/^\d+$/u)])
  .transform(value => Number(value)).pipe(z.number().int().min(0).max(Number.MAX_SAFE_INTEGER));
const dailyReceipts = z.object({ encaisse: z.object({
  montant_dzd: integer,
  seances: integer,
  perimetre: z.enum(["cabinet", "praticienne"]),
}) });

/** SQL owns role visibility and cash semantics; nothing else from the dashboard is returned. */
export async function readDailyReceipts(client: ClientSql, signal: AbortSignal) {
  signal.throwIfAborted();
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Algiers", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  const result = await client.rpc<unknown>("dashboard_today", { p_day: day });
  signal.throwIfAborted();
  if (result.error) throw new Error("ReceiptsUnavailable");
  const raw: unknown = Array.isArray(result.data) ? result.data[0] : result.data;
  return { day, ...dailyReceipts.parse(raw).encaisse };
}
