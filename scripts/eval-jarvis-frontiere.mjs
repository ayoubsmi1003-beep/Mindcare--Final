/**
 * eval-jarvis-frontiere — LE SCÉNARIO L, CRITÈRE DE SÉCURITÉ DUR.
 *
 * ═══ CE QUE CETTE PASSE PROUVE, ET CE QU'ELLE NE PROUVE PAS ═══
 * Elle capture la charge EXACTE que la boucle s'apprête à émettre vers le
 * fournisseur, et affirme deux choses SYMÉTRIQUES :
 *
 *   NÉGATIF — aucune valeur identifiante de la fixture n'y figure : ni nom, ni
 *             prénom, ni numéro de dossier, ni téléphone, ni e-mail, ni adresse,
 *             ni date de naissance, ni identifiant réel (UUID).
 *   POSITIF — le modèle reçoit BIEN le jeton pseudonyme et les faits cliniques
 *             non identifiants.
 *
 * ⚠️ LE VOLET POSITIF N'EST PAS UNE POLITESSE. Sans lui, un pare-feu qui
 * n'enverrait RIEN passerait le test avec les honneurs — et Jarvis serait
 * parfaitement sûr et parfaitement inutile. Un contrôle qui ne peut pas
 * distinguer « protégé » de « vide » ne contrôle rien.
 *
 * Aucun réseau, aucune clé, aucune base : la frontière est une propriété du
 * code, elle doit se prouver sans dépendre de ce qui est joignable ce jour-là.
 *
 *   node scripts/eval-jarvis-frontiere.mjs <répertoire-des-modules-compilés>
 */

import { pathToFileURL } from "node:url";
import { join } from "node:path";

const repertoire = process.argv[2];
if (repertoire === undefined) {
  console.error("usage : node scripts/eval-jarvis-frontiere.mjs <dir js compilé>");
  process.exit(2);
}

const url = (f) => pathToFileURL(join(repertoire, f)).href;
const { CarteIdentite, MARQUEUR_NON_RESOLU } = await import(url("jarvis-identite.js"));
const { preparerPourLeModele, verifierSortant, FuiteDetectee } = await import(
  url("jarvis-confidentialite.js")
);
const { projeterWorkspace, projeterTimeline, projeterConsultation } = await import(
  url("jarvis-projections.js")
);

