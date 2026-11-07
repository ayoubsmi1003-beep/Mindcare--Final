import { describe, expect, it, vi } from "vitest";
import { releaseSharedReads } from "@/server/alexa/agent-loop";
import type { RequestPart } from "@/shared/alexa/agent";
import { runAlexa } from "@/server/alexa/orchestrator";
import { asksForAChange, frenchRequestAdmission, hasNoChangeAction, sequencedGoals } from "@/shared/alexa/request-contract";
import { understandTurn } from "@/shared/alexa/turn-understanding";
import type { AlexaEvent } from "@/shared/alexa/turn";

describe("sequencedGoals", () => {
  it.each([
    ["Montre l'accueil puis les traitements à revoir", ["Montre l'accueil", "Montre les traitements à revoir"]],
    ["Combien de dossiers actifs compte le cabinet ? Puis rappelle les seuils de durée.", ["Combien de dossiers actifs compte le cabinet ?", "Rappelle les seuils de durée."]],
    ["Quels traitements à revoir ? Quelle est la dose de lithium ?", ["Quels traitements à revoir ?", "Quelle est la dose de lithium ?"]],
    ["Montre mes statistiques, ensuite mes messages internes", ["Montre mes statistiques", "Montre mes messages internes"]],
    ["Les traitements à revoir et montre mes messages internes", ["Les traitements à revoir", "Montre mes messages internes"]],
  ])("%s", (text, goals) => {
    expect(sequencedGoals(text)).toEqual({ goals, dropped: [] });
  });

  it("keeps one goal together", () => {
    for (const text of ["Les allergies et les traitements de ce patient", "Quels traitements à revoir ?", "Combien de patients et de consultations ?", "Recette du mois de septembre 2026", "Si le patient a une allergie, montre ses traitements puis son solde.", "Consultations de juin 2026 puis les paiements en attente", "Lorsque le patient arrive, montre ses traitements puis son solde", "Consultations de la semaine dernière puis les paiements en attente", "Agenda de demain puis les paiements en attente"])
      expect(sequencedGoals(text)).toBeNull();
  });

  it("names what it won't process instead of dropping it", () => {
    expect(sequencedGoals("Montre l'agenda puis la recette puis les statistiques puis les messages")).toEqual({ goals: ["Montre l'agenda", "Montre la recette", "Montre les statistiques"], dropped: ["Montre les messages"] });
  });
});

describe("asksForAChange", () => {
  it.each(["Marque mes messages internes comme lus", "Supprime mes messages internes", "Archive ce message", "Alexa, annule tous mes rendez-vous de demain", "Peux-tu modifier la date de naissance", "Clôture la consultation", "Je voudrais que tu supprimes ce patient", "Je veux supprimer ce patient", "Il faut supprimer ce patient", "Est-ce que tu peux supprimer ce patient ?", "Pourrais-tu supprimer ce patient", "Je souhaite supprimer ce patient"])("%s", text => {
    expect(asksForAChange(text)).toBe(true);
  });
  it.each(["Quels rendez-vous ai-je annulés ?", "Montre mes messages internes marqués comme lus", "Montre les changements de dose", "Quels traitements à revoir ?", "Change d'avis : montre l'agenda sans modifier quoi que ce soit", "Remplacer la sertraline par la fluoxétine : quelle conduite ?", "Change d'avis, montre l'agenda"])("%s", text => {
    expect(asksForAChange(text)).toBe(false);
  });
});

describe("two goals and one read", () => {
  const part = (id: string, ref: string): RequestPart => ({ id, goal: id, conditions: [], dependsOn: [], status: "answered", resultRefs: [ref] });
  it("only the first goal counts as answered by a read the model chose", () => {
    const parts = [part("a", "c1"), part("b", "c1"), part("c", "c2")];
    releaseSharedReads(parts);
    expect(parts.map(item => item.status)).toEqual(["answered", "budget_limited", "answered"]);
    expect(parts[1]).toMatchObject({ resultRefs: [], reason: expect.stringContaining("pas été établie") });
  });
  it("leaves a read shared by a deterministic route alone", () => {
    const parts = [part("a", "direct-1"), part("b", "direct-1")];
    releaseSharedReads(parts);
    expect(parts.map(item => item.status)).toEqual(["answered", "answered"]);
  });
});

