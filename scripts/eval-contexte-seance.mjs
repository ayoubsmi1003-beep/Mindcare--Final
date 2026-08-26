/**
 * eval-contexte-seance — LA PRÉSÉANCE DES SOURCES EST UNE PROPRIÉTÉ DU CODE.
 *
 * ═══ POURQUOI CETTE ÉVAL EXISTE ═══
 *
 * On peut écrire dans un prompt « les notes de la praticienne priment sur la
 * transcription ». C'est une SUGGESTION : le modèle la suit la plupart du
 * temps, et « la plupart du temps » n'est pas une garantie sur un document
 * clinique.
 *
 * Ce que cette éval vérifie, c'est ce qui ENTRE dans le contexte et ce qui est
 * tronqué en premier quand le budget se remplit. Cela ne dépend d'aucun
 * modèle, d'aucune clé, d'aucune base — donc cela peut être PROUVÉ.
 *
 *   node scripts/eval-contexte-seance.mjs <chemin js compilé>
 */

import { pathToFileURL } from "node:url";

const fichier = process.argv[2];
if (fichier === undefined) {
  console.error("usage : node scripts/eval-contexte-seance.mjs <chemin js compilé>");
  process.exit(2);
}

const { assemblerContexteSeance, formaterDonneesStructurees } = await import(
  pathToFileURL(fichier).href
);

let rouges = 0;
let verts = 0;
function verdict(nom, ok, detail = "") {
  if (ok) verts += 1;
  else rouges += 1;
  console.log(`  ${ok ? "vert " : "ROUGE"} | ${nom.padEnd(56)} | ${detail}`);
}

const src = (type, libelle, contenu) => ({ type, libelle, contenu });