let rouges = 0;
function verdict(nom, ok, detail) {
  if (!ok) rouges++;
  console.log(`  ${ok ? "vert " : "ROUGE"} | ${nom.padEnd(58)} | ${detail}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// LA FIXTURE — identifiante de part en part
// ═══════════════════════════════════════════════════════════════════════════
// Chaque valeur ci-dessous est une valeur qui NE DOIT PAS franchir. Elles sont
// placées dans les champs structurés ET dans le texte libre, parce que ce sont
// deux chemins de fuite différents : la liste blanche couvre le premier, la
// pseudonymisation le second.

const UUID_PATIENT = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const IDENTIFIANTS = {
  nom: "BELKACEM",
  prenom: "Nadia",
  numeroDossier: "D-2026-0417",
  telephone: "0551234567",
  fixe: "021445566",
  international: "+213551234567",
  courriel: "nadia.belkacem@example.dz",
  adresse: "12 rue Didouche Mourad, Alger",
  dateNaissance: "1991-03-14",
  uuid: UUID_PATIENT,
};

// Les faits cliniques NON identifiants : eux DOIVENT franchir, sans quoi Jarvis
// ne peut rien dire d'utile. C'est le volet positif du scénario L.
const FAITS_ATTENDUS = {
  diagnostic: "Trouble anxieux généralisé",
  molecule: "Sertraline",
  dose: "50 mg",
  echelle: "HAM-A",
};

const workspace = {
  contrat: 1,
  genereA: "2026-08-25T09:00:00+01:00",
  identite: {
    id: UUID_PATIENT,
    recordNumber: IDENTIFIANTS.numeroDossier,
    firstName: IDENTIFIANTS.prenom,
    lastName: IDENTIFIANTS.nom,
    birthDate: IDENTIFIANTS.dateNaissance,
    age: 34,
    sex: "F",
    isActive: true,
  },
  contact: {
    phone: IDENTIFIANTS.telephone,
    phoneAlt: IDENTIFIANTS.fixe,
    address: IDENTIFIANTS.adresse,
    emergencyContact: {
      name: "BELKACEM Sofiane",
      relation: "frère",
      phone: IDENTIFIANTS.international,
    },
  },
  identification: { idDocumentNumber: "108234567", idDocumentIssuer: "Daïra d'Alger-Centre" },
  admin: { notesAdmin: `Joindre au ${IDENTIFIANTS.telephone}, mail ${IDENTIFIANTS.courriel}` },
  clinique: {
    diagnostics: [
      {
        id: "d1",
        codeSystem: "CIM-10",
        code: "F41.1",
        label: FAITS_ATTENDUS.diagnostic,
        isPrimary: true,
        onsetDate: "2024-02-01",
        resolvedAt: null,
      },
    ],
    echelles: [
      {
        scaleCode: FAITS_ATTENDUS.echelle,
        scaleName: "Échelle d'anxiété de Hamilton",
        dernier: { score: 18, date: "2026-08-01", interpretation: "anxiété modérée" },
        precedent: { score: 24, date: "2026-06-01" },
        delta: -6,
      },
    ],
    derniereConsultation: {
      id: "c1",
      startedAt: "2026-08-01T10:00:00+01:00",
      endedAt: "2026-08-01T10:40:00+01:00",
      status: "closed",
      kind: "suivi",
      practitionerName: "Dr. HAMDANI",
    },
    nombreConsultations: 7,
  },
  traitements: {
    dernierePrescription: {
      id: "p1",
      prescribedAt: "2026-08-01T10:35:00+01:00",
      isHandwritten: false,
      practitionerName: "Dr. HAMDANI",
      lignes: [
        {
          id: "l1",
          designation: FAITS_ATTENDUS.molecule,
          brandName: "Zoloft",
          dose: FAITS_ATTENDUS.dose,
          frequencyPerDay: 1,
          durationDays: 30,
          // TEXTE LIBRE PORTANT UNE IDENTITÉ — le cas que la liste blanche seule
          // ne couvrirait pas si `instructions` était projeté.
          instructions: `Revoir ${IDENTIFIANTS.prenom} dans un mois, tel ${IDENTIFIANTS.telephone}`,
        },
      ],
    },
    nombrePrescriptions: 4,
  },
  agenda: {
    prochainRendezVous: {
      id: "r1",
      startsAt: "2026-09-01T14:00:00+01:00",
      endsAt: "2026-09-01T14:30:00+01:00",
      status: "scheduled",
      kind: "suivi",
      practitionerName: "Dr. HAMDANI",
    },
    dernierRendezVous: null,
    nombreRendezVous: 9,
  },
  documents: { nombre: 2, dernierEmisLe: "2026-08-01T11:00:00+01:00" },
  rendezVousDuJour: [],
  resume: null,
};

// Une note SOAP où la praticienne a écrit le prénom — le cas RÉEL, celui qui
// justifie la deuxième couche.
const consultation = {
  id: "c1",
  status: "closed",
  startedAt: "2026-08-01T10:00:00+01:00",
  endedAt: "2026-08-01T10:40:00+01:00",
  rawNotes: `dictée brute : ${IDENTIFIANTS.prenom} dit aller mieux, rappeler au ${IDENTIFIANTS.telephone}`,
  appointmentId: "r0",
  appointmentKind: "suivi",
  patientId: UUID_PATIENT,
  recordNumber: IDENTIFIANTS.numeroDossier,
  firstName: IDENTIFIANTS.prenom,
  lastName: IDENTIFIANTS.nom,
  practitionerId: "prat-1",
  practitionerName: "Dr. HAMDANI",
  note: {
    id: "n1",
    status: "signed",
    soap: {
      subjective: `${IDENTIFIANTS.prenom} rapporte une amélioration du sommeil.`,
      objective: "Contact adapté, pas d'agitation.",
      assessment: `Évolution favorable sous ${FAITS_ATTENDUS.molecule}.`,
      plan: `Poursuivre. Joindre la famille au ${IDENTIFIANTS.international}.`,
    },
    signedAt: "2026-08-01T10:45:00+01:00",
    signerName: "Dr. HAMDANI",
    lockAfter: null,
  },
};

const timeline = [
  {
    occurredAt: "2026-08-01T10:40:00+01:00",
    eventId: "e1",
    eventType: "diagnostic",
    labelKey: "diagnostic_pose",
    practitionerName: "Dr. HAMDANI",
    detail: {
      label: FAITS_ATTENDUS.diagnostic,
      code: "F41.1",
      code_system: "CIM-10",
      is_primary: true,
      onset_date: "2024-02-01",
      // CLÉ HORS LISTE BLANCHE, volontairement identifiante : simule une
      // migration future qui enrichirait `detail` sans que ce fichier soit relu.
      patient_phone: IDENTIFIANTS.telephone,
      patient_name: `${IDENTIFIANTS.nom} ${IDENTIFIANTS.prenom}`,
    },
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// LE PASSAGE — exactement celui que la boucle exécutera
// ═══════════════════════════════════════════════════════════════════════════

const carte = new CarteIdentite();
const contexte = {
  patient: projeterWorkspace(workspace, carte),
  consultation: projeterConsultation(consultation, carte),
  timeline: projeterTimeline(carte.patient(UUID_PATIENT, "x"), timeline),
  // Le message libre de la praticienne — §1.5 : il part comme le reste.
  message: `Parle-moi de ${IDENTIFIANTS.prenom} ${IDENTIFIANTS.nom}, dossier ${IDENTIFIANTS.numeroDossier}`,
};

let charge = null;
let leve = null;
try {
  charge = preparerPourLeModele(contexte, carte);
} catch (e) {
  leve = e;
}

verdict(
  "le passage n'a pas levé (la charge est réellement émissible)",
  leve === null,
  leve === null ? "aucune levée" : `${leve.name}:${leve.classe ?? "?"}`,
);

const serialisee = JSON.stringify(charge ?? {});

// ── VOLET NÉGATIF ──────────────────────────────────────────────────────────
console.log("\nVolet NÉGATIF — aucune valeur identifiante dans la charge sortante");
for (const [nom, valeur] of Object.entries(IDENTIFIANTS)) {
  const present = serialisee.toLowerCase().includes(String(valeur).toLowerCase());
  verdict(`${nom} absent de la charge`, !present, present ? "PRÉSENT — fuite" : "absent");
}

// ⚠️ LES FRAGMENTS, ET PAS SEULEMENT LES VALEURS ENTIÈRES. Ce bloc existe parce
// qu'un contrôle qui ne cherchait que la valeur COMPLÈTE a été VERT sur une
// vraie fuite : « nadia@example.dz » masqué en « {{PATIENT_001}}@example.dz »
// ne contient plus la chaîne d'origine, mais laisse partir « @example.dz ».
// Une substitution partielle rend toujours vert un test qui cherche l'original.
console.log("\nVolet NÉGATIF (fragments) — une fuite partielle est une fuite");
for (const [nom, fragment] of [
  ["domaine de courriel", "example.dz"],
  ["arobase suivie d'un domaine", "@example"],
  ["nom seul, hors contexte", "belkacem"],
  ["prénom seul, hors contexte", "nadia"],
  ["préfixe du numéro de dossier", "D-2026-"],
  ["fragment d'UUID", UUID_PATIENT.slice(0, 13)],
  ["voie de l'adresse", "Didouche"],
]) {
  const present = serialisee.toLowerCase().includes(fragment.toLowerCase());
  verdict(`fragment « ${nom} » absent`, !present, present ? "PRÉSENT — fuite" : "absent");
}

// Le contact d'urgence et la pièce d'identité : jamais projetés du tout.
console.log("\nVolet NÉGATIF (champs jamais projetés)");
for (const [nom, valeur] of [
  ["contact d'urgence (nom)", "Sofiane"],
  ["pièce d'identité", "108234567"],
  ["émetteur de la pièce", "Daïra"],
  ["notes admin", "Joindre au"],
  ["dictée brute (rawNotes)", "dictée brute"],
  ["marque commerciale", "Zoloft"],
  ["instructions libres", "Revoir"],
]) {
  const present = serialisee.toLowerCase().includes(valeur.toLowerCase());
  verdict(`${nom} absent`, !present, present ? "PRÉSENT — fuite" : "absent");
}

// ── VOLET POSITIF ──────────────────────────────────────────────────────────
console.log("\nVolet POSITIF — le modèle reçoit de quoi raisonner");
verdict(
  "le jeton pseudonyme est présent",
  /PATIENT_\d{3}/.test(serialisee),
  (serialisee.match(/PATIENT_\d{3}/) ?? ["aucun"])[0],
);
for (const [nom, valeur] of Object.entries(FAITS_ATTENDUS)) {
  const present = serialisee.includes(valeur);
  verdict(`fait clinique « ${nom} » transmis`, present, present ? valeur : "ABSENT");
}
verdict(
  "l'âge remplace la date de naissance",
  serialisee.includes('"age":34') && !serialisee.includes(IDENTIFIANTS.dateNaissance),
  "age:34 présent, birthDate absent",
);
verdict(
  "la provenance accompagne les faits",
  /"porte":"app\.get_patient_workspace"/.test(serialisee),
  "porte nommée",
);
verdict(
  "l'incomplétude de l'historique de prescription est déclarée",
  /"historiqueIncomplet":true/.test(serialisee),
  "déclarée au modèle",
);

// ── LE GARDE FAIL-CLOSED ───────────────────────────────────────────────────
console.log("\nGarde fail-closed — une fuite ANNULE l'appel, jamais ne l'ajuste");
for (const [nom, sonde, classe] of [
  ["identité non masquée", { note: `${IDENTIFIANTS.nom} va mieux` }, "identite"],
  ["mobile d'un tiers non déclaré", { note: "rappeler le 0661122334" }, "telephone"],
  ["courriel", { note: "ecrire a contact@exemple.dz" }, "courriel"],
]) {
  let attrape = null;
  try {
    verifierSortant(sonde, carte);
  } catch (e) {
    attrape = e;
  }
  verdict(
    `levée sur ${nom}`,
    attrape instanceof FuiteDetectee && attrape.classe === classe,
    attrape === null ? "AUCUNE LEVÉE" : `${attrape.name}:${attrape.classe}`,
  );
  // La classe ne doit jamais transporter la valeur fautive.
  if (attrape !== null) {
    const message = `${attrape.message}${JSON.stringify(attrape.classe)}`;
    verdict(
      `  └ la levée ne transporte pas la valeur (${nom})`,
      !/BELKACEM|0661122334|contact@exemple/i.test(message),
      "message sans valeur",
    );
  }
}

// ── LE SIDECAR ─────────────────────────────────────────────────────────────
console.log("\nSidecar d'identité — le rendu local, et son refus de deviner");
const ref = carte.patient(UUID_PATIENT, `${IDENTIFIANTS.nom} ${IDENTIFIANTS.prenom}`);
verdict(
  "un jeton connu est rendu en identité locale",
  carte.rendre(`Votre prochain patient est {{${ref}}}.`) ===
    `Votre prochain patient est ${IDENTIFIANTS.nom} ${IDENTIFIANTS.prenom}.`,
  "rendu exact",
);
verdict(
  "un jeton INCONNU n'est jamais deviné",
  carte.rendre("Patient {{PATIENT_999}}.") === `Patient ${MARQUEUR_NON_RESOLU}.`,
  MARQUEUR_NON_RESOLU,
);
// ⚠️ RÉGRESSION DU 2026-08-26. `get_patient_timeline` frappe la carte avec un
// libellé VIDE : elle ne connaît que l'identifiant. Tant qu'une autre source
// avait déjà frappé le dossier sous son vrai nom, l'idempotence sur l'ID le
// masquait — mais une première frappe sans nom rendait `""`, et la phrase
// devenait « le patient  a… » : un trou muet, indiscernable d'une maladresse
// de formulation. Une entrée sans libellé n'a par ailleurs AUCUNE identité à
// masquer : elle doit se voir, pas se taire.
{
  const orpheline = new CarteIdentite();
  const refVide = orpheline.patient("00000000-0000-4000-8000-000000000000", "");
  verdict(
    "un libellé VIDE rend le marqueur, jamais une chaîne vide",
    orpheline.rendre(`Patient {{${refVide}}}.`) === `Patient ${MARQUEUR_NON_RESOLU}.`,
    MARQUEUR_NON_RESOLU,
  );
  verdict(
    "une entrée sans libellé n'expose aucune identité à masquer",
    orpheline.identites().length === 0,
    "0 identité",
  );
}

verdict(
  "le même dossier reçoit TOUJOURS le même jeton",
  carte.patient(UUID_PATIENT, "peu importe") === ref,
  ref,
);
verdict(
  "un jeton résout vers l'identifiant réel (arguments d'outil)",
  carte.resoudre(ref) === UUID_PATIENT,
  "résolution exacte",
);
verdict(
  "un jeton non résolu invalide TOUTE la structure d'arguments",
  carte.resoudreArguments({ patientId: `{{${ref}}}`, autre: "{{PATIENT_999}}" }) === null,
  "refus total, jamais partiel",
);
verdict(
  "la carte détecte structurellement une réponse porteuse d'identité (TTS)",
  carte.porteUneReference(`Bonjour {{${ref}}}`) && !carte.porteUneReference("Bonjour."),
  "détection par forme, pas par heuristique",
);

// ── ISOLATION — scénario K, la moitié vérifiable sans modèle ───────────────
console.log("\nIsolation — la purge de carte empêche la contamination A→B→A");
const carteB = new CarteIdentite();
const refA = carteB.patient("uuid-a", "PATIENT A");
const refB = carteB.patient("uuid-b", "PATIENT B");
verdict(
  "deux patients distincts reçoivent deux jetons distincts",
  refA !== refB,
  `${refA} ≠ ${refB}`,
);
verdict(
  "après purge, l'ancien jeton ne résout plus rien",
  new CarteIdentite().resoudre(refA) === null,
  "carte neuve = aucune résolution",
);

console.log(
  `\n${rouges === 0 ? "VERDICT FRONTIÈRE : VERT" : `VERDICT FRONTIÈRE : ROUGE — ${rouges} contrôle(s)`}`,
);
process.exit(rouges === 0 ? 0 : 1);
