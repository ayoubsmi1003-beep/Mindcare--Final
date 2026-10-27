#!/usr/bin/env node
/**
 * generer-pages-unites — carte `unit_id → (folio imprimé, page PDF)`.
 *
 *   node scripts/generer-pages-unites.mjs
 *
 * ═══ POURQUOI CETTE CARTE EXISTE ═══
 * Le marqueur `[livre p.N|src:M]` est écrit DANS le texte au moment du
 * chargement. Quand une unité est découpée en plusieurs chunks, seul le
 * dernier morceau garde le marqueur : 17 246 chunks n'ont donc aucune page,
 * alors que leur unité d'origine en a une, vérifiée à l'ingestion.
 *
 * Cette carte rétablit la page de l'UNITÉ (pas d'un voisin, pas d'un offset)
 * pour ces chunks. Elle est construite depuis les paquets canoniques
 * (`units.jsonl`), pas depuis la base : elle est donc vérifiable et
 * reproductible, et ne peut pas « inventer » une page.
 *
 * ═══ CE QU'ELLE N'EST PAS ═══
 *   · Pas un calcul folio→PDF : les deux valeurs viennent du même enregistrement.
 *   · Pas une déduction par voisinage : clé = `unit_id` du chunk lui-même.
 *   · Pas une écriture : sortie JSON dans `src/server/knowledge/`.
 */
import { createReadStream, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { join, resolve } from "node:path";

const RACINE = resolve(import.meta.dirname, "..");
const SORTIE = join(RACINE, "src", "server", "knowledge", "pages-unites.json");

const LIVRES = [
  {
    bookId: "dsm5-fr-2015-elsevier",
    dossier: join(RACINE, "knowledge", "canonical-v2", "dsm5-fr-2015-elsevier",
      "sha256-be145e65aa8291dcb59e56ad61b86bcc41d4145ab2344a1c50f10582dcfa1d53", "units.jsonl"),
    id: (u) => u.id,
    imprime: (u) => u.printed_page_start,
    pdf: (u) => u.page_start,
  },
  {
    bookId: "maudsley-prescribing-guidelines-2021-taylor-14e",
    dossier: join(RACINE, "knowledge", "canonical-v2", "maudsley-prescribing-guidelines-2021-taylor-14e",
      "sha256-14072b5bf1a74cd5aa754d7fbbfb8a9fd146cd77a49996676c5b5094c16cd9d0", "units.jsonl"),
    id: (u) => u.unit_id,
    imprime: (u) => u.printed_start,
    pdf: (u) => u.physical_start,
  },
];

const nombre = (valeur) => {
  if (typeof valeur === "number" && Number.isInteger(valeur) && valeur > 0) return valeur;
  if (typeof valeur === "string" && /^\d{1,5}$/u.test(valeur.trim())) {
    const n = Number.parseInt(valeur.trim(), 10);
    return n > 0 ? n : null;
  }
  return null;
};

const carte = {};
for (const livre of LIVRES) {
  const entrees = {};
  let lues = 0;
  const rl = createInterface({ input: createReadStream(livre.dossier, "utf8"), crlfDelay: Infinity });
  for await (const ligne of rl) {
    if (!ligne.trim()) continue;
    lues += 1;
    let unite;
    try { unite = JSON.parse(ligne); } catch { continue; }
    const id = livre.id(unite);
    if (typeof id !== "string" || id === "") continue;
    const imprime = nombre(livre.imprime(unite));
    const pdf = nombre(livre.pdf(unite));
    if (imprime === null && pdf === null) continue;
    entrees[id] = [imprime, pdf];
  }
  carte[livre.bookId] = entrees;
  console.log(JSON.stringify({ bookId: livre.bookId, unites: lues, avecPage: Object.keys(entrees).length }));
}

writeFileSync(SORTIE, JSON.stringify(carte));
console.log(JSON.stringify({ sortie: SORTIE, octets: JSON.stringify(carte).length }));
