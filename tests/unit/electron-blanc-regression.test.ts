/**
 * Régression écran blanc (§4 de la mission, WS-1 à WS-7).
 *
 * Ces garde-fous ont tous été trouvés par échec réel ; ce test les épingle
 * dans le source pour qu'aucune refactorisation ne les retire en silence.
 * Convention maison : analyse de source, comme
 * `jarvis-egress-frontiere-source.test.ts` (contrôle 2b du preflight).
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const lire = (relatif: string): string => readFileSync(path.join(RACINE, relatif), "utf8");

const INDEX = lire("electron/main/index.ts");
const ORCHESTRATEUR = lire("electron/main/orchestrateur.ts");
const PRELOAD = lire("electron/preload/index.cts");

describe("écran blanc : chargement du renderer (WS-3)", () => {
  it("did-fail-load alimente une erreur affichée, pas un simple log", () => {
    expect(INDEX).toContain("echecChargementPrincipal");
    expect(INDEX).toMatch(/did-fail-load[\s\S]{0,600}echecChargementPrincipal\s*=/);
  });

  it("loadURL est gardé : échec → fenêtre d'erreur FR, jamais de vide", () => {
    expect(INDEX).toContain("await fenetrePrincipale.loadURL(urlDepart())");
    expect(INDEX).toContain("L'interface n'a pas pu se charger.");
  });

  it("un chien de garde remplace la fenêtre invisible (20 s)", () => {
    expect(INDEX).toMatch(/20_000/);
    expect(INDEX).toContain("ne s'est jamais affichée");
  });

  it("pas de flash blanc pendant le démarrage", () => {
    expect(INDEX).toContain("backgroundColor");
    expect(INDEX).toContain("show: false");
  });
});

describe("écran blanc : préparation backend (WS-2, WS-5, WS-6)", () => {
  it("la préparation distingue liveness et readiness", () => {
    expect(ORCHESTRATEUR).toContain("sonderPreparation");
  });

  it("la sonde de santé est réessayée (pas de reprise lourde sur un octet lent)", () => {
    expect(ORCHESTRATEUR).toMatch(/for\s*\(\s*let essai\s*=\s*0;\s*essai\s*<\s*3/);
  });

  it("toute sortie immédiate du backend est un crash, jamais un port-occupé", () => {
    expect(ORCHESTRATEUR).toContain("BACKEND_CRASH");
    expect(ORCHESTRATEUR).not.toMatch(/exitCode !== null && backend\.exitCode !== 0/);
  });
});

describe("écran blanc : preload et navigation (WS-1, WS-4)", () => {
  it("le preload expose exactement les 4 opérations typées, rien de brut", () => {
    for (const op of ["getVersion", "onStartupState", "openLogsFolder", "runBackup"]) {
      expect(PRELOAD).toContain(op);
    }
    expect(PRELOAD).not.toContain("nodeIntegration");
  });

  it("la garde de navigation recalcule l'origine à chaque événement", () => {
    expect(INDEX).toContain("new URL(urlDepart()).origin");
    expect(INDEX).not.toMatch(/const origineAutorisee = new URL\(urlDepart\(\)\)\.origin;/);
  });
});

describe("données de production (§D)", () => {
  it("l'orchestrateur restaure l'instantané au premier lancement", () => {
    expect(ORCHESTRATEUR).toContain("restaurerInstantaneSiPresent");
    expect(ORCHESTRATEUR).toContain("RESTAURATION_ECHOUEE");
  });

  it("les migrations sont toujours vérifiées, même après provisionnement", () => {
    expect(ORCHESTRATEUR).not.toContain("Déjà provisionné à l'étape STARTING_DATABASE");
  });
});

describe("paquet installé : le processus principal ne dépend d'aucun node_modules (2026-10-07)", () => {
  it("aucun import tiers nu dans electron/main (sinon ERR_MODULE_NOT_FOUND dans app.asar)", () => {
    const dossier = path.join(RACINE, "electron", "main");
    const fautifs: string[] = [];
    for (const fichier of readdirSync(dossier).filter((f) => f.endsWith(".ts"))) {
      const contenu = readFileSync(path.join(dossier, fichier), "utf8");
      for (const ligne of contenu.split("\n")) {
        const m = /^\s*import\s(?:[^'"]*from\s)?['"]([^'"]+)['"]/.exec(ligne);
        if (m === null) continue;
        const nomModule = m[1] ?? "";
        const autorise =
          nomModule === "electron" ||
          nomModule.startsWith("node:") ||
          nomModule.startsWith("./") ||
          nomModule.startsWith("../");
        if (!autorise) fautifs.push(`${fichier}: ${nomModule}`);
      }
    }
    expect(fautifs, `imports interdits dans electron/main : ${fautifs.join(", ")}`).toEqual([]);
  });
});
