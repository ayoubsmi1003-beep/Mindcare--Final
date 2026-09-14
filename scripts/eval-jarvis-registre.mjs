/**
 * eval-jarvis-registre — LA SURFACE ALEXA (PHASES 1-3), ÉPROUVÉE EN LA FAISANT TOURNER.
 *
 * ═══ POURQUOI CE FICHIER EXISTE ═══
 * Les phases 1 à 3 ont ajouté 4 capacités et 7 alias au registre de lecture,
 * un TTL au contexte, une clarification pronominale et une purge sur
 * ambiguïté. Chacun de ces comportements est couvert en unitaire — mais un
 * test unitaire ne prouve pas que le MODULE COMPILÉ, branché à ses vraies
 * dépendances, se comporte pareil. Cette passe charge `.eval-out/services`
 * (la compilation réelle) et fait TOURNER la surface : résolution, budgets,
 * délégation, TTL, clarification, amorce.
 *
 * ═══ CE QU'ELLE NE PROUVE PAS ═══
 * Ni la RLS (checkpoint SQL, base requise), ni le comportement avec un vrai
 * modèle (navigateur, phase 5). Les lectures DB y sont évitées par
 * construction : seuls des chemins pré-lecture (Zod) ou purs sont exécutés.
 *
 *   node scripts/eval-jarvis-registre.mjs <répertoire-des-modules-compilés>
 */

import { pathToFileURL } from "node:url";
import { join } from "node:path";

const repertoire = process.argv[2];
if (repertoire === undefined) {
  console.error("usage : node scripts/eval-jarvis-registre.mjs <dir js compilé>");
  process.exit(2);
}
const url = (f) => pathToFileURL(join(repertoire, f)).href;

let rouges = 0;
let verts = 0;
function verdict(nom, ok, detail = "") {
  if (ok) verts += 1;
  else rouges += 1;
  console.log(`  ${ok ? "vert " : "ROUGE"} | ${nom.padEnd(56)} | ${detail}`);
}

Object.defineProperty(globalThis, "navigator", {
  value: { mediaDevices: {} },
  configurable: true,
  writable: true,
});
globalThis.window = { localStorage: { getItem: () => null, setItem() {}, removeItem() {} } };

const {
  capaciteLecture,
  estCapaciteLecture,
  nomsDeLecture,
  descriptionDesCapacites,
} = await import(url("jarvis-capacites.js"));
const {
  definirCible,
  cibleCourante,
  cibleValide,
  signalerAmbiguite,
  besoinDeClarification,
  assemblerAmorce,
  TTL_CONTEXTE_MS,
} = await import(url("jarvis-contexte.js"));
const { CarteIdentite, carte, reinitialiserCarte } = await import(url("jarvis-identite.js"));

// ═══════════════════════════════════════════════════════════════════════════
// R1 — LA SURFACE : 22 capacités + 7 alias, ni plus ni moins
// ═══════════════════════════════════════════════════════════════════════════
console.log("\nR1 — la surface du registre de lecture");
{
  const directes = [
    "search_patients",
    "get_patient_context",
    "get_patient_timeline",
    "get_patient_documents",
    "get_next_patient",
    "get_today_agenda",
    "get_agenda_range",
    "get_appointment",
    "get_waiting_room",
    "get_consultation",
    "get_day_revenue",
    "get_period_revenue",
    "get_outstanding_payments",
    "get_notifications",
    "get_system_status",
    "get_current_medications",
    "get_consultation_history",
    "get_patient_financial_summary",
    "brief_prochain_patient",
    "brief_matinal",
    "brief_finance",
    "draft_patient_message",
  ];
  const alias = {
    get_agenda: "get_agenda_range",
    get_next_appointment: "get_next_patient",
    search_patient: "search_patients",
    get_patient_summary: "get_patient_context",
    get_finance_overview: "get_period_revenue",
    get_pending_payments: "get_outstanding_payments",
    get_attention_items: "get_notifications",
  };
  const attendus = [...directes, ...Object.keys(alias)].sort();
  const recus = [...nomsDeLecture()].sort();
  verdict(
    "22 directes + 7 alias, ensemble exact",
    JSON.stringify(recus) === JSON.stringify(attendus),
    `${recus.length} nom(s)`,
  );
  const manquantes = directes.filter((n) => capaciteLecture(n) === null);
  verdict("chaque directe résout", manquantes.length === 0, manquantes.join(", ") || "toutes");
  const aliasMorts = Object.entries(alias).filter(
    ([a, c]) => capaciteLecture(a) === null || capaciteLecture(c) === null,
  );
  verdict("chaque alias délègue à une cible vivante", aliasMorts.length === 0, "7 alias");
}

