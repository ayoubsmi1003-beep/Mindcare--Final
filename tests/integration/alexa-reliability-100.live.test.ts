import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { readKnowledge } from "@/server/alexa/knowledge-adapter";
import { inferNativeGeneralAlexa } from "@/server/alexa/model-gateway";
import { inferLocalText } from "@/server/alexa/local-model";
import { ouvrirSession } from "@/server/auth/session";
import { alexaDb } from "@/server/alexa/db";
import { clientSql } from "@/server/jarvis/client-sql";
import { runAlexa } from "@/server/alexa/orchestrator";
import { agentExecutor } from "@/server/alexa/agent-tools";
import type { AlexaEvent } from "@/shared/alexa/turn";
import type { ClientSql, ReponseRpc } from "@/server/jarvis/client-sql";

/**
 * Read-only execution of the 100-case Alexa reliability corpus.
 *
 *   $env:MINDCARE_ALEXA_TRACE_DATABASE_URL = $env:MINDCARE_DATABASE_URL
 *   $env:MINDCARE_ALEXA_EVAL = "1"
 *   pnpm vitest run tests/integration/alexa-reliability-100.live.test.ts
 *
 * Categories that need a practitioner session and 25–45 model generations are
 * recorded as NOT RUN, never as PASS. The artifact contains no source text.
 */
const url = process.env["MINDCARE_ALEXA_TRACE_DATABASE_URL"];
const enabled = process.env["MINDCARE_ALEXA_EVAL"] === "1" && Boolean(url);
const require = createRequire(import.meta.url);
const cases = require("../eval/alexa-reliability-100.cjs") as ReadonlyArray<{
  id: string; category: string; route: string; question: string; oracle: Record<string, unknown>; requires?: readonly string[];
}>;

type Status = "PASS" | "FAIL" | "NOT RUN";
interface Outcome { id: string; category: string; status: Status; ms: number; note: string }

const fold = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Only aggregate counts with an independent governed oracle are executed. */
const patientSpecs = new Map<string, Record<string, unknown>>([
  ["Combien de patients actifs compte le cabinet ?", { mode: "count", population: "active", filters: [] }],
  ["Combien de patients n'ont pas de téléphone ?", { mode: "count", population: "active", filters: [{ field: "phone", op: "missing", value: null }] }],
  ["Combien de patients n'ont pas de carte d'identité ?", { mode: "count", population: "active", filters: [{ field: "identity_card", op: "missing", value: null }] }],
  ["Combien de patients sont mineurs ?", { mode: "count", population: "active", filters: [{ field: "age", op: "lt", value: 18 }] }],
  ["Combien de patients n'ont pas de date de naissance ?", { mode: "count", population: "active", filters: [{ field: "birth_date", op: "missing", value: null }] }],
  ["Combien de patients n'ont jamais eu de consultation terminée ?", { mode: "count", population: "active", filters: [{ field: "completed_consultations", op: "eq", value: 0 }] }],
  ["Combien de patients n'ont pas été vus depuis six mois ?", { mode: "count", population: "active", filters: [{ field: "no_completed_months", op: "eq", value: 6 }] }],
  ["Combien de patients ont un solde impayé ?", { mode: "count", population: "active", filters: [{ field: "outstanding_balance", op: "gt", value: 0 }] }],
]);

const algeriaDate = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Algiers" }).format(date);
const today = algeriaDate(new Date());
const [year, month] = today.split("-").map(Number);
const pad = (value: number) => String(value).padStart(2, "0");
const monthStart = `${year}-${pad(month!)}-01T00:00:00+01:00`;
const nextMonthStart = month === 12 ? `${year! + 1}-01-01` : `${year}-${pad(month! + 1)}-01`;
const monthEnd = `${nextMonthStart}T00:00:00+01:00`;
const yearStart = `${year}-01-01T00:00:00+01:00`;
const yearEnd = `${year! + 1}-01-01T00:00:00+01:00`;
const tomorrow = new Date(`${today}T12:00:00+01:00`); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
const dayStart = `${today}T00:00:00+01:00`;
const dayEnd = `${algeriaDate(tomorrow)}T00:00:00+01:00`;

const appSpecs = new Map<string, { domain: string; spec: Record<string, unknown> }>([
  ["Combien de rendez-vous sont prévus aujourd'hui ?", { domain: "agenda", spec: { from: dayStart, to: dayEnd } }],
  ["Combien de rendez-vous confirmés aujourd'hui ?", { domain: "agenda", spec: { from: dayStart, to: dayEnd, statuses: ["confirmed"] } }],
  ["Combien de consultations terminées cette année ?", { domain: "consultations", spec: { mode: "count", status: "closed", from: yearStart, to: yearEnd } }],
  ["Combien de paiements sont en attente ?", { domain: "finance", spec: { mode: "list", state: "pending", from: monthStart, to: monthEnd } }],
  ["Combien de documents ont été émis ce mois ?", { domain: "documents", spec: { from: monthStart, to: monthEnd, status: "issued" } }],
  ["Combien de nouveaux patients ce mois ?", { domain: "patients", spec: { mode: "count", population: "active", createdPeriod: { from: monthStart, to: monthEnd } } }],
  ["Quel est le chiffre d'affaires du mois en cours ?", { domain: "finance-overview", spec: { mode: "overview", from: monthStart, to: monthEnd } }],
]);

