/**
 * `fixtures-population-synthetique` — DONNE DE VRAIS NOMS À LA BASE DE DEV.
 *
 * ═══ CE QUE CE SCRIPT FAIT, ET SURTOUT CE QU'IL NE FAIT PAS ═══
 *
 * Il met à jour DEUX COLONNES — `first_name` et `last_name` — sur les dossiers
 * `is_synthetic` de la base de développement. Rien d'autre. Aucune ligne créée,
 * aucune ligne supprimée, aucun identifiant modifié, aucune relation touchée.
 *
 * ⚠️ C'EST DÉLIBÉRÉ, ET C'EST LA PARTIE IMPORTANTE. Les 71 dossiers portent déjà
 * des rendez-vous, des consultations, des notes, des traitements, des paiements,
 * des documents et des résumés de cas. Les recréer pour « repartir propre »
 * aurait détruit ce tissu et, avec lui, tout ce qui rend l'E2E crédible : une
 * question sur les traitements a besoin d'un dossier qui EN A. On renomme donc
 * en place, et l'intégrité référentielle est conservée par construction — il n'y
 * a aucune clé étrangère qui pointe vers un nom.
 *
 * ═══ POURQUOI UN CLASSEMENT PLUTÔT QU'UNE LISTE D'UUID ═══
 *
 * Figer 71 identifiants dans un fichier, c'est écrire quelque chose qui devient
 * faux au premier reprovisionnement — sans que rien ne le signale. On classe
 * donc les dossiers par RICHESSE RELATIONNELLE (rendez-vous, consultations,
 * traitements, résumés, documents, paiements), on départage par identifiant, et
 * on attribue les rôles dans cet ordre. Même base ⇒ même attribution, à chaque
 * exécution. Le script est idempotent : renommer ne change aucun score.
 *
 * Les noms vedettes tombent ainsi sur les dossiers les plus fournis, ce qui
 * n'est pas cosmétique : « Résume le cas de Karim Djilali » n'a de sens que si
 * Karim Djilali a un cas à résumer.
 *
 * ═══ IDENTITÉS FICTIVES ═══
 *
 * Toutes les personnes nommées ici sont inventées. Aucune ne correspond à un
 * dossier réel. La source de vérité des noms est
 * `tests/fixtures/population-synthetique.json`.
 *
 * ═══ USAGE ═══
 *
 *   MINDCARE_ADMIN_DATABASE_URL="postgresql://postgres:…@127.0.0.1:55441/mindcare" \
 *     node scripts/fixtures-population-synthetique.mjs [--verifier]
 *
 * Le rôle applicatif `mindcare_app` ne peut PAS écrire dans `app.patients` hors
 * de ses portes SQL — c'est voulu (règle 4). Ce script est un outil de poste de
 * développement et demande donc une connexion propriétaire, comme les
 * migrations.
 *
 * `--verifier` n'écrit rien et rend le plan d'attribution : à utiliser avant.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..");
const POPULATION = JSON.parse(
  readFileSync(join(RACINE, "tests/fixtures/population-synthetique.json"), "utf8"),
);

const url =
  process.env.MINDCARE_ADMIN_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
if (url.trim() === "") {
  console.error(
    "ROUGE — MINDCARE_ADMIN_DATABASE_URL (ou DATABASE_URL) est requise.\n" +
      "        Ce script écrit dans app.patients : il lui faut le rôle propriétaire,\n" +
      "        celui des migrations. `mindcare_app` ne le peut pas, et c'est voulu.",
  );
  process.exit(2);
}

const verifierSeulement = process.argv.includes("--verifier");

/**
 * La richesse d'un dossier. Les traitements et les résumés pèsent double :
 * ce sont eux qui rendent une conversation possible (« ses traitements »,
 * « résume son cas »), là où un paiement isolé ne porte aucune matière.
 */
const SQL_CLASSEMENT = `
  SELECT p.id, p.first_name, p.last_name,
         (SELECT count(*) FROM app.appointments a WHERE a.patient_id = p.id)
       + (SELECT count(*) FROM app.consultations c WHERE c.patient_id = p.id)
       + (SELECT count(*) FROM app.patient_treatments t WHERE t.patient_id = p.id) * 2
       + (SELECT count(*) FROM app.patient_case_summaries s WHERE s.patient_id = p.id) * 2
       + (SELECT count(*) FROM app.documents d WHERE d.patient_id = p.id)
       + (SELECT count(*) FROM app.payments y WHERE y.patient_id = p.id) AS score
    FROM app.patients p
   WHERE p.is_synthetic
   ORDER BY score DESC, p.id ASC`;

