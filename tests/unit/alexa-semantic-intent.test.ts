import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { INTENT_CATALOGUE } from "@/shared/alexa/intent-catalogue";
import { renderIntent } from "@/shared/alexa/intent-render";
import { readFamily } from "@/shared/alexa/patient-question";
import { CHOICES, intentByMeaning, maskNames, shortlistIntents, SHORTLIST, type Choose, type Embed } from "@/server/alexa/semantic-intent";

const ASOF = "2026-10-26T09:30:00+01:00";
const byId = (id: string) => INTENT_CATALOGUE.find((entry) => entry.id === id)!;
/** A toy space: one axis per intent, set when the text is one of that intent's examples. */
const toyEmbed: Embed = async (text) => INTENT_CATALOGUE.map((entry) => (entry.examples.map(maskNames).includes(text) ? 1 : 0.01));
const signal = new AbortController().signal;

describe("reading a request by meaning", () => {
  it("masks names, never intent words", () => {
    expect(maskNames("Quand Karim Benali est-il venu ?")).toBe("Quand X est-il venu ?");
    expect(maskNames("Son traitement actuel ?")).toBe("Son traitement actuel ?");
  });
  it("shortlists the closest intents first", async () => {
    const list = await shortlistIntents(byId("patient.lastdate").examples[0]!, toyEmbed);
    expect(list?.length).toBe(SHORTLIST);
    expect(list?.[0]?.id).toBe("patient.lastdate");
  });
  it("takes only what the closed choice returns from the shortlist", async () => {
    const text = byId("agenda.count").examples[0]!;
    const pick = (id: string | null): Choose => async () => id;
    expect((await intentByMeaning(text, toyEmbed, pick("agenda.count"), signal))?.id).toBe("agenda.count");
    expect(await intentByMeaning(text, toyEmbed, pick(null), signal)).toBeNull();
    // An id outside the shortlist is ignored: the model cannot widen its own choice.
    const listed = new Set((await shortlistIntents(text, toyEmbed))!.map((intent) => intent.id));
    const outside = INTENT_CATALOGUE.find((entry) => !listed.has(entry.id))!.id;
    expect(await intentByMeaning(text, toyEmbed, pick(outside), signal)).toBeNull();
    // A listed intent that is not e5's closest is refused too: the two judges must agree.
    const second = (await shortlistIntents(text, toyEmbed))![1]!.id;
    expect(await intentByMeaning(text, toyEmbed, pick(second), signal)).toBeNull();
    expect(await intentByMeaning(text, toyEmbed, async () => { throw new Error("LocalModelTimeout"); }, signal)).toBeNull();
    expect(await intentByMeaning(text, async () => null, pick("agenda.count"), signal)).toBeNull();
  });
  it("reads nothing for a change, or for words that say neither who nor when, and offers the model only the closest few", async () => {
    let offered = 0;
    const agreeing: Choose = async (_text, list) => { offered = list.length; return list[0]!.id; };
    for (const text of ["J'ai faim.", "Ajoute un rendez-vous demain à 10 h.", "Rédige un certificat de repos pour lui."]) expect(await intentByMeaning(text, toyEmbed, agreeing, signal), text).toBeNull();
    expect((await intentByMeaning(byId("agenda.count").examples[0]!, toyEmbed, agreeing, signal))?.id).toBe("agenda.count");
    expect(offered).toBe(CHOICES);
  });
  it("never reads a question about a patient's money as another patient read", async () => {
    const money = "Combien de dinars nous a-t-elle donnés depuis le début ?";
    const count = byId("patient.count").examples.map(maskNames)[0]!;
    const embed: Embed = async (text) => toyEmbed(text === money ? count : text);
    expect((await shortlistIntents(money, embed))![0]!.id).toBe("patient.count");
    expect(await intentByMeaning(money, embed, async () => "patient.count", signal)).toBeNull();
  });
});

describe("writing the closed question for a chosen intent", () => {
  const onScreen = { contextPatient: true, followup: false };
  it("keeps the patient on screen for a pronoun and names a named patient", () => {
    expect(renderIntent(byId("patient.lastdate"), "Il est passé quand chez nous ?", onScreen, ASOF)).toEqual({ text: "Quelles sont les dates de la première à la dernière consultation du patient sélectionné ?", contextPatient: true });
    expect(renderIntent(byId("patient.count"), "Karim Benali, il a fait combien de séances ?", { contextPatient: false, followup: false }, ASOF)?.text).toBe("Nombre de consultations pour Karim Benali.");
  });
  it("does not guess who or when", () => {
    expect(renderIntent(byId("patient.treatments"), "Et les médicaments ?", { contextPatient: false, followup: false }, ASOF)).toBeNull();
    expect(renderIntent(byId("agenda.count"), "J'ai combien de monde ?", onScreen, ASOF)).toBeNull();
  });
  it("uses the frames' own periods for the agenda and the money", () => {
    expect(renderIntent(byId("agenda.list"), "Qui passe me voir demain ?", onScreen, ASOF)?.text).toBe("Quels sont les rendez-vous demain ?");
    expect(renderIntent(byId("finance.revenue"), "Qu'a rapporté le cabinet en septembre ?", onScreen, ASOF)?.text).toBe("Quelles sont les recettes de septembre 2026 ?");
  });
});

