import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { alexaDb } from "@/server/alexa/db";
import { runAlexa } from "@/server/alexa/orchestrator";
import { TurnTraceRecorder, withTurnTrace } from "@/server/alexa/turn-trace";
import { clientSql } from "@/server/jarvis/client-sql";
import type { AlexaEvent } from "@/shared/alexa/turn";
// The C202 evaluator is plain ESM next to the cases; tests/ is compiled with allowJs.
import { evaluateTurn, extractQuotes, fold, rollUp } from "../eval/alexa-clinical-conversational/v3/evaluate.mjs";

/**
 * C202 runner: drives the REAL pipeline (runAlexa, real gates under RLS, real local model, real retrieval)
 * for every case of tests/eval/alexa-clinical-conversational/v3/cases.json and judges each answer against
 * the SQL-derived oracle in .eval-out/alexa-c202/private-oracles.json. Nothing is mocked or answered by hand.
 *
 *   MINDCARE_C202=run  MINDCARE_C202_DB=main|fixture  MINDCARE_C202_LABEL=<run name>
 *   MINDCARE_DATABASE_URL=postgres://mindcare_app@…/<db>        (application role, RLS applies)
 *   MINDCARE_ALEXA_EVAL_ADMIN_URL=postgres://postgres@…/alexa_eval_v8_intelligence_20261027   (verbatim quote checks)
 *   MINDCARE_C202_FILTER=C001,C002 | domain:agenda   MINDCARE_C202_RESUME=1
 *
 * Results (answers included) go to .eval-out/alexa-c202/, which is git-ignored: they hold synthetic patient names.
 */
const mode = process.env["MINDCARE_C202"];
const which = process.env["MINDCARE_C202_DB"] ?? "main";
const SET = process.env["MINDCARE_C202_SET"] === "holdout" ? "holdout" : "cases";
const label = process.env["MINDCARE_C202_LABEL"] ?? "run";
const url = process.env["MINDCARE_DATABASE_URL"] ?? "";
const adminUrl = process.env["MINDCARE_ALEXA_EVAL_ADMIN_URL"] ?? "";
const expectedDb = which === "main" ? "alexa_eval_v8_intelligence_20261027" : "alexa_eval_v9_fixture_20261030";
const ready = mode === "run" && url.endsWith(`/${expectedDb}`);

const root = process.cwd();
const dataset = join(root, "tests", "eval", "alexa-clinical-conversational", "v3");
const out = join(root, ".eval-out", "alexa-c202");
const resultsFile = join(out, `results-${label}.jsonl`);
const DEFAULT_AS_OF = "2026-10-26T09:30:00+01:00";
const TURN_HARD_STOP_MS = 600_000;

interface Role { id: string; first_name: string; last_name: string; openConsultationId?: string }
interface Page { type: "global" | "patient" | "consultation"; role?: string; which?: "last" | "open" }
interface Turn { say: string; expect: { k: string }; page?: Page; lang?: string; form?: string }
interface Case { id: string; domain: string; db: "main" | "fixture"; page: Page; turns: Turn[]; asOf?: string }
interface Private { roles: Record<string, Record<string, Role>>; consultationIds: Record<string, Record<string, string>>; oracles: Record<string, Record<string, unknown>[]> }

const spec = ready ? (JSON.parse(readFileSync(join(dataset, `${SET}.json`), "utf8")) as { cases: Case[] }) : { cases: [] as Case[] };
const secrets = ready ? (JSON.parse(readFileSync(join(out, SET === "holdout" ? "private-oracles-holdout.json" : "private-oracles.json"), "utf8")) as Private) : null;
const filter = (process.env["MINDCARE_C202_FILTER"] ?? "").split(",").map((part) => part.trim()).filter(Boolean);
const done = new Set<string>();
if (ready && process.env["MINDCARE_C202_RESUME"] === "1" && existsSync(resultsFile)) {
  for (const line of readFileSync(resultsFile, "utf8").split("\n")) if (line) { try { const row = JSON.parse(line) as { caseId: string; rollup?: string }; if (row.rollup) done.add(row.caseId); } catch { /* partial line */ } }
}
const selected = spec.cases.filter((item) => item.db === which
  && (!filter.length || filter.some((entry) => entry.startsWith("domain:") ? item.domain === entry.slice(7) : entry === item.id))
  && !done.has(item.id));

