import { sanitizeAlexaEvaluationArtifact } from "../../scripts/lib/alexa-eval-artifact.mjs";
import { describe, expect, it } from "vitest";
import { frenchRequestAdmission, isClosedDrugQuestion, questionConcernsAPerson } from "@/shared/alexa/request-contract";
import { evaluateV8KnowledgeOracle } from "../../scripts/lib/alexa-v8-adversarial-evaluator.mjs";

const toBooks = (text: string) => { const tools = frenchRequestAdmission(text, false).tools ?? []; return tools.length === 1 && tools[0] === "search_knowledge"; };

describe("these questions about a patient or the practice don't go to the books", () => {
  for (const text of [
    "Lithium chez Benali ?", "Benali prend du lithium ?", "Dose de Karim ?", "Posologie de Benali ?", "Diagnostic de Benali ?", "Traitement de Benali ?",
    "Comment soigner Amina ?", "Il prend du lithium ?", "Leur lithium ?", "L’ordonnance de lithium de Benali ?",
    "Quelle dose de sertraline pour Karim Benali âgé de 70 ans ?", "Lithium chez Karim Benali adulte ?", "Quelle dose de lithium chez Amina Benali enceinte ?",
    "Bilan financier de janvier ?", "Taux d’encaissement du mois ?", "Taux de remplissage de l’agenda ?", "Bilan du cabinet ?",
    "Son lithium ?", "Sertraline de la patiente ?", "Arrete le lithium de Benali ?",
    "Que faire pour son TDAH ?", "Que faire pour sa dépendance aux opiacés ?", "Que faire pour la dépendance de Benali ?", "Que faire pour la dyskinésie de Karim Benali ?", "Que faire pour le sevrage de Mme Benali ?",
    "Que faire du bilan financier ?", "Que faire du bilan du cabinet ?",
    "Quelle dose de lithium pour Benali ?", "Quelle dose de lithium pour benali ?", "Quel traitement pour Amina ?", "Comment traiter l'anxiété de Karim ?", "Quelle posologie pour mon patient ?", "Quel traitement pour ma patiente ?",
    "Quelle dose de lithium pour M. Benali ?", "Comment traiter l'anxiété de Karim Benali ?", "Karim Benali a 45 ans, quelle dose de lithium ?", "Benali prend du lithium, quelle dose ?", "Quelle dose de lithium pour ce patient ?", "Quelle dose pour mon fils ?", "Quelle est sa dose de lithium ?", "La lithémie d'Ahmed est-elle trop haute ?",
    "quelle dose de lithium pour m. benali ?", "Quelle est la dose du patient ?", "Le patient prend du lithium, quelle dose ?", "Quelle dose pour mon malade ?", "Quelle dose pour ma belle-mère ?", "Quel est son taux de lithium ?", "karim prend du lithium, quelle dose ?",
    "Quel est le bilan de la semaine ?", "Quel est le taux de présence ?",
    "Quel est le bilan du mois ?", "Quel est le taux de TVA ?", "Quel taux d'occupation ?", "Quelle est la durée moyenne des rendez-vous ?", "Quel traitement comptable pour les remises ?",
    "Quel bilan du cabinet ?", "Quel taux d'encaissement ?", "Quelles sont les recettes du mois ?", "Quel taux de remplissage ?",
  ]) it(text, () => expect(toBooks(text)).toBe(false));
});

describe("a closed drug question goes to the books", () => {
  for (const text of ["Posologie de la rispéridone ?", "L'escitalopram chez le sujet âgé ?", "Effets indésirables de la duloxétine ?", "La fluoxétine pendant la grossesse ?", "Le lorazépam chez l'insuffisant rénal ?", "Surveillance sous quétiapine ?", "Comment traiter la dépendance aux opioïdes ?", "Que faire en cas de dyskinésie tardive ?", "Que faire devant une akathisie ?"]) {
    it(text, () => { expect(isClosedDrugQuestion(text)).toBe(true); expect(toBooks(text)).toBe(true); });
  }
  for (const text of ["Le lithium chez Benali ?", "Posologie de Benali ?", "La sertraline chez Karim Benali ?", "Sertraline ?"]) {
    it(`not: ${text}`, () => expect(isClosedDrugQuestion(text)).toBe(false));
  }
});

describe("a book question about a condition isn't about a person", () => {
  for (const text of ["Quel traitement pour la dépression ?", "Quelle dose de sertraline chez l'enfant ?", "Quel traitement pour traiter la manie ?", "Quelle dose chez adulte ?", "Quel traitement pour TDAH ?", "Quels sont les symptômes de la maladie de Parkinson ?", "Quel traitement de la maladie d'Alzheimer ?", "Quelle est la posologie du lithium ?", "Quel traitement de la dépression de Hamilton ?"]) {
    it(text, () => expect(questionConcernsAPerson(text)).toBe(false));
  }
  for (const text of ["Son lithium ?", "Sa sertraline ?", "Quelle dose de lithium pour Benali ?", "Quel traitement chez Amina ?", "Comment traiter l'anxiété de Karim ?", "Quelle posologie pour mon patient ?"]) {
    it(`it is: ${text}`, () => expect(questionConcernsAPerson(text)).toBe(true));
  }
});

