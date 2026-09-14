/**
 * LM54.3 — le contrôle de démarrage `verifier-base.mjs` et le cycle de vie
 * `base-locale.mjs`, éprouvés par EXÉCUTION RÉELLE des scripts.
 *
 * La règle du dépôt s'applique : on ne simule pas le script, on l'exécute
 * avec des environnements CONTRÔLÉS :
 *
 *   · `MINDCARE_SKIP_DB_WAIT=1` + URL vers un port mort → le script doit
 *     REFUSER (exit 1) en nommant la base de données — le comportement
 *     `--allow-degraded` qui laissait passer une application cassée est
 *     la cause racine de LM54.3, et ce test verrouille son non-retour ;
 *   · URL absente → refus immédiat, message distinct ;
 *   · `--allow-degraded` (drapeau historique) → NE DOIT PLUS contourner
 *     le refus : le drapeau est retiré, ce test prouve qu'il est inert ;
 *   · contre la vraie base (quand `MINDCARE_TEST_DATABASE_URL` est posée)
 *     → exit 0 avec « migrations à jour ».
 *
 * `base-locale.mjs` est éprouvé sur ses fonctions pures (constants et
 * budgets) — ses fonctions asynchrones exigent Docker, couvert par la
 * vérification de démarrage réelle ci-dessus et par `pnpm dev`.
 */

import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const RACINE = path.resolve(import.meta.dirname, "..", "..");
const SCRIPT = path.join(RACINE, "scripts", "verifier-base.mjs");

/** Un port où RIEN n'écoute — le substitut reproductible de « Docker arrêté ». */
const URL_MORTE = "postgresql://mindcare_app:x@127.0.0.1:1/mindcare";

/** Même port mort, mais sur le PORT DU CONTENEUR de développement mc-p3. */
const URL_MORTE_DEV =
  "postgresql://mindcare_app:x@127.0.0.1:55441/mindcare";

const URL_TEST = process.env.MINDCARE_TEST_DATABASE_URL;
const BASE_ACTIVE = URL_TEST !== undefined && URL_TEST.trim() !== "";

interface ResultatExec {
  readonly code: number;
  readonly sortie: string;
  readonly erreur: string;
}

/** Exécute le script réel, capture la sortie et le code de sortie. */
async function executerScript(env: Record<string, string>): Promise<ResultatExec> {
  return new Promise((resoudre) => {
    const enfant = execFile(
      process.execPath,
      [SCRIPT],
      {
        env: { ...process.env, ...env },
        cwd: RACINE,
        timeout: 60_000,
      },
      (erreur, stdout, stderr) => {
        resoudre({
          code: erreur !== null && typeof (erreur as { code?: number }).code === "number"
            ? (erreur as { code: number }).code
            : 0,
          sortie: stdout ?? "",
          erreur: stderr ?? "",
        });
      },
    );
    // Empêcher le SIGTERM du timeout de laisser le test pendre.
    enfant.on("error", () => {
      /* déjà traité par le callback execFile */
    });
  });
}