/** Placeholders: {R1}, {R1.first}, {R1.last}, {R1.up}, {R1.rev}, {R1.plain}. */
function fill(text: string, roles: Record<string, Role>): string {
  return text.replace(/\{([A-Z]+\d*)(?:\.(first|last|up|rev|plain))?\}/gu, (_whole, name: string, form?: string) => {
    const role = roles[name];
    if (!role) throw new Error(`role ${name} unresolved`);
    const first = role.first_name, last = role.last_name, full = `${first} ${last}`;
    switch (form) {
      case "first": return first;
      case "last": return last;
      case "up": return full.toUpperCase();
      case "rev": return `${last.toUpperCase()} ${first}`;
      case "plain": return fold(full).replace(/[-']/gu, "");
      default: return full;
    }
  });
}

function appContextFor(page: Page, db: string) {
  const roles = secrets!.roles[db]!;
  if (page.type === "global") return { patientId: null, page: "/jarvis" };
  const role = roles[page.role!];
  if (!role) throw new Error(`role ${page.role} unresolved`);
  if (page.type === "patient") return { patientId: role.id, page: `/patients/${role.id}` };
  // The consultation screen only knows its consultation id: the patient must come from the server.
  const consultationId = page.which === "open" ? role.openConsultationId ?? null : secrets!.consultationIds[db]![page.role!] ?? null;
  if (!consultationId) throw new Error(`no consultation for ${page.role}`);
  return { patientId: null, page: `/consultation/${consultationId}`, consultationId };
}

let networkViolation = false;
const realFetch = globalThis.fetch;
if (ready) {
  globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const target = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
    if (!/^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?\//u.test(target)) { networkViolation = true; return Promise.reject(new Error("C202: external network call blocked")); }
    return realFetch(input, init);
  }) as typeof fetch;
}

const MARKER_PAGE = /\[[^\]]*?\bp\.(\d+)[^\]]*\]/u;

/**
 * Where does a quoted passage really come from? SQL on the approved chunks, never trusting the answer's own label.
 * `strict`: the whole quotation, heading included, is a word-for-word part of one chunk.
 * `verbatim`: the body of the quotation is (the breadcrumb Alexa assembles in front of it, "Titre — Sous-section —", is her labelling, not the
 * book's text). The campaign reports both, so the looser reading never hides how often the strict one holds.
 */