const REFERENCES = "Voici les passages les plus proches de votre question. Ils viennent des livres, pas d’un dossier patient, et je n’ai pas vérifié qu’ils y répondent ni qu’ils s’appliquent à votre cas : lisez-les dans le livre, avec leur contexte.";

describe("the evaluator's section label", () => {
  const section = "Lithium › Dosing", other = "Valproate › Dosing";
  const oracle = { kind: "knowledge_case", caseId: "c", answerable: true };
  const sourceCase = { id: "c", answerable: true, attendu: { source: "Guide", section: [["Lithium"]] } };
  const source = (part: string, excerpt: string, version = "v1") => ({ id: part, type: "knowledge", label: `Guide · ${part} · ${version} · p. 1`, version, excerpt, provenance: { pagePdf: 1 } });
  const judge = (text: string, sources: unknown[]) => evaluateV8KnowledgeOracle({ oracle, sourceCase, observations: [{ knowledgeTraces: [{ result: "ok" }], events: [{ type: "sentence", text, sources }] }] }).checks.find((check: { id: string }) => check.id === "answer_evidence");
  const a = "Lithium usual dose is stated here.", b = "Valproate usual dose is stated here.";
  it("passes right before the source's own excerpt, and says it relied on the amendment", () => {
    expect(judge(`Passage cité (${section}) : « ${a} »`, [source(section, a)])).toEqual({ id: "answer_evidence", status: "PASS", originalRule: "NOT VERIFIED" });
  });
  it("the references opening is framing, and says it relied on the amendment", () => {
    expect(judge(`${REFERENCES} Passage cité : « ${a} »`, [source(section, a)])).toEqual({ id: "answer_evidence", status: "PASS", originalRule: "NOT VERIFIED" });
  });
  it("other prose around references isn't", () => {
    expect(judge(`${REFERENCES} Prescrire 900 mg. Passage cité : « ${a} »`, [source(section, a)])?.status).toBe("NOT VERIFIED");
  });
  it("a plain quote passes under both rules", () => expect(judge(`Passage cité : « ${a} »`, [source(section, a)])).toEqual({ id: "answer_evidence", status: "PASS" }));
  it("fails with another cited source's section", () => {
    expect(judge(`Passage cité (${other}) : « ${a} » Passage cité : « ${b} »`, [source(section, a), source(other, b)])?.status).toBe("NOT VERIFIED");
  });
  it("fails with a section from a source with no excerpt", () => {
    expect(judge(`Passage cité (${other}) : « ${a} »`, [source(section, a), source(other, "")])?.status).toBe("NOT VERIFIED");
  });
  it("a version isn't a section", () => {
    expect(judge(`Passage cité (v1) : « ${a} »`, [{ ...source(section, a), label: "Guide · v1 · p. 1", section: undefined }, source(section, a)])?.status).toBe("NOT VERIFIED");
  });
  it("fails with text that isn't a section at all", () => {
    expect(judge(`Passage cité (Prescrire 900 mg) : « ${a} »`, [source(section, a)])?.status).toBe("NOT VERIFIED");
  });
});

describe("book questions the guards must leave alone", () => {
  it.each(["Quel est le traitement du TDAH chez l'enfant ?", "Quelle dose de méthylphénidate pour le TDAH chez l'enfant ?", "Quel traitement du TDAH chez l'adulte ?", "Quelle dose de lithium chez le sujet âgé ?", "Quels effets du lithium chez le patient âgé ?", "Comment faire la remise en route de la clozapine après interruption ?", "Quelle fréquence de rendez-vous de surveillance sous clozapine ?"])("%s", text => {
    expect(toBooks(text)).toBe(true);
  });
});

describe("a person named after a population word stays a person", () => {
  it.each(["Dossier de l'enfant Karim Benali", "Résumé du dossier de l'enfant Karim Benali", "Prends rendez-vous demain à 10h pour l'enfant", "Prépare une ordonnance pour l'enfant"])("%s", text => {
    expect(toBooks(text)).toBe(false);
  });
});

describe("the campaign report", () => {
  it("keeps the original-rule score and the flag it is counted from", () => {
    const report = sanitizeAlexaEvaluationArtifact({ version: 1, status: "FAIL", passingUnderOriginalRule: 7, rows: [{ id: "ADV-001", status: "PASS", oracleChecks: [{ oracleIndex: 1, kind: "knowledge_case", checks: [{ id: "answer_evidence", status: "PASS", originalRule: "NOT VERIFIED" }] }] }], records: [] });
    expect(report.passingUnderOriginalRule).toBe(7);
    expect(JSON.stringify(report.rows)).toContain('"originalRule":"NOT VERIFIED"');
  });
});

describe("a question about the record stays with the record, whatever its ending", () => {
  it.each(["Quels patients ont un trouble bipolaire chez l'adulte ?", "Quel traitement en cours chez l'adolescent ?", "Quels traitements actuels chez les sujets âgés ?", "Quel est le bilan noté chez la personne âgée ?", "Quels diagnostics actifs au dossier chez l'adulte ?", "Quels traitements dans le dossier chez l'enfant ?", "Combien de dossiers actifs sans téléphone ? Ensuite, quel traitement de la manie chez l'enfant ?"])("%s", text => {
    expect(toBooks(text)).toBe(false);
  });
});
