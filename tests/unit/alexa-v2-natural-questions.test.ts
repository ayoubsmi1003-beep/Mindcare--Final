import { describe, expect, it } from "vitest";
import { planRequest } from "@/shared/alexa/request-plan";
import { parsePatientMention, patientMention } from "@/server/alexa/patient-mention";

describe("ordinary multilingual Alexa questions", () => {
  it.each(["Bonjour Alexa", "Salut !", "Bonsoir", "السلام عليكم", "صباح الخير", "salam alaykoum"])("answers the greeting %s", text => {
    expect(planRequest(text, null)).toMatchObject({ intent: "dialogue", dialogueAct: "hello" });
  });
  it.each(["Merci beaucoup", "Merci بزاف", "يعطيك الصحة", "شكرا", "صحا"])("acknowledges %s", text => {
    expect(planRequest(text, null)).toMatchObject({ intent: "dialogue", dialogueAct: "thanks" });
  });
  it.each(["Alexa", "Alexa, tu es là ?", "Tu es prête ?", "واش راكي هنا؟", "راك هنا Alexa؟"])("answers a presence check locally: %s", text => {
    expect(planRequest(text, null)).toMatchObject({ intent: "dialogue", dialogueAct: "presence" });
  });
  it.each(["Quelle est la dose de sertraline ?", "Quels sont les effets indésirables de sertraline ?", "Quelles contre-indications pour la sertraline ?", "Comment fonctionne la sertraline ?", "ما هي جرعة السيرترالين؟", "واش هي جرعة السيرترالين؟"])("uses books for a general medication question without reading an active patient: %s", text => {
    expect(planRequest(text, { intent: "treatments", count: 1 })).toMatchObject({ intent: "knowledge" });
    expect(patientMention(text)).toBeUndefined();
  });
  it.each(["Quelle dose de sertraline prend ce patient ?", "Quelle est sa dose de sertraline ?", "Quelle dose de sertraline prend Nadia Test ?", "dose de sertraline pour Nadia Test", "La dose de «Lithium»"])("preserves explicit record scope in a medication question: %s", text => {
    expect(planRequest(text, null).intent).toBe("treatments");
  });
  it("distinguishes a medicine topic from a name while retaining a separately named patient", () => {
    expect(patientMention("dose de sertraline pour Nadia Test")).toBe("Nadia Test");
    expect(patientMention("traitement du patient Lithium")).toBe("Lithium");
    expect(patientMention("Quelle dose de sertraline prend Nadia Test ?")).toBe("Nadia Test");
  });
  it.each(["Quelle dose de sertraline prend-il ?", "Quelle dose de sertraline prend-elle ?"])("reads the working patient's dose without treating medication and pronouns as a name: %s", text => {
    expect(patientMention(text)).toBeUndefined();
    expect(planRequest(text, null).intent).toBe("treatments");
  });
  it.each(["Que peux-tu faire ?", "Comment peux-tu m'aider ?", "واش تقدري تديري؟", "Aide Alexa"])("explains its capabilities for %s", text => {
    expect(planRequest(text, null)).toMatchObject({ intent: "dialogue", dialogueAct: "help" });
  });
  it.each(["Quel est son diagnostic ?", "Les diagnostics du dossier", "واش هو التشخيص تاعو؟", "تشخيص المريض", "Diagnostic actuel", "ما هو تشخيص «Nadia Test»؟", "واش هو التشخيص تاع «Nadia Test»؟"])("reads recorded diagnoses for %s", text => {
    expect(planRequest(text, null)).toMatchObject({ intent: "diagnoses" });
  });
  it.each(["Quel est le diagnostic de Nadia Test ?", "Diagnostic de nadia test", "Quels sont les symptômes de Nadia Test ?"])("does not turn a named record question into general knowledge: %s", text => {
    expect(planRequest(text, null).intent).toBe(/symptômes/u.test(text) ? "notes" : "diagnoses");
  });
  it.each(["Quels sont les symptômes de schizophrénie ?", "Quels sont les symptômes de trouble bipolaire ?"])("keeps ordinary clinical topics out of identity resolution: %s", text => {
    expect(planRequest(text, null).intent).toBe("knowledge");
    expect(patientMention(text)).toBeUndefined();
  });
  it.each(["Que disait la dernière consultation ?", "Les notes de la dernière séance", "واش قال في آخر جلسة؟", "آخر جلسة واش فيها؟"])("reads the recorded visit narrative for %s", text => {
    expect(planRequest(text, null)).toMatchObject({ intent: "history", count: 1 });
  });
  it.each(["Compare les deux dernières consultations", "قارن آخر 2 جلسات", "Compare آخر ٢ consultations"])("compares the requested visits for %s", text => {
    expect(planRequest(text, null)).toMatchObject({ intent: "history", count: 2, operation: "compare" });
  });
  it.each(["Comment évolue son sommeil ?", "كيفاش راه النوم تاعو من البداية؟", "Evolution du sommeil"])("uses the record for longitudinal symptom questions: %s", text => {
    expect(planRequest(text, null)).toMatchObject({ intent: "longitudinal", focus: "sleep" });
  });
  it.each(["Quels sont ses symptômes ?", "Que disent les notes sur son anxiété ?", "واش هي الاعراض تاعو؟"])("uses patient notes for %s", text => {
    expect(planRequest(text, null)).toMatchObject({ intent: "notes" });
  });
  it.each(["Quelle est la différence entre dépression et anxiété ?", "Quels sont les symptômes de la dépression ?", "ما هي أعراض الاكتئاب؟", "واش الفرق بين الاكتئاب و القلق؟"])("keeps general clinical questions in governed knowledge: %s", text => {
    expect(planRequest(text, null)).toMatchObject({ intent: "knowledge" });
  });
  it.each(["Combien de rendez-vous aujourd'hui ?", "شحال عندي rdv اليوم؟", "Mes rendez-vous du jour"])("understands ordinary agenda paraphrases: %s", text => {
    expect(planRequest(text, null)).toMatchObject({ intent: "agenda" });
  });
  it.each(["Qui arrive ensuite ?", "Qui vient après ?", "Résume-moi ma journée", "Aide-moi à préparer ma journée"])("understands the app's own daily questions: %s", text => {
    expect(planRequest(text, null)).toMatchObject({ intent: "agenda" });
  });
  it.each(["Explique-moi le score de Hamilton", "Comment interpréter un score PHQ-9 ?", "اشرح مقياس هاملتون", "Explique le score de MADRS", "Explique le score de PHQ-9", "Explique le score de GAD-7"])("uses governed knowledge for general scale explanations: %s", text => {
    expect(planRequest(text, null).intent).toBe("knowledge");
    expect(patientMention(text)).toBeUndefined();
  });
  it.each(["Explique le score PHQ-9 de Nadia Test", "Interprète le score de Nadia Test", "Explique le score de Hamilton pour Nadia Test", "Explique le score PHQ-9 de «Nadia Test»", "Explique le score PHQ-9 de Nadia Test et de Karim Test"])("keeps an explicit patient reference on the recorded scales path: %s", text => {
    expect(planRequest(text, null).intent).toBe("scales");
  });
  it("separates books from recorded scales in a named mixed question", () => {
    expect(planRequest("Explique le score PHQ-9 de Nadia Test selon les livres", null)).toMatchObject({ intent: "scales", includeKnowledge: true });
    expect(planRequest("Explique le score de Hamilton selon les livres", null)).toMatchObject({ intent: "knowledge" });
  });
  it("keeps a named diagnosis and its requested book references separate", () => {
    expect(planRequest("Quel est le diagnostic de Nadia Test selon les livres ?", null)).toMatchObject({ intent: "diagnoses", includeKnowledge: true });
  });
  it("does not consume a second name introducer while reading the first candidate", () => {
    expect(patientMention("Explique le score de Hamilton pour Nadia Test")).toBe("Nadia Test");
    expect(parsePatientMention("Le score de Nadia pour Karim").status).toBe("ambiguous");
  });
  it("opens the local search page for the existing dossier-search suggestion", () => {
    expect(planRequest("Rechercher un dossier", null)).toMatchObject({ intent: "navigation", navigationTarget: "patients" });
  });
  it("retains the confirmation cycle for the existing document-draft suggestion", () => {
    expect(planRequest("Préparer un brouillon de document", null).intent).toBe("proposal");
  });
  it("does not replace a request with a greeting or thanks", () => {
    expect(planRequest("Bonjour Alexa, le traitement actuel s'il te plaît", null).intent).toBe("treatments");
    expect(planRequest("Merci, et les cinq dernières consultations ?", null)).toMatchObject({ intent: "history", count: 5 });
  });
  it("keeps an elliptical summary on the previously requested history page", () => {
    const before = { id: "00000000-0000-4000-8000-000000000001", startedAt: "2026-01-01T12:00:00Z" };
    const previous = { intent: "history" as const, count: 5, cursor: { ...before, id: "00000000-0000-4000-8000-000000000002" }, selectionBefore: before };
    expect(planRequest("Résume-les", previous)).toMatchObject({ intent: "history", count: 5, operation: "summarize", before });
    expect(planRequest("Et son sommeil ?", previous)).toMatchObject({ intent: "history", count: 5, focus: "sleep", before });
  });
  it.each(["dernier diagnostic", "notes cliniques", "symptômes actuels", "diagnostic de la dépression", "notes de la dernière consultation", "traitement de son anxiété"])("does not mistake ordinary clinical wording for a patient name: %s", text => {
    expect(patientMention(text)).toBeUndefined();
  });
  it("keeps explicit names local and refuses unsupported counts", () => {
    expect(patientMention("diagnostic de «Nadia Test»")).toBe("Nadia Test");
    expect(planRequest("Compare les 101 dernières consultations", null).intent).toBe("clarify");
    expect(planRequest("Supprime le diagnostic", null).intent).toBe("proposal");
    expect(planRequest("Compare les médicaments selon le DSM", null).intent).toBe("knowledge");
  });
  it.each(["Quelle dose prend-il ?", "Sa posologie", "L'ordonnance actuelle", "واش ياخذ دوا؟", "الجرعة الحالية", "La fréquence des prises"])("reads recorded medication details for %s", text => {
    expect(planRequest(text, null).intent).toBe("treatments");
    expect(patientMention(text)).toBeUndefined();
  });
  it.each(["La consultation en cours", "Les notes de la séance actuelle", "الجلسة الحالية"])("keeps an open consultation separate for %s", text => {
    expect(planRequest(text, null)).toMatchObject({ intent: "current_consultation", count: 1 });
  });
  it.each(["Ses scores aux échelles", "Dernier score PHQ-9", "نتائج المقاييس تاعو"])("reads recorded scales for %s", text => {
    expect(planRequest(text, null).intent).toBe("scales");
  });
  it.each(["C'est quoi le trouble bipolaire ?", "Comment diagnostiquer une dépression ?", "Quels traitements pour l'anxiété ?", "ما هو علاج الاكتئاب؟"])("keeps general medical questions free of patient scope: %s", text => {
    expect(planRequest(text, null).intent).toBe("knowledge");
    expect(patientMention(text)).toBeUndefined();
  });
  it.each(["diagnostic Nadia Test", "notes Nadia Test", "Ouvre le dossier Nadia Test", "diagnostic de Nadia Test s'il te plaît"])("recognizes the explicit dossier name in %s", text => {
    expect(patientMention(text)).toBe("Nadia Test");
  });
  it.each(["notes sur son anxiété", "score actuel", "diagnostic selon le DSM", "traitement actuel s'il te plaît"])("does not turn modifiers or courtesy into a name: %s", text => {
    expect(patientMention(text)).toBeUndefined();
  });
  it.each(["Quels diagnostics sont enregistrés ?", "Quelles notes ont été enregistrées ?", "Le traitement est-il efficace ?", "Les notes indiquent-elles une amélioration ?", "Quel est le diagnostic retenu ?"])("keeps grammatical clinical questions out of identity extraction: %s", text => {
    expect(patientMention(text)).toBeUndefined();
  });
  it("reads how the active patient is doing without interpreting va as a navigation command", () => {
    expect(planRequest("Comment va ce patient ?", null)).toMatchObject({ intent: "summary" });
  });
  it.each(["N'ouvre pas l'agenda", "Ne va pas au dossier", "لا تفتح ملف المريض"])("does not perform a negated navigation: %s", text => {
    expect(planRequest(text, null).intent).toBe("clarify");
  });
  it.each(["ما هو تشخيص الاكتئاب؟", "ما هو التشخيص التفريقي للاكتئاب؟"])("keeps general Arabic diagnosis questions in governed knowledge: %s", text => {
    expect(planRequest(text, null).intent).toBe("knowledge");
  });
});
