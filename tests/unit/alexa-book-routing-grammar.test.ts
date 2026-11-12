import { describe, expect, it } from "vitest";
import { parsePatientMention } from "@/shared/alexa/patient-mention";
import { patientQuestionFrame } from "@/shared/alexa/patient-question";
import { frenchRequestAdmission } from "@/shared/alexa/request-contract";

// Development wordings, never C270/H270.
const ASOF = "2026-10-26T09:30:00+01:00";
const tools = (text: string) => frenchRequestAdmission(text, false, ASOF).tools ?? [];

describe("a book question is not taken for a patient by its grammar", () => {
  it("never reads a function word, a purpose or an indefinite patient as a name", () => {
    for (const text of [
      "C'est quoi au juste la trichotillomanie ?",
      "Le lithium a-t-il une place contre la manie ?",
      "Combien de temps faut-il pour affirmer une dysthymie ?",
      "Chez une patiente enceinte, la lamotrigine est-elle sûre ?",
      "Un patient agité sous olanzapine, quelle conduite ?",
      "Une cure de kétamine dure combien de temps ?",
    ]) {
      expect(parsePatientMention(text), text).toEqual({ status: "none" });
      expect(tools(text), text).toEqual(["search_knowledge"]);
    }
  });
  it("keeps real names, after « pour », after « la patiente », and a lone first name", () => {
    expect(parsePatientMention("Prépare un certificat pour Amine Brahimi.")).toEqual({ status: "named", name: "Amine Brahimi" });
    expect(parsePatientMention("Quel est le traitement de la patiente Amina Kaci ?")).toEqual({ status: "named", name: "Amina Kaci" });
    expect(parsePatientMention("Quel est le traitement pour Samir ?")).toEqual({ status: "named", name: "Samir" });
    expect(patientQuestionFrame("Quelle est la posologie de Marion Dupont ?", { contextPatient: false, followup: false }, ASOF)?.text).toBe("Quel est le traitement de Marion Dupont ?");
  });
  it("reads « est-il », « sont-ils » as a question about the topic before it", () => {
    for (const text of ["La buspirone est-elle addictive ?", "Les ISRS sont-ils efficaces dans le TOC ?", "L'halopéridol est-il utile en cas d'agitation aiguë ?"]) expect(tools(text), text).toEqual(["search_knowledge"]);
  });
});

describe("a write verb that describes is no command", () => {
  it("sends a verb with its own subject, in a « si » or « quand » clause or asked about, to the books", () => {
    for (const text of [
      "Que risque-t-on si on arrête brutalement la paroxétine ?",
      "Qu'est-ce qui se passe quand on passe de la venlafaxine à la duloxétine ?",
      "Lorsqu'un patient arrête le tabac sous clozapine, que faut-il surveiller ?",
      "Sous lithium, la dose change-t-elle avec l'âge ?",
    ]) expect(tools(text), text).toEqual(["search_knowledge"]);
  });
  it("keeps every command, and any verb about a named or possessed patient, out of the books", () => {
    expect(tools("Arrête la sertraline.")).toEqual(["prepare_action"]);
    for (const text of ["On arrête le lithium de Karim Benali ?", "Faut-il arrêter son lithium ?", "Change la dose de sertraline de Karim Benali."]) expect(tools(text), text).not.toContain("search_knowledge");
  });
});
