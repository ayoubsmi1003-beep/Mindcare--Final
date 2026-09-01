#!/usr/bin/env node
/**
 * `pnpm dev:electron` — lance le backend Next.js EXISTANT (inchangé) puis la
 * coquille Electron par-dessus, en développement.
 *
 * ═══ POURQUOI UN ORCHESTRATEUR, ET PAS DEUX TERMINAUX ══════════════════════
 *
 * §H du plan interdit `setTimeout` comme mécanisme de synchronisation de
 * démarrage. Ce script sonde donc la VRAIE disponibilité du port avant de
 * lancer Electron — la même sonde par connexion que `garde-origine.mjs`
 * utilise déjà pour la raison inverse (refuser si le port est PRIS ; ici, on
 * attend qu'il le devienne).
 *
 * `next dev` lui-même reste lancé via `pnpm dev` (donc `garde-origine.mjs`
 * puis `verifier-base.mjs` d'abord) — ce script ne les court-circuite pas,
 * il les appelle.
 */
import { connect } from "node:net";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env["PORT"] ?? "43117");

function sondePret() {
  return new Promise((resoudre) => {
    const sonde = connect({ port: PORT, host: "127.0.0.1" });
    const conclure = (valeur) => {
      sonde.destroy();
      resoudre(valeur);
    };
    sonde.setTimeout(500);
    sonde.once("connect", () => conclure(true));
    sonde.once("timeout", () => conclure(false));
    sonde.once("error", () => conclure(false));
  });
}

async function attendrePort(budgetMs) {
  const echeance = Date.now() + budgetMs;
  while (Date.now() < echeance) {
    if (await sondePret()) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

const env = { ...process.env, PORT: String(PORT) };

console.log(`[dev-electron] démarrage de Next.js sur le port ${PORT}…`);
const next = spawn("pnpm", ["dev"], {
  cwd: RACINE,
  env,
  stdio: "inherit",
  shell: process.platform === "win32",
});

let electron = null;
let arret = false;

function arreterTout(code) {
  if (arret) return;
  arret = true;
  if (electron && !electron.killed) electron.kill();
  if (next && !next.killed) next.kill();
  process.exit(code ?? 0);
}

next.on("exit", (code) => {
  // `garde-origine.mjs`/`verifier-base.mjs` ont refusé, ou Next s'est arrêté :
  // rien à faire de plus, Electron ne doit pas se lancer sur un backend absent.
  if (!arret) arreterTout(code ?? 1);
});

const pret = await attendrePort(60_000);
if (!pret) {
  console.error(
    `[dev-electron] le port ${PORT} ne répond toujours pas après 60 s — abandon.`,
  );
  arreterTout(1);
}

console.log("[dev-electron] backend prêt, lancement d'Electron…");
electron = spawn("pnpm", ["exec", "electron", path.join(RACINE, "dist-electron", "main", "index.js")], {
  cwd: RACINE,
  env: { ...env, MINDCARE_START_URL: `http://127.0.0.1:${PORT}`, MINDCARE_ELECTRON_ENV: "development" },
  stdio: "inherit",
  shell: process.platform === "win32",
});

electron.on("exit", (code) => arreterTout(code ?? 0));

process.on("SIGINT", () => arreterTout(0));
process.on("SIGTERM", () => arreterTout(0));
