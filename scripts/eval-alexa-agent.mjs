/** Real French MiniCPM + actor-bound SQL. Explicit isolated, synthetic-only preflight; no .env reads. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join, relative, isAbsolute } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createHash, randomUUID } from "node:crypto";
import {finalizeAlexaAdmission} from './lib/alexa-eval-admission.mjs';

const invocationCwd = process.cwd();
const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
// The production asset layout is rooted at the checkout, independently of report location.
process.chdir(root);
const require = createRequire(join(root, "package.json"));
const vite = createRequire(require.resolve("vitest/package.json"));
const { build } = createRequire(vite.resolve("vite/package.json"))("esbuild");
const { evaluateAlexaCase } = await import(
  pathToFileURL(join(root, "tests", "eval", "evaluate-alexa-agent.mjs")).href
);

const args = process.argv.slice(2);
const value = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index < 0 ? fallback : args[index + 1];
};
const output = resolve(invocationCwd, value("--out", "work/alexa/french-live-evaluation.json"));
const manifestPath = resolve(value("--manifest", join(root, "tests", "eval", "alexa-french-questions.json")));
const evalRoot = resolve(root, "tests", "eval");
const manifestRelative = relative(evalRoot, manifestPath);
if (manifestRelative.startsWith("..") || isAbsolute(manifestRelative)) {
  throw new Error("EvaluationManifestMustStayInTestsEval");
}

const manifestSource = await readFile(manifestPath, "utf8");
const manifest = JSON.parse(manifestSource);
manifest.cases = manifest.cases.filter((spec) => spec.language === "fr");
const requested = new Set(value("--cases", "all").split(","));
// Exercise each application area before repeating the next paraphrase in that area.
if (args.includes("--round-robin")) {
  const ordinal = (id) => Number(id.match(/-(\d+)$/)?.[1] ?? 0);
  manifest.cases.sort((a, b) => ordinal(a.id) - ordinal(b.id) || a.id.localeCompare(b.id));
}
const fixtureAsOf = manifest.fixtureAsOf;
if (!fixtureAsOf) throw new Error("ExplicitFixtureClockRequired");

const dbValue = process.env.MINDCARE_ALEXA_EVAL_DATABASE_URL;
if (!dbValue) throw new Error("Set MINDCARE_ALEXA_EVAL_DATABASE_URL explicitly to an isolated alexa_eval database.");
const db = new URL(dbValue);
if (!["postgres:", "postgresql:"].includes(db.protocol) || !["127.0.0.1", "localhost"].includes(db.hostname) || !/^\/alexa_eval(?:_[a-z0-9_]+)?$/.test(db.pathname) || db.port === "55441") {
  throw new Error("DisposableDatabaseRequired");
}
process.env.MINDCARE_DATABASE_URL = dbValue;

const actorIds = manifest.actors ?? {
  owner: "ea000000-0000-4000-8000-000000000001",
  assistant: "ea000000-0000-4000-8000-000000000003",
};
const actorRoles = { owner: 'owner', assistant: 'assistant', other: 'practitioner' };
if (!actorIds.owner || Object.entries(actorIds).some(([key,id]) => !Object.hasOwn(actorRoles,key) || typeof id !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id))) throw Error('InvalidFixtureActors');
for (const spec of manifest.cases) if (!actorIds[spec.expected.actor ?? 'owner']) throw Error('UnknownFixtureActor');
const adminValue = process.env.MINDCARE_ALEXA_EVAL_ADMIN_URL;
if (!adminValue) throw Error('ExplicitDisposablePreflightAdminRequired');
const admin = new URL(adminValue);
if (!['postgres:', 'postgresql:'].includes(admin.protocol) || !['127.0.0.1','localhost'].includes(admin.hostname) || admin.port !== db.port || admin.pathname !== db.pathname) throw Error('DisposablePreflightTargetMismatch');
const { Client } = require('pg');
const preflight = new Client({ connectionString: admin.href, connectionTimeoutMillis: 10000 });
let sourceCount;
try {
 await preflight.connect();
 const check = (await preflight.query('SELECT current_database() name, count(*) FILTER (WHERE is_synthetic IS DISTINCT FROM true)::int unsafe FROM app.patients')).rows[0];
 if (check?.name !== db.pathname.slice(1) || check.unsafe !== 0) throw Error('SyntheticDatabasePreflightFailed');
 for (const [key,id] of Object.entries(actorIds)) {
  const profile = (await preflight.query('SELECT cabinet_id,role::text FROM app.profiles WHERE id=$1',[id])).rows[0];
  if (!profile || profile.role !== actorRoles[key] || (manifest.fixtureCabinet && profile.cabinet_id !== manifest.fixtureCabinet)) throw Error('FixtureActorScopeMismatch');
 }
 sourceCount = (await preflight.query('SELECT count(*)::int total FROM app.knowledge_sources')).rows[0].total;
} finally { await preflight.end(); }
process.env.MINDCARE_ALEXA_EVAL_NO_KNOWLEDGE = sourceCount === 0 ? '1' : '0';
console.log('Synthetic-only database and fixture actor preflight PASS; knowledge sources: ' + sourceCount);
if (args.includes('--preflight-only')) process.exit(0);

const runId = randomUUID();
const outDir = join(root, ".eval-out", "alexa-agent", `codex-run-${runId}`);
await mkdir(outDir, { recursive: true });
await mkdir(resolve(output, ".."), { recursive: true });
const entry = join(outDir, "entry.mjs");
await build({
  stdin: {
    contents: "export {runAlexa} from '@/server/alexa/orchestrator';export {alexaDb} from '@/server/alexa/db';export {clientSql} from '@/server/jarvis/client-sql';export {inferLocalCompletion,releaseLocalModel} from '@/server/alexa/local-model';export {agentSchemas,compactDeclarationSchema,ALEXA_NATIVE_DEADLINE_MS,ALEXA_NATIVE_BUDGET} from '@/shared/alexa/agent';export {withCaller} from '@/server/db/withCaller';export {fermerPool} from '@/server/db/pool';",
    resolveDir: root,
    loader: "ts",
  },
  outfile: entry,
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  tsconfig: join(root, "tsconfig.json"),
  logLevel: "silent",
});

const api = await import(pathToFileURL(entry).href);
const run = {
  id: runId,
  startedAt: new Date().toISOString(),
  bundleSha256: createHash('sha256').update(await readFile(entry)).digest('hex'),
  manifestSha256: createHash('sha256').update(manifestSource).digest('hex'),
  fixtureAsOf,
  capabilities: { approvedBookFixtureAvailable: process.env.MINDCARE_ALEXA_EVAL_NO_KNOWLEDGE !== '1' },
};
const rows = [];
const records = [];
let infrastructureBlock = null;


for (const spec of manifest.cases) {
  if (!requested.has("all") && !requested.has(spec.id)) {
    rows.push({ id: spec.id, scenario: spec.scenario, language: spec.language, status: "NOT RUN", reason: "Not selected" });
    continue;
  }
  if (spec.expected.mode || spec.expected.requiresPendingTask || spec.expected.followUpStatus || spec.expected.replay) {
    rows.push({ id: spec.id, scenario: spec.scenario, language: spec.language, status: "NOT RUN", reason: "Requires dedicated multi-turn/endpoint harness" });
    continue;
  }
  if (spec.expected.requiresEvidence && process.env.MINDCARE_ALEXA_EVAL_NO_KNOWLEDGE === '1') {
    rows.push({ id: spec.id, scenario: spec.scenario, language: spec.language, status: 'NOT RUN', classification: 'fixture', reason: 'No approved book corpus in isolated fixture' });
    continue;
  }

  const started = Date.now();
  const events = [];
  const calls = [];
  const liveCalls = [];
  const dispatchedCalls = [];
  const queries = [];
  const faults = [];
  const timings = { inference: [], tools: [], firstVisible: null };
  const actor = actorIds[spec.expected.actor ?? "owner"];
  const port = api.alexaDb(actor);
  const wrapped = {
    rpc: async (name, rpcArgs) => {
      const time = Date.now();
      const queryRecord = { name, args: structuredClone(rpcArgs) };
      queries.push(queryRecord);
      const fault = spec.expected.fault;
      if (fault?.tool && ((name === "query_alexa_records" && rpcArgs.p_domain === fault.tool.slice(6)) || (fault.tool === "query_finance" && ["get_finance_overview", "get_charges_list"].includes(name)))) {
        try {
          await api.withCaller(actor, (query) => query.query(fault.kind === "timeout" ? "SELECT pg_sleep(16)" : "SELECT 1/0"));
        } catch (error) {
          const code = typeof error?.code === "string" ? error.code : "UnknownDatabaseFailure";
          faults.push({ tool: fault.tool, kind: fault.kind, rpc: name, code });
          timings.tools.push({ name, ms: Date.now() - time, fault: true });
          queryRecord.response = { ok: false, error: { code: "indisponible", message: "Synthetic fault", technical: code } };
          return queryRecord.response;
        }
      }
      const result = await port.rpc(name, rpcArgs);
      queryRecord.response = structuredClone(result);
      timings.tools.push({ name, ms: Date.now() - time });
      return result;
    },
  };

  try {
    await api.runAlexa(
      {
        text: spec.input,
        conversationId: randomUUID(),
        clientTurnId: randomUUID(),
        appContext: spec.context ?? { patientId: null, page: "/jarvis" },
      },
      {
        actor,
        db: wrapped,
        knowledge: api.clientSql(actor),
        native: true,
        agentAsOf: fixtureAsOf,
        agentObserve: call => dispatchedCalls.push(call),
        agentInfer: async (messages, options) => {
          if (spec.expected.fault?.kind === "model-unavailable") throw new Error("LocalModelUnavailable");
          const time = Date.now();
          let result;
          try {
            result = await api.inferLocalCompletion(messages, options);
          } catch (error) {
            const code = error instanceof Error && /^(?:LocalModel[A-Za-z]+|TimeoutError|AbortError)$/.test(error.message)
              ? error.message
              : error instanceof Error && /^(?:TimeoutError|AbortError)$/.test(error.name)
                ? error.name
                : "InferenceFailure";
            timings.inference.push({ ms: Date.now() - time, error: code });
            throw error;
          }
          timings.inference.push({ ms: Date.now() - time, tokensIn: result.tokensIn, tokensOut: result.tokensOut, kind: result.kind, ...(result.kind === 'answer' ? { plainText: result.text.slice(0, 1200) } : {}) });
          if (result.kind === "calls") {
            for (const call of result.calls) {
              const schema = call.name === "declare_request" ? api.compactDeclarationSchema : api.agentSchemas[call.name];
              calls.push({ name: call.name, args: structuredClone(call.args), valid: schema?.safeParse(call.args).success === true });
              liveCalls.push({call,schema});
            }
          }
          return result;
        },
      },
      (event) => {
        events.push(event);
        if (event.type === "sentence" && timings.firstVisible === null) timings.firstVisible = Date.now() - started;
      },
      AbortSignal.timeout(api.ALEXA_NATIVE_DEADLINE_MS),
    );
    const acceptedIds=new Set(events.filter(e=>e.type==='done').flatMap(e=>(e.parts??[]).flatMap(p=>p.resultRefs??[])));
    for(const [index,entry] of liveCalls.entries())calls[index]=finalizeAlexaAdmission(calls[index],entry.call,entry.schema,acceptedIds,dispatchedCalls.find(call=>call.id===entry.call.id));
    const record = {
      id: spec.id,
      requestBudgetMs: api.ALEXA_NATIVE_DEADLINE_MS,
      inferenceBudgetMs: api.ALEXA_NATIVE_BUDGET.inferenceMs,
      events,
      calls,
      queries,
      faults,
      timings,
      ms: Date.now() - started,
    };
    records.push(record);
    const result = evaluateAlexaCase(spec, record);
    const startupError = timings.inference[0]?.error;
    if (!spec.expected.fault && !calls.length && ['LocalModelAssetAccess', 'LocalModelIntegrity', 'LocalModelBusy', 'LocalModelUnavailable'].includes(startupError)) {
      result.classification = 'infrastructure';
      result.reason = startupError;
      infrastructureBlock = startupError;
    }
    rows.push(result);
    console.log(`${result.status} ${spec.id} ${result.ms}ms ${result.failures.join("; ")}`);
  } catch (error) {
    rows.push({ id: spec.id, scenario: spec.scenario, language: spec.language, status: "FAIL", classification: "infrastructure-or-harness", reason: error instanceof Error ? error.message : "unknown" });
    console.log(`FAIL ${spec.id} harness`);
  }
  await writeFile(output, JSON.stringify({ version: 1, status: "PARTIAL", baseline: manifest.baseline, run, rows, records }, null, 2));
  if (infrastructureBlock) break;
}

for (const spec of manifest.cases) if (!rows.some(row => row.id === spec.id)) rows.push({ id: spec.id, scenario: spec.scenario, language: spec.language, status: 'NOT RUN', reason: 'Campaign stopped: ' + infrastructureBlock });

await api.releaseLocalModel();
await api.fermerPool();
const tally = Object.fromEntries(["PASS", "FAIL", "PARTIAL", "NOT RUN"].map((status) => [status, rows.filter((row) => row.status === status).length]));
const report = {
  version: 1,
  status: tally.FAIL ? "FAIL" : tally["NOT RUN"] ? "PARTIAL" : "PASS",
  baseline: manifest.baseline,
  run,
  tally,
  rows,
  records,
  release: "NO-GO until all correctness, completeness, security, browser, voice and packaging gates pass",
};
await writeFile(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify(tally));
process.exitCode = tally.FAIL ? 1 : 0;
