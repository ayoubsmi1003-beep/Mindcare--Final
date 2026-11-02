/** Real in-process runAlexa turns for the separate 250-case corpus; never loads .env. */
import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  resolveV8AdversarialPromptTurns,
  validateV8AdversarialManifest,
} from "./lib/alexa-v8-adversarial.mjs";
import {
  createV8AdversarialProgress,
  recoverV8AdversarialProgress,
} from "./lib/alexa-v8-campaign-progress.mjs";
import {
  executeV8AdversarialCampaign,
  matchesV8AdversarialResumeBinding,
  restoreV8AdversarialOracleResults,
  selectV8AdversarialCase,
} from "./lib/alexa-v8-campaign-executor.mjs";
import { sanitizeAlexaEvaluationArtifact } from "./lib/alexa-eval-artifact.mjs";
import { createV8AnswerTranscriptRow } from "./lib/alexa-v8-answer-transcript.mjs";
import { withV8KnowledgeVectorEnabled } from "./lib/alexa-v8-campaign-config.mjs";
import {
  evaluateV8AdversarialScenario,
  evaluateV8KnowledgeOriginCoverage,
} from "./lib/alexa-v8-adversarial-evaluator.mjs";
import {
  BOOK_RAG_REQUIRED_MIGRATIONS,
  resolveV8CampaignActors,
  resolveV8CampaignDatabaseUrls,
  validateBookRagSource,
  validateV8MigrationInventory,
  v8AdversarialRequiresCrossEncoder,
} from "./lib/alexa-v8-manifest.mjs";
import {
  mergeAlexaExecutionFallback,
  runAlexaV8DirectKnowledge,
  runAlexaV8Turn,
} from "./lib/alexa-v8-runtime-observation.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const evalRoot = join(root, "tests", "eval");
const privateRoot = join(root, ".eval-out", "alexa-v8-upgrade");
const args = process.argv.slice(2);
const v9Corpus = args.includes("--corpus-v9");
const require = createRequire(join(root, "package.json"));
const hash = value => createHash("sha256").update(value).digest("hex");

function onlyKnownFlags() {
  const allowed = new Set(["--validate-only", "--resume", "--case", "--capture-answers", "--corpus-v9"]);
  for (let index = 0; index < args.length; index++) {
    if (!allowed.has(args[index]) || ["--resume", "--case"].includes(args[index]) && typeof args[index + 1] !== "string") {
      throw new Error("Usage: node scripts/eval-alexa-v8-adversarial.mjs [--corpus-v9] [--validate-only | --resume <progress-file> | --case ADV-001] [--capture-answers]");
    }
    if (args[index] === "--case" && !/^ADV-\d{3}$/u.test(args[index + 1] ?? "")) throw new Error("Invalid diagnostic case ID");
    if (["--resume", "--case"].includes(args[index])) index++;
  }
  if (args.includes("--validate-only") && args.some(flag => ["--resume", "--case", "--capture-answers"].includes(flag))) throw new Error("Validation mode cannot run a diagnostic case, resume a campaign, or capture answers");
  if (args.includes("--case") && args.includes("--resume")) throw new Error("A diagnostic case run cannot resume a campaign");
}

function diagnosticCaseId() {
  const index = args.indexOf("--case");
  return index < 0 ? null : args[index + 1];
}