// ═══════════════════════════════════════════════════════════════════════════
// R2 — DÉLÉGATION ET FAIL-CLOSED, SANS BASE
// ═══════════════════════════════════════════════════════════════════════════
console.log("\nR2 — délégation des alias, refus des inconnus");
{
  const ctx = () => ({
    carte: new CarteIdentite(),
    signal: new AbortController().signal,
    aujourdHui: "2026-09-03",
  });
  // `{}` ne passe aucun schéma strict : l'échec prouve que l'alias appelle
  // bien le `lancer` (donc le Zod) de sa cible, avant toute lecture.
  const r = await capaciteLecture("get_agenda").lancer({}, ctx());
  verdict(
    "un alias invalide échoue en regle-metier avant lecture",
    r.ok === false && r.error.code === "regle-metier",
    r.ok ? "succès inattendu" : r.error.code,
  );
  const r2 = await capaciteLecture("get_patient_summary").lancer({ patientId: "pas-un-uuid" }, ctx());
  verdict(
    "un alias renomme avant de valider (patient_id rejeté par le Guid)",
    r2.ok === false && r2.error.code === "regle-metier",
    r2.ok ? "succès inattendu" : r2.error.code,
  );
  verdict("inconnu → null (proposition inconnue, jamais exécutée)", capaciteLecture("executer_sql") === null, "null");
  verdict("estCapaciteLecture cohérent", estCapaciteLecture("get_system_status") && !estCapaciteLecture("supprimer_patient"), "oui/non");
}

// ═══════════════════════════════════════════════════════════════════════════
// R3 — BUDGETS ET DESCRIPTIONS GÉNÉRÉS
// ═══════════════════════════════════════════════════════════════════════════
console.log("\nR3 — budgets bornés, descriptions composées");
{
  const horsBudget = nomsDeLecture().filter((n) => {
    const c = capaciteLecture(n);
    return c === null || c.budgetOctets <= 0 || c.budgetOctets > 12_000;
  });
  verdict("tout budget dans (0, 12000]", horsBudget.length === 0, horsBudget.join(", ") || "tous");
  const texte = descriptionDesCapacites();
  const aliasAbsents = ["get_agenda", "get_next_appointment", "get_attention_items"].filter(
    (n) => !texte.includes(`- ${n} : Alias de `),
  );
  verdict("les alias sont décrits comme alias", aliasAbsents.length === 0, "généré, jamais recopié");
}

// ═══════════════════════════════════════════════════════════════════════════
// R4 — TTL : 15 MINUTES, EXPIRÉ = ABSENT
// ═══════════════════════════════════════════════════════════════════════════
console.log("\nR4 — TTL du contexte patient");
{
  const T0 = Date.parse("2026-09-03T10:00:00+01:00");
  const A = { id: "uuid-a", libelle: "DJILALI Karim", numeroDossier: "D-101", origine: "ecran" };
  const B = { id: "uuid-b", libelle: "SAIDI Mahmoud", numeroDossier: "D-102", origine: "ecran" };
  verdict("TTL = 15 minutes", TTL_CONTEXTE_MS === 900_000, String(TTL_CONTEXTE_MS));

  definirCible(A, T0);
  verdict("cible valide à T0", cibleValide(T0)?.id === "uuid-a", "posée");
  verdict("valide à TTL-1s", cibleValide(T0 + 900_000 - 1000)?.id === "uuid-a", "tient");
  verdict("absente à TTL", cibleValide(T0 + 900_000) === null, "expirée");
  verdict("expirée = purgée, pas conservée", cibleCourante() === null, "lazy purge");

  definirCible(A, T0);
  const refA = carte().patient(A.id, A.libelle, [A.libelle]);
  definirCible(B, T0 + 1000);
  verdict("A→B : aucun jeton de A ne survit", carte().resoudre(refA) === null, "carte purgée");
  verdict("A→B : la cible est B", cibleValide(T0 + 1000)?.id === "uuid-b", "remplacée");

  definirCible(A, T0);
  signalerAmbiguite();
  verdict("ambiguïté : cible purgée, jamais devinée", cibleCourante() === null, "purge");
  reinitialiserCarte();
}

