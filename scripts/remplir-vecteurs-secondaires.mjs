#!/usr/bin/env node
/**
 * remplir-vecteurs-secondaires — backfill de l'index vectoriel SECONDAIRE (188).
 *
 *   node scripts/remplir-vecteurs-secondaires.mjs \
 *     --url "postgresql://…" --modele intfloat/multilingual-e5-small \
 *     --version 614241f… --dossier <chemin> [--max 128] [--batch 8] [--dry-run]
 *
 * ═══ GARANTIES ═══
 *   · Idempotent et REPRENABLE : ne sélectionne que les chunks actifs des
 *     sources autorisées qui n'ont pas encore de vecteur pour CE couple
 *     (modele, version). `ON CONFLICT DO NOTHING` en second rideau.
 *   · Un seul vecteur par chunk et par modèle (clé primaire 188).
 *   · Aucun texte source modifié, aucune approbation touchée, aucune
 *     activation : la table secondaire est la SEULE écriture.
 *   · Vérifie le manifeste SHA-256 du modèle AVANT le premier calcul.
 *   · Refuse NaN/Inf et une norme nulle (aucun vecteur corrompu en base).
 *
 * ═══ SORTIE ═══
 * Une ligne JSON finale : `{ ok, modele, version, attendus, presents, ... }`.
 */
import { join } from "node:path";
import { chargerEmbeddeur, vecteurPg } from "./lib/embedding-livre.mjs";

const args = process.argv.slice(2);
const opt = (nom, defaut) => {
  const i = args.indexOf(nom);
  return i >= 0 && args[i + 1] !== undefined && !args[i + 1].startsWith("--") ? args[i + 1] : defaut;
};
const URL = opt("--url", process.env.DATABASE_URL ?? "");
const MODELE = opt("--modele", "intfloat/multilingual-e5-small");
const VERSION = opt("--version", "");
const SLUG = opt("--slug", "e5-small");
const DOSSIER = opt("--dossier", join(process.env.LOCALAPPDATA ?? process.env.TEMP, "MindCare", "modeles", SLUG));
const MAX_TOKENS = Number(opt("--max", "128"));
const BATCH = Number(opt("--batch", "8"));
const ECRITURE = Number(opt("--ecriture", "64"));
const THREADS = Number(opt("--threads", "2"));
const LIMITE = Number(opt("--limite", "0"));
const DRY = args.includes("--dry-run");
const NORMALISATION = "l2-moyenne-masque-v1";

if (URL === "") { console.error("--url requis (rôle propriétaire, jamais le rôle applicatif)"); process.exit(1); }
if (VERSION === "") { console.error("--version requis (révision du modèle, jamais une valeur devinée)"); process.exit(1); }

const { default: pg } = await import("pg");
const client = new pg.Client({ connectionString: URL, connectionTimeoutMillis: 15_000 });
await client.connect();

const autorite = `s.classification = 'C4' AND s.statut = 'active'
  AND s.approved_at IS NOT NULL AND s.approved_by IS NOT NULL
  AND (s.review_due_at IS NULL OR s.review_due_at > now()) AND s.superseded_by IS NULL
  AND c.statut = 'active' AND (s.titre LIKE 'DSM-5%' OR s.titre LIKE 'The Maudsley%')`;

const attendus = (await client.query(`SELECT count(*)::int n
  FROM app.knowledge_chunks c JOIN app.knowledge_sources s ON s.id = c.source_id WHERE ${autorite}`)).rows[0].n;

const deja = (await client.query(`SELECT count(*)::int n FROM app.knowledge_chunk_vectors
  WHERE modele = $1 AND version = $2`, [MODELE, VERSION])).rows[0].n;

console.log(JSON.stringify({ etape: "inventaire", attendus, deja, modele: MODELE, version: VERSION.slice(0, 12) }));

if (DRY) {
  const restants = await client.query(`SELECT count(*)::int n
    FROM app.knowledge_chunks c JOIN app.knowledge_sources s ON s.id = c.source_id
    WHERE ${autorite} AND NOT EXISTS (SELECT 1 FROM app.knowledge_chunk_vectors v
      WHERE v.chunk_id = c.id AND v.modele = $1 AND v.version = $2)`, [MODELE, VERSION]);
  console.log(JSON.stringify({ etape: "dry-run", restants: restants.rows[0].n }));
  await client.end();
  process.exit(0);
}

