import {expect,it} from "vitest";
import {planKnowledgeQuery,matchesRequestedBook,requetePourLivreRequis} from "@/server/alexa/knowledge-query";

// ADR-041 : trois livres approuves (DSM-5, Maudsley, Stahl 7e).
// La propriete de securite est INCHANGEE : une source qui n'est pas dans la
// liste fermee reste refusee, et un livre nomme dans la question cible
// UNIQUEMENT ce livre.
const DSM5 = "DSM-5 \u2014 Manuel diagnostique et statistique des troubles mentaux";
const MAUDSLEY = "The Maudsley Prescribing Guidelines in Psychiatry";
const STAHL = "Prescriber's Guide (Stahl's Essential Psychopharmacology)";
it('grounds a named DSM definition in its diagnostic section without narrowing a comparison',()=>{
 const plan=planKnowledgeQuery('Comment le DSM-5 définit-il le trouble panique ?')!;
 expect(plan.sectionFocus).toBe('trouble panique');expect(plan.sectionLeaf).toBe('caracteristiques diagnostiques');
 expect(matchesRequestedBook({source_titre:DSM5,section:'Section II › Troubles anxieux › Trouble panique › Caractéristiques diagnostiques'},plan)).toBe(true);
 expect(matchesRequestedBook({source_titre:DSM5,section:'Section II › Troubles anxieux › Trouble panique › Marqueurs diagnostiques'},plan)).toBe(false);
 expect(planKnowledgeQuery('Compare le trouble dépressif caractérisé et le trouble panique selon le DSM-5.')?.sectionFocus).toBeUndefined();
 expect(planKnowledgeQuery('Distingue les critères du trouble panique et du trouble dépressif caractérisé selon le DSM-5.')?.sectionFocus).toBeUndefined();
});
it.each(['Comment le DSM-5 définit-il le trouble panique ?','Comment le DSM-5 décrit-il le trouble panique ?','Quels critères du trouble panique figurent dans le DSM-5 ?'])('removes French question verbs without removing clinical restrictions: %s',question=>{
 const plan=planKnowledgeQuery(question)!;
 expect(plan.queries[0]).not.toMatch(/\b(?:definit|decrit|figurent)\b/u);
 expect(plan.queries[0]).toContain('panique');
});
it('retains population and dose qualifiers after removing question scaffolding',()=>{
 const plan=planKnowledgeQuery('Selon Taylor, décris les contre-indications de la sertraline pendant la grossesse, sans dose adulte.')!;
 expect(plan.queries.join(' ')).toMatch(/pregnancy|grossesse/u);
 expect(plan.queries.join(' ')).toMatch(/dose/u);
 expect(plan.queries.join(' ')).toMatch(/adult/u);
});

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

it("un livre nomme dans la question cible UNIQUEMENT ce livre qualifie", () => {
  const plan = planKnowledgeQuery("Selon Taylor, quelles précautions sont documentées pour la sertraline ?")!;
  expect(plan.sourceTitle).toBe(MAUDSLEY);
  expect(matchesRequestedBook({ source_titre: STAHL }, plan)).toBe(false);
  expect(matchesRequestedBook({ source_titre: DSM5 }, plan)).toBe(false);
  expect(matchesRequestedBook({ source_titre: MAUDSLEY }, plan)).toBe(true);
});

it("Stahl est adressable par son nom et ne cible que Stahl", () => {
  const plan = planKnowledgeQuery("Selon Stahl, quelle est la posologie de la clozapine ?")!;
  expect(plan.sourceTitle).toBe(STAHL);
  expect(plan.sourceLabel).toBe("Stahl");
  expect(plan.language).toBe("en");
  expect(matchesRequestedBook({ source_titre: STAHL }, plan)).toBe(true);
  expect(matchesRequestedBook({ source_titre: DSM5 }, plan)).toBe(false);
  expect(matchesRequestedBook({ source_titre: MAUDSLEY }, plan)).toBe(false);
  // Le titre doit rester identique a celui ecrit en base (comparaison normalisee).
  expect(matchesRequestedBook({ source_titre: "Prescriber's Guide (Stahl's Essential Psychopharmacology) " }, plan)).toBe(true);
});

it("reinjecte le libelle du livre requis, jamais un prefixe code en dur", () => {
  const stahl = planKnowledgeQuery("Selon Stahl, quelle est la posologie de la clozapine ?")!;
  const taylor = planKnowledgeQuery("Selon Taylor, quelles précautions pour la sertraline ?")!;
  const dsm = planKnowledgeQuery("Selon le DSM-5, quels critères pour le trouble panique ?")!;
  const generic = planKnowledgeQuery("Quels sont les criteres du trouble panique ?")!;
  expect(requetePourLivreRequis(stahl, "posologie clozapine")).toBe("Stahl posologie clozapine");
  expect(requetePourLivreRequis(taylor, "precautions sertraline")).toBe("Taylor precautions sertraline");
  expect(requetePourLivreRequis(dsm, "criteres trouble panique")).toBe("DSM-5 criteres trouble panique");
  expect(requetePourLivreRequis(generic, "criteres trouble panique")).toBe("criteres trouble panique");
});
