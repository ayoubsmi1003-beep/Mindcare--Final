#!/usr/bin/env node
/**
 * verifier-golden-livres — vérifie qu'un golden est ATTERRISSABLE dans le corpus.
 *
 *   node --env-file=… scripts/verifier-golden-livres.mjs [--golden <fichier>]
 *
 * ═══ CE QUE CE SCRIPT PROUVE ═══
 * Pour chaque cas `answerable: true`, il existe AU MOINS un chunk actif, dans la
 * source attendue, qui satisfait les contraintes (rubrique DSM = deux derniers
 * segments du chemin ; chapitre Maudsley + fragments de texte ; exclusions de
 * references/index). Un golden qui ne satisfait pas cette passe ne mesure rien :
 * il fabrique des échecs.
 *
 * ═══ CE QU'IL NE PROUVE PAS ═══
 * Que le retriever TROUVE ce chunk (c'est le rôle de `eval-book-rag.mjs`), ni
 * que la réponse soit cliniquement correcte (aucun LLM ici).
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const opt = (nom, defaut) => {
  const i = args.indexOf(nom);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : defaut;
};
const GOLDEN = resolve(opt("--golden", join("tests", "eval", "knowledge.books-v2-2026-10-27.json")));
const normaliser = (v) => String(v ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const segments = (section) => normaliser(section).split(/[\u203A\u00BB]/).map((s) => s.trim()).filter(Boolean);
const sectionsConcernent = (section, groupes) => {
  const cible = segments(section).slice(-2).join(" › ");
  return groupes.every((groupe) => groupe.some((mot) => cible.includes(normaliser(mot))));
};
const sectionExclue = (section, exclus) => (exclus ?? []).some((mot) => normaliser(section).includes(normaliser(mot)));

const { default: pg } = await import("pg");
const url = process.env.MINDCARE_ADMIN_DATABASE_URL ?? process.env.MINDCARE_DATABASE_URL;
const client = new pg.Client({ connectionString: url });
await client.connect();
await client.query("SET ROLE authenticated");
const { rows } = await client.query(`
  SELECT s.titre, c.section, c.texte
    FROM app.knowledge_chunks c JOIN app.knowledge_sources s ON s.id = c.source_id
   WHERE c.statut = 'active' AND s.statut = 'active' AND s.classification = 'C4'
     AND (s.titre LIKE 'DSM-5%' OR s.titre LIKE 'The Maudsley%')`);
await client.end();

const golden = JSON.parse(readFileSync(GOLDEN, "utf8").replace(/^\uFEFF/, ""));
let manquants = 0;
for (const cas of golden.cas) {
  if (cas.answerable === false) continue;
  const source = cas.attendu.source === "DSM-5" ? "DSM-5" : "The Maudsley";
  let trouve = null;
  for (const ligne of rows) {
    if (!normaliser(ligne.titre).includes(normaliser(source))) continue;
    if (sectionExclue(ligne.section ?? "", cas.attendu.sectionExclut)) continue;
    if (cas.attendu.section && !sectionsConcernent(ligne.section ?? "", cas.attendu.section)) continue;
    if (cas.attendu.texteContient && !cas.attendu.texteContient.every((f) => normaliser(ligne.texte).includes(normaliser(f)))) continue;
    trouve = ligne; break;
  }
  if (trouve === null) { manquants += 1; console.log(`MANQUE ${cas.id}`); }
  else console.log(`OK     ${cas.id.padEnd(24)} ${String(trouve.section).slice(-62)}`);
}
console.log(JSON.stringify({ golden: GOLDEN.split(/[\\/]/).pop(), cas: golden.cas.length, manquants }));
process.exit(manquants === 0 ? 0 : 1);
