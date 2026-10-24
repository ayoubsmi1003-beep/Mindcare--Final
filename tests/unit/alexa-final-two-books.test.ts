import {expect,it} from "vitest";
import {planKnowledgeQuery,matchesRequestedBook} from "@/server/alexa/knowledge-query";

// Only DSM-5 and Taylor are qualified for Alexa. Stahl remains unfinished.
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

it("une question non qualifiee admet uniquement les deux livres qualifies", () => {
  const plan = planKnowledgeQuery("Quels sont les criteres du trouble panique ?")!;
  expect(plan.sourceTitle).toBeNull();
  expect(matchesRequestedBook({ source_titre: DSM5 }, plan)).toBe(true);
  expect(matchesRequestedBook({ source_titre: MAUDSLEY }, plan)).toBe(true);
  expect(matchesRequestedBook({ source_titre: STAHL }, plan)).toBe(false);
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