function resumeName() {
  const index = args.indexOf("--resume");
  if (index < 0) return null;
  const value = args[index + 1];
  if (basename(value) !== value || !/^[a-z0-9._-]{1,120}\.progress\.json$/iu.test(value)) {
    throw new Error("Resume file must be a progress artifact in the V8 evaluation directory");
  }
  return value;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function loadInputs() {
  const manifestPath = join(evalRoot, v9Corpus ? "alexa-v9-adversarial-300.cjs" : "alexa-v8-adversarial-250.cjs");
  const frozenPath = join(evalRoot, "alexa-v8-cases.json");
  const snapshotPath = join(privateRoot, "private-oracle-snapshot-v2.json");
  const privateOraclePath = join(privateRoot, "private-oracles-v4.json");
  const manifestBytes = await readFile(manifestPath);
  const frozenBytes = await readFile(frozenPath);
  const snapshotBytes = await readFile(snapshotPath);
  const privateOracleBytes = await readFile(privateOraclePath);
  const manifestFile = require(manifestPath);
  const fullManifest = v9Corpus ? { ...manifestFile, campaign: "alexa-v8-adversarial-250" } : manifestFile;
  const requestedCases = (process.env["ALEXA_EVAL_CASE_FILTER"] ?? "")
    .split(",").map(value => value.trim()).filter(Boolean);
  if (requestedCases.some(id => !/^ADV-\d{3}$/u.test(id))) throw new Error("Invalid ALEXA_EVAL_CASE_FILTER");
  const filteredCases = requestedCases.length
    ? fullManifest.cases.filter(scenario => requestedCases.includes(scenario.id))
    : fullManifest.cases;
  if (requestedCases.length && filteredCases.length !== new Set(requestedCases).size) {
    throw new Error("ALEXA_EVAL_CASE_FILTER contains an unknown case");
  }
  const manifest = requestedCases.length ? { ...fullManifest, cases: filteredCases } : fullManifest;
  const frozenManifest = JSON.parse(frozenBytes.toString("utf8"));
  const snapshot = JSON.parse(snapshotBytes.toString("utf8"));
  const privateOracles = JSON.parse(privateOracleBytes.toString("utf8"));
  if (privateOracles.version !== 4 || privateOracles.sourceSha256 !== hash(snapshotBytes)) {
    throw new Error("Private adversarial bindings do not match the frozen synthetic snapshot");
  }

  const knowledgeSources = {};
  const sourceFiles = [...new Set(fullManifest.cases.flatMap(item => item.oracles
    .filter(oracle => oracle.kind === "knowledge_case").map(oracle => oracle.sourceFile)))];
  for (const file of sourceFiles) {
    if (basename(file) !== file || !file.endsWith(".json")) throw new Error("Invalid knowledge source reference");
    const source = await readJson(join(evalRoot, file));
    knowledgeSources[file] = source.cas;
  }
  const validation = validateV8AdversarialManifest(fullManifest, {
    frozenManifest,
    knowledgeSources,
    ...(v9Corpus ? { campaign: "alexa-v8-adversarial-250", categoryCounts: fullManifest.categoryCounts } : {}),
  });
  const resolvedPrompts = {};
  let placeholderCount = 0;
  for (const scenario of manifest.cases) {
    resolvedPrompts[scenario.id] = resolveV8AdversarialPromptTurns(scenario, { snapshot, privateOracles });
    placeholderCount += scenario.turns.reduce((count, turn) => count + [...turn.matchAll(/\[([A-Z0-9_]+)\]/gu)].length, 0);
  }

  return {
    manifest,
    manifestSha256: hash(manifestBytes),
    frozenManifest,
    frozenManifestSha256: hash(frozenBytes),
    snapshot,
    privateOracles,
    privateOracleSha256: hash(privateOracleBytes),
    knowledgeSources,
    validation,
    resolvedPrompts,
    placeholderCount,
    fixtureAsOf: privateOracles.fixtureAsOf,
  };
}

async function checkHashBinding() {
  if (v9Corpus) {
    const { workingTreeSha256 } = await import("./alexa-v8-bind-adversarial.mjs");
    return { checkout: { sourceWorkingTreeSha256: workingTreeSha256() } };
  }
  const { execFileSync } = await import("node:child_process");
  execFileSync(process.execPath, [join(root, "scripts", "alexa-v8-bind-adversarial.mjs"), "--check"], {
    cwd: root,
    stdio: "pipe",
    windowsHide: true,
  });
  const binding = await readJson(join(privateRoot, "adversarial-oracle-binding-v2.json"));
  if (!/^[a-f0-9]{64}$/u.test(binding.checkout?.sourceWorkingTreeSha256 ?? "")) {
    throw new Error("Adversarial source working-tree binding is invalid");
  }
  return binding;
}

async function writeAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, path);
}

