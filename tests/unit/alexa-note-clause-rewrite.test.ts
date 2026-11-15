import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@/server/alexa/local-model", async importOriginal => ({ ...await importOriginal<typeof import("@/server/alexa/local-model")>(), inferLocalText: vi.fn() }));
import { inferLocalText } from "@/server/alexa/local-model";
import { rewriteNoteClause } from "@/server/alexa/clinical-narrative";

const signal = new AbortController().signal;
const answer = (text: string) => vi.mocked(inferLocalText).mockResolvedValueOnce(JSON.stringify({ text }));
beforeEach(() => vi.mocked(inferLocalText).mockReset());

it("keeps a fluent rewrite that holds only the note's own words", async () => {
  answer("Le patient dort mal depuis deux semaines, avec une anxiété le soir.");
  expect(await rewriteNoteClause("subjective", "Dort mal depuis deux semaines. Anxiété le soir.", signal))
    .toBe("Le patient dort mal depuis deux semaines, avec une anxiété le soir.");
});
it("rejects a rewrite that adds a cause the note never states", async () => {
  answer("Le patient dort mal depuis deux semaines à cause de son travail.");
  expect(await rewriteNoteClause("subjective", "Dort mal depuis deux semaines. Anxiété le soir.", signal)).toBeNull();
});
it("rejects a rewrite that drops a recorded negation", async () => {
  answer("Le patient évoque des idées suicidaires lors de l’entretien.");
  expect(await rewriteNoteClause("objective", "Pas d'idées suicidaires lors de l’entretien.", signal)).toBeNull();
});
it("rejects a changed number and never calls the model for a field too long to prove", async () => {
  answer("La sertraline est augmentée à 100 mg par jour.");
  expect(await rewriteNoteClause("plan", "Sertraline augmentée à 75 mg par jour.", signal)).toBeNull();
  expect(await rewriteNoteClause("plan", "Phrase longue. ".repeat(40), signal)).toBeNull();
  expect(inferLocalText).toHaveBeenCalledTimes(1);
});
