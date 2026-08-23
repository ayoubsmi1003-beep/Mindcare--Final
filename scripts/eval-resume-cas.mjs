/**
 * eval-resume-cas — évaluation HORS LIGNE du Résumé du cas.
 * Même discipline que `eval-jarvis-v2.mjs` : on éprouve ce qui est pur
 * (module partagé `_shared/resume-cas.ts`, prompt) SANS clé fournisseur ni
 * base. Les contrôles base/réseau appartiennent au checkpoint navigateur.
 *
 * Vert exigé AVANT toute montée de PROMPT_VERSION.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";

let verts = 0;
const rouges = [];
function vert(nom, condition) {
  if (condition) {
    verts++;
    console.log("  VERT - " + nom);
  } else {
    rouges.push(nom);
    console.log("  ROUGE - " + nom);
  }
}

const racine = new URL("../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

// ── Import des modules purs ────────────────────────────────────────────────
const cheminShared = new URL(
  "../supabase/functions/_shared/resume-cas.ts",
  import.meta.url,
);
const {
  construireCandidats,
  validerContenuResume,
  couperPhrases,
  MAX_SIGNAUX_AFFICHES,
  MAX_PHRASES_EN_BREF,
} = await import(pathToFileURL(fileURLToPath(cheminShared)).href);
const cheminPrompt = new URL("../supabase/functions/jarvis-resume-cas/prompt.ts", import.meta.url);
const { SYSTEM_PROMPT_RESUME, PROMPT_VERSION } = await import(
  pathToFileURL(fileURLToPath(cheminPrompt)).href
);

console.log("=== 1 · PROMPT — formulations imposées et interdits §9.2 ===");
vert(
  "interdits cliniques présents",
  ["prescrire", "risque suicidaire", "s'aggrave"].every((m) => SYSTEM_PROMPT_RESUME.includes(m)),
);
vert(
  "préfixe de signal imposé",
  SYSTEM_PROMPT_RESUME.includes("À vérifier —"),
);
vert("sortie JSON stricte exigée", SYSTEM_PROMPT_RESUME.includes("aucun texte hors du JSON"));
vert("plafond en_bref énoncé", SYSTEM_PROMPT_RESUME.includes("2 à 4 phrases"));
vert("signaux bornés aux candidats", SYSTEM_PROMPT_RESUME.includes("UNIQUEMENT parmi les signaux fournis"));
vert("version de prompt stable", PROMPT_VERSION === "resume-v1.0");

console.log("=== 2 · CANDIDATS — déterministes, neutres, plafonnés ===");
const espaceFixture = {
  clinique: {
    diagnostics: [{ id: "d1", label: "Episode depressif" }],
    echelles: [
      {
        scaleName: "PHQ-9",
        dernier: { score: 15, date: "2026-08-20" },
        precedent: { score: 12, date: "2026-07-29" },
        delta: 3,
        id: "e1",
      },
      {
        scaleName: "GAD-7",
        dernier: { score: 8, date: "2026-08-20" },
        precedent: null,
        delta: null,
        id: "e2",
      },
    ],
    derniereConsultation: { id: "c1", startedAt: "2026-08-20T14:00:00Z" },
  },
  traitements: { dernierePrescription: { id: "p1", prescribedAt: "2026-07-01T10:00:00Z" } },
  agenda: { prochainRendezVous: null },
};

const { candidats, total } = construireCandidats(espaceFixture);
vert("delta PHQ-9 cité en chiffres neutres", candidats.some((c) => c.libelle.includes("12 (2026-07-29) → 15 (2026-08-20)")));
vert("aucune valence sur les mesures", !candidats.some((c) => /amélior|aggrav|worsen/i.test(c.libelle)));
vert("mesure unique (GAD-7) ne fait pas un signal", !candidats.some((c) => c.cle === "echelle:e2"));
vert("prescription antérieure signalée", candidats.some((c) => c.cle === "prescription:p1"));
vert("sans RDV à venir signalé", candidats.some((c) => c.cle === "agenda:sans_prochain"));

// Plafond : fabrique 8 échelles à delta → candidats plafonnés à 5, total=8+2.
const espaceLarge = JSON.parse(JSON.stringify(espaceFixture));
espaceLarge.clinique.echelles = Array.from({ length: 8 }, (_, i) => ({
  scaleName: "ECHELLE" + i,
  dernier: { score: 10, date: "2026-08-" + String(10 + i).padStart(2, "0") },
  precedent: { score: 9, date: "2026-08-01" },
  delta: 1,
  id: "ex" + i,
}));
const grand = construireCandidats(espaceLarge);
vert("candidats plafonnés à 5", grand.candidats.length === MAX_SIGNAUX_AFFICHES);
vert("total honnête au-delà du plafond", grand.total === 10);

console.log("=== 3 · GROUNDING — citations fabriquées retirées ===");
const contenuBrut = {
  en_bref: [
    {
      texte:
        "Suivi documenté pour épisode dépressif. La mesure PHQ-9 est passée de 12 à 15. Troisième phrase documentée par le dossier. Quatrième phrase. Cinquième phrase qui doit disparaître.",
      sources: [{ t: "diagnostic", id: "d1" }],
    },
  ],
  evolution_recente: [{ texte: "Fait réel.", sources: [{ t: "consultation", id: "c1" }] }],
  a_discuter: [
    { texte: "À vérifier — écart de PHQ-9.", sources: [], cle: "echelle:e1" },
    { texte: "Signal inventé hors liste.", sources: [], cle: "inconnu:xyz" },
    { texte: "Citation fabriquée.", sources: [{ t: "diagnostic", id: "FAKE" }] },
  ],
  dernier_etat: null,
  traitements_documentes: [],
  points_attention: [],
};
const valide = validerContenuResume(contenuBrut, espaceFixture, candidats);
vert("contenu accepté", valide !== null);
vert("en_bref tronqué à 4 phrases", valide !== null && !valide.en_bref[0].texte.includes("Cinquième"));
vert("signal avec cle fournie conservé", valide !== null && valide.a_discuter.some((i) => i.texte.includes("PHQ-9")));
vert("signal hors liste retiré", valide !== null && !valide.a_discuter.some((i) => i.texte.includes("hors liste")));
vert("citation FAKE retirée avant la porte", valide !== null && !valide.a_discuter.some((i) => i.sources.some((s) => s.id === "FAKE")));

const vide = validerContenuResume(
  { en_bref: [], a_discuter: [], evolution_recente: [], traitements_documentes: [], points_attention: [], dernier_etat: null },
  { clinique: null, traitements: null, agenda: {} },
  [],
);
vert("tout-vide ⇒ null (échec, pas une carte vide)", vide === null);

console.log("=== 4 · couperPhrases ===");
vert("coupe à N phrases", couperPhrases("A. B. C. D. E.", 4).endsWith("D."));

console.log("=== 5 · FRONTIÈRE — static checks ===");
const externalCall = readFileSync(new URL("../supabase/functions/_shared/external-call.ts", import.meta.url), "utf8");
vert("purpose 'resume-cas' déclaré dans la sortie unique", externalCall.includes('"resume-cas"'));
const migration054 = readFileSync(new URL("../supabase/migrations/054_boundary_purpose_resume_cas.sql", import.meta.url), "utf8");
vert("CHECK boundary élargie en base", migration054.includes("'resume-cas'"));
const porte053 = readFileSync(new URL("../supabase/migrations/053_case_summaries.sql", import.meta.url), "utf8");
vert(
  "porte : garde de citation présente (le refus lui-même est prouvé par la sonde SQL)",
  porte053.includes("LA CITATION DOIT EXISTER") && porte053.includes("ne correspond"),
);
vert(
  "Amendement A : visibilité par LE PATIENT",
  porte053.includes("can_see_clinical(patient_practitioner_id)") && porte053.includes("patient_practitioner_id uuid NOT NULL"),
);
const panneau = readFileSync(new URL("../src/components/patients/CarteResumeCas.tsx", import.meta.url), "utf8");
vert("UI : mention permanente du disclaimer", panneau.includes("fr.disclaimer"));
vert("UI : jamais un score de confiance affiché", !/confiance\s*[:=]\s*\d/i.test(panneau));

console.log("\nVERDICT eval-resume-cas : " + verts + " verts · " + rouges.length + " rouges");
if (rouges.length > 0) {
  console.log("ROUGES : " + rouges.join(" | "));
  process.exit(1);
}
