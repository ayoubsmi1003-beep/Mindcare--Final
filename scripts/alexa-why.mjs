#!/usr/bin/env node
/**
 * alexa-why — answers "why did this turn end like that?" from the stored trace.
 *
 *   MINDCARE_ALEXA_WHY_URL=<database url> node scripts/alexa-why.mjs [count]
 *
 * Read-only. Prints closed codes only: never question text, answers or patient identity.
 */
import pg from "pg";

const url = process.env.MINDCARE_ALEXA_WHY_URL;
const count = Number(process.argv[2] ?? 10);
if (!url || !Number.isInteger(count) || count < 1 || count > 200) {
  console.error("Usage: MINDCARE_ALEXA_WHY_URL=<url> node scripts/alexa-why.mjs [1-200]");
  process.exit(2);
}

/** Pure, so the diagnosis itself can be tested. */
export function diagnose(trace) {
  if (!trace) return "no-trace: turn predates tracing";
  const codes = trace.codes ?? [], tools = trace.tools ?? [];
  const failed = tools.find(tool => tool.errorCode);
  const knowledge = codes.filter(entry => entry.stage === "knowledge").map(entry => entry.code);
  if (trace.outcome === "answered") return "answered";
  if (trace.outcome === "clarification") return "understanding: asked for a precision";
  if (trace.outcome === "permission_denied") return `authorization: ${failed?.name ?? "tool"} refused`;
  if (trace.outcome === "capability_unavailable") return "capability: not available";
  if (failed) return `tool: ${failed.name} failed (${failed.errorCode})`;
  if (knowledge.includes("sans-preuve")) return "retrieval: no approved evidence found";
  if (knowledge.includes("faible")) return "retrieval: only weak evidence found";
  const fallback = knowledge.find(code => code.startsWith("source-fallback:"));
  if (fallback) return `generation: evidence found, model output rejected (${fallback.slice(16)})`;
  if (trace.route === "none") return "routing: no route was chosen";
  if (trace.route === "model_loop" && !tools.length) return "understanding: the model chose no tool";
  return `other: ${trace.outcome ?? "unknown"}`;
}

const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 10000 });
await client.connect();
try {
  await client.query("BEGIN TRANSACTION READ ONLY");
  const { rows } = await client.query(
    "SELECT created_at, outil->'trace' AS trace FROM app.jarvis_messages WHERE outil ? 'trace' ORDER BY created_at DESC LIMIT $1", [count]);
  for (const row of rows) {
    const trace = row.trace;
    console.log(JSON.stringify({ at: row.created_at, traceId: trace?.traceId, route: trace?.route, followup: trace?.followup, ms: trace?.ms, outcome: trace?.outcome, why: diagnose(trace) }));
  }
  if (!rows.length) console.log("No traced turn yet.");
  await client.query("ROLLBACK");
} finally { await client.end(); }