const { embed, dimensions } = await chargerEmbeddeur({ dossier: DOSSIER, slug: SLUG, maxTokens: MAX_TOKENS, threads: THREADS });

const { rows: chunks } = await client.query(`
  SELECT c.id, c.texte
  FROM app.knowledge_chunks c JOIN app.knowledge_sources s ON s.id = c.source_id
  WHERE ${autorite} AND NOT EXISTS (SELECT 1 FROM app.knowledge_chunk_vectors v
    WHERE v.chunk_id = c.id AND v.modele = $1 AND v.version = $2)
  ORDER BY c.id ${LIMITE > 0 ? `LIMIT ${LIMITE}` : ""}`, [MODELE, VERSION]);

console.log(JSON.stringify({ etape: "calcul", a_embedder: chunks.length, dimensions }));

let ecrits = 0;
let tampon = [];
const debut = performance.now();
const vider = async () => {
  if (tampon.length === 0) return;
  const valeurs = [];
  const params = [MODELE, VERSION, dimensions, NORMALISATION];
  tampon.forEach((ligne, index) => {
    const base = index * 2;
    valeurs.push(`($${base + 5}, $1, $2, $3, $4, 'cosine', $${base + 6}::public.vector)`);
    params.push(ligne.id, ligne.vecteur);
  });
  await client.query(`INSERT INTO app.knowledge_chunk_vectors
      (chunk_id, modele, version, dimensions, normalisation, distance, embedding)
    VALUES ${valeurs.join(",")} ON CONFLICT (chunk_id, modele, version) DO NOTHING`, params);
  ecrits += tampon.length;
  tampon = [];
};

for (let i = 0; i < chunks.length; i += BATCH) {
  const lot = chunks.slice(i, i + BATCH);
  const vecteurs = await embed(lot.map((c) => c.texte), "passage");
  vecteurs.forEach((vecteur, j) => tampon.push({ id: lot[j].id, vecteur: vecteurPg(vecteur) }));
  if (tampon.length >= ECRITURE) await vider();
  if ((i / BATCH) % 100 === 0) {
    const secondes = (performance.now() - debut) / 1000;
    console.log(JSON.stringify({ etape: "progression", traites: Math.min(i + BATCH, chunks.length), ecrits,
      passagesParSeconde: Number((ecrits / Math.max(1, secondes)).toFixed(1)) }));
  }
}
await vider();

// ── Vérification finale : la seule qui autorise à dire « terminé » ─────────
const controle = (await client.query(`
  SELECT
    (SELECT count(*)::int FROM app.knowledge_chunk_vectors WHERE modele=$1 AND version=$2) AS presents,
    (SELECT count(*)::int FROM app.knowledge_chunk_vectors WHERE modele=$1 AND version=$2 AND public.vector_dims(embedding) <> 384) AS mauvaises_dimensions,
    (SELECT count(*)::int FROM app.knowledge_chunk_vectors v JOIN app.knowledge_chunks c ON c.id=v.chunk_id
       WHERE v.modele=$1 AND v.version=$2 AND c.statut <> 'active') AS chunks_inactifs,
    (SELECT count(*)::int FROM app.knowledge_chunk_vectors v JOIN app.knowledge_chunks c ON c.id=v.chunk_id
       JOIN app.knowledge_sources s ON s.id=c.source_id
       WHERE v.modele=$1 AND v.version=$2 AND NOT (${autorite})) AS hors_perimetre
`, [MODELE, VERSION])).rows[0];

const cible = LIMITE > 0 ? Math.min(attendus, deja + chunks.length) : attendus;
const ok = controle.presents === cible && controle.mauvaises_dimensions === 0
  && controle.chunks_inactifs === 0 && controle.hors_perimetre === 0;
console.log(JSON.stringify({ ok, modele: MODELE, version: VERSION, attendus, cible, ecrits, ...controle,
  duree_s: Math.round((performance.now() - debut) / 1000) }, null, 1));
await client.end();
process.exit(ok ? 0 : 1);
