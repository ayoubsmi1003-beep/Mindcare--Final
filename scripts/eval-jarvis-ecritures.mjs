/**
 * eval-jarvis-ecritures — LE CYCLE D'ÉCRITURE, ÉPROUVÉ EN LE FAISANT TOURNER.
 *
 * ═══ LE SCÉNARIO N EST LE CŒUR DE CETTE PASSE ═══
 * « Une action échoue après proposition → Jarvis rapporte l'échec, jamais un
 * faux succès. » C'est le seul contrôle qui distingue une couche d'écriture
 * honnête d'une couche qui se contente de ne pas planter.
 *
 * La vérification est ce que V-JARVIS-CORE n'avait pas : `executerAction` refuse
 * déjà de lire un retour NULL comme un succès — nécessaire, pas suffisant. La
 * porte peut rendre un identifiant (« quelque chose a été touché ») sans que la
 * ligne porte l'heure demandée. On éprouve donc les DEUX : le cas où la
 * relecture confirme, et le cas où elle contredit.
 *
 * `setDbPort` est utilisé tel qu'il a été prévu : « dans un test ou un
 * checkpoint, un port factice, sans réseau ni clé » (`db/index.ts`).
 *
 *   node scripts/eval-jarvis-ecritures.mjs <répertoire-des-modules-compilés>
 */

import { pathToFileURL } from "node:url";
import { join } from "node:path";

const repertoire = process.argv[2];
if (repertoire === undefined) {
  console.error("usage : node scripts/eval-jarvis-ecritures.mjs <dir js compilé>");
  process.exit(2);
}
const url = (f) => pathToFileURL(join(repertoire, f)).href;

const { capaciteEcriture, nomsDEcriture } = await import(url("jarvis-ecritures.js"));
const { setDbPort } = await import(url("db/index.js"));
const { CarteIdentite } = await import(url("jarvis-identite.js"));

