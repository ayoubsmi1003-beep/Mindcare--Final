#!/usr/bin/env node
/**
 * remplir-vecteurs-768-docker — remplit l'espace 768 du cabinet SANS secret.
 *
 *   node scripts/remplir-vecteurs-768-docker.mjs [--conteneur mc-p3] [--base mindcare]
 *        [--limit 500] [--batch 48] [--dry-run]
 *
 * ═══ POURQUOI CE SCRIPT ═══
 * Le rôle applicatif (`mindcare_app`) n'a — à raison — aucun accès direct au
 * corpus : les politiques RLS le filtrent, et la seule voie prévue est la porte
 * `SECURITY DEFINER`. Le propriétaire, lui, est protégé par un secret illisible
 * (ACL `%ProgramData%\MindCare`). Ce script n'a donc besoin d'AUCUN mot de
 * passe : il lit les textes et écrit les vecteurs via `docker exec ... psql`,
 * qui parle au serveur par socket locale sous l'identité propriétaire.
 *
 * ═══ GARANTIES ═══
 *   · Aucune écriture hors `app.knowledge_chunk_vectors_768`.
 *   · Reprenable : ne calcule que les chunks absents pour CE couple (modele, version).
 *   · Vérifie le manifeste SHA-256 du modèle avant le premier vecteur.
 *   · Refuse NaN/Inf, vecteur nul, dimension inattendue.
 *   · Les lots sont chargés par `COPY ... FROM STDIN` (aucun fichier temporaire,
 *     aucun secret sur la ligne de commande).
 */
import { execFileSync, spawn } from "node:child_process";
import { join } from "node:path";
import { chargerEmbeddeur, vecteurPg } from "./lib/embedding-livre.mjs";

const args = process.argv.slice(2);
const opt = (nom, defaut) => {
  const i = args.indexOf(nom);
  return i >= 0 && args[i + 1] !== undefined && !args[i + 1].startsWith("--") ? args[i + 1] : defaut;
};
const CONTENEUR = opt("--conteneur", "mc-p3");
const BASE = opt("--base", "mindcare");
const SLUG = opt("--slug", "e5-base");
const MODELE = opt("--modele", "intfloat/multilingual-e5-base");
const VERSION = opt("--version", "d128750597153bb5987e10b1c3493a34e5a4502a");
const DIMENSIONS = 768;
const NORMALISATION = "l2-moyenne-masque-v1";
const BATCH = Number(opt("--batch", "48"));
const LIMITE = Number(opt("--limit", "0"));
const DRY = args.includes("--dry-run");
const DOSSIER = opt("--dossier", join(process.env.LOCALAPPDATA ?? process.env.TEMP, "MindCare", "modeles", SLUG));
const TABLE = "app.knowledge_chunk_vectors_768";

/** Exécute une requête et rend la sortie brute (CSV/texte) du serveur. */
function psql(sql) {
  return execFileSync(
    "docker",
    ["exec", CONTENEUR, "psql", "-U", "postgres", "-d", BASE, "-v", "ON_ERROR_STOP=1", "-At", "-c", sql],
    { maxBuffer: 512 * 1024 * 1024 },
  ).toString("utf8");
}

/**
 * Perimetre des livres qualifies pour Alexa (ADR-041), EXPLICITE.
 *
 * Le 2026-10-27, un filtre code sur deux titres avait laisse Stahl hors de
 * l'index 768 alors que la source etait deja active et approuvee. La liste
 * reste fermee : toute extension est une decision humaine, jamais un `LIKE '%'`.
 * Les quotes SQL sont doublees (`''`) : le titre Stahl contient une apostrophe.
 */
const TITRES_QUALIFIES = ["DSM-5%", "The Maudsley%", "Prescriber''s Guide%"];
const PERIMETRE_LIVRES = TITRES_QUALIFIES.map((titre) => `s.titre LIKE '${titre}'`).join(" OR ");

const autorite = `s.classification = 'C4' AND s.statut = 'active'
  AND s.approved_at IS NOT NULL AND s.approved_by IS NOT NULL
  AND (s.review_due_at IS NULL OR s.review_due_at > now()) AND s.superseded_by IS NULL
  AND c.statut = 'active' AND (${PERIMETRE_LIVRES})`;

const attendus = Number(psql(`SELECT count(*) FROM app.knowledge_chunks c
  JOIN app.knowledge_sources s ON s.id = c.source_id WHERE ${autorite};`).trim());

const deja = Number(psql(`SELECT count(*) FROM ${TABLE}
  WHERE modele = '${MODELE}' AND version = '${VERSION}';`).trim());

