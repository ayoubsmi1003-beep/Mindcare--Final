/**
 * C270 · domain "patient": 55 French turns about one patient's record, aimed at what C200–C202 barely asked (doc 19):
 * treatment details and history, note sections, the n-th previous visit, visits within a period, absent safety data,
 * age and birth date, scales, searching the notes, the first note, several requests in one sentence, diagnoses
 * (fixture), similar and identical names. `{R7}` etc. are role placeholders resolved from SQL at run time; no patient
 * name is stored in this repository.
 */
import { c, t } from "./helpers.mjs";

const D = "patient";
const G = { type: "global" };
const onPatient = (role) => ({ type: "patient", role });
const onConsult = (role, which = "last") => ({ type: "consultation", role, which });
const F = "fr";
const p = (id, form, page, say, expect) => c(id, D, "main", page, [t(say, expect, [F, form])]);
const fx = (id, form, page, say, expect) => c(id, D, "fixture", page, [t(say, expect, [F, form])], { asOf: "2026-09-27T18:00:00+01:00" });

export const cases = [
  // Treatment details and history (8)
  p("P001", "direct", onPatient("T1"), "À quelle dose et à quel rythme prend-il son traitement ?", { k: "treat_detail", r: "T1" }),
  p("P002", "wordorder", G, "Depuis quand {T2} est-il sous traitement ?", { k: "treat_start", r: "T2" }),
  p("P003", "conversational", onPatient("T3"), "La dose de son antidépresseur a-t-elle bougé depuis le début ?", { k: "prevtreat", r: "T3" }),
  p("P004", "formal", G, "Quelle était la posologie initiale du traitement de {T4} ?", { k: "prevtreat", r: "T4" }),
  p("P005", "informal", onConsult("T5"), "Il le prend le matin ou le soir, son médicament ?", { k: "treat_timing", r: "T5" }),
  p("P006", "conversational", onPatient("N1"), "Est-ce qu'un traitement médicamenteux figure dans son dossier ?", { k: "treat", r: "N1" }),
  p("P007", "direct", G, "{T1} a-t-il eu des modifications de traitement ?", { k: "prevtreat", r: "T1" }),
  p("P008", "synonym", onPatient("T2"), "Retrace-moi l'historique de ses prescriptions.", { k: "prevtreat", r: "T2" }),

  // Note sections of the last visit (6)
  p("P009", "conversational", onPatient("R1"), "Qu'est-ce que j'avais mis dans le plan la dernière fois ?", { k: "note_area", area: "plan", r: "R1" }),
  p("P010", "wordorder", G, "Sur {R2}, qu'avais-je écrit dans l'évaluation à la dernière séance ?", { k: "note_area", area: "assessment", r: "R2" }),
  p("P011", "formal", onPatient("R3"), "Pourriez-vous me relire la partie subjective de sa dernière consultation ?", { k: "note_area", area: "subjective", r: "R3" }),
  p("P012", "synonym", onPatient("R4"), "Quelles observations cliniques avais-je relevées lors du dernier entretien ?", { k: "note_area", area: "objective", r: "R4" }),
  p("P013", "direct", onPatient("R5"), "Relis-moi la conduite à tenir décidée la dernière fois.", { k: "note_area", area: "plan", r: "R5" }),
  p("P014", "short", onConsult("R6"), "Le plan de la séance précédente ?", { k: "note_area", area: "plan", r: "R6" }),

  // The n-th previous visit (3)
  p("P015", "informal", onPatient("R7"), "L'avant-dernière séance, elle date de quand ?", { k: "nthdate", n: 2, r: "R7" }),
  p("P016", "direct", G, "Quand ai-je vu {R8} juste avant sa dernière visite ?", { k: "nthdate", n: 2, r: "R8" }),
  p("P017", "conversational", onPatient("R9"), "Sa troisième séance en remontant depuis la plus récente, c'était quel jour ?", { k: "nthdate", n: 3, r: "R9" }),

  // Visits within a period (3)
  p("P018", "direct", onPatient("R10"), "En 2025, il a consulté à combien de reprises ?", { k: "count_period", range: "2025", r: "R10" }),
  p("P019", "informal", G, "{R1} a consulté combien de fois l'an passé ?", { k: "count_period", range: "lastyear", r: "R1" }),
  p("P020", "conversational", onPatient("R2"), "Depuis le début de l'année, combien de séances avec lui ?", { k: "count_period", range: "year", r: "R2" }),

  // Safety data that the record does not hold: the answer must say it is absent (4)
  p("P021", "direct", onPatient("R3"), "A-t-il des allergies connues ?", { k: "absent", section: "allergies", r: "R3" }),
  p("P022", "wordorder", G, "Des effets indésirables ont-ils été signalés chez {R4} ?", { k: "absent", section: "adverse_events", r: "R4" }),
  p("P023", "conversational", onPatient("R5"), "Son poids et sa tension ont été relevés quelque part ?", { k: "absent", section: "measurements", r: "R5" }),
  p("P024", "informal", onConsult("R6"), "On a des infos sur son observance ?", { k: "absent", section: "adherence", r: "R6" }),

  // Identity (3)
  p("P025", "short", onPatient("R7"), "Quel âge a-t-il ?", { k: "age", r: "R7" }),
  p("P026", "direct", G, "Date de naissance de {R8} ?", { k: "birthdate", r: "R8" }),
  p("P027", "conversational", onConsult("R9"), "Rappelle-moi son âge, s'il te plaît.", { k: "age", r: "R9" }),

  // Scales (2)
  p("P028", "direct", onPatient("S1"), "Quel score a-t-il obtenu à sa dernière échelle d'évaluation ?", { k: "scales", r: "S1" }),
  p("P029", "wordorder", G, "{S1} a-t-il été évalué avec une échelle, et avec quel résultat ?", { k: "scales", r: "S1" }),

  // Searching the notes (2)
  p("P030", "conversational", onPatient("R10"), "Dans ses notes, est-ce qu'il est question de sommeil ?", { k: "note_search", word: "sommeil", r: "R10" }),
  p("P031", "direct", G, "Retrouve dans les notes de {R1} les passages où il est question de fatigue.", { k: "note_search", word: "fatigue", r: "R1" }),

  // The very first note (2)
  p("P032", "conversational", onPatient("R4"), "Qu'est-ce qui avait été noté lors de sa toute première consultation ?", { k: "firstnote", r: "R4" }),
  p("P033", "formal", G, "Que disait la note de la première séance de {R5} ?", { k: "firstnote", r: "R5" }),

  // Two requests in one sentence (4)
  p("P034", "informal", G, "Brief express sur {R3} : dernière venue et traitement.", { k: "multi", parts: ["lastdate", "treat"], r: "R3" }),
  p("P035", "direct", onPatient("T3"), "Son traitement actuel et la date de sa prochaine consultation ?", { k: "multi", parts: ["treat", "nextappt"], r: "T3" }),
  p("P036", "conversational", G, "Les échelles de {S1} et la date de sa dernière séance, s'il te plaît.", { k: "multi", parts: ["scales", "lastdate"], r: "S1" }),
  p("P037", "direct", onPatient("R10"), "Quand a-t-il été vu pour la dernière fois et combien de fois au total ?", { k: "multi", parts: ["lastdate", "count"], r: "R10" }),

  // Preparing the visit, reviewing the course (3)
  p("P038", "conversational", onConsult("R2"), "Avant que je le fasse entrer, qu'est-ce que je dois savoir ?", { k: "summary", r: "R2" }),
  p("P039", "formal", onPatient("R6"), "Comment sa prise en charge a-t-elle évolué au fil des consultations ?", { k: "evolution", r: "R6" }),
  p("P040", "direct", onPatient("R7"), "Montre-moi l'ensemble de ses rendez-vous, passés et à venir.", { k: "history", r: "R7" }),

  // Names: same first name, close names, identical names, zero and two visits (5)
  p("P041", "short", G, "J'aimerais savoir quand {HA.first} est passé pour la dernière fois.", { k: "clarify", decoys: ["HA", "HB"] }),
  p("P042", "direct", G, "{SA} cumule combien de rendez-vous honorés ?", { k: "count", r: "SA", decoys: ["SB"] }),
  p("P043", "informal", G, "{DA} a-t-il été revu récemment ? Quand ?", { k: "clarify", decoys: ["DA", "DB"] }),
  p("P044", "formal", G, "{Z1} a-t-il déjà été reçu en consultation ?", { k: "count", r: "Z1" }),
  p("P045", "conversational", onPatient("F1"), "Ses deux séances, c'était quand ?", { k: "prev", n: 2, r: "F1" }),

  // Next appointment of one patient (3)
  p("P046", "direct", G, "{U1} a-t-il un rendez-vous de prévu ?", { k: "nextappt", r: "U1" }),
  p("P047", "informal", onPatient("U2"), "On le revoit quand ?", { k: "nextappt", r: "U2" }),
  p("P048", "conversational", onConsult("U3"), "La prochaine fois qu'il vient, c'est quel jour ?", { k: "nextappt", r: "U3" }),

  // Note status (1)
  p("P049", "direct", onPatient("R9"), "Sa dernière note est-elle signée ?", { k: "note_signed", r: "R9" }),

  // Diagnoses, treatments and money on the small fixture database (6)
  fx("P050", "direct", onPatient("DX1"), "Quel diagnostic est retenu pour lui ?", { k: "diag", r: "DX1" }),
  fx("P051", "short", G, "Diagnostic principal de {DX2} ?", { k: "diag", r: "DX2" }),
  fx("P052", "conversational", onPatient("DX3"), "Depuis quand ce diagnostic est-il posé ?", { k: "diag_onset", r: "DX3" }),
  fx("P053", "formal", onPatient("FT1"), "Pourriez-vous lister ses prescriptions en cours avec leurs doses ?", { k: "treat", r: "FT1" }),
  fx("P054", "direct", G, "Est-ce que {FP1} a des impayés ?", { k: "patient_outstanding", r: "FP1" }),
  fx("P055", "conversational", onPatient("FP2"), "Combien a-t-il réglé en tout depuis le début ?", { k: "patient_paid", r: "FP2" }),
];
