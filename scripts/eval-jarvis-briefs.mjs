/**
 * eval-jarvis-briefs — LES BRIEFS NE FABRIQUENT AUCUN FAIT.
 *
 * ═══ LE CONTRÔLE QUI COMPTE ═══
 * Chaque chiffre du brief doit se retrouver dans les données d'entrée. Un brief
 * dont un nombre n'a pas d'antécédent est une hallucination — et c'est le seul
 * défaut de cette couche qu'on ne verrait PAS à l'écran, parce qu'un chiffre
 * plausible ressemble en tout point à un chiffre vrai.
 *
 * Fonctions PURES : aucune base, aucun réseau, aucun modèle.
 *
 *   node scripts/eval-jarvis-briefs.mjs <répertoire-des-modules-compilés>
 */

import { pathToFileURL } from "node:url";
import { join } from "node:path";

const repertoire = process.argv[2];
if (repertoire === undefined) {
  console.error("usage : node scripts/eval-jarvis-briefs.mjs <dir js compilé>");
  process.exit(2);
}
const url = (f) => pathToFileURL(join(repertoire, f)).href;

const {
  composerBriefProchainPatient,
  composerBriefMatinal,
  composerBriefFinance,
  DOMAINES_ABSENTS,
} = await import(url("jarvis-briefs.js"));
const { composerRappelRendezVous, composerDocumentPret, estRefus } = await import(
  url("jarvis-messages.js")
);

let rouges = 0;
function verdict(nom, ok, detail) {
  if (!ok) rouges++;
  console.log(`  ${ok ? "vert " : "ROUGE"} | ${nom.padEnd(58)} | ${detail}`);
}

const SRC = [{ porte: "app.dashboard_today", luA: "2026-08-26T08:00:00Z", tronque: false }];
const MAINTENANT = Date.parse("2026-08-26T09:00:00+01:00");

const creneau = {
  ref: "RDV_001",
  patient: "PATIENT_001",
  debut: "2026-08-26T14:00:00+01:00",
  fin: "2026-08-26T14:30:00+01:00",
  dureeMinutes: 30,
  statut: "scheduled",
  type: "suivi",
  arriveA: null,
};

const patient = {
  ref: "PATIENT_001",
  age: 34,
  sexe: "F",
  actif: true,
  clinique: {
    diagnostics: [
      { code: "F41.1", systeme: "CIM-10", libelle: "Trouble anxieux généralisé", principal: true, depuis: "2024-02-01", resoluLe: null },
      { code: "F32.0", systeme: "CIM-10", libelle: "Épisode dépressif léger", principal: false, depuis: "2023-01-01", resoluLe: "2024-06-01" },
    ],
    echelles: [
      { code: "HAM-A", nom: "Hamilton anxiété", score: 24, le: "2026-08-01", scorePrecedent: 18, delta: 6 },
    ],
    derniereConsultation: { le: "2026-04-01T10:00:00+01:00", type: "suivi", close: true },
    nombreConsultations: 7,
  },
  traitements: {
    dernierePrescriptionLe: "2026-04-01T10:35:00+01:00",
    lignes: [{ designation: "Sertraline", dose: "50 mg", frequenceParJour: 1, dureeJours: 30 }],
    nombrePrescriptions: 4,
    historiqueIncomplet: true,
  },
  agenda: { prochainRendezVous: null, dernierRendezVous: null, nombreRendezVous: 9 },
  documents: { nombre: 2, dernierEmisLe: null },
  provenance: [{ porte: "app.get_patient_workspace", luA: "2026-08-26T08:00:00Z", tronque: false }],
};