describe("changes Alexa has no action for", () => {
  it.each(["Marque mes messages internes comme lus", "Supprime mes messages internes", "Archive ce message", "Supprime ce patient", "Alexa, efface cette consultation"])("%s is refused at once, with no read", async text => {
    const events: AlexaEvent[] = [], rpc = vi.fn(), db: unknown = { rpc }, knowledge: unknown = {};
    const dependencies = { actor: crypto.randomUUID(), db: db as never, knowledge: knowledge as never, native: true };
    await runAlexa({ text, conversationId: crypto.randomUUID(), clientTurnId: crypto.randomUUID(), appContext: { patientId: null, page: "/jarvis" } },
      dependencies, event => events.push(event), new AbortController().signal);
    expect(rpc).not.toHaveBeenCalled();
    expect(events.find(event => event.type === "sentence")).toMatchObject({ text: expect.stringContaining("je n’ai rien changé") });
    expect(events.find(event => event.type === "done")).toMatchObject({ status: "failed", speechAllowed: true });
  });
  it.each(["Montre mes messages internes", "Annule le rendez-vous de demain", "Clôture la consultation de ce patient"])("%s keeps its route", text => {
    expect(hasNoChangeAction(text)).toBe(false);
  });
  it.each(["Supprime le rendez-vous de ce patient", "Supprime la charge de la consultation", "Marque Karim Benali arrivé et envoie un message à l'assistante"])("%s keeps its proposal path", text => {
    expect(understandTurn(text, { selected: true }).noChangeAction).toBe(false);
  });
  it("names the part of a change that has no action", () => {
    expect(understandTurn("Supprime le rendez-vous et le dossier de ce patient", { selected: true }).partlyWithoutAction).toBe(true);
    expect(understandTurn("Supprime le rendez-vous de ce patient", { selected: true }).partlyWithoutAction).toBe(false);
  });
  it("reports the other goal of a refused change", async () => {
    const events: AlexaEvent[] = [], rpc = vi.fn(), db: unknown = { rpc }, knowledge: unknown = {};
    await runAlexa({ text: "Supprime ce patient puis montre l'agenda", conversationId: crypto.randomUUID(), clientTurnId: crypto.randomUUID(), appContext: { patientId: null, page: "/jarvis" } },
      { actor: crypto.randomUUID(), db: db as never, knowledge: knowledge as never, native: true }, event => events.push(event), new AbortController().signal);
    expect(events.filter(event => event.type === "sentence").map(event => (event).text).join(" ")).toContain("Montre l'agenda");
  });
});

describe("a sequence goes through whole turns", () => {
  const selected = "11111111-1111-4111-8111-111111111111";
  const run = async (text: string, reads: (name: string) => unknown) => {
    const events: AlexaEvent[] = [];
    const rpc = vi.fn(async (name: string) => ({ ok: true, data: [reads(name)] })), db: unknown = { rpc }, knowledge: unknown = {}, agentInfer: unknown = vi.fn(async () => { throw new Error("no model"); });
    const dependencies = { actor: crypto.randomUUID(), db: db as never, knowledge: knowledge as never, native: true, agentInfer: agentInfer as never };
    await runAlexa({ text, conversationId: crypto.randomUUID(), clientTurnId: crypto.randomUUID(), appContext: { patientId: selected, page: "/jarvis" } },
      dependencies,
      event => events.push(event), new AbortController().signal);
    return { events, done: events.find(event => event.type === "done") as Extract<AlexaEvent, { type: "done" }>, text: events.filter(event => event.type === "sentence").map(event => (event).text).join("\n"), rpc };
  };

  it("reports one refused goal and doesn't call the turn complete", async () => {
    const { done, text } = await run("Quels traitements à revoir ? Puis montre mes statistiques", () => null);
    expect(text).toContain("Demande 1 sur 2");
    expect(text).toContain("Demande 2 sur 2");
    expect(done.parts).toHaveLength(2);
    expect(done.status).not.toBe("completed");
  });

  it("doesn't allow speech when a goal may not be spoken", async () => {
    const { done } = await run("Quels traitements à revoir ? Puis montre mes statistiques", () => null);
    expect(done.speechAllowed).toBe(false);
  });

  it("doesn't run later goals after one asks a question", async () => {
    const { done, rpc } = await run("Traitements du patient Karim Benali ? Puis ses allergies ?", () => ({ rows: [], total: 0 }));
    expect(rpc.mock.calls.map(call => call[0])).not.toContain("get_patient");
    expect(done.parts?.length ?? 0).toBeLessThanOrEqual(2);
  });

  it("publishes exactly one final state", async () => {
    const { events } = await run("Quels traitements à revoir ? Puis montre mes statistiques", () => null);
    expect(events.filter(event => event.type === "done")).toHaveLength(1);
  });
});

describe("a person is the subject even without a name", () => {
  it.each(["a-t-elle un trouble bipolaire ?", "karim benali a-t-il un traitement ?", "Risque de lithium pendant sa grossesse", "quels traitements du trouble bipolaire de karim benali et de salim haddad ?"])("%s doesn't go to the books", text => {
    expect(frenchRequestAdmission(text, false).tools).not.toEqual(["search_knowledge"]);
  });
  // Known limitation, docs/alexa/10: a lowercase name after a book subject still gets book passages. They say they come from books, and no record is read.
  it.fails.each(["que donne le bilan de karim ?", "trouve les effets indésirables de karim"])("%s still goes to the books", text => {
    expect(frenchRequestAdmission(text, false).tools).not.toEqual(["search_knowledge"]);
  });
  it.each(["Le trouble panique exige-t-il une durée minimale de symptômes, et laquelle ?", "Risque de lithium pendant la grossesse chez la mère", "Que sait-on du syndrome sérotoninergique et de ses signes ?", "Quels repères de durée et de nombre de symptômes encadrent l'anxiété généralisée ?", "Le lithium a-t-il un effet tératogène ?", "La sertraline a-t-elle des interactions avec le tramadol ?"])("%s goes to the books", text => {
    expect(frenchRequestAdmission(text, false).tools).toEqual(["search_knowledge"]);
  });
});