let rouges = 0;
function verdict(nom, ok, detail) {
  if (!ok) rouges++;
  console.log(`  ${ok ? "vert " : "ROUGE"} | ${nom.padEnd(58)} | ${detail}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// UN PORT FACTICE — scripté par nom de porte
// ═══════════════════════════════════════════════════════════════════════════

const RDV_ID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const PRAT_ID = "3f2504e0-4f89-11d3-9a0c-0305e82c3302";

function portFactice(reponses) {
  const appels = [];
  return {
    appels,
    port: {
      select: async () => ({ ok: true, data: [] }),
      rpc: async (nom, args) => {
        appels.push({ nom, args });
        const r = reponses[nom];
        if (r === undefined) return { ok: true, data: [] };
        return typeof r === "function" ? r(args, appels) : r;
      },
      signIn: async () => ({ ok: true, data: null }),
      signOut: async () => ({ ok: true, data: undefined }),
      getSession: async () => ({ ok: true, data: null }),
      invokeFunction: async () => ({ ok: true, data: {} }),
      invokeFunctionStream: async () => ({ ok: false, error: { code: "indisponible", message: "-" } }),
    },
  };
}

/** Une ligne d'agenda telle que `get_appointment` la rend. */
function ligneRdv({ startsAt, status = "scheduled", arrivedAt = null }) {
  return {
    id: RDV_ID,
    starts_at: startsAt,
    ends_at: new Date(Date.parse(startsAt) + 30 * 60_000).toISOString(),
    status,
    source: "doctor",
    kind: "suivi",
    notes_admin: null,
    arrived_at: arrivedAt,
    patient_id: "3f2504e0-4f89-11d3-9a0c-0305e82c3303",
    record_number: "D-2026-0417",
    first_name: "Nadia",
    last_name: "BELKACEM",
    practitioner_id: PRAT_ID,
    practitioner_name: "Dr. HAMDANI",
  };
}

const DEMANDE = "2026-09-03T15:00:00+01:00";
const AVANT = "2026-09-01T14:00:00+01:00";

// ═══════════════════════════════════════════════════════════════════════════
// E0 · LA SÉPARATION DES REGISTRES
// ═══════════════════════════════════════════════════════════════════════════
console.log("\nE0 — lectures et écritures sont deux registres disjoints");
{
  const { capaciteLecture } = await import(url("jarvis-capacites.js"));
  const ecritures = nomsDEcriture();
  verdict(
    "aucune écriture n'est atteignable par le registre de LECTURE",
    ecritures.every((n) => capaciteLecture(n) === null),
    ecritures.join(", "),
  );
  verdict(
    "les actes engageants ne sont dans AUCUN registre",
    ["issue_document", "print_document", "delete_patient", "send_message", "export_data"].every(
      (n) => capaciteLecture(n) === null && capaciteEcriture(n) === null,
    ),
    "émission, impression, suppression, envoi, export",
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// E1 · PRÉCONDITION — refuser AVANT la carte, pas après le clic
// ═══════════════════════════════════════════════════════════════════════════
console.log("\nE1 — la précondition refuse avant de poser une proposition");
{
  const { port, appels } = portFactice({
    get_appointment: { ok: true, data: [ligneRdv({ startsAt: AVANT })] },
    // Le créneau visé est OCCUPÉ.
    check_slot_available: { ok: true, data: [{ disponible: false, motif: "creneau-occupe" }] },
  });
  setDbPort(port);

  const cap = capaciteEcriture("reschedule_appointment");
  const r = await cap.preparer(
    { appointmentId: RDV_ID, nouveauDebut: DEMANDE },
    new CarteIdentite(),
  );

  verdict("la préparation ÉCHOUE", !r.ok, r.ok ? "acceptée à tort" : r.error.code);
  verdict(
    "le message nomme le créneau occupé et dit que rien n'a bougé",
    !r.ok && /déjà pris/i.test(r.error.message) && /rien n'a été modifié/i.test(r.error.message),
    !r.ok ? r.error.message.slice(0, 46) : "-",
  );
  verdict(
    "AUCUNE ligne `proposed` n'a été posée",
    !appels.some((a) => a.nom === "propose_jarvis_action"),
    "propose_jarvis_action jamais appelée",
  );
  verdict(
    "la disponibilité s'exclut elle-même du conflit",
    appels.find((a) => a.nom === "check_slot_available")?.args.p_exclude_id === RDV_ID,
    "p_exclude_id = le rendez-vous déplacé",
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// E2 · LA CARTE — ce que l'humaine lit avant d'accepter
// ═══════════════════════════════════════════════════════════════════════════
console.log("\nE2 — la carte dit l'acte et ses champs");
{
  const { port } = portFactice({
    get_appointment: { ok: true, data: [ligneRdv({ startsAt: AVANT })] },
    check_slot_available: { ok: true, data: [{ disponible: true, motif: null }] },
  });
  setDbPort(port);

  const cap = capaciteEcriture("reschedule_appointment");
  const r = await cap.preparer(
    { appointmentId: RDV_ID, nouveauDebut: DEMANDE },
    new CarteIdentite(),
  );
  verdict("la préparation aboutit sur un créneau libre", r.ok, r.ok ? "ok" : r.error.code);
  verdict(
    "le titre nomme l'acte, pas un vague « modifier »",
    r.ok && /Déplacer le rendez-vous/.test(r.data.titre),
    r.ok ? r.data.titre : "-",
  );
  verdict(
    "la nouvelle date est lisible en heure d'Alger",
    r.ok && r.data.champs.some((c) => /15:00/.test(c.valeur)),
    r.ok ? (r.data.champs[0]?.valeur ?? "-") : "-",
  );
  verdict(
    "aucun nom de patient ne figure sur la carte via un jeton brut",
    r.ok && !r.data.champs.some((c) => /\{\{/.test(c.valeur)),
    "aucun jeton non rendu",
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// E3 · SCÉNARIO N — LA VÉRIFICATION CONTREDIT L'EXÉCUTION
// ═══════════════════════════════════════════════════════════════════════════
console.log("\nE3 — SCÉNARIO N : la porte n'a pas levé, mais l'effet n'y est pas");
{
  // La porte a rendu un identifiant — donc « quelque chose a été touché ». Mais
  // la relecture montre l'ANCIENNE heure : l'écriture n'a pas pris.
  const { port } = portFactice({
    get_appointment: { ok: true, data: [ligneRdv({ startsAt: AVANT })] },
  });
  setDbPort(port);

  const cap = capaciteEcriture("reschedule_appointment");
  const v = await cap.verifier({ appointmentId: RDV_ID, nouveauDebut: DEMANDE }, RDV_ID);

  verdict("la vérification ÉCHOUE", !v.ok, v.ok ? "déclarée vérifiée à tort" : v.error.code);
  verdict(
    "elle ne dit NI « c'est fait » NI « ça a échoué »",
    !v.ok && /tentée/i.test(v.error.message) && !/c'est fait/i.test(v.error.message),
    !v.ok ? v.error.message.slice(0, 52) : "-",
  );
  verdict(
    "elle renvoie la praticienne à l'écran",
    !v.ok && /vérifiez à l'écran/i.test(v.error.message),
    "mention présente",
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// E4 · LE CAS NOMINAL — la relecture confirme
// ═══════════════════════════════════════════════════════════════════════════
console.log("\nE4 — la relecture confirme l'heure demandée");
{
  const { port } = portFactice({
    get_appointment: { ok: true, data: [ligneRdv({ startsAt: DEMANDE })] },
  });
  setDbPort(port);
  const cap = capaciteEcriture("reschedule_appointment");
  const v = await cap.verifier({ appointmentId: RDV_ID, nouveauDebut: DEMANDE }, RDV_ID);
  verdict("la vérification réussit", v.ok, v.ok ? "vérifiée" : v.error.code);
}

// ═══════════════════════════════════════════════════════════════════════════
// E5 · LES FUSEAUX — même instant, deux écritures
// ═══════════════════════════════════════════════════════════════════════════
console.log("\nE5 — la comparaison porte sur l'INSTANT, pas sur la chaîne");
{
  // `2026-09-03T15:00:00+01:00` et `2026-09-03T14:00:00Z` sont le MÊME moment.
  // Comparer les chaînes déclarerait un échec sur une écriture parfaite — et la
  // praticienne irait vérifier un rendez-vous qui est en réalité correct.
  const { port } = portFactice({
    get_appointment: { ok: true, data: [ligneRdv({ startsAt: "2026-09-03T14:00:00Z" })] },
  });
  setDbPort(port);
  const cap = capaciteEcriture("reschedule_appointment");
  const v = await cap.verifier({ appointmentId: RDV_ID, nouveauDebut: DEMANDE }, RDV_ID);
  verdict("deux écritures du même instant sont acceptées", v.ok, "+01:00 ≡ Z");
}

// ═══════════════════════════════════════════════════════════════════════════
// E6 · ANNULATION — acte critique, motif exigé, état relu
// ═══════════════════════════════════════════════════════════════════════════
console.log("\nE6 — annulation : critique, motif obligatoire, état vérifié");
{
  const cap = capaciteEcriture("cancel_appointment");
  verdict("l'annulation est marquée CRITIQUE", cap.critique === true, "critique:true");

  setDbPort(portFactice({ get_appointment: { ok: true, data: [ligneRdv({ startsAt: AVANT })] } }).port);
  const sansMotif = await cap.preparer({ appointmentId: RDV_ID, motif: "" }, new CarteIdentite());
  verdict("un motif vide est refusé", !sansMotif.ok, !sansMotif.ok ? sansMotif.error.code : "acceptée");

  const avecMotif = await cap.preparer(
    { appointmentId: RDV_ID, motif: "Patiente souffrante, rappellera" },
    new CarteIdentite(),
  );
  verdict("un motif renseigné passe", avecMotif.ok, avecMotif.ok ? "ok" : avecMotif.error.code);
  verdict(
    "le motif figure sur la carte",
    avecMotif.ok && avecMotif.data.champs.some((c) => /souffrante/.test(c.valeur)),
    "motif visible",
  );

  // Déjà annulé → refus en précondition.
  setDbPort(portFactice({
    get_appointment: { ok: true, data: [ligneRdv({ startsAt: AVANT, status: "cancelled" })] },
  }).port);
  const deja = await cap.preparer({ appointmentId: RDV_ID, motif: "doublon" }, new CarteIdentite());
  verdict("annuler deux fois est refusé", !deja.ok, !deja.ok ? "refusé" : "accepté à tort");

  // Vérification : la relecture doit montrer `cancelled`.
  setDbPort(portFactice({
    get_appointment: { ok: true, data: [ligneRdv({ startsAt: AVANT, status: "scheduled" })] },
  }).port);
  const v = await cap.verifier({ appointmentId: RDV_ID, motif: "x" }, RDV_ID);
  verdict("une annulation qui n'a pas pris est signalée", !v.ok, "non vérifiée");
}

// ═══════════════════════════════════════════════════════════════════════════
// E7 · CIBLE INTROUVABLE ≡ HORS PÉRIMÈTRE (ADR-003)
// ═══════════════════════════════════════════════════════════════════════════
console.log("\nE7 — introuvable et hors périmètre rendent la MÊME chose");
{
  setDbPort(portFactice({ get_appointment: { ok: true, data: [] } }).port);
  const messages = [];
  for (const nom of ["reschedule_appointment", "cancel_appointment", "mark_patient_arrived"]) {
    const cap = capaciteEcriture(nom);
    const args =
      nom === "cancel_appointment"
        ? { appointmentId: RDV_ID, motif: "motif quelconque" }
        : nom === "reschedule_appointment"
          ? { appointmentId: RDV_ID, nouveauDebut: DEMANDE }
          : { appointmentId: RDV_ID };
    const r = await cap.preparer(args, new CarteIdentite());
    messages.push(r.ok ? "ACCEPTÉE" : r.error.code);
  }
  verdict(
    "les trois refusent de la même façon",
    new Set(messages).size === 1 && messages[0] === "introuvable",
    messages.join(" / "),
  );
  verdict(
    "aucun oracle d'existence n'est fabriqué",
    messages.every((m) => m === "introuvable"),
    "jamais « hors périmètre » distinct de « introuvable »",
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// E8 · ARGUMENTS HALLUCINÉS — la frontière Zod tient
// ═══════════════════════════════════════════════════════════════════════════
console.log("\nE8 — un argument inventé échoue à la frontière du schéma");
{
  setDbPort(portFactice({
    get_appointment: { ok: true, data: [ligneRdv({ startsAt: AVANT })] },
    check_slot_available: { ok: true, data: [{ disponible: true, motif: null }] },
  }).port);
  const cap = capaciteEcriture("reschedule_appointment");

  const enTrop = await cap.preparer(
    { appointmentId: RDV_ID, nouveauDebut: DEMANDE, force: true },
    new CarteIdentite(),
  );
  verdict("une clé inattendue est REJETÉE, jamais ignorée", !enTrop.ok, "strictObject");

  const malForme = await cap.preparer(
    { appointmentId: "pas-un-uuid", nouveauDebut: DEMANDE },
    new CarteIdentite(),
  );
  verdict("un identifiant mal formé est rejeté", !malForme.ok, "guid");

  const sansFuseau = await cap.preparer(
    { appointmentId: RDV_ID, nouveauDebut: "2026-09-03T15:00:00" },
    new CarteIdentite(),
  );
  verdict(
    "un instant SANS fuseau est rejeté (faux une heure par nuit)",
    !sansFuseau.ok,
    "offset exigé",
  );
}

setDbPort(undefined);
console.log(
  `\n${rouges === 0 ? "VERDICT ÉCRITURES : VERT" : `VERDICT ÉCRITURES : ROUGE — ${rouges} contrôle(s)`}`,
);
process.exit(rouges === 0 ? 0 : 1);
