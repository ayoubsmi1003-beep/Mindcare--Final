/**
 * C201 · HOLDOUT: 30 unseen reformulations, written with the main set but kept apart. They are run once, AFTER the main evaluation and
 * after its results are saved; nothing in the application was tuned on them. They measure whether the wording generalises.
 * (Each reformulates the intent of a main case with other words; the book ones keep the verified facts of the same approved passage.)
 */
import { c, t } from "./helpers.mjs";

const D = "holdout";
const G = { type: "global" };
const AT = { asOf: "2026-10-26T09:30:00+01:00" };
const FIN = { asOf: "2026-09-27T18:00:00+01:00" };
const onPatient = (role) => ({ type: "patient", role });
const onConsult = (role, which = "last") => ({ type: "consultation", role, which });
const h = (id, tag, page, say, expect, options = {}) => c(id, D, "main", page, [t(say, expect, tag)], options);
const book = (id, tag, say, ...facts) => h(id, tag, G, say, { k: "book", alts: [{ textAll: facts }], quoteFacts: facts });

export const cases = [
  // ── Patients and context (12) ──────────────────────────────────────────────
  h("H001", ["fr", "implicit"], onPatient("R1"), "Il en est à combien de séances jusqu'à maintenant ?", { k: "count", r: "R1" }),
  h("H002", ["fr", "informal"], G, "Donne-moi un coup d'œil rapide sur {R3}", { k: "summary", r: "R3" }),
  h("H003", ["fr", "informal"], onPatient("T2"), "Qu'est-ce qu'il avale comme comprimés ?", { k: "treat", r: "T2" }),
  h("H004", ["fr", "conversational"], onConsult("R5"), "Quand l'ai-je reçu pour la première fois ?", { k: "firstdate", r: "R5" }),
  h("H005", ["fr", "formal"], G, "Quelles ont été les trois dernières entrevues avec {R7} ?", { k: "prev", r: "R7", n: 3 }),
  h("H006", ["fr", "conversational"], onPatient("R2"), "Rappelle-moi ce que j'ai écrit après sa dernière visite", { k: "lastnote", r: "R2" }),
  h("H007", ["la", "direct"], onPatient("R4"), "Chhal men mara dkhel l consultation had l mrid ?", { k: "count", r: "R4" }),
  h("H008", ["ar", "formal"], G, "المعلومات ديال {R6} لو سمحتي", { k: "summary", r: "R6" }),
  h("H009", ["mx", "conversational"], onConsult("T1"), "Daba chnou kayakhod mn dwa w ch7al ?", { k: "treat", r: "T1" }),
  h("H010", ["fr", "otherpatient"], onPatient("R8"), "Et {R9} ? Quelle est sa dernière date de présence ?", { k: "lastdate", r: "R9", decoys: ["R8"] }),
  c("H011", D, "main", G, [
    t("Que sait-on de {T3} ?", { k: "summary", r: "T3" }, ["fr", "direct"]),
    t("Il suit quoi comme traitement ?", { k: "treat", r: "T3" }, ["fr", "pronoun"])]),
  h("H012", ["fr", "short"], G, "Des nouvelles de {HA.first} ?", { k: "clarify", decoys: ["HA", "HB"] }),

  // ── Agenda (6) ─────────────────────────────────────────────────────────────
  h("H013", ["fr", "direct"], G, "Combien de rendez-vous m'attendent aujourd'hui ?", { k: "a_count", day: "today" }, AT),
  h("H014", ["fr", "wordorder"], G, "Mes patients de demain, la liste ?", { k: "a_list", day: "tomorrow" }, AT),
  h("H015", ["fr", "conversational"], G, "À quelle heure arrive mon prochain patient ?", { k: "a_next" }, AT),
  h("H016", ["la", "direct"], G, "Chhal men maw3id 3andi ghedda ?", { k: "a_count", day: "tomorrow" }, AT),
  c("H017", D, "main", G, [
    t("Qui vois-je aujourd'hui ?", { k: "a_list", day: "today" }, ["fr", "direct"]),
    t("Même chose pour hier", { k: "a_list", day: "yesterday" }, ["fr", "period"])], AT),
  h("H018", ["fr", "direct"], G, "Quel est le tout dernier rendez-vous aujourd'hui ?", { k: "a_last", day: "today" }, AT),

  // ── Money and activity (6) ─────────────────────────────────────────────────
  c("H019", D, "fixture", G, [t("Quel est le montant total des encaissements d'aujourd'hui ?", { k: "f_revenue", range: "today" }, ["fr", "formal"])], FIN),
  c("H020", D, "fixture", G, [t("Que doit-on encore recevoir ?", { k: "f_outstanding", range: "month" }, ["fr", "informal"])], FIN),
  c("H021", D, "fixture", G, [t("شحال خلصو المرضى هاد الأسبوع", { k: "f_revenue", range: "week" }, ["ar", "direct"])], FIN),
  c("H022", D, "fixture", G, [
    t("Recettes du mois ?", { k: "f_revenue", range: "month" }, ["fr", "short"]),
    t("Pareil pour le mois précédent", { k: "f_revenue", range: "lastmonth" }, ["fr", "period"])], FIN),
  h("H023", ["fr", "formal"], G, "Combien de patients distincts ont été vus ce mois-ci ?", { k: "n_patients_seen", range: "month" }, AT),
  h("H024", ["fr", "direct"], G, "Nombre de consultations réalisées la semaine dernière ?", { k: "n_consults", range: "lastweek" }, AT),

  // ── Medical knowledge (6): other words, same approved passages ─────────────
  book("H025", ["fr", "conversational"], "Que dit-on de la prévalence du mutisme sélectif chez l'enfant ?", "relativement rare", "0,03 et 1 %"),
  book("H026", ["fr", "informal"], "Y a-t-il un lien entre lithium et malformation cardiaque du fœtus ?", "ebstein"),
  book("H027", ["fr", "conversational"], "Jusqu'à quand continuer la varénicline chez quelqu'un qui a arrêté de fumer ?", "varenicline", "additional 12 weeks"),
  book("H028", ["fr", "direct"], "Combien d'heures après la dernière prise faut-il faire la lithémie ?", "trough", "12 hours after the last dose"),
  book("H029", ["fr", "direct"], "Quels symptômes caractérisent une personnalité borderline ?", "instabilite des relations interpersonnelles", "impulsivite marquee"),
  book("H030", ["fr", "formal"], "Sur quelles structures la prégabaline se fixe-t-elle ?", "alpha 2 delta", "calcium channels"),
];
