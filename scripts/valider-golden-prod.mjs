/**
 * valider-golden-prod — M07 R0 · auto-validation du jugement de production.
 *
 * Vérifie : 46/46 cas (mêmes ids que le gelé), requêtes/langues octet-identiques
 * au gelé, schéma valide, sources/versions/sections existantes en base (lecture
 * seule), aucun positif sur source révoquée/supersédée/non-C4/non-approuvée,
 * sémantique forbidden/no-answer/multilingue intacte, ordre déterministe.
 *
 *   node scripts/valider-golden-prod.mjs
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..");
const GELE = JSON.parse(readFileSync(join(RACINE, "tests", "eval", "knowledge.golden.json"), "utf8"));
const PROD = JSON.parse(readFileSync(join(RACINE, "tests", "eval", "knowledge.golden.prod-2026-09-15.json"), "utf8"));

let verts = 0;
const rouges = [];
function check(nom, ok, detail = "") {
  if (ok) verts += 1;
  else rouges.push(nom + (detail === "" ? "" : " : " + detail));
}

// 1 · Couverture + ordre déterministe (même ordre que le gelé)
check("46-cas", PROD.cas.length === 46, "n=" + PROD.cas.length);
check("ordre-identique-gele", PROD.cas.every((c, i) => c.id === GELE.cas[i].id));
// 2 · Requêtes/langues intactes
for (const g of GELE.cas) {
  const p = PROD.cas.find((c) => c.id === g.id);
  check(g.id + "-requete-intacte", p !== undefined && p.requete === g.requete);
  check(g.id + "-langue-intacte", p !== undefined && p.langue === g.langue);
}
// 3 · Schéma
const LANGUES = new Set(["fr", "ar", "darija"]);
const ISSUES = new Set(["pertinent", "faible", "aucune"]);
for (const c of PROD.cas) {
  const okS = typeof c.id === "string" && typeof c.requete === "string" && LANGUES.has(c.langue) && ISSUES.has(c.issue)
    && (c.gold === null || (typeof c.gold.source === "string" && typeof c.gold.section === "string"))
    && Array.isArray(c.acceptable) && Array.isArray(c.hard_negatives) && Array.isArray(c.forbidden)
    && typeof c.expected_no_answer === "boolean"
    && (c.expected_version === null || typeof c.expected_version === "string")
    && (c.citation_contient === null || typeof c.citation_contient === "string")
    && typeof c.motif === "string" && c.motif !== "";
  check(c.id + "-schema", okS);
  // Cohérence issue/jugement
  if (c.issue === "aucune") check(c.id + "-aucune-coherente", c.gold === null && c.acceptable.length === 0 && c.expected_no_answer === true);
  else check(c.id + "-positive-coherente", (c.gold !== null || c.acceptable.length > 0) && c.expected_no_answer === false);
}
// 4 · Multilingue intact : FR/AR/darija présents comme au gelé
for (const l of ["fr", "ar", "darija"]) {
  check("langue-" + l + "-couverte", PROD.cas.some((c) => c.langue === l));
}

// 5 · Base : sources/versions/sections + gouvernance (lecture seule, authenticated)
for (const nom of [".env.local", ".env"]) {
  let texte;
  try { texte = readFileSync(join(RACINE, nom), "utf8"); } catch { continue; }
  for (const ligne of texte.split("\n")) {
    const nette = ligne.trim().replace(/\r$/, "");
    if (nette === "" || nette.startsWith("#")) continue;
    const egal = nette.indexOf("=");
    if (egal <= 0) continue;
    const cle = nette.slice(0, egal).trim();
    if (process.env[cle] !== undefined) continue;
    let valeur = nette.slice(egal + 1).trim();
    if ((valeur.startsWith('"') && valeur.endsWith('"')) || (valeur.startsWith("'") && valeur.endsWith("'"))) valeur = valeur.slice(1, -1);
    process.env[cle] = valeur;
  }
}
const url = process.env.MINDCARE_DATABASE_URL ?? "";
const m = url.match(/^(\w+:\/\/[^/]+\/)([^?]*)(.*)$/);
const { default: pg } = await import("pg");
const client = new pg.Client({ connectionString: m ? m[1] + "mindcare" + m[3] : null, statement_timeout: 60000 });
await client.connect();
await client.query("BEGIN");
await client.query("SET LOCAL ROLE authenticated");
const src = await client.query("SELECT id, titre, version, classification, statut, (approved_at IS NOT NULL AND approved_by IS NOT NULL) AS approuvee, (review_due_at IS NULL OR review_due_at > now()) AS revue_ok, superseded_by FROM app.knowledge_sources");
const parId = new Map(src.rows.map((s) => [s.id, s]));
const positives = new Set();
for (const c of PROD.cas) {
  if (c.gold !== null) positives.add(c.gold.source + "::" + c.gold.section);
  for (const s of c.acceptable) positives.add(s + "::*");
  for (const f of c.forbidden) {
    check(c.id + "-forbidden-existe", parId.has(f), "forbidden=" + f);
  }
}
for (const c of PROD.cas) {
  const refs = [...(c.gold !== null ? [c.gold.source] : []), ...c.acceptable];
  for (const id of refs) {
    const s = parId.get(id);
    check(c.id + "-source-existe", s !== undefined, "source=" + id);
    if (s !== undefined) {
      if (c.gold !== null && c.gold.source === id) {
        check(c.id + "-version-existe", s.version === c.expected_version, "base=" + s.version + " attendu=" + c.expected_version);
        const sec = await client.query("SELECT 1 FROM app.knowledge_chunks WHERE source_id=$1 AND section=$2 LIMIT 1", [id, c.gold.section]);
        check(c.id + "-section-existe", sec.rowCount === 1, c.gold.section);
      }
      check(c.id + "-gouvernance-positive", s.classification === "C4" && s.statut === "active" && s.approuvee === true && s.revue_ok === true && s.superseded_by === null,
        (s.titre ?? id) + " " + s.classification + "/" + s.statut);
    }
  }
}
// interdites du fichier : existent ? (vide attendu en prod)
for (const f of PROD.interdites ?? []) {
  check("interdite-connue-" + f, parId.has(f));
}
await client.query("COMMIT");
await client.end();

console.log(verts + " verts, " + rouges.length + " ROUGE");
for (const r of rouges) console.log("  ROUGE | " + r);
process.exit(rouges.length === 0 ? 0 : 1);
