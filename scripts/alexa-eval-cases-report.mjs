// Writes docs/alexa/evaluation/campaign-cases.md from a finished L4 campaign run, so that the file can
// be read by a person. Questions are copied verbatim from the frozen manifest. Patient identifiers are
// masked, and book passages are replaced by the section and page they cite.
//
//   node scripts/alexa-eval-cases-report.mjs <run id>   with MINDCARE_ALEXA_EVAL_ADMIN_URL set
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

const require = createRequire(import.meta.url);
const root = process.cwd(), runId = process.argv[2];
if (!/^[0-9a-f-]{36}$/u.test(runId ?? "")) throw new Error("usage: alexa-eval-cases-report.mjs <run id>");
const out = join(root, ".eval-out", "alexa-v8-upgrade"), base = join(out, `adversarial-${runId}`);
const report = JSON.parse(readFileSync(`${base}.report.json`, "utf8"));
const answers = readFileSync(`${base}.answers.jsonl`, "utf8").trim().split("\n").map(line => JSON.parse(line));
const manifest = require(join(root, "tests", "eval", "alexa-v9-adversarial-300.cjs"));
const oracleCases = JSON.parse(readFileSync(join(out, "private-oracles-v1.json"), "utf8")).cases;
const privateOracle = new Map((Array.isArray(oracleCases) ? oracleCases : Object.entries(oracleCases).map(([id, value]) => ({ id, ...value }))).map(item => [item.id, item]));
const readJson = file => JSON.parse(readFileSync(join(root, "tests", "eval", file), "utf8").replace(/^﻿/u, ""));
const golden = new Map(readJson("knowledge.books-v4-2026-10-28.json").cas.map(item => [item.id, item]));

const client = new pg.Client({ connectionString: process.env.MINDCARE_ALEXA_EVAL_ADMIN_URL });
await client.connect();
const nonSynthetic = (await client.query("SELECT count(*)::int AS n FROM app.patients WHERE NOT is_synthetic")).rows[0].n;
if (nonSynthetic !== 0) throw new Error("Refusing to report from a database holding non-synthetic patients");
const people = (await client.query("SELECT first_name, last_name, phone, phone_alt, record_number, birth_date::text AS birth FROM app.patients")).rows;
const staff = (await client.query("SELECT coalesce(full_name, '') AS name FROM app.profiles")).rows;
await client.end();

