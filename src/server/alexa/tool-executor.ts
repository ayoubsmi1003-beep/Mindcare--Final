import { z } from "zod";

const clinicalArguments = z.object({ patientId: z.string().min(1), count: z.number().int().min(1).max(100), before: z.object({ startedAt: z.string(), id: z.string() }).optional() }).strict();
export type ClinicalReadArguments = z.infer<typeof clinicalArguments>;

/** A closed read surface. Business mutations remain in the PostgreSQL confirmation cycle. */
export async function executeRead<T>(name: string, raw: unknown, patientId: string, read: (args: ClinicalReadArguments, signal: AbortSignal) => Promise<T>, signal?: AbortSignal, timeoutMs = 15_000): Promise<T> {
  if (name !== "clinical_context") throw new Error("ToolNotAllowed");
  const args = clinicalArguments.parse(raw);
  if (args.patientId !== patientId) throw new Error("ScopeChanged");
  signal?.throwIfAborted();
  const controller = new AbortController();
  const onAbort = (): void => controller.abort(signal?.reason);
  signal?.addEventListener("abort", onAbort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onCancel: (() => void) | undefined;
  try {
    const deadline = new Promise<never>((_, reject) => {
      onCancel = () => reject(controller.signal.reason ?? new Error("Aborted"));
      controller.signal.addEventListener("abort", onCancel, { once: true });
      timer = setTimeout(() => controller.abort(new Error("Timeout")), timeoutMs);
    });
    const result = await Promise.race([read(args, controller.signal), deadline]);
    controller.signal.throwIfAborted();
    return result;
  } finally {
    if (timer) clearTimeout(timer);
    if (onCancel) controller.signal.removeEventListener("abort", onCancel);
    signal?.removeEventListener("abort", onAbort);
  }
}