async function askPatient(actor: string, question: string): Promise<{ text: string; status: string | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException("Deadline", "TimeoutError")), 180_000);
  const events: AlexaEvent[] = [];
  try {
    await runAlexa(
      { text: question, conversationId: `eval-${randomUUID()}`, clientTurnId: randomUUID(), appContext: { patientId: null, page: "/jarvis" } },
      { actor, db: alexaDb(actor), knowledge: clientSql(actor), native: true, contextKey: JSON.stringify({ patientId: null, page: "/jarvis" }) },
      event => { events.push(event); },
      controller.signal,
    );
  } finally {
    clearTimeout(timer);
  }
  const sentences = events.filter((event): event is Extract<AlexaEvent, { type: "sentence" }> => event.type === "sentence");
  const done = events.find((event): event is Extract<AlexaEvent, { type: "done" }> => event.type === "done");
  return { text: sentences.map(sentence => sentence.text).join("\n"), status: done?.status ?? null };
}

describe.skipIf(!enabled)("Alexa reliability — 100 cases", () => {
  it("executes every runnable case and records the rest honestly", async () => {
    const client = new Client({ connectionString: url!, connectionTimeoutMillis: 20_000, statement_timeout: 20_000 });
    await client.connect();
    await client.query("BEGIN TRANSACTION READ ONLY");
    await client.query("SET LOCAL ROLE authenticated");
    const failure = (technical: string): ReponseRpc<unknown[]> => ({
      data: null, error: { code: "indisponible", message: "indisponible", technical, context: "eval" },
    });
    const sql: ClientSql = {
      rpc: async <T = unknown>(name: string, args: Readonly<Record<string, unknown>> = {}): Promise<ReponseRpc<T>> => {
        if (name !== "search_knowledge_lexical") return failure(`unexpected:${name}`) as ReponseRpc<T>;
        try {
          const result = await client.query("select * from app.search_knowledge_lexical($1,$2,$3)", [
            args["p_requete"], args["p_langue"], args["p_limite"],
          ]);
          return { data: result.rows as T, error: null };
        } catch (error) {
          return failure(`sql:${(error as { code?: string }).code ?? "unknown"}`) as ReponseRpc<T>;
        }
      },
    };
    const outcomes: Outcome[] = [];
    const record = (id: string, category: string, status: Status, ms: number, note: string) =>
      outcomes.push({ id, category, status, ms, note });
    const patientSession = process.env["MINDCARE_ALEXA_PATIENT"] === "1"
      ? await ouvrirSession(process.env["DOCTOR_ACCOUNT_USERNAME"] ?? "", process.env["DOCTOR_ACCOUNT_PASSWORD"] ?? "")
      : null;

    try {
      for (const testCase of cases) {
        const started = performance.now();
        const { id, category, question, oracle } = testCase;
        const elapsed = () => Math.round(performance.now() - started);

        if (category === "rag" || category === "medication" || id === "REL-03" || id === "REL-04" || id === "REL-05") {
          const result = await readKnowledge(sql, question, undefined, { vectorActif: false });
          if (oracle["kind"] === "abstention" || oracle["answerable"] === false) {
            record(id, category, result.etat === "sans-preuve" ? "PASS" : "FAIL", elapsed(), `etat=${result.etat}`);
            continue;
          }
          if (result.etat !== "ok") {
            record(id, category, "FAIL", elapsed(), `etat=${result.etat}, preuves=${result.preuves.length}`);
            continue;
          }
          const haystack = fold(result.preuves.map(proof => `${proof.section ?? ""} ${proof.extrait}`).join(" "));
          const expected = typeof oracle["mustContain"] === "string" ? fold(oracle["mustContain"]) : null;
          const excluded = typeof oracle["sectionExcludes"] === "string" ? fold(oracle["sectionExcludes"]) : null;
          const topSection = fold(result.preuves[0]?.section ?? "");
          if (expected && !haystack.includes(expected)) {
            record(id, category, "FAIL", elapsed(), `missing:${oracle["mustContain"]}`);
            continue;
          }
          if (excluded && excluded.split(/\s+/u).some(token => topSection.includes(token))) {
            record(id, category, "FAIL", elapsed(), `excluded-section:${result.preuves[0]?.section ?? ""}`);
            continue;
          }
          if (id.startsWith("REL-") && result.preuves.length === 0) {
            record(id, category, "FAIL", elapsed(), "no-proof");
            continue;
          }
          record(id, category, "PASS", elapsed(), `preuves=${result.preuves.length}`);
          continue;
        }

        if (category === "general" || id === "REL-02") {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(new DOMException("Deadline", "TimeoutError")), 120_000);
          try {
            const answer = await inferNativeGeneralAlexa(question, controller.signal);
            if (!answer.ok) {
              record(id, category, "FAIL", elapsed(), `code=${answer.code}`);
              continue;
            }
            const expected = oracle["mustMatch"];
            const matches = typeof expected === "string" ? new RegExp(expected, "iu").test(answer.text) : true;
            record(id, category, matches ? "PASS" : "FAIL", elapsed(), matches ? "grounded" : "fact-mismatch");
          } finally {
            clearTimeout(timer);
          }
          continue;
        }

        if (id === "REL-01") {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(new DOMException("Deadline", "TimeoutError")), 120_000);
          try {
            const answer = await inferLocalText([
              { role: "system", content: "Réponds en français, en une phrase courte." },
              { role: "user", content: question },
            ], { maxOutputTokens: 120, timeoutMs: 120_000, signal: controller.signal });
            record(id, category, answer.trim().length > 0 ? "PASS" : "FAIL", elapsed(), `chars=${answer.length}`);
          } catch {
            record(id, category, "FAIL", elapsed(), "model-unavailable");
          } finally {
            clearTimeout(timer);
          }
          continue;
        }

        if (category === "patient" && patientSession) {
          const app = appSpecs.get(question);
          const spec = patientSpecs.get(question);
          if (app || spec) {
            let total: number;
            if (app?.domain === "finance-overview") {
              const questionInput = { text: question, conversationId: `oracle-${randomUUID()}`, clientTurnId: randomUUID(), appContext: { patientId: null, page: "/jarvis" } };
              const executed = await agentExecutor(questionInput, alexaDb(patientSession.userId), clientSql(patientSession.userId))(
                { id: "oracle", name: "query_finance", args: { partIds: ["oracle"], ...app.spec } } as never,
                new Date().toISOString(), [], new AbortController().signal, question,
              );
              const data = executed.data as { pulse?: { revenu_mois?: number } } | null;
              total = Number(data?.pulse?.revenu_mois);
            } else {
              const oracle = app && app.domain !== "patients"
                ? await alexaDb(patientSession.userId).rpc<{ total: number }>("query_alexa_records", {
                    p_domain: app.domain, p_spec: JSON.stringify(app.spec), p_as_of: new Date().toISOString(),
                  })
                : await alexaDb(patientSession.userId).rpc<{ total: number }>("search_patients", {
                    p_spec: JSON.stringify(app ? app.spec : spec), p_as_of: new Date().toISOString(),
                  });
              total = oracle.ok ? Number(oracle.data[0]?.total) : NaN;
            }
            if (!Number.isFinite(total)) { record(id, category, "FAIL", elapsed(), "oracle-error"); continue; }
            const answer = await askPatient(patientSession.userId, question);
            const compactText = answer.text.replace(/[\s\u00a0\u202f]/gu, "");
            const zeroExpressed = total === 0 && /aucun|aucune|tous|toutes|\b0\b/iu.test(answer.text);
            const pass = answer.status !== "failed" && (compactText.includes(String(total)) || zeroExpressed);
            record(id, category, pass ? "PASS" : "FAIL", elapsed(), `total=${total},status=${answer.status}`);
            continue;
          }
          record(id, category, "NOT RUN", 0, "aggregate oracle not implemented for this phrasing");
          continue;
        }

        const reason = testCase.requires?.includes("practitioner_session")
          ? "needs a real practitioner session and a model generation budget"
          : "not executed in this batch";
        record(id, category, "NOT RUN", 0, reason);
      }
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      await client.end().catch(() => {});
    }

    const byCategory = new Map<string, Record<Status, number>>();
    for (const outcome of outcomes) {
      const counts = byCategory.get(outcome.category) ?? { PASS: 0, FAIL: 0, "NOT RUN": 0 };
      counts[outcome.status] += 1;
      byCategory.set(outcome.category, counts);
    }
    const summary = {
      total: outcomes.length,
      pass: outcomes.filter(o => o.status === "PASS").length,
      fail: outcomes.filter(o => o.status === "FAIL").length,
      notRun: outcomes.filter(o => o.status === "NOT RUN").length,
      byCategory: Object.fromEntries([...byCategory].map(([key, value]) => [key, value])),
      durationsMs: outcomes.filter(o => o.status !== "NOT RUN").map(o => o.ms).sort((a, b) => a - b),
    };
    const directory = join(".eval-out", "alexa-reliability-100");
    await mkdir(directory, { recursive: true });
    const file = join(directory, `report-${new Date().toISOString().replace(/[:.]/gu, "-")}.json`);
    await writeFile(file, JSON.stringify({ generatedAt: new Date().toISOString(), summary, outcomes }, null, 2), "utf8");
    console.log(`[alexa-100] ${file}`);
    console.log(JSON.stringify(summary, null, 2));
    for (const outcome of outcomes.filter(o => o.status === "FAIL")) {
      console.log(`[alexa-100] FAIL ${outcome.id} ${outcome.category} ${outcome.note}`);
    }

    expect(outcomes).toHaveLength(100);
    expect(summary.notRun).toBeLessThanOrEqual(55);
  }, 1_800_000);
});