const restants = (() => {
  const csv = psql(`COPY (SELECT c.id FROM app.knowledge_chunks c
    JOIN app.knowledge_sources s ON s.id = c.source_id
    WHERE ${autorite} AND NOT EXISTS (SELECT 1 FROM ${TABLE} v
      WHERE v.chunk_id = c.id AND v.modele = '${MODELE}' AND v.version = '${VERSION}')
    ORDER BY c.id) TO STDOUT WITH (FORMAT csv);`);
  return csv.split(/\r?\n/).map((l) => l.replace(/^"|"$/gu, "")).filter((l) => l !== "");
})();

console.log(JSON.stringify({ etape: "inventaire", attendus, deja, restants: restants.length, modele: MODELE, version: VERSION.slice(0, 12) }));
if (DRY) process.exit(0);
if (restants.length === 0) { console.log(JSON.stringify({ ok: true, deja, restants: 0 })); process.exit(0); }

const cibles = LIMITE > 0 ? restants.slice(0, LIMITE) : restants;
const { embed, dimensions } = await chargerEmbeddeur({ dossier: DOSSIER, slug: SLUG, maxTokens: 128, threads: 2 });
if (dimensions !== DIMENSIONS) throw new Error(`dimension ${dimensions} ≠ ${DIMENSIONS}`);

const champCsv = (valeur) => `"${String(valeur).replace(/"/gu, '""')}"`;
const ecrireLot = (lignes) => new Promise((resolve, reject) => {
  const enfant = spawn("docker", ["exec", "-i", CONTENEUR, "psql", "-U", "postgres", "-d", BASE, "-v", "ON_ERROR_STOP=1", "-c",
    `COPY ${TABLE} (chunk_id, modele, version, dimensions, normalisation, distance, embedding) FROM STDIN WITH (FORMAT csv)`]);
  let erreur = "";
  enfant.stderr.on("data", (m) => { erreur += String(m); });
  enfant.on("error", reject);
  enfant.on("close", (code) => code === 0 ? resolve() : reject(new Error(erreur.slice(0, 300))));
  enfant.stdin.write(lignes.join("\n") + "\n");
  enfant.stdin.end();
});

let ecrits = 0;
const debut = performance.now();
for (let i = 0; i < cibles.length; i += BATCH) {
  const lot = cibles.slice(i, i + BATCH);
  const json = psql(`SELECT json_agg(json_build_object('id', c.id, 't', c.texte))
    FROM app.knowledge_chunks c WHERE c.id = ANY(ARRAY[${lot.map((id) => `'${id.replace(/'/gu, "''")}'`).join(",")}]);`);
  const textes = new Map(JSON.parse(json).map((r) => [r.id, r.t]));
  const vecteurs = await embed(lot.map((id) => textes.get(id) ?? ""), "passage");
  const lignes = lot.map((id, j) => {
    const vecteur = vecteurs[j];
    if (vecteur === undefined) throw new Error(`vecteur manquant pour ${id}`);
    return [id, MODELE, VERSION, DIMENSIONS, NORMALISATION, "cosine", vecteurPg(vecteur)].map(champCsv).join(",");
  });
  await ecrireLot(lignes);
  ecrits += lignes.length;
  if ((i / BATCH) % 10 === 0) {
    const secondes = (performance.now() - debut) / 1000;
    console.log(JSON.stringify({ etape: "progression", ecrits, restants: cibles.length - ecrits,
      passagesParSeconde: Number((ecrits / Math.max(1, secondes)).toFixed(2)) }));
  }
}

const controle = JSON.parse(psql(`SELECT json_build_object(
  'presents', (SELECT count(*) FROM ${TABLE} WHERE modele='${MODELE}' AND version='${VERSION}'),
  'mauvaises_dimensions', (SELECT count(*) FROM ${TABLE} WHERE modele='${MODELE}' AND version='${VERSION}' AND public.vector_dims(embedding) <> ${DIMENSIONS}),
  'chunks_inactifs', (SELECT count(*) FROM ${TABLE} v JOIN app.knowledge_chunks c ON c.id=v.chunk_id
     WHERE v.modele='${MODELE}' AND v.version='${VERSION}' AND c.statut <> 'active'),
  'hors_perimetre', (SELECT count(*) FROM ${TABLE} v JOIN app.knowledge_chunks c ON c.id=v.chunk_id
     JOIN app.knowledge_sources s ON s.id=c.source_id
     WHERE v.modele='${MODELE}' AND v.version='${VERSION}' AND NOT (${autorite})));`));

const ok = controle.mauvaises_dimensions === 0 && controle.chunks_inactifs === 0 && controle.hors_perimetre === 0
  && controle.presents >= Math.min(attendus, deja + ecrits);
console.log(JSON.stringify({ ok, attendus, deja, ecrits, ...controle, duree_s: Math.round((performance.now() - debut) / 1000) }, null, 1));
process.exit(ok ? 0 : 1);
