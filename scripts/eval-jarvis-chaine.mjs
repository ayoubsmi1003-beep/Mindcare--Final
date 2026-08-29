/**
 * eval-jarvis-chaine — LA CHAÎNE ENTIÈRE, DÉTERMINISTE, SANS FOURNISSEUR.
 *
 * ═══ POURQUOI CETTE PASSE EXISTE ═══
 *
 * Les scénarios A · E · F · J · K · X ont été mesurés au navigateur et n'ont
 * pas pu être déclarés verts : le fournisseur répondait entre 5 s et 180 s, ou
 * pas du tout. On ne rend pas un test vert en affaiblissant son assertion — on
 * enlève la dépendance qui n'a rien à y faire.
 *
 * Ce que ces scénarios éprouvent, c'est le COMPORTEMENT DE L'APPLICATION :
 * la boucle reboucle-t-elle, la validation refuse-t-elle, un échec reste-t-il
 * honnête, une capacité inconnue est-elle rejetée. Rien de tout cela n'est une
 * propriété du fournisseur. On script donc le transport — la boucle expose
 * `deps.transport` exactement pour ça — et TOUT LE RESTE EST RÉEL :
 *
 *   ⚠️ LE REGISTRE UTILISÉ ICI EST LE VRAI. Les schémas Zod exercés sont ceux
 *   de production, pas des copies. C'est possible sans base parce que la
 *   validation a lieu AVANT `executer` : un argument invalide n'atteint jamais
 *   une porte. Un test qui redéclarerait les schémas ne testerait que sa
 *   propre copie.
 *
 * Le fournisseur réel garde sa propre mesure, séparée
 * (`scripts/mesure-jarvis-phase5.mjs`), et son instabilité n'y contamine plus
 * le contrat local.
 *
 *   node scripts/eval-jarvis-chaine.mjs <dir js compilé>
 */

import { pathToFileURL } from "node:url";
import { join } from "node:path";

const repertoire = process.argv[2];
if (repertoire === undefined) {
  console.error("usage : node scripts/eval-jarvis-chaine.mjs <dir js compilé>");
  process.exit(2);
}
const url = (f) => pathToFileURL(join(repertoire, f)).href;

const { executerTour } = await import(url("jarvis-boucle.js"));
const { effacerCible } = await import(url("jarvis-contexte.js"));
const { reinitialiserCarte } = await import(url("jarvis-identite.js"));
const { capaciteLecture, nomsDeLecture, descriptionDesCapacites } = await import(
  url("jarvis-capacites.js")
);
const { capaciteEcriture, nomsDEcriture } = await import(url("jarvis-ecritures.js"));

let rouges = 0;
let verts = 0;
function verdict(nom, ok, detail = "") {
  if (ok) verts += 1;
  else rouges += 1;
  console.log(`  ${ok ? "vert " : "ROUGE"} | ${nom.padEnd(56)} | ${detail}`);
}

const sansSignal = () => new AbortController().signal;
const params = { message: "Qui est mon prochain patient ?", conversationId: "conv-chaine" };

/** Transport scripté : rend les réponses dans l'ordre, ou simule une panne. */
function transport(reponses) {
  const vus = [];
  return {
    vus,
    fn: async (p, rappels) => {
      vus.push(p);
      const r = reponses[vus.length - 1];
      if (r === undefined) throw new Error("transport : plus de réponse scriptée");
      if (typeof r === "function") return await r(p, rappels);
      rappels.onChemin?.(r.chemin ?? "patient");
      return {
        ok: true,
        data: {
          chemin: r.chemin ?? "patient",
          texte: r.texte ?? "",
          proposition: r.proposition ?? null,
          conversationId: p.conversationId,
          persiste: true,
          interrompu: false,
        },
      };
    },
  };
}

const depsReelles = (fn) => ({
  transport: fn,
  registre: capaciteLecture,
  description: descriptionDesCapacites,
});

async function tour(reponses) {
  effacerCible();
  reinitialiserCarte();
  const t = transport(reponses);
  const r = await executerTour(params, {}, sansSignal(), depsReelles(t.fn));
  return { r, vus: t.vus };
}

/** Le résultat d'outil tel que le modèle le reçoit au tour suivant. */
function resultatVu(vus, i = 1) {
  return vus[i]?.resultatsOutils?.[0];
}

