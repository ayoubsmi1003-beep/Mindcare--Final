import { describe, expect, it, vi } from "vitest";
import { runAlexa } from "@/server/alexa/orchestrator";
import { onlyTheRecordInContext, thirdPartyReference } from "@/shared/alexa/request-contract";
import type { AlexaEvent } from "@/shared/alexa/turn";

const selected = "11111111-1111-4111-8111-111111111111";

describe("a question about someone else than the record in context", () => {
  it.each([
    "Chronologie des traitements de sa mère",
    "Quel traitement prend sa mère ?",
    "Quelles sont les allergies de son père ?",
    "Le dossier de son mari",
    "Les rendez-vous de sa femme",
    "Quel est le solde de son frère ?",
    "Dernière consultation de sa fille",
    "Et sa soeur ?",
    "Prépare une ordonnance pour son fils",
    "Résumé du père de ce patient",
    "Quel traitement prend la mère de la patiente ?",
    "Quel traitement prend la mère de Karim Benali ?",
    "Quels diagnostics pour l'autre patient ?",
    "Le traitement de cet autre patient",
    "Montre le dossier de quelqu'un d'autre",
    "Allergies de sa sœur",
    "Allergies de sa vieille mère",
    "Traitement de sa copine",
    "Allergies de sa belle-fille",
    "Traitement de son grand frère",
    "Quel traitement prend le père d'Amine Benali ?",
  ])("%s stops before any read when a patient is selected", text => {
    expect(thirdPartyReference(text, true)).toBe(true);
  });

  it.each([
    "Quel traitement prend sa mère ?",
    "Le dossier de son mari",
    "Résumé du père de ce patient",
    "Quels diagnostics pour l'autre patient ?",
  ])("%s also stops with nobody selected, since it asks for a record", text => {
    expect(thirdPartyReference(text, false)).toBe(true);
  });

  it.each([
    "Quels traitements prend ce patient ?",
    "Antécédents familiaux de ce patient",
    "Chronologie des traitements de Karim Benali",
    "Allergies de ce patient",
    "Son traitement actuel",
    "Sa dernière consultation",
    "Risque de lithium pendant la grossesse chez la mère",
    "Quel traitement du TDAH chez l'enfant ?",
    "Le lorazépam chez un enfant de moins de 12 ans",
    "Que faire pendant la grossesse d'une mère de famille ?",
    "Statistiques du mois",
    "Montre le deuxième patient",
    "Comment expliquer le traitement à ses proches ?",
  ])("%s stays in scope", text => {
    expect(thirdPartyReference(text, true)).toBe(false);
  });

  it("a book question naming a relative without a record word stays a book question when nobody is selected", () => {
    expect(thirdPartyReference("Comment parler de la maladie à sa mère ?", false)).toBe(false);
  });

  it("answers without touching the database and keeps the selected patient", async () => {
    const rpc = vi.fn(() => { throw new Error("read"); }), events: AlexaEvent[] = [], db: unknown = { rpc }, knowledge: unknown = {};
    await runAlexa(
      { text: "Quelles sont les allergies de son père ?", conversationId: crypto.randomUUID(), clientTurnId: crypto.randomUUID(), appContext: { patientId: selected, page: "/jarvis" } },
      { actor: crypto.randomUUID(), db: db as never, knowledge: knowledge as never, native: true },
      event => events.push(event), new AbortController().signal);
    expect(rpc).not.toHaveBeenCalled();
    const done = events.find(event => event.type === "done") as Extract<AlexaEvent, { type: "done" }>;
    expect(done).toMatchObject({ status: "needs_input", patientId: null, patientScope: "preserve" });
    expect(events.find(event => event.type === "sentence")).toMatchObject({ text: expect.stringContaining("Je n’ai lu aucun dossier") });
  });
});

describe("the record in context is used only when nobody else is named", () => {
  it.each(["Allergies de Karim Benali", "Allergies de Karim", "Effets secondaires de Karim Benali", "Poids de Karim Benali", "Lithémie de karim", "Contre-indications de Karim", "Allergies de sa demi-sœur", "Traitement de son petit-fils", "Allergies de sa pauvre vieille mère", "Allergies de la belle-mère d'Amine Benali", "Les allergies d'Amine Benali", "Traitement de sa nourrice", "Allergies d'un patient", "Son petit-fils a-t-il des allergies ?", "Allergies concernant Karim Benali", "Karim Benali, ses allergies ?", "Allergies de la femme"])("%s isn't answered from the selected record", text => {
    expect(onlyTheRecordInContext(text)).toBe(false);
  });
  it.each(["Allergies", "Ses allergies ?", "Allergies de ce patient", "Quels traitements prend-il ?", "Dernière consultation de juin 2026", "Résume la dernière consultation de ce patient en séparant les faits des questions", "Évolution de son humeur depuis 3 mois", "Effets indésirables de la sertraline chez ce patient", "Antécédents familiaux de ce patient", "Allergies à la pénicilline", "Chronologie des traitements de ce patient", "Paiements de la semaine dernière", "Date de naissance", "Score de Hamilton", "Contact d'urgence", "Quelles allergies sont enregistrées ?", "Score de Hamilton de ce patient", "Téléphone", "Son traitement actuel", "Ses allergies connues", "Affiche son profil."])("%s may use the selected record", text => {
    expect(onlyTheRecordInContext(text)).toBe(true);
  });
});