function sourceCaseIds(scenario) {
  return [...new Set(scenario.oracles.flatMap(oracle => [oracle.sourceCaseId, oracle.promptBindingSourceCaseId])
    .filter(id => typeof id === "string"))];
}

function patientForRef(snapshot, reference) {
  if (reference === "PATIENT_A") return snapshot?.patientA ?? null;
  if (reference === "PATIENT_B") return snapshot?.patientB ?? null;
  const long = /^PATIENT_LONG_([123])$/u.exec(reference ?? "");
  return long ? snapshot?.longPatients?.[Number(long[1]) - 1] ?? null : null;
}

function appContextFor(scenario, inputs, turnIndex = 0) {
  const preconditionsPath = join(evalRoot, "alexa-v8-preconditions.json");
  const preconditions = JSON.parse(require("node:fs").readFileSync(preconditionsPath, "utf8"));
  const selectedDocument = sourceCaseIds(scenario).some(id =>
    preconditions.cases?.[id]?.kind === "selected_issued_document" && preconditions.cases[id].source === "currentDocument");
  if (!selectedDocument) {
    const source = sourceCaseIds(scenario)
      .map(id => inputs.privateOracles.cases.find(item => item.id === id))
      .find(item => Array.isArray(item?.turnScopes));
    const scope = source?.turnScopes?.[turnIndex === 0 ? 0 : turnIndex - 1] ?? source?.turnScopes?.at(0);
    const patient = patientForRef(inputs.snapshot, scope?.patientRef);
    return { patientId: patient?.id ?? null, page: patient?.id ? `/patients/${patient.id}` : "/jarvis" };
  }
  const document = inputs.snapshot.currentDocument;
  if (!document || document.status !== "issued" || document.is_synthetic !== true ||
      typeof document.id !== "string" || typeof document.patient_id !== "string" || typeof document.content_hash !== "string") {
    throw new Error("Selected synthetic issued-document context is invalid");
  }
  return {
    patientId: document.patient_id,
    page: "/documents",
    documentId: document.id,
    documentRevision: document.content_hash,
  };
}

async function validateOnly() {
  onlyKnownFlags();
  const inputs = await loadInputs();
  const binding = await checkHashBinding();
  process.stdout.write(JSON.stringify({
    status: "PASS",
    mode: "static-validation-only",
    cases: inputs.validation.total,
    oracleReferences: inputs.manifest.cases.reduce((total, item) => total + item.oracles.length, 0),
    resolvedPromptPlaceholders: inputs.placeholderCount,
    manifestSha256: inputs.manifestSha256,
    privateOracleSha256: inputs.privateOracleSha256,
    sourceWorkingTreeSha256: binding.checkout.sourceWorkingTreeSha256,
    knowledgeOriginCoverage: { status: "NOT RUN", direct: false, agentTool: false },
    database: "NOT CHECKED",
    runtime: "NOT RUN",
  }) + "\n");
}

