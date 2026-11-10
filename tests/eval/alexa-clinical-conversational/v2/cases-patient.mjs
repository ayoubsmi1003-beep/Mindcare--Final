/**
 * C201 · domain "patient": 55 new patient questions (information, history, summaries, dates, treatments).
 * Written before the run and never tuned against it. Same question kinds as C200, entirely new wording; part of them in Darija
 * (Arabic script, Latin letters, or mixed with French). `{R7}` etc. are role placeholders resolved at run time from the private oracle.
 * No patient name is stored in this repository.
 */
import { c, t } from "./helpers.mjs";

const D = "patient";
const G = { type: "global" };
const onPatient = (role) => ({ type: "patient", role });
const onConsult = (role, which = "last") => ({ type: "consultation", role, which });
const p = (id, tag, page, say, expect) => c(id, D, "main", page, [t(say, expect, tag)]);

export const cases = [
  // ── Summaries (9) ──────────────────────────────────────────────────────────
  p("V001", ["fr", "conversational"], onPatient("R7"), "Rappelle-moi un peu qui est ce patient avant qu'il entre.", { k: "summary", r: "R7" }),
  p("V002", ["fr", "short"], G, "Dossier de {R8}", { k: "summary", r: "R8" }),
  p("V003", ["la", "conversational"], onPatient("R9"), "Goulli chnou kayen f dossier dyal had l patient", { k: "summary", r: "R9" }),
  p("V004", ["ar", "conversational"], G, "عطيني فكرة على المريض {R10}", { k: "summary", r: "R10" }),
  p("V005", ["mx", "informal"], G, "Fais-moi un petit résumé dyal {R3} stp", { k: "summary", r: "R3" }),
  p("V006", ["fr", "typo"], G, "resume moi le dosier de {R5} svp", { k: "summary", r: "R5" }),
  p("V007", ["fr", "wordorder"], onConsult("R4"), "Globalement, de ce monsieur, qu'est-ce que je dois savoir ?", { k: "summary", r: "R4" }),
  p("V008", ["fr", "implicit"], onPatient("R6"), "Fais le point.", { k: "summary", r: "R6" }),
  p("V009", ["la", "short"], onPatient("R1"), "Résumé dyal had l mrid", { k: "summary", r: "R1" }),

  // ── History (6) ────────────────────────────────────────────────────────────
  p("V010", ["fr", "synonym"], G, "Retrace le parcours de {R2} au cabinet", { k: "history", r: "R2" }),
  p("V011", ["fr", "formal"], onPatient("R8"), "Pourriez-vous me présenter l'historique des consultations de ce patient ?", { k: "history", r: "R8" }),
  p("V012", ["la", "conversational"], onPatient("R10"), "3tini l'historique kamel dyalou", { k: "history", r: "R10" }),
  p("V013", ["ar", "short"], onPatient("R3"), "تاريخ المريض", { k: "history", r: "R3" }),
  p("V014", ["fr", "informal"], G, "Tout ce qui s'est passé avec {R7} jusqu'ici, ça donne quoi ?", { k: "history", r: "R7" }),
  p("V015", ["mx", "wordorder"], onConsult("R5"), "Son historique complet, 3afak", { k: "history", r: "R5" }),

  // ── How many consultations (7) ─────────────────────────────────────────────
  p("V016", ["fr", "synonym"], onPatient("R2"), "Nombre de passages au cabinet pour ce patient ?", { k: "count", r: "R2" }),
  p("V017", ["fr", "informal"], G, "{R9} est passé combien de fois chez nous ?", { k: "count", r: "R9" }),
  p("V018", ["la", "direct"], onPatient("R4"), "Kayen chhal men consultation 3and had l patient ?", { k: "count", r: "R4" }),
  p("V019", ["ar", "direct"], onPatient("R6"), "شحال من مرة جا عندنا هاد المريض", { k: "count", r: "R6" }),
  p("V020", ["mx", "conversational"], onConsult("R1"), "En tout il a fait chhal de séances avec nous ?", { k: "count", r: "R1" }),
  p("V021", ["fr", "typo"], G, "cmbien de consultatons pour {R5}", { k: "count", r: "R5" }),
  p("V022", ["fr", "implicit"], onPatient("R8"), "Au total ça fait combien de visites ?", { k: "count", r: "R8" }),

  // ── Date of the last visit (7) ─────────────────────────────────────────────
  p("V023", ["fr", "direct"], onPatient("R10"), "Quelle est la date de sa dernière séance ?", { k: "lastdate", r: "R10" }),
  p("V024", ["fr", "informal"], G, "{R6} est venu la dernière fois quand déjà ?", { k: "lastdate", r: "R6" }),
  p("V025", ["la", "conversational"], onPatient("R2"), "Wakteh kanet akhir consultation dyalou ?", { k: "lastdate", r: "R2" }),
  p("V026", ["ar", "direct"], G, "إمتى كانت آخر زيارة ديال {R4}؟", { k: "lastdate", r: "R4" }),
  p("V027", ["mx", "short"], onConsult("R7"), "Sa dernière visite kanet wakteh ?", { k: "lastdate", r: "R7" }),
  p("V028", ["fr", "wordorder"], onPatient("R3"), "La dernière fois qu'on l'a vu, c'était quand ?", { k: "lastdate", r: "R3" }),
  p("V029", ["fr", "typo"], G, "derniere visite de {R9} stp", { k: "lastdate", r: "R9" }),

  // ── Date of the first visit (4) ────────────────────────────────────────────
  p("V030", ["fr", "conversational"], onPatient("R1"), "À quelle date a-t-il commencé à venir au cabinet ?", { k: "firstdate", r: "R1" }),
  p("V031", ["la", "direct"], onPatient("R5"), "Men wakteh w howa kayji 3andna ?", { k: "firstdate", r: "R5" }),
  p("V032", ["fr", "short"], G, "Première consultation de {R2} ?", { k: "firstdate", r: "R2" }),
  p("V033", ["mx", "informal"], onConsult("R9"), "Depuis quand il est suivi hna ?", { k: "firstdate", r: "R9" }),

  // ── The last consultations (4) ─────────────────────────────────────────────
  p("V034", ["fr", "formal"], G, "Pourriez-vous me rappeler les trois dernières consultations de {R6} ?", { k: "prev", r: "R6", n: 3 }),
  p("V035", ["fr", "informal"], onPatient("R4"), "Ses deux dernières visites, c'étaient quand ?", { k: "prev", r: "R4", n: 2 }),
  p("V036", ["la", "conversational"], onPatient("R7"), "3tini ghir akhir 3 consultations dyalou", { k: "prev", r: "R7", n: 3 }),
  p("V037", ["ar", "conversational"], onPatient("R8"), "عطيني آخر جوج استشارات ديالو", { k: "prev", r: "R8", n: 2 }),

  // ── The last note (4) ──────────────────────────────────────────────────────
  p("V038", ["fr", "conversational"], onPatient("R10"), "Qu'est-ce que j'avais noté la dernière fois ?", { k: "lastnote", r: "R10" }),
  p("V039", ["fr", "direct"], G, "Montre-moi la dernière note de consultation de {R3}", { k: "lastnote", r: "R3" }),
  p("V040", ["mx", "informal"], onConsult("R2"), "Chnou ktebt f akhir note dyalou ?", { k: "lastnote", r: "R2" }),
  p("V041", ["fr", "synonym"], onPatient("R1"), "Relis-moi mes observations de la séance précédente", { k: "lastnote", r: "R1" }),

  // ── Current treatment (7) ──────────────────────────────────────────────────
  p("V042", ["fr", "synonym"], onPatient("T1"), "Quelles molécules prend-il en ce moment ?", { k: "treat", r: "T1" }),
  p("V043", ["fr", "informal"], G, "{T2} il est sous quoi comme médicaments ?", { k: "treat", r: "T2" }),
  p("V044", ["la", "direct"], onPatient("T3"), "Chnou men dwa kayakhod had l patient daba ?", { k: "treat", r: "T3" }),
  p("V045", ["ar", "direct"], onPatient("T4"), "شنو من دوا كيشرب المريض هذا دابا", { k: "treat", r: "T4" }),
  p("V046", ["mx", "conversational"], onConsult("T5"), "Il prend quels médicaments daba, w b'chhal ?", { k: "treat", r: "T5" }),
  p("V047", ["fr", "typo"], G, "ordonance actuel de {T1}", { k: "treat", r: "T1" }),
  p("V048", ["fr", "formal"], onPatient("T2"), "Pourriez-vous m'indiquer son traitement médicamenteux en cours ?", { k: "treat", r: "T2" }),

  // ── Next appointment (3) ───────────────────────────────────────────────────
  p("V049", ["fr", "conversational"], onPatient("U1"), "Il revient quand ?", { k: "nextappt", r: "U1" }),
  p("V050", ["la", "direct"], onPatient("U2"), "Wakteh l maw3id jay dyalou ?", { k: "nextappt", r: "U2" }),
  p("V051", ["fr", "wordorder"], G, "Le prochain rendez-vous de {U3}, c'est pour quand ?", { k: "nextappt", r: "U3" }),

  // ── Documents, scales, identity (4) ────────────────────────────────────────
  p("V052", ["fr", "direct"], onPatient("R4"), "Combien de documents dans son dossier ?", { k: "documents", r: "R4" }),
  p("V053", ["mx", "informal"], onPatient("R6"), "Kayen chhal men document f dossier ?", { k: "documents", r: "R6" }),
  p("V054", ["fr", "conversational"], onPatient("S1"), "A-t-il passé des échelles ? Quels scores ?", { k: "scales", r: "S1" }),
  p("V055", ["fr", "short"], onConsult("OPEN", "open"), "Je suis sur quel dossier là ?", { k: "who", r: "OPEN" }),
];
