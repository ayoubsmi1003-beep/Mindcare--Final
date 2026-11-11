/**
 * Which closed read a request MEANS, when the word-based frames did not recognise its wording.
 *
 * Two local steps, no network (rule 1), no new dependency:
 *  1. a SHORTLIST of the 8 closest catalogue intents under the e5 model already loaded for the books
 *     (centred vectors, nearest class centroid);
 *  2. ONE closed-choice call to the local model, whose output is constrained to those 8 ids or "none".
 *
 * Why not e5 alone: measured on the catalogue's own paraphrases (leave-one-out, doc 20), nearest neighbours under e5-base pick
 * the right intent 53 % of the time at best; short French questions about one patient all embed close together. The right
 * intent is however among the 8 closest 97 % of the time, which makes e5 a good SHORTLIST and a poor JUDGE.
 * Why not the existing agent loop: it chains 2 to 5 model calls with tool schemas (30 to 350 s on the doctor's PC); one
 * constrained choice is a few seconds and returns an id, never prose.
 *
 * The result only chooses a closed question. The frames' own renderers write it, the deterministic path runs it, and every read
 * keeps its audited gate (rule 4). Only READ intents exist in the catalogue (rule 7). With no e5 vector or no model answer the
 * layer returns nothing and the turn behaves exactly as before.
 */
import { z } from "zod";
import { INTENT_CATALOGUE, type CatalogueIntent } from "@/shared/alexa/intent-catalogue";
import { unknownNameRuns } from "@/shared/alexa/patient-question";
import { intentChoicePrompt } from "@/i18n/alexa-agent";
import { inferTextForTask } from "./inference/registry";

export type Embed = (text: string) => Promise<readonly number[] | null>;
export type Choose = (text: string, shortlist: readonly CatalogueIntent[], signal: AbortSignal) => Promise<string | null>;

export const SHORTLIST = 8;
/** Calibrated for intfloat/multilingual-e5-base (768d). Another space means another calibration: the layer stays off. */
export const SEMANTIC_RECIPE = "e5-base";

/** Names never shape an intent: the masked form is what the catalogue's "[X]" examples look like. */
export function maskNames(text: string): string {
  let masked = text.replace(/\[X\]/gu, "X");
  for (const run of unknownNameRuns(text)) if (run.words.length >= 2 || run.upper) masked = masked.replace(run.words.join(" "), "X");
  return masked;
}

const dot = (a: readonly number[], b: readonly number[]) => { let sum = 0; for (let i = 0; i < a.length; i++) sum += a[i]! * b[i]!; return sum; };
const unit = (a: readonly number[]) => { const n = Math.sqrt(dot(a, a)); return n ? a.map((x) => x / n) : [...a]; };
const meanOf = (vectors: readonly (readonly number[])[]) => { const m = new Array<number>(vectors[0]!.length).fill(0); for (const v of vectors) v.forEach((x, i) => { m[i]! += x / vectors.length; }); return m; };

interface Bank { readonly mean: readonly number[]; readonly centroids: readonly { readonly intent: CatalogueIntent; readonly c: readonly number[] }[] }
let bankPromise: Promise<Bank | null> | null = null;
let bankEmbed: Embed | null = null;

/** The catalogue embedded once per process and reduced to one centred centroid per intent. */
async function bank(embed: Embed): Promise<Bank | null> {
  if (bankPromise && bankEmbed === embed) return bankPromise;
  bankEmbed = embed;
  bankPromise = (async () => {
    const rows: { intent: CatalogueIntent; v: readonly number[] }[] = [];
    for (const intent of INTENT_CATALOGUE) for (const example of intent.examples) {
      const v = await embed(maskNames(example));
      if (!v) return null;
      rows.push({ intent, v });
    }
    // e5 vectors share a large common direction; removing it is what makes their differences readable.
    const mean = meanOf(rows.map((row) => row.v));
    const centroids = INTENT_CATALOGUE.map((intent) => ({ intent, c: unit(meanOf(rows.filter((row) => row.intent === intent).map((row) => unit(row.v.map((x, i) => x - mean[i]!))))) }));
    return { mean, centroids };
  })().catch(() => null);
  return bankPromise;
}

/** The SHORTLIST catalogue intents closest to the request, best first; null when no vector can be computed. */
export async function shortlistIntents(text: string, embed: Embed, size = SHORTLIST): Promise<readonly CatalogueIntent[] | null> {
  const loaded = await bank(embed);
  if (!loaded) return null;
  const v = await embed(maskNames(text));
  if (!v) return null;
  const centred = unit(v.map((x, i) => x - loaded.mean[i]!));
  return loaded.centroids.map((entry) => ({ intent: entry.intent, s: dot(centred, entry.c) })).sort((a, b) => b.s - a.s).slice(0, size).map((entry) => entry.intent);
}

/** One constrained call to the local model: an id of the shortlist, or null for "none of these". */
export const chooseWithLocalModel: Choose = async (text, shortlist, signal) => {
  const ids = shortlist.map((intent) => intent.id);
  const schema = z.object({ intent: z.enum(["none", ...ids]) }).strict();
  const options = shortlist.map((intent) => `${intent.id} : ${intent.label}`).join("\n");
  const raw = await inferTextForTask("intent_choice", [{ role: "system", content: intentChoicePrompt(options) }, { role: "user", content: maskNames(text) }],
    { jsonSchema: z.toJSONSchema(schema), maxOutputTokens: 24, timeoutMs: 90_000, signal });
  const parsed = schema.safeParse(JSON.parse(raw));
  return parsed.success && parsed.data.intent !== "none" ? parsed.data.intent : null;
};

/** The intent a request means, or null (then nothing changes for this turn). */
export async function intentByMeaning(text: string, embed: Embed, choose: Choose, signal: AbortSignal): Promise<CatalogueIntent | null> {
  const shortlist = await shortlistIntents(text, embed);
  if (!shortlist?.length) return null;
  const id = await choose(text, shortlist, signal).catch(() => null);
  return shortlist.find((intent) => intent.id === id) ?? null;
}