// ═══════════════════════════════════════════════════════════════════════════
// C1 · L'ORDRE EST CELUI DE LA PRÉSÉANCE, PAS CELUI DE L'APPELANT
// ═══════════════════════════════════════════════════════════════════════════
console.log("\nC1 — les sources arrivent dans le désordre");
{
  const r = assemblerContexteSeance([
    src("contexte-longitudinal", "Consultation precedente", "ancien"),
    src("transcription", "Transcription", "dit"),
    src("notes-finalisees", "Notes de la praticienne", "ecrit"),
    src("donnees-structurees", "Dossier", "faits"),
  ]);

  const ordre = r.sources.map((s) => s.type);
  verdict(
    "les notes finalisées passent EN PREMIER",
    ordre[0] === "notes-finalisees",
    ordre.join(" > "),
  );
  verdict(
    "la transcription passe APRÈS les données structurées",
    ordre.indexOf("transcription") > ordre.indexOf("donnees-structurees"),
    ordre.join(" > "),
  );
  verdict(
    "le longitudinal ferme la marche",
    ordre[ordre.length - 1] === "contexte-longitudinal",
    ordre.join(" > "),
  );
  // ⚠️ L'ORDRE DU BLOC EST CE QUE LE MODÈLE LIT. Le tableau `sources` sert la
  // trace ; c'est le texte qui compte.
  verdict(
    "le bloc lui-même respecte cet ordre",
    r.bloc.indexOf("ecrit") < r.bloc.indexOf("faits") &&
      r.bloc.indexOf("faits") < r.bloc.indexOf("dit"),
    "notes < dossier < transcription",
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// C2 · UNE SOURCE VIDE N'EST PAS UNE SOURCE
// ═══════════════════════════════════════════════════════════════════════════
console.log("\nC2 — sources absentes ou vides");
{
  const r = assemblerContexteSeance([
    src("notes-finalisees", "Notes", "presentes"),
    src("donnees-structurees", "Dossier", null),
    src("contexte-longitudinal", "Precedente", "   "),
  ]);

  verdict("une seule source est retenue", r.sources.length === 1, `${r.sources.length}`);
  // ⚠️ ANNONCER UNE SECTION VIDE INVITE LE MODÈLE À LA COMBLER. Un titre
  // « Consultation précédente » suivi de rien est une invitation à supposer.
  verdict("aucun titre de section vide dans le bloc", !r.bloc.includes("Precedente"), "pas d'appel au vide");
  verdict("rien n'est déclaré tronqué", r.tronque === false, String(r.tronque));
}

// ═══════════════════════════════════════════════════════════════════════════
// C3 · LA TRONCATURE GARDE LA FIN — LÀ OÙ VIT LA DÉCISION
// ═══════════════════════════════════════════════════════════════════════════
console.log("\nC3 — une note trop longue");
{
  const debut = "DEBUT-MOTIF ".repeat(10);
  const remplissage = "x".repeat(9000);
  const fin = " PLAN-DECIDE-ICI";
  const r = assemblerContexteSeance([
    src("notes-finalisees", "Notes", debut + remplissage + fin),
  ]);

  const s0 = r.sources[0];
  verdict("la source est marquée tronquée", s0.tronquee === true, String(s0.tronquee));
  verdict("la troncature est DITE dans le bloc", r.bloc.includes("tronqué ici"), "marqueur présent");
  // ⚠️ LE CONTRÔLE QUI COMPTE. Couper par la fin garderait le motif et jetterait
  // le plan : un résumé clinique sans la décision de la praticienne.
  verdict("la FIN de la note est conservée", r.bloc.includes("PLAN-DECIDE-ICI"), "plan présent");
  verdict("le début a bien été coupé", !r.bloc.includes("DEBUT-MOTIF"), "motif omis");
  verdict("le contexte reste sous le budget", r.caracteresTotal <= 14000, `${r.caracteresTotal} car.`);
}

// ═══════════════════════════════════════════════════════════════════════════
// C4 · SOUS PRESSION, C'EST LE RANG LE PLUS FAIBLE QUI TOMBE
// ═══════════════════════════════════════════════════════════════════════════
console.log("\nC4 — toutes les sources sont énormes");
{
  const enorme = (m) => m.repeat(20000).slice(0, 20000);
  const r = assemblerContexteSeance([
    src("notes-finalisees", "Notes", enorme("N")),
    src("donnees-structurees", "Dossier", enorme("D")),
    src("transcription", "Transcription", enorme("T")),
    src("contexte-longitudinal", "Precedente", enorme("L")),
  ]);

  const par = Object.fromEntries(r.sources.map((s) => [s.type, s.caracteres]));
  verdict("le budget global est tenu", r.caracteresTotal <= 14000, `${r.caracteresTotal} car.`);
  verdict("les notes finalisées gardent la plus grosse part", par["notes-finalisees"] >= par["transcription"], `${par["notes-finalisees"]} vs ${par["transcription"]}`);
  verdict("les notes finalisées ne sont jamais évincées", par["notes-finalisees"] > 0, `${par["notes-finalisees"]} car.`);
  verdict("toute éviction est déclarée", r.tronque === true, String(r.tronque));
}

// ═══════════════════════════════════════════════════════════════════════════
// C5 · DÉTERMINISME — MÊMES ENTRÉES, MÊME BLOC
// ═══════════════════════════════════════════════════════════════════════════
console.log("\nC5 — deux exécutions sur les mêmes données");
{
  const entrees = [
    src("notes-finalisees", "Notes", "a"),
    src("donnees-structurees", "Dossier", "b"),
    src("contexte-longitudinal", "Precedente", "c"),
  ];
  const a = assemblerContexteSeance(entrees);
  const b = assemblerContexteSeance(entrees);
  // Un bloc non déterministe ferait varier le hash de prompt sans qu'aucune
  // donnée n'ait changé — et rendrait le journal des franchissements illisible.
  verdict("le bloc est identique", a.bloc === b.bloc, "déterministe");
}

// ═══════════════════════════════════════════════════════════════════════════
// C6 · LES DONNÉES STRUCTURÉES N'AFFIRMENT PAS CE QUE LA BASE N'ENREGISTRE PAS
// ═══════════════════════════════════════════════════════════════════════════
console.log("\nC6 — mise en forme du dossier");
{
  const texte = formaterDonneesStructurees(
    {
      diagnostics: [{ label: "Trouble anxieux généralisé", is_primary: true, onset_date: "2024-03-01" }],
      echelles: [
        { scale_name: "GAD-7", dernier: { score: 12 }, precedent: { score: 17 } },
        { scale_name: "PHQ-9", dernier: { score: 8 }, precedent: null },
      ],
    },
    {
      derniere_prescription: {
        prescribed_at: "2026-06-02",
        lignes: [{ designation: "sertraline", dose: "50 mg", frequency_per_day: 1 }],
      },
    },
  );

  verdict("le diagnostic principal est rendu", texte.includes("Trouble anxieux généralisé"), "présent");
  verdict("un écart d'échelle à deux points est rendu", texte.includes("précédent 17"), "GAD-7");
  // ⚠️ UNE SEULE MESURE NE FAIT PAS UNE TENDANCE.
  verdict(
    "une échelle à une seule mesure ne dessine PAS de tendance",
    texte.includes("une seule mesure"),
    "PHQ-9",
  );
  verdict("la prescription est rendue", texte.includes("sertraline"), "présente");
  // ⚠️ LE SCHÉMA N'A NI `stopped_at` NI STATUT DE LIGNE. Écrire « traitement en
  // cours » ferait affirmer au résumé une chose que la base n'enregistre pas —
  // et cette affirmation atterrirait dans un dossier médical.
  verdict(
    "elle est présentée comme un HISTORIQUE, pas un traitement en cours",
    texte.includes("ne pas en conclure que ce traitement est en cours"),
    "mise en garde présente",
  );
  verdict(
    "aucune formule affirmant un traitement actuel",
    !/traitement (actuel|en cours)\s*:/i.test(texte),
    "aucune",
  );

  const vide = formaterDonneesStructurees(null, null);
  verdict("un dossier inaccessible rend `null`, pas un texte vide", vide === null, String(vide));
}

console.log(
  `\nVERDICT CONTEXTE SÉANCE : ${rouges === 0 ? `VERT (${verts} vert(s))` : `ROUGE — ${rouges} contrôle(s)`}`,
);
process.exit(rouges === 0 ? 0 : 1);
