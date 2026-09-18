/**
 * eval-jarvis-intentions — LE HARNESS GOLDEN M08-A (bootstrap M01).
 *
 * ═══ CE QUE CETTE PASSE PROUVE ═══
 * Sur sorties modèle PINÉES (transport faux, 0 réseau) : le classifieur rend
 * le statut/l'intention/entités/manquants/flags attendus, l'outil attendu est
 * compatible avec l'intention, les refus restent décidés par la frontière
 * déterministe (jamais par le classifieur). Confusion/qualité : rapport par
 * intention + paires de confusion.
 *
 * ═══ CE QU'ELLE NE PROUVE PAS ═══
 * Ni la qualité live d'un vrai modèle (sorties pinées), ni la RLS, ni le rendu
 * UI. Le live se mesure au navigateur ; cette passe garde la régression.
 *
 *   node scripts/eval-jarvis-intentions.mjs <dir intentions compilé> <dir frontière> [golden.json]
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";

const dirIntentions = process.argv[2];
const dirFrontiere = process.argv[3];
const cheminGolden =
  process.argv[4] ?? join(dirname(process.argv[1]), "..", "tests", "eval", "jarvis-intentions.golden.json");
if (dirIntentions === undefined || dirFrontiere === undefined) {
  console.error("usage : node scripts/eval-jarvis-intentions.mjs <dir intentions> <dir frontiere> [golden.json]");
  process.exit(2);
}

const { classifierIntent } = await import(
  pathToFileURL(join(resolve(dirIntentions), "server", "jarvis", "classifieur-intentions.js")).href
);
const { estPropositionCompatible, mentionsEgales } = await import(
  pathToFileURL(join(resolve(dirIntentions), "shared", "jarvis", "intentions.js")).href
);
const { classerMultilingue } = await import(
  pathToFileURL(join(resolve(dirFrontiere), "normalisation.js")).href
);

const golden = JSON.parse(readFileSync(resolve(cheminGolden), "utf8"));
const cas = golden.cas ?? [];

let rouges = 0;
let verts = 0;
const parIntention = new Map();
const confusions = [];

function verdict(ok, ligne, detail = "") {
  if (ok) verts += 1;
  else rouges += 1;
  console.log(`  ${ok ? "vert " : "ROUGE"} | ${ligne}${detail === "" ? "" : ` | ${detail}`}`);
}

function memeTableau(a, b) {
  if (a.length !== b.length) return false;
  const sa = [...a].sort().join(",");
  const sb = [...b].sort().join(",");
  return sa === sb;
}

for (const c of cas) {
  const faux = {
    completer: async () => ({ texte: c.sortieModele, modele: "pinné/m01" }),
  };
  const ids = { conversationId: randomUUID(), turnId: randomUUID(), runId: randomUUID() };
  let r;
  try {
    r = await classifierIntent(c.input, ids, faux);
  } catch (e) {
    verdict(false, `${c.id} le classifieur ne lève jamais`, String(e));
    continue;
  }
  const a = c.attendu;
  const statutOk = r.statut === a.statut;
  const raisonOk = a.statut === "valide" ? true : r.raison === a.raison;
  let fondOk = true;
  if (r.statut === "valide" && a.statut === "valide") {
    fondOk =
      r.intent.name === a.intent &&
      memeTableau(r.intent.missingInformation, a.missingInformation) &&
      r.intent.references.pronomSansAntecedent === a.pronomSansAntecedent &&
      r.intent.references.homonymePossible === a.homonymePossible;
    if (a.patientMention !== null && a.patientMention !== undefined) {
      const mention = r.intent.entities.patientMention ?? null;
      fondOk = fondOk && mention !== null && mentionsEgales(mention, a.patientMention);
    }
  }
  // Compatibilité : l'outil attendu appartient à la famille de l'intention.
  let compatOk = true;
  if (r.statut === "valide" && a.statut === "valide" && a.outil !== null) {
    compatOk = estPropositionCompatible(r.intent.name, a.outil);
  }
  if (r.statut === "valide" && a.statut === "valide" && a.outil === null) {
    compatOk = ["GENERAL_KNOWLEDGE", "ASK_CLARIFICATION", "UNKNOWN"].includes(r.intent.name);
  }
  // Refus : la frontière déterministe tranche, pas le classifieur.
  let refusOk = true;
  if (a.refus === true) {
    refusOk = classerMultilingue(c.input).chemin === "refus";
  }
  const ok = statutOk && raisonOk && fondOk && compatOk && refusOk;
  const cle = `${a.intent ?? r.raison ?? "?"}`;
  const entree = parIntention.get(cle) ?? { total: 0, ok: 0 };
  entree.total += 1;
  if (ok) entree.ok += 1;
  parIntention.set(cle, entree);
  if (!ok && r.statut === "valide" && a.statut === "valide" && r.intent.name !== a.intent) {
    confusions.push(`${c.id}: attendu=${a.intent} obtenu=${r.intent.name} « ${c.input} »`);
  }
  verdict(
    ok,
    `${c.id} [${c.langue}/${c.categorie}] ${a.intent ?? a.raison ?? "?"}`,
    ok
      ? `modele=${r.modele} latence=${r.latenceMs}ms`
      : `attendu=${JSON.stringify(a)} obtenu=${JSON.stringify(r.statut === "valide" ? r.intent : r.raison)} refusGate=${a.refus === true ? classerMultilingue(c.input).chemin : "-"}`,
  );
}

console.log("\n— par intention (qualité) —");
for (const [nom, e] of [...parIntention.entries()].sort()) {
  console.log(`  ${e.ok === e.total ? "vert " : "ROUGE"} | ${nom.padEnd(28)} | ${e.ok}/${e.total}`);
}
if (confusions.length > 0) {
  console.log("\n— confusions —");
  for (const l of confusions) console.log(`  ROUGE | ${l}`);
}

console.log(`\nVERDICT INTENTIONS : ${rouges === 0 ? `VERT (${verts} vert(s))` : `ROUGE — ${rouges} contrôle(s)`}`);
process.exit(rouges === 0 ? 0 : 1);