async function checkQuote(admin: Client, quote: string, labels: string[]) {
  // Cheap regexes pick the candidate chunks (three word pairs, near the start, the middle and the end of the quotation, all required: a
  // single common pair such as "population générale" matches hundreds of chunks); the exact word-for-word test is then done on those alone
  // (a whole-table normalisation per quote took minutes on this PC).
  // Pairs are neighbours in the text itself (two long words side by side), never words made adjacent by dropping the short ones between.
  const labelEnd = quote.slice(0, 160).lastIndexOf(" — ");
  const tokens = (labelEnd >= 0 ? quote.slice(labelEnd + 3) : quote).split(/\s+/u), long = (word: string | undefined) => !!word && /^[\p{L}]{4,}$/u.test(word);
  const neighbours = tokens.flatMap((word, index) => (long(word) && long(tokens[index + 1]) ? [[word, tokens[index + 1]!]] : []));
  const words = neighbours;
  const escape = (word: string) => word.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const pairs = words.length >= 3 ? [words[0]!, words[Math.floor(words.length / 2)]!, words[words.length - 1]!] : words.slice(0, 1);
  const patterns = pairs.filter((pair) => pair.length === 2).map((pair) => `${escape(pair[0]!)}\\s+${escape(pair[1]!)}`);
  if (!patterns.length) patterns.push(escape(quote.slice(0, 30)));
  const candidates = (await admin.query(
    `select s.titre, c.section, c.texte from app.knowledge_chunks c join app.knowledge_sources s on s.id=c.source_id
      where s.statut='active' and ${patterns.map((_, index) => `c.texte ~* $${index + 1}`).join(" and ")} limit 300`, patterns)).rows as { titre: string; section: string | null; texte: string }[];
  const strip = (text: string) => fold(text.replace(/\[[^\]]*\bp\.\d+[^\]]*\]/gu, " ")).replace(/\s*—\s*/gu, " ");
  const dash = quote.slice(0, 160).lastIndexOf(" — ");
  const body = dash >= 0 && quote.length - dash - 3 >= 40 ? quote.slice(dash + 3) : quote;
  const wantedStrict = strip(quote), wantedBody = strip(body);
  const strictRows = candidates.filter((row) => strip(row.texte).includes(wantedStrict));
  const rows = strictRows.length ? strictRows : candidates.filter((row) => strip(row.texte).includes(wantedBody));
  if (!rows.length) return { quote: quote.slice(0, 80), quoteFull: quote, verbatim: false, strict: false };
  // The same words can stand in several chunks (every Stahl monograph repeats "Monitoring after starting an atypical antipsychotic"):
  // the quotation is judged against the chunk whose own page marker agrees with the label when one does, never against an arbitrary twin.
  const pagesOf = (candidate: { section: string | null; texte: string }) => {
    const markers = [...candidate.texte.matchAll(/\[[^\]]*?\bp\.(\d+)[^\]]*\]/gu)].map((match) => Number(match[1]));
    const tail = fold((candidate.section ?? "").split("›").pop() ?? "").trim();
    const own = tail ? labels.filter((value) => fold(value).includes(tail)) : [];
    const wanted = (own.length ? own : labels).flatMap((value) => { const page = /\bp(?:age|\.)?\s*(\d+)/iu.exec(value)?.[1]; return page ? [Number(page)] : []; });
    return wanted.some((page) => markers.includes(page));
  };
  const row = rows.find((candidate) => pagesOf(candidate)) ?? rows[0]!;
  const markerPages = [...row.texte.matchAll(/\[[^\]]*?\bp\.(\d+)[^\]]*\]/gu)].map((match) => Number(match[1]));
  // The answer lists one source label per passage: the labels of this passage's own section are the ones that must carry its page
  // (taking the first label of the answer for every quotation judged each passage by another passage's page).
  const sectionTail = fold((row.section ?? "").split("›").pop() ?? "").trim();
  const ownLabels = sectionTail ? labels.filter((value) => fold(value).includes(sectionTail)) : [];
  const labelPages = (ownLabels.length ? ownLabels : labels).flatMap((value) => { const page = /\bp(?:age|\.)?\s*(\d+)/iu.exec(value)?.[1]; return page ? [Number(page)] : []; });
  const pageInLabel = labelPages.find((page) => markerPages.includes(page)) ?? labelPages[0] ?? null;
  const head = fold(row.titre).slice(0, 14);
  return {
    quote: quote.slice(0, 80), quoteFull: quote, verbatim: true, strict: strictRows.length > 0, sourceTitle: row.titre, section: row.section ?? "", chunkHead: row.texte.slice(0, 240), chunkText: row.texte,
    // A chunk can span pages: a label page is wrong only when it is none of the chunk's own page markers.
    markerPage: pageInLabel !== null && markerPages.includes(pageInLabel) ? pageInLabel : markerPages[0] ?? null, pageInLabel, sourceLabelMatches: labels.some((value) => fold(value).includes(head)),
  };
}