async function preflightDatabase(inputs) {
  const { applicationUrl, adminUrl } = resolveV8CampaignDatabaseUrls(process.env);
  process.env.MINDCARE_DATABASE_URL = applicationUrl;
  const Client = require("pg").Client;
  const client = new Client({ connectionString: adminUrl, connectionTimeoutMillis: 10000 });
  let sourceCount;
  let databaseSnapshot;
  let migrationInventory;
  try {
    await client.connect();
    const source = (await client.query(`SELECT current_database() AS "database",
      (SELECT count(*)::int FROM app.patients) AS patients,
      (SELECT count(*)::int FROM app.consultations) AS consultations,
      (SELECT count(*) FILTER (WHERE is_synthetic IS DISTINCT FROM true)::int FROM app.patients) AS "nonSynthetic",
      (SELECT count(*)::int FROM app.schema_migrations WHERE version = ANY($1::text[])) AS "appliedMigrationsThrough200"`,
    [BOOK_RAG_REQUIRED_MIGRATIONS])).rows[0];
    validateBookRagSource(source);
    databaseSnapshot = {
      patients: Number(source.patients),
      consultations: Number(source.consultations),
      nonSynthetic: Number(source.nonSynthetic),
    };
    const repositoryVersions = (await readdir(join(root, "supabase", "migrations")))
      .filter(file => file.endsWith(".sql"))
      .map(file => file.slice(0, -4));
    const appliedVersions = (await client.query("SELECT version FROM app.schema_migrations ORDER BY version"))
      .rows.map(row => row.version);
    const acknowledgedHistoricalVersions = [];
    if (appliedVersions.includes("173_document_autofill_context")) {
      const legacyEffect = (await client.query(
        "SELECT to_regprocedure('app.document_context(app.document_drafts)') IS NOT NULL AS present",
      )).rows[0]?.present === true;
      if (!legacyEffect) throw new Error("V8HistoricalMigrationEffectMismatch");
      acknowledgedHistoricalVersions.push("173_document_autofill_context");
    }
    migrationInventory = validateV8MigrationInventory({
      repositoryVersions,
      appliedVersions,
      acknowledgedHistoricalVersions,
    });
    const actionDatabase = process.env.ALEXA_EVAL_EXECUTE_ACTIONS === "1" && source.database === "alexa_eval_v9_actions_20261031";
    if ((!actionDatabase && inputs.snapshot.source?.database !== source.database) || Number(inputs.snapshot.source?.nonSynthetic) !== 0 ||
        Number(inputs.snapshot.source?.patients) !== Number(source.patients) ||
        Number(inputs.snapshot.source?.consultations) !== Number(source.consultations)) {
      throw new Error("Runtime database does not match the bound synthetic snapshot");
    }
    const fixtureActors = resolveV8CampaignActors(inputs.snapshot);
    for (const [name, id] of Object.entries(fixtureActors)) {
      const actor = (await client.query("SELECT role::text FROM app.profiles WHERE id=$1", [id])).rows[0];
      const expectedRole = name === "owner" ? "owner" : "assistant";
      if (!actor || actor.role !== expectedRole) throw new Error("Synthetic fixture actor scope mismatch");
    }
    sourceCount = Number((await client.query("SELECT count(*)::int AS total FROM app.knowledge_sources")).rows[0]?.total ?? 0);
  } finally {
    await client.end();
  }
  if (sourceCount === 0) throw new Error("Approved synthetic knowledge corpus is unavailable; campaign remains NOT RUN");
  process.env.MINDCARE_ALEXA_EVAL_NO_KNOWLEDGE = "0";
  return {
    sourceCount,
    database: "alexa_eval_v8_intelligence_20261027",
    databaseSnapshot,
    migrationInventory,
    actors: resolveV8CampaignActors(inputs.snapshot),
  };
}

