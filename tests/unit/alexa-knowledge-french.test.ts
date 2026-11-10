import { describe, expect, it } from "vitest";
import { frenchAidAcceptable, frenchAidEligible, medicationBoundBySection, numericEvidenceAllowed } from "@/server/alexa/knowledge-french";

const plain = "Sertraline inhibits the reuptake of serotonin in neurons.";
const good = "La sertraline inhibe la recapture de la sérotonine dans les neurones.";

describe("frenchAidEligible", () => {
  it("allows a plain descriptive sentence", () => expect(frenchAidEligible(plain)).toBe(true));
  // Each of these was shown to pass a rule-based translation check while changing the meaning.
  it.each([
    "Valproate is contra-indicated in pregnancy for all women.",
    "Lithium dose is 900 mg/day.",
    "Take it twice daily.",
    "Maximum daily dose is 200 mg.",
    "Do not exceed the usual range.",
    "It should be avoided in renal impairment.",
    "Clozapine is used only in resistant cases.",
    "Stop lithium if toxicity is suspected.",
    "Lithium may cause tremor.",
    "Sertraline lacks evidence in this group.",
    "This reduces suicide risk.",
    "It is safe in this group.",
    "Lithium requires monitoring.",
    "Half of the patients respond.",
    "Treatment lasts at least two weeks.",
    "Sertraline is given to the elderly.",
    "Valproate increases lamotrigine levels.",
  ])("never renders: %s", quote => expect(frenchAidEligible(quote)).toBe(false));
});

describe("frenchAidAcceptable", () => {
  it("accepts a faithful rendering of a plain sentence", () => expect(frenchAidAcceptable(plain, good)).toEqual({ ok: true }));
  it("refuses an ineligible source whatever the French says", () => {
    expect(frenchAidAcceptable("Valproate is contra-indicated in pregnancy.", "Le valproate est contre-indiqué pendant la grossesse.")).toEqual({ ok: false, reason: "ineligible" });
  });
  it.each([
    ["untranslated English", plain, "language"],
    ["a swapped medication", "La clozapine inhibe la recapture de la sérotonine dans les neurones.", "medication"],
    ["an unknown drug added", "La sertraline et la cariprazine inhibent la recapture de la sérotonine.", "medication"],
    ["an added claim of safety", "La sertraline inhibe la recapture de la sérotonine et elle est sûre pendant la grossesse.", "forbidden"],
    ["an added population", "La sertraline inhibe la recapture de la sérotonine chez les enfants.", "forbidden"],
    ["an added negation", "La sertraline n'inhibe pas la recapture de la sérotonine dans les neurones.", "forbidden"],
    ["an added number", "La sertraline inhibe 50 % de la recapture de la sérotonine dans les neurones.", "forbidden"],
    ["an injected instruction", "Il faut arrêter tout traitement à base de sertraline immédiatement dans les neurones.", "forbidden"],
    ["direct advice", "Vous devez utiliser la sertraline pour la recapture de la sérotonine.", "unsafe"],
    ["markup", "<b>La sertraline</b> inhibe la recapture de la sérotonine dans les neurones.", "unsafe"],
    ["a link", "La sertraline ![x](https://evil.example/a) inhibe la recapture de la sérotonine.", "unsafe"],
    ["a text-direction override", "La sertraline ‮ inhibe la recapture de la sérotonine dans les neurones.", "unsafe"],
    ["a truncated rendering", "La sertraline agit ici.", "length"],
  ])("refuses %s", (_label, french, reason) => expect(frenchAidAcceptable(plain, french)).toEqual({ ok: false, reason }));
});

describe("medicationBoundBySection", () => {
  const question = "posologie de l'aripiprazole ?";
  it("binds a sentence to its exact single-drug monograph root", () => {
    expect(medicationBoundBySection(question, "Usual dosage range is 15-30 mg/day.", "Aripiprazole › Dosing and Use")).toBe(true);
  });
  it.each([
    ["another drug's monograph", "Usual dosage range is 15-30 mg/day.", "Lithium › Dosing and Use"],
    ["a sentence naming another known drug", "Unlike clozapine, the usual dose is 15 mg.", "Aripiprazole › Dosing and Use"],
    ["a drug outside the lexicon", "Cariprazine is started at 1.5 mg/day.", "Aripiprazole › Dosing and Use"],
    ["a brand subject", "Depakote is started at 250 mg.", "Aripiprazole › Dosing and Use"],
    ["a drug class", "Antipsychotics are started at 5 mg.", "Aripiprazole › Dosing and Use"],
    ["an interaction section", "The usual dose is 10 mg/day.", "Aripiprazole › Interactions"],
    ["a shared heading", "The usual dose is 10 mg/day.", "Aripiprazole and clozapine › Dosing"],
    ["a topic heading that only contains the name", "The usual dose is 10 mg/day.", "Aripiprazole-resistant cases › Augmentation"],
    ["no heading", "Usual dosage range is 15-30 mg/day.", null],
  ])("does not bind %s", (_label, quote, section) => expect(medicationBoundBySection(question, quote, section)).toBe(false));
});

describe("numericEvidenceAllowed", () => {
  it("refuses a dose from a drug book when no medication was recognized", () => {
    expect(numericEvidenceAllowed("Usual dosage range de la lurasidone", "Usual dosage range is 15-30 mg/day for adults.", "en", "Aripiprazole › Dosing and Use")).toBe(false);
  });
  it("keeps numbered French diagnostic criteria", () => {
    expect(numericEvidenceAllowed("critères de la dépression", "Au moins 5 symptômes pendant 2 semaines.", "fr", "Trouble dépressif › Critères")).toBe(true);
  });
  it("catches a quantity written as a word", () => {
    expect(numericEvidenceAllowed("dose du lithium", "Lithium or clozapine is given for one week.", "en", null)).toBe(false);
  });
  it("passes a sentence without any number", () => {
    expect(numericEvidenceAllowed("mécanisme", "It blocks a transporter.", "en", null)).toBe(true);
  });
});
