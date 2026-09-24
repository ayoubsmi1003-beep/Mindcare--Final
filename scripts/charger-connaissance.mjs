#!/usr/bin/env node
/** R1 (c) : entree CLI — dry-run par defaut, --ecrire = quarantaine.
 * `--socket` = transport superuser local mc-p3 (docker exec + fichier),
 * sans URL admin. Sessions `exec` séparées ⇒ la transaction est UN script
 * (BEGIN…COMMIT) ; ON_ERROR_STOP + garde DO-block (raise avant COMMIT).
 * Preuve par RETURNING (ids par lot confrontés aux demandés). */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pipelineCorpusA } from "./charger-connaissance-corpus-a.mjs";
import { pipelineCorpusB } from "./charger-connaissance-corpus-b.mjs";
import { pipelineCorpusOcr } from "./charger-connaissance-corpus-ocr.mjs";
import { argsChargeur, sqlSource } from "./charger-connaissance-sql.mjs";
import { lierParams, verifierRetourLot } from "./remplir-embeddings-sql.mjs";
import { execSocket } from "./transport-socket.mjs";

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VIA_SOCKET = process.argv.slice(2).includes("--socket");
const opt = argsChargeur(process.argv.slice(2), {
  manifeste: join(RACINE, "knowledge", "manifest.json"),
  sortie: join(RACINE, "knowledge", ".sortie-chargeur.json"),
});
const manifeste = JSON.parse(readFileSync(opt.manifeste, "utf8"));
const entrees = [...(manifeste.sources ?? [])].sort((a, b) => (a.source_id < b.source_id ? -1 : 1));
const rapport = { manifeste: opt.manifeste, ecrire: opt.ecrire, decouverts: 0, acceptes: [], rejetes: [], medicaments: { total: 0, uniques: 0, doublons: 0, libelles: 0, rejetes: 0 }, chunks: 0, ecrits: { sources: 0, chunks: 0 } };
const candidats = [...pipelineCorpusA(RACINE, entrees, rapport), ...pipelineCorpusB(RACINE, entrees, rapport, opt.limite), ...pipelineCorpusOcr(RACINE, entrees, rapport)];
mkdirSync(dirname(opt.sortie), { recursive: true });
writeFileSync(opt.sortie, JSON.stringify(rapport, null, 2) + "\n", "utf8");
if (!opt.ecrire) {
  console.log("charger-connaissance — DRY-RUN (zero ecriture)");
  console.log(`  decouverts : ${rapport.decouverts}`);
  console.log(`  acceptes   : ${rapport.acceptes.length}`);
  console.log(`  rejetes    : ${rapport.rejetes.length} (${rapport.rejetes.map((r) => `${r.source_id}:${r.motif}`).join(", ") || "aucun"})`);
  console.log(`  chunks     : ${rapport.chunks}`);
  process.exit(0);
}
  // Geste OPERATEUR : connexion admin d'abord (convention du depot :
  // auth-locale.test.ts, fixtures-population-synthetique.mjs). Le role
  // applicatif (MINDCARE_DATABASE_URL) refuse l'ecriture par construction
  // (42501, mesure R1) : c'est la frontiere, pas une panne.
  const url = process.env.MINDCARE_ADMIN_DATABASE_URL ?? process.env.MINDCARE_TEST_DATABASE_URL ?? process.env.MINDCARE_DATABASE_URL ?? "";