// Words that also happen to be test names must stay readable.
const common = new Set(["pour", "dans", "avec", "sans", "date", "sous", "mais", "plus", "test", "patient", "patiente", "aucun", "aucune", "dose", "note", "notes", "mois", "jour", "jours", "lire", "voir", "cette", "elle", "elles", "tout", "tous", "toute", "sont", "dossier", "consultation", "traitement"]);
const fold = value => value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
// The manifest holds placeholders, never a name, so its vocabulary is safe to keep.
for (const item of manifest.cases) for (const turn of item.turns) for (const word of turn.match(/\p{L}[\p{L}\p{M}]{2,}/gu) ?? []) common.add(fold(word));
const names = new Set(), literals = new Set();
for (const person of people) {
  for (const part of [person.first_name, person.last_name]) for (const token of String(part ?? "").split(/[\s,;.'’-]+/u)) if (token.length >= 3 && !common.has(fold(token))) names.add(fold(token));
  for (const value of [person.phone, person.phone_alt, person.record_number, person.birth]) if (value && String(value).length >= 4) literals.add(String(value));
}
for (const person of staff) for (const token of String(person.name).split(/\s+/u)) if (token.length >= 3 && !common.has(fold(token))) names.add(fold(token));
function scrub(text) {
  let masked = String(text ?? "");
  for (const literal of literals) if (masked.includes(literal)) masked = masked.split(literal).join("[masqué]");
  masked = masked.replace(/(Voici les \d+ premiers noms\.).*/su, "$1 [liste masquée]").replace(/\b[A-Z]{2,5}-\d{4}-\d+\b/gu, "[numéro]");
  masked = masked.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/giu, "[id]").replace(/\b0[5-7]\d{8}\b/gu, "[téléphone]");
  return masked.replace(/\p{L}[\p{L}\p{M}]{2,}/gu, word => names.has(fold(word)) ? "[nom]" : word);
}
const cell = text => String(text ?? "").replace(/\s+/gu, " ").replace(/\|/gu, "\\|").trim();
const clip = (text, size) => text.length > size ? `${text.slice(0, size)}…` : text;

/** Book passages stay in the books: the answer is described by what it cites. */
function describeAnswer(text) {
  if (!/Passage cité \(/u.test(text)) return clip(scrub(text), 260);
  const sections = [...new Set([...text.matchAll(/Passage cité \((.+?)\)\s*:/gu)].map(match => match[1]))];
  const pages = [...new Set([...text.matchAll(/\(p\. (\d+)\)/gu)].map(match => match[1]))];
  return `Liste ${sections.length} passage(s), sans réponse rédigée : ${clip(sections.map(section => section.split("›").slice(-2).join("›").trim()).join(" ; "), 200)}. Pages citées : ${pages.join(", ") || "aucune"}.`;
}
const MASKED = "valeur du dossier de test, masquée";
function describeAssertion(item) {
  switch (item.kind) {
    case "exact_count": return `Compte exact : ${item.value}${item.subject ? ` (${item.subject})` : ""}.`;
    case "exact_amount_dzd": return `Montant exact : ${item.value} DZD.`;
    case "exact_boolean": return `Réponse exacte : ${item.value ? "oui" : "non"}.`;
    case "exact_partition": return `Répartition exacte : ${item.withPhone} avec téléphone, ${item.withoutPhone} sans.`;
    case "exact_patient_set": return `Liste exacte de ${item.count} patient(s) (noms masqués).`;
    case "exact_patient": return "Fiche du patient de référence (valeurs masquées).";
    case "exact_value": return `Champ \`${item.field}\` : ${/^patients\.|phone|address|email|name/u.test(item.field ?? "") ? MASKED : item.value}.`;
    case "exact_values": return `${(item.values ?? []).length} valeur(s) exacte(s) (${MASKED}).`;
    case "exact_presence": return `Champ \`${item.field}\` : ${item.present ? "renseigné" : "absent"}.`;
    case "missing_fields": return `Champs à signaler comme absents : ${(item.fields ?? []).join(", ")}.`;
    case "clinical_facts": return "Faits cliniques du dossier de test, tirés des lignes sources (masqués).";
    case "source_rows": case "exact_rows": return `Exactement ${(item.rows ?? []).length} ligne(s) de la base (contenu masqué).`;
    case "latest_and_previous": return "Dernière consultation et précédente, distinguées (contenu masqué).";
    case "expected_action": return `Action \`${item.action}\`, résultat attendu \`${item.outcome}\`.`;
    case "turn_stage": return `Tour ${item.turnIndex + 1} : \`${item.outcome}\`${item.slot ? `, information manquante \`${item.slot}\`` : ""}${item.mutates === false ? ", sans écriture" : ""}.`;
    default: return null;
  }
}
function describeOracle(oracle) {
  if (oracle.kind === "knowledge_case") {
    const source = golden.get(oracle.caseId);
    if (oracle.answerable === false || source?.answerable === false) return { text: "S'abstenir : ni livre ni dossier ne contient la réponse.", clinical: false };
    const section = (source?.attendu?.section ?? []).map(group => group.join(" ou ")).join(" › ");
    return { text: `Passage de **${source?.attendu?.source ?? "?"}**${section ? `, section ${section}` : ""}, page résolue, citation exacte (cas \`${oracle.caseId}\`).`, clinical: true };
  }
  if (oracle.kind === "route_contract") return { text: `Filière attendue : \`${oracle.expectedPipeline}\`. Aucune sortie réseau.`, clinical: false };
  if (oracle.kind === "retrieval_contract") return { text: "Traces de recherche complètes et pages citées qui existent.", clinical: false };
  if (oracle.kind === "clinical_contract" || oracle.kind === "action_contract" || oracle.kind === "snapshot_case") {
    const frozen = (privateOracle.get(oracle.sourceCaseId)?.assertions ?? []).map(describeAssertion).filter(Boolean);
    const rules = oracle.rules ? `Règles : ${oracle.rules.map(rule => `\`${rule}\``).join(", ")}.` : "";
    const clinical = oracle.kind === "clinical_contract" || (privateOracle.get(oracle.sourceCaseId)?.assertions ?? []).some(item => item.kind === "clinical_facts");
    return { text: [...new Set(frozen)].slice(0, 3).concat(rules).filter(Boolean).join(" ") || "Assertion figée sur l'instantané de la base.", clinical };
  }
  return { text: oracle.kind, clinical: false };
}
const explain = {
  answer_present: "Aucune réponse publiée.", answer_evidence: "Réponse non établie à partir des preuves.", source: "Source ou section citée différente de celle attendue.",
  page: "Page citée absente ou non résolue.", book_title_omitted: "Le titre du livre apparaît dans la réponse alors qu'il était à omettre.", retrieval_succeeded: "La recherche n'a pas trouvé de preuve.",
  retrieval_observed: "Aucune recherche observée : le passage n'a pas été vérifié.", frozen_assertion: "Réponse différente de la valeur attendue.", expected_pipeline: "Mauvaise filière : le tour n'a pas suivi la route attendue.",
  page_attribution: "Page non attribuée à la preuve.", frozen_expected_action_outcome: "L'issue de l'action diffère de celle attendue.",
};
const notVerifiedAction = "Action non exécutée dans cette campagne : les écritures exigent `ALEXA_EVAL_EXECUTE_ACTIONS=1` sur une base dédiée.";
function explanation(row) {
  if (row.status === "PASS") {
    const amended = row.oracleChecks.flatMap(item => item.checks).some(check => check.originalRule);
    return amended ? "PASS selon la règle modifiée ; NOT VERIFIED selon la règle d'origine (citation seule, sans réponse rédigée)." : "";
  }
  const open = row.oracleChecks.flatMap(item => item.checks.map(check => ({ ...check, kind: item.kind }))).filter(check => check.status !== "PASS");
  if (row.status === "NOT VERIFIED" && open.every(check => check.kind === "action_contract")) return notVerifiedAction;
  return [...new Set(open.map(check => `${explain[check.id.replace(/_\d+$/u, "")] ?? check.id} (${check.status})`))].join(" ");
}
const titles = { knowledge: "Knowledge", retrieval: "Retrieval", mixed: "Mixed intent", followups: "Follow-ups", model_routing: "Routing", patient_consultation: "Patient and consultation", agenda: "Agenda", finance: "Finance", documents_printing: "Documents and printing", actions: "Actions" };
const rows = new Map(report.rows.map(row => [row.id, row]));
const answersOf = id => answers.filter(item => item.caseId === id).sort((a, b) => a.turnNumber - b.turnNumber);

const lines = [`# Evaluation campaign: every case`, "",
  `Generated by \`scripts/alexa-eval-cases-report.mjs\` from run \`${runId}\`, started ${report.run.startedAt}. Don't edit by hand.`, "",
  "- **Input:** copied from `tests/eval/alexa-v9-adversarial-300.cjs`. `[PATIENT_A]` and similar are placeholders for test patients. ` ⏎ ` separates the turns of one case.",
  "- **Validation:** `Auto` means the expected result is a count, a database value or a contract computed from the test database. `NOT CLINICALLY APPROVED` means a clinician hasn't validated it. No expected result in this file has been signed by Dr. Larbi.",
  "- **Actual:** the last answer, shortened. Names, phone numbers, record numbers, birth dates and document numbers are masked; a name too short to recognize can slip through in free text. Book passages are replaced by the section and page they cite.",
  "- **Comparing with the baseline:** `PASS` here uses the amended rule, under which a correct citation without a written answer counts. Rows saying so were `NOT VERIFIED` under the original rule.", "",
  "| Result | Cases |", "|---|---|"];
const tally = report.tally ?? {};
for (const [name, count] of Object.entries(tally)) lines.push(`| ${name} | ${count} |`);
if (report.passingUnderOriginalRule !== undefined) lines.push(`| PASS under the original rule | ${report.passingUnderOriginalRule} |`);
lines.push("");
for (const [category, title] of Object.entries(titles)) {
  const cases = manifest.cases.filter(item => item.category === category);
  const counts = { PASS: 0, FAIL: 0, "NOT VERIFIED": 0 };
  for (const item of cases) counts[rows.get(item.id)?.status] = (counts[rows.get(item.id)?.status] ?? 0) + 1;
  lines.push(`## ${title}: ${counts.PASS} PASS, ${counts.FAIL} FAIL, ${counts["NOT VERIFIED"]} NOT VERIFIED`, "", "| ID | Input | Expected | Validation | Actual | Result | Why |", "|---|---|---|---|---|---|---|");
  for (const item of cases) {
    const row = rows.get(item.id), described = (item.oracles ?? []).map(describeOracle);
    const last = answersOf(item.id).at(-1)?.answer ?? "";
    lines.push(`| ${item.id} | ${cell(item.turns.join(" ⏎ "))} | ${cell(scrub(described.map(entry => entry.text).join(" ")))} | ${described.some(entry => entry.clinical) ? "**NOT CLINICALLY APPROVED**" : "Auto"} | ${cell(describeAnswer(last)) || "(no answer)"} | ${row?.status ?? "NOT RUN"} | ${cell(row ? explanation(row) : "")} |`);
  }
  lines.push("");
}

// The conversation and retrieval layers keep their own files.
const transform = join(root, ".eval-out", "alexa-transform");
const conversationLabel = process.argv[3];
const flows = readJson(join("alexa-transform", "v1", "conversation-flows.json")).flows;
const conversationFile = conversationLabel ? join(transform, `conversation-${conversationLabel}.json`) : null;
const conversation = conversationFile && existsSync(conversationFile) ? new Map(JSON.parse(readFileSync(conversationFile, "utf8")).results.map(result => [result.id, result])) : new Map();
lines.push(`## Multi-turn conversations (L3)${conversationLabel ? `, run \`${conversationLabel}\`` : ""}`, "", "`{name}` stands for a test patient.", "", "| Turn | Input | Expected | Result | Failed checks |", "|---|---|---|---|---|");
for (const flow of flows) for (const [index, turn] of flow.turns.entries()) {
  const id = `${flow.id}#${index + 1}`, result = conversation.get(id);
  const expected = [turn.tool && `outil \`${turn.tool}\``, turn.alsoTool && `et \`${turn.alsoTool}\``, turn.noTool && "aucun outil", turn.noPatientRead && "aucune lecture de dossier", turn.patient && `patient ${turn.patient === "target" ? "visé" : "autre que le visé"}`, turn.textMatches && `texte : \`${turn.textMatches}\``, turn.evidence && `preuve de ${turn.evidence}`, turn.cited && "passage cité"].filter(Boolean).join(", ");
  lines.push(`| ${id} | ${cell(turn.text)} | ${cell(expected) || "réponse non vide"} | ${result ? (result.pass ? "PASS" : "FAIL") : "NOT RUN"} | ${result ? cell(Object.entries(result.checks).filter(([, ok]) => !ok).map(([name]) => name).join(", ")) : ""} |`);
}
lines.push("");
const sets = [["fr-en-retrieval.json", "tuned"], ["fr-en-holdout.json", "held out 1"], ["fr-en-holdout-2.json", "held out 2"], ["fr-en-holdout-3.json", "held out 3"], ["fr-en-answers-holdout-4.json", "answers 4, tuned"], ["fr-en-answers-holdout-5.json", "answers 5, independent"]];
lines.push("## French questions, English sources (L2)", "", "Expected: a passage from this source and section within the first five. The source and section come from the dataset; a clinician hasn't validated them, so all are **NOT CLINICALLY APPROVED**. Scores are in `08-baseline-results.md`.", "", "| Set | ID | Question | Source | Section |", "|---|---|---|---|---|");
for (const [file, label] of sets) for (const item of readJson(join("alexa-transform", "v1", file)).cases) lines.push(`| ${label} | ${item.id} | ${cell(item.question)} | ${cell(item.source ?? "S'abstenir")} | ${cell((item.section ?? []).join(" › "))} |`);
lines.push("");
mkdirSync(join(root, "docs", "alexa", "evaluation"), { recursive: true });
const target = join(root, "docs", "alexa", "evaluation", "campaign-cases.md"), body = `${lines.join("\n")}\n`;
for (const person of people) for (const value of [person.phone, person.record_number]) if (value && String(value).length >= 6 && body.includes(String(value))) {
  const at = body.indexOf(String(value));
  throw new Error(`An identifier survived masking, after: ${body.slice(Math.max(0, at - 80), at)}`);
}
writeFileSync(target, body);
console.log(`${target}: ${manifest.cases.length} campaign cases, ${body.length} characters`);