// ═══════════════════════════════════════════════════════════════════════════
// R5 — CLARIFICATION PRONOMINALE
// ═══════════════════════════════════════════════════════════════════════════
console.log("\nR5 — pronoms : la cible ou la question");
{
  const T0 = Date.parse("2026-09-03T10:00:00+01:00");
  const A = { id: "uuid-a", libelle: "DJILALI Karim", numeroDossier: "D-101", origine: "ecran" };
  definirCible(A, T0);
  verdict(
    "cible valide : aucun pronom ne déclenche",
    !besoinDeClarification("Et ses médicaments ?", T0 + 60_000),
    "chemin normal",
  );
  // Purge manuelle : la suite éprouve l'absence de cible.
  signalerAmbiguite();
  verdict("sans cible : « ses médicaments » clarifie", besoinDeClarification("Et ses médicaments ?", T0), "question");
  verdict("sans cible : « son dossier » clarifie", besoinDeClarification("Résume-moi son dossier", T0), "question");
  verdict("nom explicite : pas de clarification", !besoinDeClarification("Résume le dossier de Karim", T0), "recherche");
  verdict("agenda : pas de clarification", !besoinDeClarification("Qu'ai-je demain matin ?", T0), "opérationnel");
  definirCible(A, T0);
  verdict(
    "expirée : pronom clarifie",
    besoinDeClarification("Et la dernière séance ?", T0 + 900_000 + 1000),
    "absente",
  );
  signalerAmbiguite();
}

// ═══════════════════════════════════════════════════════════════════════════
// R6 — AMORCE : JAMAIS DE RÉFÉRENCE STALE
// ═══════════════════════════════════════════════════════════════════════════
console.log("\nR6 — l'amorce ne porte que du TTL-valide");
{
  const T0 = Date.parse("2026-09-03T10:00:00+01:00");
  const A = { id: "uuid-a", libelle: "DJILALI Karim", numeroDossier: "D-101", origine: "ecran" };
  signalerAmbiguite();
  const sans = await assemblerAmorce(reinitialiserCarte());
  verdict("sans cible : aucune patientCible", sans.patientCible === undefined, "maigre");
  definirCible(A, T0);
  // Note : l'amorce lit l'horloge réelle pour le TTL — une cible posée à T0
  // (passé) serait expirée. On repose à l'instant pour ce contrôle.
  definirCible(A, Date.now());
  const avec = await assemblerAmorce(reinitialiserCarte());
  const texte = JSON.stringify(avec);
  verdict("cible valide : jeton présent", typeof avec.patientCible === "string" && avec.patientCible.startsWith("PATIENT_"), avec.patientCible ?? "absent");
  verdict(
    "aucune identité réelle dans l'amorce",
    !texte.includes("DJILALI") && !texte.includes("D-101") && !texte.includes("uuid-a"),
    "jetons seuls",
  );
  signalerAmbiguite();
  reinitialiserCarte();
}

console.log(
  `\nVERDICT REGISTRE : ${rouges === 0 ? `VERT (${verts} vert(s))` : `ROUGE — ${rouges} contrôle(s)`}`,
);
process.exit(rouges === 0 ? 0 : 1);