async function bundleRuntime(outDir) {
  const vitestPackage = require.resolve("vitest/package.json");
  const vitePackage = createRequire(vitestPackage).resolve("vite/package.json");
  const { build } = createRequire(vitePackage)("esbuild");
  const entry = join(outDir, "runtime-entry.mjs");
  await build({
    stdin: {
      contents: "export {runAlexa} from '@/server/alexa/orchestrator';export {readKnowledge} from '@/server/alexa/knowledge-adapter';export {ALEXA_CONVERSATION_MODEL} from '@/server/alexa/model-policy';export {alexaDb} from '@/server/alexa/db';export {clientSql} from '@/server/jarvis/client-sql';export {inferLocalCompletion,releaseLocalModel} from '@/server/alexa/local-model';export {agentSchemas,compactDeclarationSchema,ALEXA_NATIVE_DEADLINE_MS,ALEXA_NATIVE_BUDGET} from '@/shared/alexa/agent';export {fermerPool} from '@/server/db/pool';",
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
  return import(pathToFileURL(entry).href);
}

function tally(progress) {
  return Object.fromEntries(["PASS", "FAIL", "PARTIAL", "NOT RUN", "NOT VERIFIED"].map(status =>
    [status, progress.cases.filter(item => item.status === status).length]));
}

async function runCampaign() {
  onlyKnownFlags();
  const inputs = await loadInputs();
  if (v9Corpus) process.env.KNOWLEDGE_VECTOR_RECETTE ??= "e5-base";
  const selectedCase = diagnosticCaseId();
  if (selectedCase) Object.assign(inputs, selectV8AdversarialCase({
    manifest: inputs.manifest,
    resolvedPrompts: inputs.resolvedPrompts,
    caseId: selectedCase,
  }));
  const sourceBinding = await checkHashBinding();
  const evaluatorSha256 = hash(await readFile(join(root, "scripts", "lib", "alexa-v8-adversarial-evaluator.mjs")));
  const target = await preflightDatabase(inputs);
  const runId = randomUUID();
  const resumed = resumeName();
  let prefix = resumed ? resumed.replace(/\.progress\.json$/u, "") : `adversarial-${runId}`;
  let progressPath = join(privateRoot, `${prefix}.progress.json`);
  let reportPath = join(privateRoot, `${prefix}.report.json`);
  let answerTranscriptPath = args.includes("--capture-answers")
    ? join(privateRoot, `${prefix}.answers.jsonl`)
    : null;
  const outDir = join(privateRoot, "runtime-bundles", runId);
  await mkdir(outDir, { recursive: true });
  const api = await bundleRuntime(outDir);
  const fixtureAsOf = /^\d{4}-\d{2}-\d{2}$/u.test(inputs.fixtureAsOf)
    ? `${inputs.fixtureAsOf}T12:00:00+01:00`
    : inputs.fixtureAsOf;
  if (!Number.isFinite(Date.parse(fixtureAsOf))) throw new Error("Invalid synthetic fixture clock");
  process.env.ALEXA_LOCAL_TIMINGS = "1";

  const priorProgress = resumed ? await readJson(join(privateRoot, resumed)) : null;
  const previousReport = resumed ? await readJson(reportPath).catch(error => {
    if (error?.code === "ENOENT") return null;
    throw error;
  }) : null;
  const databaseBindingSha256 = hash(JSON.stringify({
    database: target.database,
    databaseSnapshot: target.databaseSnapshot,
    sourceCount: target.sourceCount,
    migrationInventory: target.migrationInventory,
  }));
  const run = {
    id: runId,
    startedAt: new Date().toISOString(),
    corpus: v9Corpus ? "alexa-v9-adversarial-300" : "alexa-v8-adversarial-250",
    manifestSha256: inputs.manifestSha256,
    frozenManifestSha256: inputs.frozenManifestSha256,
    privateOracleSha256: inputs.privateOracleSha256,
    evaluatorSha256,
    sourceWorkingTreeSha256: sourceBinding.checkout.sourceWorkingTreeSha256,
    fixtureAsOf,
    capabilities: { approvedBookFixtureAvailable: true },
    databaseTarget: target.database,
    databaseSnapshot: target.databaseSnapshot,
    databaseBindingSha256,
    sourceCount: target.sourceCount,
    migrationInventory: target.migrationInventory,
    execution: {
      model: api.ALEXA_CONVERSATION_MODEL,
      recipe: "native-agent",
      gate: "runAlexa",
      invocation: "in_process",
      fallback: { used: false, causes: [] },
    },
    retrievalConfiguration: {
      vectorFeatureGate: "enabled",
      recipe: process.env["KNOWLEDGE_VECTOR_RECETTE"]?.trim() || "e5-small",
      crossEncoder: "mmarco-for-retrieval-contract-cases",
    },
    ...(answerTranscriptPath ? { answerTranscript: basename(answerTranscriptPath) } : {}),
  };
  const previousReportMatchesBinding = matchesV8AdversarialResumeBinding({ report: previousReport, binding: run });
  run.resumeBindingStatus = !resumed ? "fresh"
    : previousReportMatchesBinding ? "matched" : "mismatch_restarted_fresh";
  if (resumed && !previousReportMatchesBinding) {
    prefix = `adversarial-${runId}`;
    progressPath = join(privateRoot, `${prefix}.progress.json`);
    reportPath = join(privateRoot, `${prefix}.report.json`);
    answerTranscriptPath = args.includes("--capture-answers")
      ? join(privateRoot, `${prefix}.answers.jsonl`)
      : null;
    if (answerTranscriptPath) run.answerTranscript = basename(answerTranscriptPath);
  }
  if (answerTranscriptPath) await appendFile(answerTranscriptPath, "", "utf8");
  let progress = priorProgress && previousReportMatchesBinding
    ? recoverV8AdversarialProgress(priorProgress, { nextSessionId: runId })
    : createV8AdversarialProgress({
      manifestSha256: inputs.manifestSha256,
      scenarios: inputs.manifest.cases.map(item => ({ id: item.id, turnCount: item.turns.length })),
    });
  const safeRecords = [];
  const oracleResults = restoreV8AdversarialOracleResults({
    manifest: inputs.manifest,
    binding: {
      manifestSha256: inputs.manifestSha256,
      frozenManifestSha256: inputs.frozenManifestSha256,
      privateOracleSha256: inputs.privateOracleSha256,
      evaluatorSha256,
      sourceWorkingTreeSha256: sourceBinding.checkout.sourceWorkingTreeSha256,
      databaseBindingSha256,
    },
    progress,
    report: previousReport,
  });
  const previousCoverage = previousReportMatchesBinding ? previousReport.knowledgeOriginCoverage : null;
  const observedOrigins = [
    ...(previousCoverage?.direct === true ? [{ knowledgeTraces: [{ origin: "direct" }] }] : []),
    ...(previousCoverage?.agentTool === true ? [{ knowledgeTraces: [{ origin: "agent_tool" }] }] : []),
  ];
  const reportRow = scenario => {
    const savedCase = progress.cases.find(item => item.id === scenario.id);
    const outcomes = oracleResults.get(scenario.id) ?? [];
    const ordered = [...outcomes].sort((left, right) => left.oracleIndex - right.oracleIndex);
    const complete = ordered.length === scenario.oracles.length &&
      ordered.every((item, index) => item.oracleIndex === index + 1 && item.kind === scenario.oracles[index]?.kind);
    return {
      id: scenario.id,
      status: savedCase?.status ?? "NOT RUN",
      ...(complete ? {
        oracleCount: ordered.length,
        passingOracleCount: ordered.filter(item => item.status === "PASS").length,
        evaluatorSha256,
        oracleStatuses: ordered.map(item => item.status),
        oracleChecks: ordered.map(item => ({
          oracleIndex: item.oracleIndex,
          kind: item.kind,
          checks: Array.isArray(item.checks) ? item.checks.map(check => ({
            id: check.id,
            status: check.status,
            ...Object.fromEntries(["sourceTitleMatched", "sourceSectionMatched", "citationMatched", "pageResolved"]
              .filter(key => typeof check[key] === "boolean").map(key => [key, check[key]])),
          })) : [],
        })),
      } : {}),
    };
  };
  const oracleStatusCounts = () => {
    const counts = {};
    for (const scenario of inputs.manifest.cases) {
      const savedCase = progress.cases.find(item => item.id === scenario.id);
      const outcomes = oracleResults.get(scenario.id) ?? [];
      scenario.oracles.forEach((oracle, index) => {
        const outcome = outcomes.find(item => item.oracleIndex === index + 1);
        const status = outcome?.status ?? (savedCase?.status === "NOT RUN" ? "NOT RUN" : "NOT VERIFIED");
        const group = counts[oracle.kind] ??= { total: 0, PASS: 0, FAIL: 0, "NOT RUN": 0, "NOT VERIFIED": 0 };
        group.total++;
        group[status]++;
      });
    }
    return counts;
  };
  const persist = async value => {
    progress = value;
    await writeAtomic(progressPath, value);
    const counts = tally(value);
    const perOracle = oracleStatusCounts();
    const oracleFailure = Object.values(perOracle).some(group => group.FAIL > 0);
    await writeAtomic(reportPath, sanitizeAlexaEvaluationArtifact({
      version: 1,
      status: counts.FAIL || oracleFailure ? "FAIL" : counts["NOT RUN"] ? "PARTIAL" : "NOT VERIFIED",
      run,
      tally: counts,
      oracleStatusCounts: perOracle,
      knowledgeOriginCoverage: evaluateV8KnowledgeOriginCoverage(observedOrigins),
      rows: inputs.manifest.cases.map(reportRow),
      records: safeRecords,
    }));
  };

  try {
    progress = await executeV8AdversarialCampaign({
      manifest: inputs.manifest,
      manifestSha256: inputs.manifestSha256,
      resolvedPrompts: inputs.resolvedPrompts,
      progress,
      sessionId: runId,
      persistProgress: persist,
      invokeTurn: async ({ scenario, turnIndex, prompt, sessionState }) => {
        const conversationId = sessionState?.conversationId ?? randomUUID();
        const actor = target.actors.owner;
        const previousReranker = process.env["KNOWLEDGE_RERANK"];
        if (v8AdversarialRequiresCrossEncoder(scenario)) process.env["KNOWLEDGE_RERANK"] = "mmarco";
        else delete process.env["KNOWLEDGE_RERANK"];
        let observation;
        try {
          observation = await withV8KnowledgeVectorEnabled(async () => {
            const actionSourceCase = scenario.oracles
              .filter(oracle => oracle.kind === "action_contract" && typeof oracle.sourceCaseId === "string")
              .map(oracle => inputs.privateOracles.cases.find(item => item.id === oracle.sourceCaseId))
              .find(Boolean);
            const expectedAction = actionSourceCase?.assertions?.find(assertion => assertion.kind === "expected_action");
            const expectedPatientId = patientForRef(inputs.snapshot, actionSourceCase?.turnScopes?.[turnIndex]?.patientRef)?.id;
            const turn = await runAlexaV8Turn({
              api,
              actor,
              text: prompt,
              conversationId,
              clientTurnId: randomUUID(),
              appContext: appContextFor(scenario, inputs, turnIndex),
              asOf: fixtureAsOf,
              expectedAction,
              expectedPatientId,
            });
            if (answerTranscriptPath) {
              const transcriptRow = createV8AnswerTranscriptRow({
                caseId: scenario.id,
                turnIndex,
                prompt,
                observation: turn,
              });
              await appendFile(answerTranscriptPath, `${JSON.stringify(transcriptRow)}\n`, "utf8");
            }
            if (scenario.oracles.some(oracle => oracle.kind === "retrieval_contract")) {
              const direct = await runAlexaV8DirectKnowledge({ api, actor, question: prompt });
              turn.knowledgeTraces.push(...direct.knowledgeTraces);
              if (direct.externalEgressCount !== null) {
                turn.externalEgressCount = (turn.externalEgressCount ?? 0) + direct.externalEgressCount;
              }
            }
            return turn;
          });
        } finally {
          if (previousReranker === undefined) delete process.env["KNOWLEDGE_RERANK"];
          else process.env["KNOWLEDGE_RERANK"] = previousReranker;
        }
        observation.caseId = scenario.id;
        observation.turnIndex = turnIndex;
        run.execution.fallback = mergeAlexaExecutionFallback(run.execution.fallback, observation.execution?.fallback);
        if (process.env["ALEXA_EVAL_DUMP_OBSERVATIONS"] === "1") {
          await appendFile(join(privateRoot, "observations-debug.jsonl"), `${JSON.stringify({
            caseId: scenario.id, turnIndex,
            queries: observation.queries,
            calls: observation.calls,
            events: observation.events,
            toolResults: observation.toolResults,
            actionEvidence: observation.actionEvidence,
            proposal: observation.events.find(event => event.type === "proposal"),
          })}\n`, "utf8");
        }
        const safe = sanitizeAlexaEvaluationArtifact({ records: [observation] }).records[0];
        if (safe) safeRecords.push(safe);
        observedOrigins.push(...observation.knowledgeTraces.map(trace => ({ knowledgeTraces: [trace] })));
        return { observation, sessionState: { conversationId } };
      },
      evaluateScenario: async ({ scenario, observations }) => {
        const evaluated = evaluateV8AdversarialScenario({
          scenario,
          observations,
          knowledgeSources: inputs.knowledgeSources,
          privateOracles: inputs.privateOracles,
          snapshot: inputs.snapshot,
        });
        if (evaluated.evaluatorSha256 !== evaluatorSha256) throw new Error("Adversarial evaluator binding changed");
        oracleResults.set(scenario.id, evaluated.oracleResults);
        return {
          status: evaluated.status,
          oracleCount: evaluated.oracleCount,
          passingOracleCount: evaluated.passingOracleCount,
          evaluatorSha256: evaluated.evaluatorSha256,
        };
      },
    });
    await persist(progress);
    const coverage = evaluateV8KnowledgeOriginCoverage(observedOrigins);
    const counts = tally(progress);
    const perOracle = oracleStatusCounts();
    const everyOraclePassed = Object.values(perOracle).every(group => group.total > 0 && group.PASS === group.total);
    const complete = progress.cases.length === inputs.manifest.cases.length && progress.cases.every(item => item.status === "PASS") && everyOraclePassed;
    const report = sanitizeAlexaEvaluationArtifact({
      version: 1,
      status: counts.FAIL ? "FAIL" : complete && coverage.status === "PASS" ? "PASS"
        : counts["NOT RUN"] ? "PARTIAL" : "NOT VERIFIED",
      run,
      tally: counts,
      oracleStatusCounts: perOracle,
      knowledgeOriginCoverage: coverage,
      rows: inputs.manifest.cases.map(reportRow),
      records: safeRecords,
    });
    await writeAtomic(reportPath, report);
    process.stdout.write(JSON.stringify({
      status: report.status,
      tally: counts,
      oracleStatusCounts: report.oracleStatusCounts,
      knowledgeOriginCoverage: coverage.status,
      directReadKnowledge: coverage.direct,
      agentToolReadKnowledge: coverage.agentTool,
      report: basename(reportPath),
      progress: basename(progressPath),
      database: target.database,
      databaseSnapshot: target.databaseSnapshot,
      migrationInventory: target.migrationInventory,
      databaseBindingSha256,
      resumeBindingStatus: run.resumeBindingStatus,
      physicalPrinting: "NOT VERIFIED",
      authenticatedUiActionConfirmation: "NOT RUN",
      ...(answerTranscriptPath ? { answers: basename(answerTranscriptPath) } : {}),
    }) + "\n");
  } finally {
    await api.releaseLocalModel();
    await api.fermerPool();
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    if (args.includes("--validate-only")) await validateOnly();
    else await runCampaign();
  } catch (error) {
    if (process.env["ALEXA_EVAL_DEBUG"] === "1") console.error(error);
    const code = error instanceof Error && /^[A-Za-z][A-Za-z0-9_-]{0,80}$/u.test(error.message)
      ? error.message : "AlexaV8AdversarialRunnerFailed";
    const systemCode = error && typeof error === "object" &&
      typeof error.code === "string" && /^[A-Za-z0-9_-]{1,32}$/u.test(error.code) ? error.code : null;
    process.stderr.write(`${code}${systemCode ? ` errorCode=${systemCode}` : ""}\n`);
    process.exitCode = 1;
  }
}
