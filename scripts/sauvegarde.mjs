#!/usr/bin/env node
/**
 * sauvegarde — sauvegarde, chiffrement, ET RESTAURATION RÉELLEMENT REJOUÉE.
 *
 * ═══ POURQUOI CE SCRIPT RESTAURE, ALORS QU'ON LUI DEMANDE DE SAUVEGARDER ═══
 *
 * « Un fichier créé ne prouve pas une sauvegarde. » C'est la phrase du plan, et
 * elle recouvre le mode de panne le plus coûteux de tout ce système : une
 * sauvegarde qui tourne chaque nuit, produit un fichier de taille plausible,
 * et se révèle illisible le jour où on en a besoin. Le cabinet découvre alors
 * qu'il n'a pas de sauvegarde depuis des mois.
 *
 * Ce script ne se contente donc pas d'écrire un fichier : il le RESTAURE dans
 * une base jetable et COMPTE les lignes. Une sauvegarde n'est déclarée valide
 * que si elle a été relue.
 *
 * ═══ CE QU'IL CHIFFRE, ET AVEC QUOI ════════════════════════════════════════
 *
 * AES-256-GCM, clé dérivée par scrypt d'une phrase de passe. GCM plutôt que CBC
 * parce qu'il AUTHENTIFIE : une sauvegarde corrompue ou modifiée est détectée
 * au déchiffrement, au lieu de rendre des octets plausibles. Sur un dossier
 * médical, la différence n'est pas théorique.
 *
 * La phrase de passe vient de l'environnement, jamais du dépôt. Sans elle, le
 * script REFUSE de sauvegarder plutôt que d'écrire en clair : une sauvegarde de
 * dossiers psychiatriques non chiffrée sur un disque externe est précisément ce
 * que la loi 18-07 interdit.
 */

import { spawn } from "node:child_process";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { createReadStream, createWriteStream, mkdirSync, statSync } from "node:fs";
import { readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";

const MAGIE = Buffer.from("MCBK1\0\0\0", "binary"); // en-tête de format, 8 octets

function exiger(nom) {
  const v = process.env[nom];
  if (v === undefined || v.trim() === "") {
    console.error(`ROUGE — ${nom} est absente. Rien n'a été fait.`);
    process.exit(1);
  }
  return v;
}

/** Exécute une commande en capturant stdout/stderr, sans passer par un shell. */
function executer(cmd, args, options = {}) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { ...options, shell: false });
    let sortie = "";
    let erreur = "";
    p.stdout?.on("data", (d) => (sortie += d.toString()));
    p.stderr?.on("data", (d) => (erreur += d.toString()));
    p.on("error", (e) => resolve({ code: -1, sortie, erreur: String(e) }));
    p.on("close", (code) => resolve({ code: code ?? -1, sortie, erreur }));
  });
}

/**
 * Chiffre un fichier. Le sel et l'IV sont écrits EN TÊTE, en clair : ils ne
 * sont pas secrets, et sans eux la sauvegarde serait indéchiffrable même avec
 * la bonne phrase de passe.
 */
async function chiffrer(source, destination, phrase) {
  const sel = randomBytes(16);
  const iv = randomBytes(12);
  const cle = scryptSync(phrase, sel, 32);
  const chiffreur = createCipheriv("aes-256-gcm", cle, iv);

  const sortie = createWriteStream(destination);
  sortie.write(MAGIE);
  sortie.write(sel);
  sortie.write(iv);

  await pipeline(createReadStream(source), chiffreur, sortie, { end: false });

  // L'étiquette d'authentification n'existe qu'APRÈS le dernier octet chiffré.
  // C'est elle qui rend la corruption détectable ; l'oublier reviendrait à
  // faire du chiffrement sans intégrité.
  const etiquette = chiffreur.getAuthTag();
  await new Promise((r) => sortie.end(etiquette, r));
}

async function dechiffrer(source, destination, phrase) {
  const brut = await readFile(source);
  if (!brut.subarray(0, 8).equals(MAGIE)) {
    throw new Error("En-tête inconnu : ce fichier n'est pas une sauvegarde MindCare.");
  }
  const sel = brut.subarray(8, 24);
  const iv = brut.subarray(24, 36);
  const etiquette = brut.subarray(brut.length - 16);
  const charge = brut.subarray(36, brut.length - 16);

  const cle = scryptSync(phrase, sel, 32);
  const dechiffreur = createDecipheriv("aes-256-gcm", cle, iv);
  dechiffreur.setAuthTag(etiquette);

  // `final()` LÈVE si l'étiquette ne correspond pas — c'est le contrôle
  // d'intégrité, et il ne doit jamais être contourné.
  const clair = Buffer.concat([dechiffreur.update(charge), dechiffreur.final()]);
  await writeFile(destination, clair);
}

/** Les comptages qui décident si une restauration est fidèle. */
const TABLES_MESUREES = [
  "app.patients",
  "app.appointments",
  "app.consultations",
  "app.clinical_notes",
  "app.payments",
  "app.documents",
  "app.profiles",
  "audit.log",
];

async function compter(psql, url) {
  const requete = TABLES_MESUREES.map(
    (t) => `SELECT '${t}' AS t, count(*)::text AS n FROM ${t}`,
  ).join(" UNION ALL ");
  const r = await executer(psql, ["-d", url, "-tAF", "|", "-c", requete]);
  if (r.code !== 0) throw new Error(`comptage impossible : ${r.erreur.trim()}`);
  const out = new Map();
  for (const ligne of r.sortie.trim().split("\n")) {
    const [t, n] = ligne.split("|");
    if (t !== undefined && n !== undefined) out.set(t, n);
  }
  return out;
}