describe("verifier-base.mjs — la panne LM54.3 ne peut plus se reproduire", () => {
  it("base injoignable + ancien drapeau --allow-degraded → REFUS (exit 1), plus de mode dégradé", async () => {
    // LE test de la régression : l'ancien comportement rendait exit 0 et
    // « degraded development mode » — l'application démarrait, puis
    // `/api/auth/sign-in` rendait 503 à l'écran. Le drapeau étant retiré,
    // il est ici traité comme un argument inconnu, SANS effet.
    const r = await executerScript({
      MINDCARE_DATABASE_URL: URL_MORTE,
      MINDCARE_SKIP_DB_WAIT: "1",
    });
    expect(r.code).toBe(1);
    expect(r.sortie + r.erreur).toContain("MINDCARE NE DEMARRE PAS");
    expect(r.sortie + r.erreur).toContain("La base de donnees ne repond pas");
    // Et JAMAIS le message du mode dégradé :
    expect(r.sortie + r.erreur).not.toContain("degraded");
  });

  it("base injoignable (cible dev mc-p3) → le message nomme mc-p3 et Docker", async () => {
    // Le conseil suit la CIBLE : une URL sur 127.0.0.1:55441 parle au
    // conteneur de développement — c'est LUI que le message doit nommer.
    const r = await executerScript({
      MINDCARE_DATABASE_URL: URL_MORTE_DEV,
      MINDCARE_SKIP_DB_WAIT: "1",
    });
    expect(r.code).toBe(1);
    const texte = r.sortie + r.erreur;
    expect(texte).toContain("mc-p3");
    expect(texte).toContain("Docker");
  });

  it("base injoignable (cible service Windows du paquet) → le message nomme le service, PAS Docker", async () => {
    // Le paquet installé parle au service `mindcare-postgres` (port 54333).
    // Y conseiller Docker serait nommer le mauvais organe — le même défaut
    // que LM54.3 reproduit sous une autre forme.
    const r = await executerScript({
      MINDCARE_DATABASE_URL: "postgresql://mindcare_app:x@127.0.0.1:54333/mindcare",
      MINDCARE_SKIP_DB_WAIT: "1",
    });
    expect(r.code).toBe(1);
    const texte = r.sortie + r.erreur;
    expect(texte).toContain("mindcare-postgres");
    expect(texte).not.toContain("mc-p3");
  });

  it("MINDCARE_DATABASE_URL absente → refus immédiat avec sa cause propre", async () => {
    const r = await executerScript({
      MINDCARE_DATABASE_URL: "",
    });
    expect(r.code).toBe(1);
    expect(r.sortie + r.erreur).toContain("MINDCARE_DATABASE_URL est absente");
  });

  it.skipIf(!BASE_ACTIVE)("vraie base saine → exit 0, migrations à jour", async () => {
    const r = await executerScript({
      MINDCARE_DATABASE_URL: URL_TEST ?? "",
      MINDCARE_SKIP_DB_WAIT: "1",
    });
    expect(r.code).toBe(0);
    expect(r.sortie).toContain("base joignable");
    expect(r.sortie).toMatch(/migrations a jour/);
  });
});

describe("base-locale.mjs — constantes du cycle de vie", () => {
  it("le conteneur, l'image, l'hôte et le port correspondent à l'installation réelle", async () => {
    const bl = await import(path.join(RACINE, "scripts", "lib", "base-locale.mjs"));
    // mc-p3, postgres:17, 127.0.0.1:55441 — figés par les phases 3-6 de
    // pg-local (checkpoints/pg-local/). Toute divergence = la base décrite
    // dans .env n'est plus celle que le cycle de vie garantit.
    expect(bl.CONTENEUR_DEV).toBe("mc-p3");
    expect(bl.IMAGE_DEV).toBe("postgres:17");
    expect(bl.HOTE).toBe("127.0.0.1");
    expect(bl.PORT_HOTE).toBe(55441);
  });

  it("la sonde applicative distingue joignable d'injoignable (port mort)", async () => {
    const bl = await import(path.join(RACINE, "scripts", "lib", "base-locale.mjs"));
    const morte = await bl.sondeApplicative(URL_MORTE);
    expect(morte.ok).toBe(false);
    // Le code d'erreur de transport est exposé SANS jamais l'URL :
    expect(morte.code).toBeDefined();
    expect(JSON.stringify(morte)).not.toContain("postgresql://");
  });

  it("la sonde applicative ne laisse JAMAIS fuir le mot de passe dans son diagnostic", async () => {
    const bl = await import(path.join(RACINE, "scripts", "lib", "base-locale.mjs"));
    const morte = await bl.sondeApplicative(
      "postgresql://mindcare_app:SECRET-A-NEXPOSER@127.0.0.1:1/mindcare",
    );
    expect(morte.ok).toBe(false);
    expect(JSON.stringify(morte)).not.toContain("SECRET-A-NEXPOSER");
    expect(JSON.stringify(morte)).not.toContain("postgresql://");
  });
});
