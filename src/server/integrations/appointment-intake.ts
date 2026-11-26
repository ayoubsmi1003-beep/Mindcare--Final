/**
 * The ONE entry point for appointment requests from outside the clinic (website relay,
 * future WhatsApp gateway). The caller must have verified its channel first (signature,
 * replay window); this validates the contract and hands the request to the database gate
 * `app.ingest_appointment_request` (235), which decides everything else.
 *
 * Never logs the request: it carries a name and a phone number (règle 1).
 */
import { appointmentRequestReceiptV1, appointmentRequestV1, type AppointmentRequestReceiptV1, type IntegrationErrorCode } from "@/shared/integrations/contracts";
import { withIntakeTransport, type Querier } from "@/server/db/withCaller";

type Transaction = <T>(fn: (q: Querier) => Promise<T>) => Promise<T>;
export type IntakeResult = { readonly ok: true; readonly receipt: AppointmentRequestReceiptV1 } | { readonly ok: false; readonly error: IntegrationErrorCode };

const GATE_ERRORS: Readonly<Record<string, IntegrationErrorCode>> = {
  IntakeInvalid: "INVALID_INPUT",
  IntakeConflict: "CONFLICT",
  IntakeCapacity: "CAPACITY",
  IntakeUnavailable: "UNAVAILABLE",
};

export async function submitAppointmentRequest(input: unknown, transaction: Transaction = withIntakeTransport): Promise<IntakeResult> {
  const parsed = appointmentRequestV1.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };
  try {
    const rows = await transaction(q => q.query<{ receipt: unknown }>("SELECT app.ingest_appointment_request($1::jsonb) AS receipt", [JSON.stringify(parsed.data)]));
    return { ok: true, receipt: appointmentRequestReceiptV1.parse(rows[0]?.receipt) };
  } catch (error) {
    const code = error instanceof Error ? GATE_ERRORS[error.message] : undefined;
    return { ok: false, error: code ?? "UNAVAILABLE" };
  }
}