async function main() {
  const url = exiger("MINDCARE_DATABASE_URL");
  const phrase = exiger("MINDCARE_BACKUP_PASSPHRASE");
  const dossier = process.env.MINDCARE_BACKUP_DIR ?? "./sauvegardes";
  const pgDump = process.env.PG_DUMP ?? "pg_dump";
  const psql = process.env.PSQL ?? "psql";
  const pgRestore = process.env.PG_RESTORE ?? "pg_restore";
  const urlAdmin = process.env.MINDCARE_ADMIN_DATABASE_URL ?? url;

  mkdirSync(dossier, { recursive: true });
  const horodatage = new Date().toISOString().replace(/[:.]/g, "-");
  const brut = path.join(dossier, `mindcare-${horodatage}.dump`);
  const chiffre = `${brut}.enc`;

  console.log("sauvegarde MindCare\n");

  // ── 1 · le cliché ────────────────────────────────────────────────────────
  console.log("1 · pg_dump");
  const dump = await executer(pgDump, ["-Fc", "-f", brut, "-d", url]);
  if (dump.code !== 0) {
    console.error(`  🔴 pg_dump a échoué : ${dump.erreur.trim().slice(0, 300)}`);
    process.exit(1);
  }
  const taille = statSync(brut).size;
  console.log(`  ✅ ${taille} octets`);
  if (taille < 1024) {
    console.error("  🔴 cliché suspect (< 1 Kio) — on ne le déclare pas valide.");
    process.exit(1);
  }

  // ── 2 · comptages de référence ───────────────────────────────────────────
  console.log("2 · comptages de la base source");
  const source = await compter(psql, url);
  for (const [t, n] of source) console.log(`  · ${t.padEnd(22)} ${n}`);

  // ── 3 · chiffrement ──────────────────────────────────────────────────────
  console.log("3 · chiffrement AES-256-GCM");
  await chiffrer(brut, chiffre, phrase);
  await unlink(brut); // le clair ne survit pas au chiffrement
  console.log(`  ✅ ${path.basename(chiffre)} (${statSync(chiffre).size} octets)`);

  // ── 4 · L'INTÉGRITÉ : une phrase fausse doit ÉCHOUER ────────────────────
  console.log("4 · contrôle d'intégrité (GCM)");
  const bidon = `${chiffre}.essai`;
  let refuse = false;
  try {
    await dechiffrer(chiffre, bidon, `${phrase}-faux`);
  } catch {
    refuse = true;
  }
  await unlink(bidon).catch(() => {});
  if (!refuse) {
    console.error("  🔴 une phrase de passe FAUSSE a déchiffré la sauvegarde.");
    process.exit(1);
  }
  console.log("  ✅ une phrase fausse est refusée (étiquette GCM)");

  // ── 5 · LA RESTAURATION, RÉELLEMENT REJOUÉE ─────────────────────────────
  if (process.env.MINDCARE_RESTORE_TEST_DB === undefined) {
    console.log("\n5 · restauration NON éprouvée");
    console.log("  ⚠️  MINDCARE_RESTORE_TEST_DB absente : la sauvegarde n'a PAS été relue.");
    console.log("      Un fichier créé ne prouve pas une sauvegarde. VERDICT : INCOMPLET.");
    process.exit(2);
  }

  console.log("\n5 · restauration dans une base jetable");
  const baseEssai = process.env.MINDCARE_RESTORE_TEST_DB;
  const rendu = path.join(dossier, "restauration-essai.dump");
  await dechiffrer(chiffre, rendu, phrase);
  console.log("  ✅ déchiffré");

  const nomBase = new URL(baseEssai).pathname.replace(/^\//, "");
  await executer(psql, ["-d", urlAdmin, "-c", `DROP DATABASE IF EXISTS "${nomBase}"`]);
  const cree = await executer(psql, ["-d", urlAdmin, "-c", `CREATE DATABASE "${nomBase}"`]);
  if (cree.code !== 0) {
    console.error(`  🔴 création de la base d'essai impossible : ${cree.erreur.trim().slice(0, 200)}`);
    process.exit(1);
  }

  // `pg_restore` signale des avertissements bénins (rôles absents) : on juge
  // sur les COMPTAGES, pas sur son code de sortie.
  await executer(pgRestore, ["-d", baseEssai, "--no-owner", "--no-privileges", rendu]);
  await unlink(rendu).catch(() => {});

  console.log("6 · comparaison source ↔ restauration");
  let ecarts = 0;
  const cible = await compter(psql, baseEssai);
  for (const [t, n] of source) {
    const m = cible.get(t);
    const ok = m === n;
    if (!ok) ecarts += 1;
    console.log(`  ${ok ? "✅" : "🔴"} ${t.padEnd(22)} source=${n} restaure=${m ?? "(absente)"}`);
  }

  await executer(psql, ["-d", urlAdmin, "-c", `DROP DATABASE IF EXISTS "${nomBase}"`]);

  console.log("");
  if (ecarts === 0) {
    console.log(`VERDICT : VERT — sauvegarde chiffrée ET restaurée, ${source.size} tables identiques.`);
    process.exit(0);
  }
  console.log(`VERDICT : ROUGE — ${ecarts} table(s) divergente(s) après restauration.`);
  process.exit(1);
}

main().catch((e) => {
  console.error("VERDICT : ROUGE —", e?.message ?? e);
  process.exit(1);
});
