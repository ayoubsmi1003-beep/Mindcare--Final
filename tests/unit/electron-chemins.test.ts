/**
 * Résolution de l'environnement Electron (§F du plan) — la propriété qui
 * compte est négative : le mode production ne doit JAMAIS pouvoir résoudre le
 * `.env` du dépôt de développement, quelle que soit la racine passée.
 */
import path from "node:path";
import { describe, expect, it } from "vitest";

import { dossierDonnees, fichierEnvironnement } from "../../electron/main/chemins";

const RACINE_DEPOT = "C:\\Users\\dev\\Final Mindcare";
const PROGRAM_DATA = "C:\\ProgramData";

describe("fichierEnvironnement", () => {
  it("développement : lit le .env du dépôt, comme pnpm dev aujourd'hui", () => {
    const f = fichierEnvironnement("development", RACINE_DEPOT, PROGRAM_DATA);
    expect(f).toBe(path.join(RACINE_DEPOT, ".env"));
  });

  it("production : lit UNIQUEMENT %ProgramData%\\MindCare\\mindcare.env", () => {
    const f = fichierEnvironnement("production", RACINE_DEPOT, PROGRAM_DATA);
    expect(f).toBe(path.join(PROGRAM_DATA, "MindCare", "mindcare.env"));
  });

  it("production : le résultat ne contient jamais la racine du dépôt", () => {
    const f = fichierEnvironnement("production", RACINE_DEPOT, PROGRAM_DATA);
    expect(f).not.toContain("dev");
    expect(f).not.toContain("Final Mindcare");
  });

  it("production : une racine de dépôt hostile n'influence pas le chemin", () => {
    // Si une variable d'environnement forgée changeait un jour la racine
    // passée à cette fonction, le résultat en production doit rester
    // indépendant d'elle — c'est le contrat qui empêche un mauvais réglage de
    // pointer la production vers une base de développement.
    const f = fichierEnvironnement("production", "C:\\Users\\dev\\..\\..\\ProgramData\\MindCare", PROGRAM_DATA);
    expect(f).toBe(path.join(PROGRAM_DATA, "MindCare", "mindcare.env"));
  });
});

describe("dossierDonnees", () => {
  it("place toujours les données sous %ProgramData%\\MindCare, jamais ailleurs", () => {
    expect(dossierDonnees(PROGRAM_DATA, "data")).toBe(path.join(PROGRAM_DATA, "MindCare", "data"));
    expect(dossierDonnees(PROGRAM_DATA, "backups")).toBe(path.join(PROGRAM_DATA, "MindCare", "backups"));
    expect(dossierDonnees(PROGRAM_DATA, "logs")).toBe(path.join(PROGRAM_DATA, "MindCare", "logs"));
  });
});