if (!VIA_SOCKET && url.trim() === "") {
  console.error("ROUGE — --ecrire exige MINDCARE_ADMIN_DATABASE_URL (ou --socket superuser local). Rien n'a ete ecrit.");
  process.exit(1);
}
if (VIA_SOCKET) {
  // Voie socket : transaction mono-script (BEGIN…COMMIT), garde anti-active
  // en DO-block (raise AVANT commit), preuve par RETURNING par lot.
  const etapes = [];
  const preuves = [];
  for (const c of candidats) {
    if (c.entree.statut === "active") throw new Error("activation interdite en R1");
    etapes.push({
      texte: sqlSource(),
      params: [c.sourceUuid, c.entree.titre, c.entree.version, c.entree.langue, c.statut, c.entree.review_due_at ?? null, c.entree.emetteur, c.entree.reference, c.hash],
    });
    rapport.ecrits.sources += 1;
    for (let i = 0; i < c.chunks.length; i += 400) {
      const lot = c.chunks.slice(i, i + 400);
      const valeurs = [];
      const params = [];
      lot.forEach((ch, j) => {
        if (ch.statut !== "active" && ch.statut !== "inactive") {
          throw new Error(`statut chunk refusé : ${String(ch.statut).slice(0, 40)}`);
        }
        if (ch.versionChunk !== "struct-v1" && ch.versionChunk !== "struct-v1.1") {
          throw new Error(`découpeur refusé : ${String(ch.versionChunk).slice(0, 40)}`);
        }
        if (!Number.isInteger(ch.occurrence) || ch.occurrence < 0) {
          throw new Error(`occurrence invalide pour ${String(ch.chunkId).slice(0, 12)}`);
        }
        const b = j * 10;
        valeurs.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},NULL,$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10},NULL,NULL,NULL,NULL,NULL,NULL)`);
        params.push(ch.chunkId, c.sourceUuid, ch.ordinal, ch.section, ch.langue, ch.texte, ch.texteHash, ch.occurrence, ch.statut, ch.versionChunk);
      });
      etapes.push({
        texte: [
          "INSERT INTO app.knowledge_chunks",
          "(id, source_id, ordinal, section, sous_section, langue, texte,",
          "texte_hash, occurrence, statut, chunker_version,",
          "embedding, embedding_provider, embedding_modele, embedding_version,",
          "embedding_dimensions, embedding_normalisation)",
          "VALUES " + valeurs.join(","),
          "ON CONFLICT (id) DO UPDATE SET",
          "ordinal = EXCLUDED.ordinal, section = EXCLUDED.section,",
          "texte = EXCLUDED.texte,",
          "texte_hash = EXCLUDED.texte_hash, occurrence = EXCLUDED.occurrence,",
          "statut = EXCLUDED.statut, chunker_version = EXCLUDED.chunker_version",
          "RETURNING id",
        ].join("\n"),
        params,
      });
      preuves.push(lot.map((ch) => ch.chunkId));
      rapport.ecrits.chunks += lot.length;
    }
  }
  const ids = candidats.map((c) => c.sourceUuid);
  const script = ["BEGIN;"]
    .concat(etapes.map((e) => lierParams(e.texte, e.params) + ";"))
    .concat(ids.length === 0 ? [] : [`DO $$ BEGIN IF (SELECT count(*)::int FROM app.knowledge_sources WHERE id = ANY(${lierParams("$1", [ids])}) AND statut = 'active') <> 0 THEN RAISE EXCEPTION 'garde R1 : source R1 active — rollback' USING ERRCODE = 'check_violation'; END IF; END $$;`])
    .concat(["COMMIT;"]).join("\n");
  let sortie;
  try {
    sortie = execSocket(RACINE, script);
  } catch (err) {
    try {
      execSocket(RACINE, "ROLLBACK;");
    } catch {
      /* session morte : rollback implicite à la déconnexion */
    }
    throw err;
  }
  const retournes = sortie.trim() === "" ? [] : sortie.split("\n").map((l) => l.trim()).filter(Boolean);
  let curseur = 0;
  for (const demandes of preuves) {
    verifierRetourLot(demandes, retournes.slice(curseur, curseur + demandes.length));
    curseur += demandes.length;
  }
  if (curseur !== retournes.length) {
    throw new Error(`RETURNING inattendu (attendus=${curseur}, retournés=${retournes.length}) — STOP.`);
  }
  writeFileSync(opt.sortie, JSON.stringify(rapport, null, 2) + "\n", "utf8");
  console.log(`charger-connaissance — QUARANTAINE (socket) : sources=${rapport.ecrits.sources} chunks=${rapport.ecrits.chunks} (active=0, preuves RETURNING ok)`);
  process.exit(0);
}
const { default: pg } = await import("pg");
const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query("BEGIN");
  for (const c of candidats) {
    if (c.entree.statut === "active") throw new Error("activation interdite en R1");
    await client.query(sqlSource(), [c.sourceUuid, c.entree.titre, c.entree.version, c.entree.langue, c.statut, c.entree.review_due_at ?? null, c.entree.emetteur, c.entree.reference, c.hash]);
    rapport.ecrits.sources += 1;
    // Batch de 400 lignes (7 params/ligne → 2800 < 65535) : 15k chunks ne
    // peuvent pas partir un INSERT a la fois (30 s depassees, mesure R1).
    for (let i = 0; i < c.chunks.length; i += 400) {
      const lot = c.chunks.slice(i, i + 400);
      const valeurs = [];
      const params = [];
      lot.forEach((ch, j) => {
        // v1.1 : statut/version/occurrence portent par params (jamais en
        // littéral) ; whitelist fermée AVANT tout SQL — un chunk qui ment
        // sur son statut ne part jamais en base.
        if (ch.statut !== "active" && ch.statut !== "inactive") {
          throw new Error(`statut chunk refusé : ${String(ch.statut).slice(0, 40)}`);
        }
        if (ch.versionChunk !== "struct-v1" && ch.versionChunk !== "struct-v1.1") {
          throw new Error(`découpeur refusé : ${String(ch.versionChunk).slice(0, 40)}`);
        }
        if (!Number.isInteger(ch.occurrence) || ch.occurrence < 0) {
          throw new Error(`occurrence invalide pour ${String(ch.chunkId).slice(0, 12)}`);
        }
        const b = j * 10;
        valeurs.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},NULL,$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10},NULL,NULL,NULL,NULL,NULL,NULL)`);
        params.push(ch.chunkId, c.sourceUuid, ch.ordinal, ch.section, ch.langue, ch.texte, ch.texteHash, ch.occurrence, ch.statut, ch.versionChunk);
      });
      await client.query(
        `INSERT INTO app.knowledge_chunks
           (id, source_id, ordinal, section, sous_section, langue, texte,
            texte_hash, occurrence, statut, chunker_version,
            embedding, embedding_provider, embedding_modele, embedding_version,
            embedding_dimensions, embedding_normalisation)
         VALUES ${valeurs.join(",")}
         ON CONFLICT (id) DO UPDATE SET
           ordinal = EXCLUDED.ordinal, section = EXCLUDED.section,
           texte = EXCLUDED.texte,
           texte_hash = EXCLUDED.texte_hash, occurrence = EXCLUDED.occurrence,
           statut = EXCLUDED.statut, chunker_version = EXCLUDED.chunker_version
         RETURNING id`,
        params,
      );
      rapport.ecrits.chunks += lot.length;
    }
  }
  const ids = candidats.map((c) => c.sourceUuid);
  if (ids.length > 0) {
    const r = await client.query("SELECT count(*)::int AS n FROM app.knowledge_sources WHERE id = ANY($1) AND statut = 'active'", [ids]);
    if ((r.rows[0]?.n ?? 1) !== 0) throw new Error("garde R1 : source R1 active — rollback");
  }
  await client.query("COMMIT");
  writeFileSync(opt.sortie, JSON.stringify(rapport, null, 2) + "\n", "utf8");
  console.log(`charger-connaissance — QUARANTAINE : sources=${rapport.ecrits.sources} chunks=${rapport.ecrits.chunks} (active=0)`);
} catch (err) {
  await client.query("ROLLBACK");
  throw err;
} finally {
  await client.end();
}