// ═══════════════════════════════════════════════════════════════════════════
// R1 · PROCHAIN PATIENT — les quatre registres
// ═══════════════════════════════════════════════════════════════════════════
console.log("\nR1 — prochain patient : quatre registres, aucun fait inventé");
{
  const b = composerBriefProchainPatient({
    agenda: { creneaux: [creneau], provenance: SRC },
    patient,
    timeline: null,
    maintenant: MAINTENANT,
  });
  const tout = JSON.stringify(b);

  // ⚠️ LE MOTIF CIBLE UNE HEURE SUIVIE DE AM/PM, pas la sous-chaîne « AM ».
  // La première version testait `!/PM|AM/` et matchait « HAM-A », le code de
  // l'échelle de Hamilton : le contrôle était ROUGE sur un brief parfaitement
  // correct. Un test qui cherche un fragment trop court accuse le bon code.
  verdict(
    "l'heure est en 24 h, pas en 12 h",
    /14:00/.test(tout) && !/\d{1,2}:\d{2}\s?(AM|PM)/i.test(tout),
    "14:00",
  );
  verdict("le patient est une RÉFÉRENCE, pas un nom", b.patient === "PATIENT_001", b.patient);
  verdict(
    "les faits portent les valeurs RÉELLES",
    b.faits.some((f) => /34 ans/.test(f)) &&
      b.faits.some((f) => /7 consultation/.test(f)) &&
      b.faits.some((f) => /Sertraline 50 mg/.test(f)),
    "âge, comptes, traitement",
  );
  verdict(
    "un diagnostic RÉSOLU n'est pas annoncé comme en cours",
    b.faits.some((f) => /Trouble anxieux/.test(f)) &&
      !b.faits.some((f) => /Épisode dépressif/.test(f)),
    "seuls les diagnostics actifs",
  );
  verdict(
    "la hausse d'échelle est une OBSERVATION, pas un fait",
    b.observations.some((o) => /HAM-A en hausse de 6/.test(o)),
    "registre observations",
  );
  verdict(
    "l'attention est un CONSTAT chiffré, jamais un verdict clinique",
    b.attention.some((a) => /augmenté de 6/.test(a)) &&
      !/aggravation|va moins bien|se dégrade/i.test(tout),
    "aucun jugement",
  );
  verdict(
    "l'intervalle > 3 mois est relevé comme observation",
    b.observations.some((o) => /trois mois/.test(o)),
    "146 jours",
  );
  verdict(
    "l'absence de suivi entre séances est DITE",
    b.informationManquante.some((m) => /check-ins|observance/.test(m)),
    "domaine absent déclaré",
  );
  verdict(
    "la réserve sur l'historique de traitement est DITE",
    b.informationManquante.some((m) => /dernière prescription/.test(m)),
    "réserve déclarée",
  );
  verdict(
    "la provenance accompagne le brief",
    b.provenance.some((p) => p.porte === "app.get_patient_workspace"),
    "portes nommées",
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// R2 · AUCUN CHIFFRE SANS ANTÉCÉDENT
// ═══════════════════════════════════════════════════════════════════════════
console.log("\nR2 — chaque nombre du brief a un antécédent dans les données");
{
  const b = composerBriefProchainPatient({
    agenda: { creneaux: [creneau], provenance: SRC },
    patient,
    timeline: null,
    maintenant: MAINTENANT,
  });
  // Les nombres AUTORISÉS : ceux des données, plus ceux qui sont dérivés par un
  // calcul explicite et documenté (jours écoulés, delta).
  // 146 et non 147 : du 1ᵉʳ avril 10:00 au 26 août 09:00, l'écart est de
  // 146 jours et 23 heures — `Math.floor` rend 146. La première version de ce
  // contrôle attendait 147 et accusait un calcul juste. Une valeur attendue
  // posée de tête est une source d'erreur au même titre que le code testé.
  const attendus = new Set(["34", "7", "50", "1", "24", "6", "30", "14", "00", "2026", "08", "01", "146", "3", "4"]);
  const nombres = [...b.faits, ...b.observations, ...b.attention]
    .join(" ")
    .match(/\d+/g) ?? [];
  const orphelins = nombres.filter((n) => !attendus.has(n));
  verdict(
    "aucun nombre orphelin",
    orphelins.length === 0,
    orphelins.length === 0 ? `${nombres.length} nombres, tous tracés` : `orphelins: ${orphelins.join(",")}`,
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// R3 · AGENDA VIDE — l'état vide est dit, pas inventé
// ═══════════════════════════════════════════════════════════════════════════
console.log("\nR3 — plus de rendez-vous : l'état vide s'affiche");
{
  const b = composerBriefProchainPatient({
    agenda: { creneaux: [], provenance: SRC },
    patient: null,
    timeline: null,
    maintenant: MAINTENANT,
  });
  verdict("un seul fait, explicite", b.faits.length === 1 && /Aucun rendez-vous/.test(b.faits[0]), b.faits[0]);
  verdict("aucune observation fabriquée", b.observations.length === 0, "0");
  verdict("aucun patient référencé", b.patient === undefined, "aucun");
}

// ═══════════════════════════════════════════════════════════════════════════
// R4 · DROITS — `null` clinique ≠ dossier vide
// ═══════════════════════════════════════════════════════════════════════════
console.log("\nR4 — hors droit et vide sont deux choses différentes");
{
  const b = composerBriefProchainPatient({
    agenda: { creneaux: [creneau], provenance: SRC },
    patient: { ...patient, clinique: null, traitements: null },
    timeline: null,
    maintenant: MAINTENANT,
  });
  verdict(
    "le hors-droit est déclaré, pas présenté comme un dossier vide",
    b.informationManquante.some((m) => /pas accessible avec vos droits/.test(m)),
    "droits déclarés",
  );
  verdict(
    "aucun « aucun diagnostic » n'est annoncé",
    !b.faits.some((f) => /aucun diagnostic/i.test(f)),
    "silence plutôt que faux",
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// R5 · BRIEF MATINAL
// ═══════════════════════════════════════════════════════════════════════════
console.log("\nR5 — brief du matin : opérationnel, annulés exclus du compte");
{
  const creneaux = [
    { ...creneau, ref: "RDV_001", debut: "2026-08-26T09:00:00+01:00", statut: "scheduled" },
    { ...creneau, ref: "RDV_002", debut: "2026-08-26T11:00:00+01:00", statut: "cancelled" },
    { ...creneau, ref: "RDV_003", debut: "2026-08-26T16:00:00+01:00", statut: "scheduled" },
  ];
  const b = composerBriefMatinal({
    agenda: { creneaux, provenance: SRC },
    finance: {
      periode: { nom: "jour", du: "2026-08-26", au: "2026-08-26" },
      encaisseDzd: 24000, enAttenteDzd: 8000, enAttenteNombre: 2,
      seances: 3, chargesDzd: null, resultatNetDzd: null,
      perimetre: "praticienne", provenance: SRC,
    },
    enAttente: 1,
  });
  verdict(
    "les annulés ne comptent pas dans la journée",
    b.faits.some((f) => /^2 consultation/.test(f)),
    b.faits[0],
  );
  verdict("la première heure est juste", b.faits.some((f) => /Première à 09:00/.test(f)), "09:00");
  verdict("la dernière heure est juste", b.faits.some((f) => /Dernière à 16:00/.test(f)), "16:00");
  verdict(
    "encaissé et en attente restent SÉPARÉS",
    b.faits.some((f) => /Encaissé aujourd'hui : 24 000 DA/.test(f)) &&
      b.attention.some((a) => /8 000 DA/.test(a)) &&
      !/32 000/.test(JSON.stringify(b)),
    "jamais additionnés",
  );
  verdict("l'annulation est une observation", b.observations.some((o) => /1 créneau/.test(o)), "signalée");
}

// ═══════════════════════════════════════════════════════════════════════════
// R6 · BRIEF FINANCE — facturé ≠ encaissé
// ═══════════════════════════════════════════════════════════════════════════
console.log("\nR6 — finance : les deux chiffres ne fusionnent jamais");
{
  const b = composerBriefFinance({
    finance: {
      periode: { nom: "mois", du: "2026-08-01", au: "2026-08-31" },
      encaisseDzd: 180000, enAttenteDzd: 45000, enAttenteNombre: 9,
      seances: 30, chargesDzd: 60000, resultatNetDzd: 120000,
      perimetre: "praticienne", provenance: SRC,
    },
    impayesAnciensJours: 62,
  });
  const tout = JSON.stringify(b);
  verdict("l'encaissé est annoncé", /180 000 DA/.test(tout), "180 000 DA");
  verdict("l'attente est annoncée SÉPARÉMENT", /45 000 DA/.test(tout), "45 000 DA");
  verdict("les deux ne sont jamais additionnés", !/225 000/.test(tout), "aucun total fusionné");
  verdict(
    "le panier moyen porte sur l'ENCAISSÉ",
    b.observations.some((o) => /6 000 DA/.test(o)),
    "180 000 / 30",
  );
  verdict("l'impayé ancien est signalé", b.attention.some((a) => /62 jours/.test(a)), "62 jours");
  verdict(
    "le périmètre praticienne est déclaré",
    b.informationManquante.some((m) => /votre seule activité/.test(m)),
    "ADR-005 respecté",
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// R7 · LE CONSTAT DES DOMAINES ABSENTS
// ═══════════════════════════════════════════════════════════════════════════
console.log("\nR7 — les domaines absents du schéma restent déclarés");
{
  verdict(
    "la liste des domaines absents est non vide",
    Array.isArray(DOMAINES_ABSENTS) && DOMAINES_ABSENTS.length > 0,
    `${DOMAINES_ABSENTS.length} domaine(s)`,
  );
  verdict(
    "elle nomme explicitement le suivi entre séances",
    DOMAINES_ABSENTS.some((d) => /check-ins/.test(d) && /humeur/.test(d) && /observance/.test(d)),
    "check-ins, humeur, sommeil, observance",
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SCÉNARIO H — LE BROUILLON DE MESSAGE, ET L'ABSENCE D'ENVOI
// ═══════════════════════════════════════════════════════════════════════════
// ⚠️ LE CONTRÔLE QUI COMPTE ICI N'EST PAS « le texte est joli ». C'est que
// RIEN ne part, que le corps ne porte AUCUNE identité, et qu'un rendez-vous
// annulé ne produit pas un rappel parfaitement rédigé et parfaitement faux.

console.log("\nH1 — rappel de rendez-vous : composé, jamais envoyé");
{
  const creneau = {
    ref: "RDV_001",
    patient: "PATIENT_001",
    debut: "2026-08-27T14:00:00.000Z",
    fin: "2026-08-27T14:45:00.000Z",
    dureeMinutes: 45,
    statut: "scheduled",
    type: "suivi",
    arriveA: null,
  };
  const b = composerRappelRendezVous({ creneau, provenance: [] });
  verdict("un brouillon est bien produit", !estRefus(b), b.type ?? "refus");
  verdict("aucun canal n'existe", b.canal === null, "canal = null");
  verdict("le brouillon n'est PAS envoyé", b.envoye === false, "envoye = false");
  verdict(
    "le corps porte le JETON, jamais un nom",
    b.corps.includes("{{PATIENT_001}}"),
    "{{PATIENT_001}}",
  );
  // Volet positif : un brouillon vide passerait tous les contrôles négatifs.
  verdict("la durée réelle figure dans le corps", b.corps.includes("45"), "45 minutes");
  verdict(
    "l'heure est sur 24 heures, jamais AM/PM",
    !/\b(AM|PM)\b/.test(b.corps),
    "hourCycle h23",
  );
  verdict(
    "l'absence de canal est DITE, pas tue",
    b.informationManquante.some((m) => /n'envoie aucun message/.test(m)),
    "déclarée",
  );
}

console.log("\nH2 — un rendez-vous annulé ne se rappelle pas");
{
  const annule = {
    ref: "RDV_002",
    patient: "PATIENT_001",
    debut: "2026-08-27T14:00:00.000Z",
    fin: "2026-08-27T14:45:00.000Z",
    dureeMinutes: 45,
    statut: "cancelled",
    type: "suivi",
    arriveA: null,
  };
  const r = composerRappelRendezVous({ creneau: annule, provenance: [] });
  verdict("le refus est nommé", estRefus(r), r.refus ?? "PAS de refus");
  verdict("aucun corps n'est composé", r.corps === undefined, "aucun texte");
}

console.log("\nH3 — un créneau sans patient n'a pas de destinataire");
{
  const vide = {
    ref: "RDV_003",
    debut: "2026-08-27T14:00:00.000Z",
    fin: "2026-08-27T14:45:00.000Z",
    dureeMinutes: 45,
    statut: "scheduled",
    type: null,
    arriveA: null,
  };
  const r = composerRappelRendezVous({ creneau: vide, provenance: [] });
  verdict("le refus est nommé", estRefus(r), "aucun patient");
}

console.log("\nH4 — document disponible : le CONTENU n'est jamais repris");
{
  const docs = {
    documents: [
      { ref: "DOC_001", type: "certificat", emisLe: "2026-08-20T09:00:00.000Z", nombreImpressions: 0 },
    ],
    provenance: [],
  };
  const b = composerDocumentPret({ patient: "PATIENT_001", documents: docs });
  verdict("un brouillon est produit", !estRefus(b), "document_pret");
  verdict("le type du document est annoncé", b.corps.includes("certificat"), "certificat");
  verdict("le brouillon n'est PAS envoyé", b.envoye === false && b.canal === null, "aucun envoi");
  verdict(
    "le non-report du contenu est DIT",
    b.informationManquante.some((m) => /se lit au cabinet/.test(m)),
    "déclaré",
  );
  const vide = composerDocumentPret({
    patient: "PATIENT_001",
    documents: { documents: [], provenance: [] },
  });
  verdict("aucun document : refus, jamais un message inventé", estRefus(vide), "refus");
}

console.log(
  `\n${rouges === 0 ? "VERDICT BRIEFS : VERT" : `VERDICT BRIEFS : ROUGE — ${rouges} contrôle(s)`}`,
);
process.exit(rouges === 0 ? 0 : 1);
