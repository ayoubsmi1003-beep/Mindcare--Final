import {expect,it} from "vitest";
import {planKnowledgeQuery,matchesRequestedBook} from "@/server/alexa/knowledge-query";

// Invariant porte a TROIS livres approuves (DSM-5, Maudsley, Stahl 7e).
// La propriete de securite est INCHANGEE : une source qui n'est pas dans la
// liste fermee reste refusee, et un livre nomme dans la question cible
// UNIQUEMENT ce livre.
const DSM5 = "DSM-5 \u2014 Manuel diagnostique et statistique des troubles mentaux";
const MAUDSLEY = "The Maudsley Prescribing Guidelines in Psychiatry";
const STAHL = "Prescriber's Guide (Stahl's Essential Psychopharmacology)";

it("une question non qualifiee admet les trois livres approuves", () => {
  const plan = planKnowledgeQuery("Quels sont les criteres du trouble panique ?")!;
  expect(plan.sourceTitle).toBeNull();
  expect(matchesRequestedBook({ source_titre: DSM5 }, plan)).toBe(true);
  expect(matchesRequestedBook({ source_titre: MAUDSLEY }, plan)).toBe(true);
  expect(matchesRequestedBook({ source_titre: STAHL }, plan)).toBe(true);
});

it("une source hors liste fermee reste refusee", () => {
  const plan = planKnowledgeQuery("Quels sont les criteres du trouble panique ?")!;
  expect(matchesRequestedBook({ source_titre: "Catalogue medicaments \u2014 libelles seuls, zero posologie" }, plan)).toBe(false);
  expect(matchesRequestedBook({ source_titre: "Autre livre non approuve" }, plan)).toBe(false);
});

it("un livre nomme dans la question cible UNIQUEMENT ce livre", () => {
  const plan = planKnowledgeQuery("Selon Stahl, quelle est la posologie de la sertraline ?")!;
  expect(plan.sourceTitle).toBe(STAHL);
  expect(matchesRequestedBook({ source_titre: STAHL }, plan)).toBe(true);
  expect(matchesRequestedBook({ source_titre: DSM5 }, plan)).toBe(false);
  expect(matchesRequestedBook({ source_titre: MAUDSLEY }, plan)).toBe(false);
});