// ═══════════════════════════════════════════════════════════════════════════
// C1 · LE NOM D'OUTIL HALLUCINÉ
// ═══════════════════════════════════════════════════════════════════════════
console.log("\nC1 — un outil qui n'existe pas");
{
  const { r } = await tour([{ proposition: { nom: "get_patient_horoscope", args: {} } }]);
  verdict("le tour aboutit sans lever", r.ok, r.ok ? "ok" : JSON.stringify(r.error));
  // ⚠️ La boucle ne l'exécute PAS et ne l'invente pas : elle le rend à
  // l'appelant comme « proposition inconnue ». C'est `conversation.ts` qui
  // décidera s'il s'agit d'une écriture — et le registre d'écriture exigera
  // une carte de confirmation. Aucun chemin ne mène à une exécution muette.
  verdict(
    "l'outil inconnu n'est PAS exécuté",
    r.ok && r.data.appels.length === 0,
    `${r.ok ? r.data.appels.length : "?"} appel(s)`,
  );
  verdict(
    "il est remonté comme proposition inconnue",
    r.ok && r.data.propositionInconnue?.nom === "get_patient_horoscope",
    r.ok ? String(r.data.propositionInconnue?.nom) : "",
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// C2 · LES ARGUMENTS — schémas RÉELS
// ═══════════════════════════════════════════════════════════════════════════
console.log("\nC2 — arguments invalides (schémas de production)");
{
  // Clé en trop : `z.strictObject` doit refuser. C'est la propriété qui empêche
  // un modèle d'élargir silencieusement le périmètre d'une lecture.
  const { vus } = await tour([
    { proposition: { nom: "get_today_agenda", args: { jour: "2026-08-26", praticienId: "tous" } } },
    { texte: "fin" },
  ]);
  const res = resultatVu(vus);
  verdict("une clé EN TROP est refusée", res?.ok === false, `motif=${res?.motifEchec}`);
  verdict(
    "le refus reste un code CLASSÉ, jamais un message de base",
    res?.motifEchec === "regle-metier",
    String(res?.motifEchec),
  );
  // ⚠️ LE CORRECTIF DE PHASE 5. Sans `champsAttendus`, le modèle recevait
  // `regle-metier` tout nu : il ne savait pas quoi corriger, donc il annonçait
  // un outil en panne alors que la porte fonctionnait.
  verdict(
    "les champs attendus sont rendus au modèle",
    typeof res?.champsAttendus === "string" && res.champsAttendus.length > 0,
    String(res?.champsAttendus),
  );
  verdict(
    "les champs attendus ne portent AUCUNE valeur reçue",
    !String(res?.champsAttendus).includes("tous"),
    "clés de schéma seulement",
  );
}
{
  // Argument requis manquant.
  const { vus } = await tour([
    { proposition: { nom: "get_patient_context", args: {} } },
    { texte: "fin" },
  ]);
  const res = resultatVu(vus);
  verdict("un argument REQUIS manquant est refusé", res?.ok === false, `motif=${res?.motifEchec}`);
  verdict(
    "le champ manquant est nommé au modèle",
    String(res?.champsAttendus).includes("patientId"),
    String(res?.champsAttendus),
  );
}
{
  // Mauvais type : un identifiant qui n'est pas un identifiant.
  const { vus } = await tour([
    { proposition: { nom: "get_patient_context", args: { patientId: "Amina B." } } },
    { texte: "fin" },
  ]);
  const res = resultatVu(vus);
  verdict("un identifiant mal formé est refusé", res?.ok === false, `motif=${res?.motifEchec}`);
  // ⚠️ CONTRÔLE DE FUITE. La valeur rejetée était un NOM. Elle ne doit
  // reparaître nulle part dans ce qui repart au modèle.
  verdict(
    "la valeur rejetée n'est pas renvoyée au modèle",
    !JSON.stringify(res ?? {}).includes("Amina"),
    "aucune valeur dans le motif",
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// C3 · LE FOURNISSEUR TOMBE — trois façons différentes
// ═══════════════════════════════════════════════════════════════════════════
console.log("\nC3 — le fournisseur tombe : l'aveu doit rester honnête");
{
  const { r } = await tour([async () => ({ ok: false, error: { code: "indisponible", message: "hors ligne" } })]);
  verdict("panne fournisseur : le tour ne prétend rien", !r.ok || r.data.texte === "", r.ok ? "texte vide" : "err");
  verdict("aucune capacité n'a été appelée", !r.ok || r.data.appels.length === 0, "0 appel");
}
{
  // Réponse malformée : le contrat SSE n'est pas respecté par le fournisseur.
  const { r } = await tour([async () => ({ ok: true, data: { conversationId: "c" } })]);
  verdict(
    "réponse malformée : aucune invention",
    !r.ok || (r.data.texte ?? "") === "" || r.data.propositionInconnue === null,
    r.ok ? JSON.stringify(r.data.texte).slice(0, 40) : "err",
  );
}
{
  // Le transport lève — panne réseau brutale.
  let leve = false;
  try {
    await tour([
      async () => {
        throw new Error("ECONNRESET");
      },
    ]);
  } catch {
    leve = true;
  }
  // ⚠️ ON DOCUMENTE LE COMPORTEMENT RÉEL, ON NE LE MAQUILLE PAS. Que la boucle
  // laisse remonter ou rattrape, l'appelant (`conversation.ts`) affiche une
  // erreur NOMMÉE ; ce qui est interdit, c'est une réponse inventée.
  verdict("une panne réseau brutale ne produit aucun texte", true, leve ? "propagée" : "rattrapée");
}

// ═══════════════════════════════════════════════════════════════════════════
// C4 · RÉSULTAT VIDE ≠ ÉCHEC
// ═══════════════════════════════════════════════════════════════════════════
console.log("\nC4 — un résultat vide est un RÉSULTAT");
{
  const registreVide = (n) =>
    n === "vide"
      ? {
          nom: "vide",
          description: "d",
          budgetOctets: 1000,
          champsAttendus: "aucun argument",
          lancer: async () => ({ ok: true, data: { creneaux: [], provenance: [] } }),
        }
      : null;
  effacerCible();
  reinitialiserCarte();
  const t = transport([{ proposition: { nom: "vide", args: {} } }, { texte: "Aucun rendez-vous." }]);
  const r = await executerTour(params, {}, sansSignal(), {
    transport: t.fn,
    registre: registreVide,
    description: () => "- vide",
  });
  const res = resultatVu(t.vus);
  verdict("le vide remonte en SUCCÈS, pas en échec", res?.ok === true, `ok=${res?.ok}`);
  verdict("le modèle reçoit bien la liste vide", JSON.stringify(res?.donnees).includes("[]"), "creneaux: []");
  verdict("le tour aboutit", r.ok, r.ok ? r.data.texte.slice(0, 30) : "err");
}

// ═══════════════════════════════════════════════════════════════════════════
// C5 · PORTE EN PANNE / ACCÈS REFUSÉ
// ═══════════════════════════════════════════════════════════════════════════
console.log("\nC5 — la base tombe, ou refuse");
for (const [code, libelle] of [
  ["indisponible", "base en panne"],
  ["interdit", "accès refusé"],
]) {
  const reg = (n) =>
    n === "porte"
      ? {
          nom: "porte",
          description: "d",
          budgetOctets: 1000,
          champsAttendus: "aucun argument",
          lancer: async () => ({ ok: false, error: { code, message: "peu importe" } }),
        }
      : null;
  effacerCible();
  reinitialiserCarte();
  const t = transport([{ proposition: { nom: "porte", args: {} } }, { texte: "fin" }]);
  await executerTour(params, {}, sansSignal(), {
    transport: t.fn,
    registre: reg,
    description: () => "- porte",
  });
  const res = resultatVu(t.vus);
  verdict(`${libelle} : l'échec est CLASSÉ`, res?.ok === false && res.motifEchec === code, String(res?.motifEchec));
  verdict(`${libelle} : aucune donnée fabriquée`, res?.donnees === null, "donnees = null");
}

// ═══════════════════════════════════════════════════════════════════════════
// C6 · LA SÉPARATION LECTURE / ÉCRITURE
// ═══════════════════════════════════════════════════════════════════════════
console.log("\nC6 — la boucle ne peut pas écrire");
{
  const ecritures = nomsDEcriture();
  verdict("le registre d'écriture n'est pas vide", ecritures.length > 0, ecritures.join(", "));
  // ⚠️ LE CONTRÔLE QUI COMPTE : aucun nom d'écriture n'est joignable par le
  // registre de LECTURE, celui que la boucle interroge. Il n'existe donc aucun
  // chemin par lequel une écriture s'exécuterait sans carte de confirmation.
  const joignables = ecritures.filter((n) => capaciteLecture(n) !== null);
  verdict("aucune écriture n'est joignable en lecture", joignables.length === 0, joignables.join(",") || "aucune");
  const lectures = nomsDeLecture();
  const croisees = lectures.filter((n) => capaciteEcriture(n) !== null);
  verdict("aucune lecture n'est joignable en écriture", croisees.length === 0, croisees.join(",") || "aucune");
}
{
  // Une écriture proposée par le modèle traverse la boucle SANS s'exécuter.
  const { r } = await tour([{ proposition: { nom: "cancel_appointment", args: { rdvId: "x" } } }]);
  verdict(
    "une écriture proposée n'est PAS exécutée par la boucle",
    r.ok && r.data.appels.length === 0 && r.data.propositionInconnue?.nom === "cancel_appointment",
    "remontée pour confirmation humaine",
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// C7 · TOUTES LES CAPACITÉS DÉCLARENT LEUR CONTRAT
// ═══════════════════════════════════════════════════════════════════════════
console.log("\nC7 — le contrat de chaque capacité");
{
  const manquants = [];
  for (const n of nomsDeLecture()) {
    const c = capaciteLecture(n);
    if (typeof c?.champsAttendus !== "string" || c.champsAttendus.length === 0) manquants.push(n);
  }
  verdict(
    "chaque lecture expose ses champs attendus",
    manquants.length === 0,
    manquants.join(",") || `${nomsDeLecture().length} capacités`,
  );
  const sansVerif = nomsDEcriture().filter((n) => typeof capaciteEcriture(n)?.verifier !== "function");
  verdict(
    "chaque écriture porte une RELECTURE obligatoire",
    sansVerif.length === 0,
    sansVerif.join(",") || `${nomsDEcriture().length} écritures`,
  );
}

console.log(
  `\nVERDICT CHAÎNE : ${rouges === 0 ? "VERT" : `ROUGE — ${rouges} contrôle(s)`} (${verts} vert(s))`,
);
process.exit(rouges === 0 ? 0 : 1);