describe("the catalogue", () => {
  it("files every example in its own family, or leaves it open", () => {
    for (const intent of INTENT_CATALOGUE) for (const example of intent.examples) {
      const family = readFamily(example);
      if (family !== null) expect(`${family} | ${example}`).toBe(`${intent.target.family === "patient" ? "patient" : "practice"} | ${example}`);
    }
    expect(readFamily("Le patient suivant arrive à quelle heure ?")).not.toBe("patient");
    expect(readFamily("Il nous reste combien en caisse ce mois ?")).toBe("practice");
    expect(readFamily("Combien de séances pour Karim Benali cette année ?")).toBe("patient");
  });
  it("holds read intents only, with unique ids, labels and examples", () => {
    const ids = INTENT_CATALOGUE.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of INTENT_CATALOGUE) {
      expect(["patient", "agenda", "finance", "activity"]).toContain(entry.target.family);
      expect(entry.label.length).toBeGreaterThan(5);
      expect(entry.examples.length).toBeGreaterThanOrEqual(3);
      for (const example of entry.examples) expect(example).not.toMatch(/\b(?:annule|déplace|crée|prépare|envoie|modifie|supprime|enregistre)\b/iu);
    }
  });
  it("never reuses an evaluation question (C200, C201, C202, C270, and H270 when present)", () => {
    const norm = (text: string) => new Set(text.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "").replace(/\{[^}]+\}|\[x\]/giu, " ").replace(/[^\p{L}\p{N} ]/gu, " ").split(/\s+/u).filter((word) => word.length > 1));
    const jaccard = (a: Set<string>, b: Set<string>) => { let shared = 0; for (const word of a) if (b.has(word)) shared++; return shared / (a.size + b.size - shared); };
    const campaigns = join(process.cwd(), "tests", "eval", "alexa-clinical-conversational");
    const files = ["v1/cases.json", "v2/cases.json", "v2/holdout.json", "v3/cases.json", "v4/cases.json"].map((file) => join(campaigns, file));
    const holdout = join(process.cwd(), ".eval-out", "alexa-c270", "holdout.json");
    const turns = [...files, ...(existsSync(holdout) ? [holdout] : [])].flatMap((file) => (JSON.parse(readFileSync(file, "utf8")) as { cases: { turns: { say: string }[] }[] }).cases.flatMap((item) => item.turns.map((turn) => norm(turn.say))));
    const close: string[] = [];
    for (const entry of INTENT_CATALOGUE) for (const example of entry.examples) {
      const mine = norm(example);
      if (mine.size >= 3 && turns.some((turn) => turn.size >= 3 && jaccard(mine, turn) >= 0.7)) close.push(example);
    }
    expect(close).toEqual([]);
  });
});

/**
 * With the real local models (slow; on request, never while a campaign runs):
 *   MINDCARE_SEMANTIC_CALIBRATION=1 KNOWLEDGE_VECTOR_RECETTE=e5-base pnpm exec vitest run tests/unit/alexa-semantic-intent.test.ts
 * Reports the shortlist recall and the closed choice accuracy on the catalogue paraphrases, and checks that questions which
 * are not record reads (book knowledge, small talk) are answered "none".
 */
const NEGATIVES = [
  "Quels sont les critères du trouble bipolaire ?", "Comment agit la mirtazapine ?", "Bonjour Alexa, ça va ?", "Merci beaucoup.",
  "Quelle est la dose maximale de sertraline ?", "Qu'est-ce que le syndrome sérotoninergique ?",
];
describe.skipIf(process.env["MINDCARE_SEMANTIC_CALIBRATION"] !== "1")("calibration with the local models", () => {
  it("measures shortlist recall and closed-choice accuracy", async () => {
    const { vecteurRequeteSecondaireProduction } = await import("@/server/knowledge/vecteur-secondaire-production");
    const { chooseWithLocalModel } = await import("@/server/alexa/semantic-intent");
    const embed: Embed = (text) => vecteurRequeteSecondaireProduction(text);
    let inList = 0, right = 0, wrong = 0, none = 0; const rows: string[] = []; const started = Date.now();
    for (const entry of INTENT_CATALOGUE) for (const example of entry.examples) {
      const list = await shortlistIntents(example, embed);
      if (list?.some((intent) => intent.id === entry.id)) inList++;
      const chosen = await intentByMeaning(example, embed, chooseWithLocalModel, signal);
      if (!chosen) { none++; rows.push(`none   ${entry.id} | ${example}`); }
      else if (chosen.id === entry.id) right++;
      else { wrong++; rows.push(`WRONG  ${entry.id} -> ${chosen.id} | ${example}`); }
    }
    const total = INTENT_CATALOGUE.reduce((sum, entry) => sum + entry.examples.length, 0);
    let falseReads = 0;
    for (const text of NEGATIVES) { const chosen = await intentByMeaning(text, embed, chooseWithLocalModel, signal); rows.push(`neg ${chosen?.id ?? "none"} | ${text}`); if (chosen) falseReads++; }
    console.log({ total, inList, right, wrong, none, falseReads, secondsPerChoice: Math.round((Date.now() - started) / 1000 / (total + NEGATIVES.length)) });
    console.log(rows.join("\n"));
    expect(falseReads).toBe(0);
  }, 7_200_000);
});