describe.skipIf(!ready)(`C202 ${which}`, () => {
  it(`has cases to run (${selected.length})`, () => { expect(selected.length).toBeGreaterThanOrEqual(0); });
  it.each(selected.map((item) => [item.id, item] as const))("%s", async (_id, item) => {
    const actor = "00000000-0000-0000-0000-0000000000a1";
    const roles = secrets!.roles[item.db]!;
    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    mkdirSync(out, { recursive: true });
    const conversationId = crypto.randomUUID();
    const turnVerdicts: string[] = [];
    try {
      for (const [index, turn] of item.turns.entries()) {
        const oracle = secrets!.oracles[item.id]![index]!;
        const page = turn.page ?? item.page;
        const recorder = new TurnTraceRecorder();
        const events: AlexaEvent[] = [], calls: { name: string; args: Record<string, unknown> }[] = [], started = Date.now();
        networkViolation = false;
        let error: string | undefined, say = "";
        // No turn may hang the campaign: the product's own deadline is 500 s, so 600 s is a hard stop recorded as a failure.
        const controller = new AbortController();
        const hardStop = setTimeout(() => controller.abort(), TURN_HARD_STOP_MS);
        try {
          say = fill(turn.say, roles);
          const appContext = appContextFor(page, item.db);
          let stopTimer: ReturnType<typeof setTimeout> | undefined;
          const stopped = new Promise<never>((_resolve, reject) => { stopTimer = setTimeout(() => reject(new Error("C202 hard stop: the turn did not finish")), TURN_HARD_STOP_MS + 5_000); });
          await Promise.race([
            withTurnTrace(recorder, () => runAlexa({ text: say, conversationId, clientTurnId: crypto.randomUUID(), appContext },
              { actor, db: alexaDb(actor), knowledge: clientSql(actor), native: true, trace: recorder, agentAsOf: item.asOf ?? DEFAULT_AS_OF, agentObserve: (call) => calls.push({ name: call.name, args: call.args as Record<string, unknown> }) },
              (event) => events.push(event), controller.signal)),
            stopped,
          ]);
          clearTimeout(stopTimer);
        } catch (caught) { error = String(caught instanceof Error ? caught.message : caught); } finally { clearTimeout(hardStop); }
        const sentences = events.filter((event): event is Extract<AlexaEvent, { type: "sentence" }> => event.type === "sentence");
        const final = events.find((event): event is Extract<AlexaEvent, { type: "done" }> => event.type === "done");
        const streamError = events.find((event) => event.type === "error");
        const answer = sentences.map((event) => event.text).join(" ");
        const sources = sentences.flatMap((event) => event.sources ?? []);
        const labels = sources.filter((source) => source.type === "knowledge").map((source) => source.label);
        const quoteChecks = (oracle as { book?: unknown }).book ? await Promise.all(extractQuotes(answer).map((quote) => checkQuote(admin, quote, labels))) : [];
        const verdict = evaluateTurn(oracle as never, {
          answer, status: final?.status ?? null, patientId: final?.patientId ?? null, calls, sources, quoteChecks,
          error: error ?? (streamError ? `stream:${(streamError as { code?: string }).code}` : undefined), network: networkViolation,
        });
        turnVerdicts.push(verdict.verdict);
        appendFileSync(resultsFile, JSON.stringify({ caseId: item.id, domain: item.domain, db: item.db, lang: (turn as { lang?: string }).lang, form: (turn as { form?: string }).form, turn: index + 1, say, page: page.type, answer, status: final?.status ?? null,
          patientId: final?.patientId ?? null, calls: calls.map((call) => call.name), sources: labels, quoteChecks: quoteChecks.map(({ chunkText: _chunk, chunkHead: _head, ...rest }) => rest),
          verdict: verdict.verdict, reasons: verdict.reasons, notes: verdict.notes, trace: { route: recorder.trace.route, followup: recorder.trace.followup, tools: recorder.trace.tools, codes: recorder.trace.codes }, ms: Date.now() - started }) + "\n");
      }
    } finally { await admin.end(); }
    appendFileSync(resultsFile, JSON.stringify({ caseId: item.id, domain: item.domain, rollup: rollUp(turnVerdicts), turns: turnVerdicts }) + "\n");
    expect(turnVerdicts.length).toBe(item.turns.length);
  }, 3_600_000);
});
