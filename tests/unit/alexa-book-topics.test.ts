import { describe, expect, it } from "vitest";
import { mentionsBookTopic } from "@/shared/alexa/book-topics";
import { BOOK_DISORDER_TERMS, BOOK_DRUG_NAMES } from "@/shared/alexa/book-topics.generated";
import { isClinicalKnowledgeQuestion, questionConcernsAPerson } from "@/shared/alexa/request-contract";

// Development wordings, written apart from C270 and H270 (none of them is an evaluation question).
describe("topics the approved books treat", () => {
  it("is generated from the books, with no record or scaffolding word", () => {
    expect(BOOK_DRUG_NAMES.length).toBeGreaterThan(100);
    expect(BOOK_DISORDER_TERMS.length).toBeGreaterThan(150);
    for (const word of ["sommeil", "diagnostic", "echelle", "identite", "attention", "medicament", "sodium", "criteres diagnostiques"])
      expect([...BOOK_DRUG_NAMES, ...BOOK_DISORDER_TERMS]).not.toContain(word);
  });
  it("matches French and English forms of one word, never a longer unrelated word", () => {
    expect(mentionsBookTopic("la tiagabine")).toBe(true);
    expect(mentionsBookTopic("un trouble cyclothymique")).toBe(true);
    expect(mentionsBookTopic("la trichotillomanie")).toBe(true);
    expect(mentionsBookTopic("notre conversation de lundi")).toBe(false);
    expect(mentionsBookTopic("le sommeil de la semaine")).toBe(false);
  });
});

describe("a question about a book topic goes to the books, a question about a person does not", () => {
  it.each([
    "Comment agit le suvorexant ?",
    "Qu'est-ce que la trichotillomanie ?",
    "C'est quoi la pyromanie ?",
    "Tiagabine, posologie habituelle ?",
    "Le lofexidine a-t-il un intérêt dans le sevrage des opiacés ?",
    "Comment le trouble schizotypique est-il décrit ?",
    "Critères du mutisme sélectif",
    "pyromanie définition et critères",
  ])("books: %s", (text) => expect(isClinicalKnowledgeQuestion(text)).toBe(true));
  it.each([
    "Est-ce qu'il prend de la tiagabine ?",
    "Depuis quand prend-il du suvorexant ?",
    "Le patient a-t-il une trichotillomanie ?",
    "A-t-il déjà eu un trouble schizotypique ?",
    "Son traitement par lofexidine est-il efficace ?",
    "Dans ses notes, est-ce qu'il est question de sommeil ?",
  ])("not the books: %s", (text) => expect(isClinicalKnowledgeQuestion(text)).toBe(false));
  it("still reads a person as the subject of an inverted verb", () => {
    expect(questionConcernsAPerson("A-t-il une pyromanie ?")).toBe(true);
    expect(questionConcernsAPerson("Le patient est-il sous tiagabine ?")).toBe(true);
    expect(questionConcernsAPerson("La pyromanie est-elle fréquente ?")).toBe(false);
  });
});