/**
 * Construit le plan : qui devient qui.
 *
 * L'ordre d'attribution est le cœur du déterminisme :
 *   1. les rôles, aux dossiers les plus riches, dans l'ordre du fichier ;
 *   2. les homonymes et le presque-homonyme, aux dossiers SANS AUCUNE relation
 *      (score nul), pris par identifiant croissant — un test d'ambiguïté qui
 *      échouerait ne doit jamais pouvoir lire de vraies données ;
 *   3. le remplissage, pour tout le reste, par identifiant croissant.
 */
function construirePlan(lignes) {
  const plan = [];
  const restants = [...lignes];

  const prendre = (predicat) => {
    const i = restants.findIndex(predicat);
    return i === -1 ? null : restants.splice(i, 1)[0];
  };

  for (const r of POPULATION.roles) {
    const cible = restants.shift();
    if (cible === undefined) break;
    plan.push({ ...cible, prenom: r.prenom, nom: r.nom, motif: `rôle:${r.role}` });
  }

  const sansRelation = () => (l) => Number(l.score) === 0;
  const h = POPULATION.homonymes;
  for (let i = 0; i < h.combien; i++) {
    const cible = prendre(sansRelation()) ?? restants.shift();
    if (cible === undefined) break;
    plan.push({ ...cible, prenom: h.prenom, nom: h.nom, motif: `homonyme ${i + 1}/${h.combien}` });
  }

  const v = POPULATION.voisin;
  const cibleVoisin = prendre(sansRelation()) ?? restants.shift();
  if (cibleVoisin !== undefined) {
    plan.push({ ...cibleVoisin, prenom: v.prenom, nom: v.nom, motif: "presque-homonyme" });
  }

  restants.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  restants.forEach((l, i) => {
    const n = POPULATION.remplissage[i % POPULATION.remplissage.length];
    // Le suffixe n'apparaît que si le vivier est épuisé — il ne doit jamais
    // servir dans une base de la taille attendue, et sa présence signale qu'il
    // faut enrichir le vivier plutôt que fabriquer des « Dupont 2 ».
    const suffixe = i >= POPULATION.remplissage.length
      ? ` ${Math.floor(i / POPULATION.remplissage.length) + 1}`
      : "";
    plan.push({ ...l, prenom: n.prenom, nom: `${n.nom}${suffixe}`, motif: "remplissage" });
  });

  return plan;
}

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const { rows } = await client.query(SQL_CLASSEMENT);
  if (rows.length === 0) {
    console.error("ROUGE — aucun dossier `is_synthetic` : mauvaise base ?");
    process.exit(2);
  }
  const plan = construirePlan(rows);

  const collisions = new Map();
  for (const p of plan) {
    const cle = `${p.prenom} ${p.nom}`.toLowerCase();
    collisions.set(cle, (collisions.get(cle) ?? 0) + 1);
  }
  const groupes = [...collisions.entries()].filter(([, n]) => n > 1);

  console.log(`Population synthétique — ${plan.length} dossier(s).`);
  console.log("\nRôles (les dossiers les plus fournis) :");
  for (const p of plan.filter((x) => x.motif.startsWith("rôle:"))) {
    console.log(`  · ${p.prenom} ${p.nom}  (score ${p.score}, ${p.motif})`);
  }
  console.log("\nGroupes de même nom (fixtures d'ambiguïté) :");
  for (const [nom, n] of groupes) console.log(`  · ${nom} × ${n}`);

  if (verifierSeulement) {
    console.log("\n--verifier : aucune écriture.");
    process.exit(0);
  }

  await client.query("BEGIN");
  for (const p of plan) {
    await client.query(
      "UPDATE app.patients SET first_name = $2, last_name = $3, updated_at = now() WHERE id = $1",
      [p.id, p.prenom, p.nom],
    );
  }
  await client.query("COMMIT");
  console.log(`\nVERT — ${plan.length} dossier(s) renommé(s). Aucune relation touchée.`);
} catch (e) {
  await client.query("ROLLBACK").catch(() => {});
  console.error("ROUGE —", e instanceof Error ? e.name : "échec");
  process.exitCode = 1;
} finally {
  await client.end();
}
