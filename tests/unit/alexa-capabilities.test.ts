import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ABSENT_FEATURES, absentFeatureRequested, ALEXA_CAPABILITIES } from "@/shared/alexa/capabilities";
import { agentSchemas } from "@/shared/alexa/agent";
import { runAgentLoop } from "@/server/alexa/agent-loop";
import { INFERENCE_PROVIDERS, INFERENCE_TASKS, providerForTask, TASK_PROVIDERS } from "@/server/alexa/inference/registry";
import { localModelIdleMs } from "@/server/alexa/local-model";

describe("capability registry", () => {
  // Server-side Alexa reads run under the caller's RLS via withCaller, so the gate's definition is what counts.
  const migrationsDir = join(process.cwd(), "supabase", "migrations");
  const migrations = readdirSync(migrationsDir).filter(file => file.endsWith(".sql")).map(file => readFileSync(join(migrationsDir, file), "utf8")).join("\n");
  it("has unique ids", () => {
    expect(new Set(ALEXA_CAPABILITIES.map(item => item.id)).size).toBe(ALEXA_CAPABILITIES.length);
  });
  it.each(ALEXA_CAPABILITIES.map(item => [item.id, item] as const))("%s is bound to a real tool and gates", (_id, item) => {
    expect(Object.keys(agentSchemas)).toContain(item.tool);
    const shape = (agentSchemas as Record<string, { shape?: Record<string, unknown> }>)[item.tool]?.shape;
    if (item.section) expect(agentSchemas.get_patient_context.shape.section.safeParse(item.section).success).toBe(true);
    if (item.view) expect(agentSchemas.query_app.shape.view.safeParse(item.view).success).toBe(true);
    expect(shape).toBeDefined();
    for (const gate of item.gates) expect(migrations).toContain(`FUNCTION app.${gate}`);
  });
  it("never lists an absent feature as a tool", () => {
    const ids = ALEXA_CAPABILITIES.map(item => item.id).join(" ");
    for (const feature of ABSENT_FEATURES) expect(ids).not.toContain(feature.id);
  });
});

describe("absent features", () => {
  it.each([["Montre les factures du mois.", "invoices"], ["Rembourse ce patient.", "refunds"], ["Quels sont mes objectifs financiers ?", "financial_goals"]])("%s", (text, id) => {
    expect(absentFeatureRequested(text)).toBe(id);
  });
  it.each(["Quelles sont les charges enregistrées, factures comprises ?", "Comment fonctionne une facture ?", "Combien j'ai encaissé aujourd'hui ?"])("leaves %s alone", text => {
    expect(absentFeatureRequested(text)).toBeNull();
  });
  it("answers honestly with no tool and no model", async () => {
    const execute = vi.fn(), infer = vi.fn();
    const result = await runAgentLoop({ text: "Montre les factures du mois.", conversationId: crypto.randomUUID(), clientTurnId: crypto.randomUUID(), appContext: { patientId: null, page: "/jarvis" } },
      { actor: crypto.randomUUID(), infer: infer as never, execute: execute as never }, new AbortController().signal);
    expect(execute).not.toHaveBeenCalled();expect(infer).not.toHaveBeenCalled();
    expect(result.sentences.join(" ")).toMatch(/factur/iu);
    expect(result.parts[0]?.status).toBe("unsupported");
  });
});

describe("inference registry", () => {
  it("serves every task from a registered provider", () => {
    for (const task of INFERENCE_TASKS) expect(INFERENCE_PROVIDERS[TASK_PROVIDERS[task]]).toBeDefined();
  });
  it("registers only local inference, as decided", () => {
    for (const task of INFERENCE_TASKS) expect(providerForTask(task).local).toBe(true);
  });
});

describe("model idle window", () => {
  it("defaults to five minutes so follow-ups avoid a cold reload", () => expect(localModelIdleMs(undefined)).toBe(300_000));
  it("accepts a bounded value", () => expect(localModelIdleMs("60000")).toBe(60_000));
  it.each(["10", "99999999", "abc", ""])("ignores %s", value => expect(localModelIdleMs(value)).toBe(300_000));
});
