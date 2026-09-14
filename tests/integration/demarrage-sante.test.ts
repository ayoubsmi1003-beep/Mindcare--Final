/**
 * LM54.3 — le démarrage et la santé de la chaîne de données, éprouvés contre
 * une VRAIE base PostgreSQL.
 *
 * Ce fichier ne simule rien : il vérifie ce que le navigateur voit quand la
 * dépendance de données manque (le 503 de LM54.3), ce que `verifierDemarrage`
 * dit d'une base saine, ce qu'il dit d'une base INJOIGNABLE, et que
 * `ouvrirSession`/`etatProvisionnement` rendent les bonnes réponses
 * applicatives quand la base répond.
 *
 * Le cas « base injoignable » est la clé de la régression : il reproduit
 * l'état LM54.3 en pointant le pool vers un port où RIEN n'écoute, et
 * exige que chaque fonction rende `indisponible`-compatible — pas une
 * exception qui traverse, pas un mensonge sur la cause.
 *
 * Comme `auth-locale.test.ts` : sans `MINDCARE_TEST_DATABASE_URL`, les tests
 * s'IGNORENT en le disant.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const URL_TEST = process.env.MINDCARE_TEST_DATABASE_URL;
const ACTIF = URL_TEST !== undefined && URL_TEST.trim() !== "";

/** Un port où RIEN n'écoute, garanti par l'OS (port 1 = tcpmux, réservé). */
const URL_MORTE = "postgresql://mindcare_app:x@127.0.0.1:1/mindcare";

const OWNER_EMAIL = "owner.dev@invalid.local";
const OWNER_MDP = process.env.DEV_ACCOUNT_PASSWORD ?? "compte-sentinel-non-connectable";

let fermerPool: typeof import("@/server/db/pool").fermerPool;
let demarrage: typeof import("@/server/demarrage");
let auth: typeof import("@/server/auth/session");
let provisioning: typeof import("@/server/auth/provisioning");

beforeAll(async () => {
  if (!ACTIF) return;
  process.env.MINDCARE_DATABASE_URL = URL_TEST;
  ({ fermerPool } = await import("@/server/db/pool"));
  demarrage = await import("@/server/demarrage");
  auth = await import("@/server/auth/session");
  provisioning = await import("@/server/auth/provisioning");
});

afterAll(async () => {
  if (!ACTIF) return;
  await fermerPool();
});

describe.skipIf(!ACTIF)("vérification de démarrage — base saine", () => {
  it("rend ok:true quand toutes les migrations sont appliquées", async () => {
    const etat = await demarrage.verifierDemarrage(process.cwd());
    expect(etat.ok).toBe(true);
  });

  it("etatProvisionnement répond — la sonde de premier lancement vit", async () => {
    const etat = await provisioning.etatProvisionnement();
    expect(typeof etat.environment).toBe("string");
    expect(typeof etat.provisionne).toBe("boolean");
  });

  it("ouvrirSession avec de mauvais identifiants rend null (401 côté route), PAS une exception", async () => {
    const s = await auth.ouvrirSession(OWNER_EMAIL, "ce-nest-pas-le-bon");
    expect(s).toBeNull();
  });
});

describe.skipIf(!ACTIF)("vérification de démarrage — base INJOIGNABLE (régression LM54.3)", () => {
  /**
   * Le cœur de la régression : le pool pointe vers un port mort, comme le
   * 2026-08-31 où Docker Desktop n'était pas démarré. Chaque fonction doit
   * rendre son diagnostic structuré — c'est ce que les routes traduisent en
   * 503 `indisponible`. Aucune ne doit réussir, aucune ne doit mentir.
   *
   * ⚠️ Le pool est MÉMOÏSÉ sur `globalThis` (pool.ts) : changer la variable
   * d'environnement ne suffit pas. `fermerPool()` AVANT de repointer, sinon
   * le test mesure l'ancienne connexion et passe au vert pour la mauvaisse
   * raison.
   */
  beforeAll(async () => {
    await fermerPool();
    process.env.MINDCARE_DATABASE_URL = URL_MORTE;
  });

  afterAll(async () => {
    await fermerPool();
    process.env.MINDCARE_DATABASE_URL = URL_TEST;
  });

  it("verifierDemarrage rend base-injoignable, pas une exception", async () => {
    const etat = await demarrage.verifierDemarrage(process.cwd());
    expect(etat.ok).toBe(false);
    expect(etat.probleme).toBe("base-injoignable");
    expect(etat.detail).toBeDefined();
  });

  it("etatProvisionnement LÈVE — la route la traduit en 503, jamais en succès", async () => {
    await expect(provisioning.etatProvisionnement()).rejects.toThrow();
  });

  it("ouvrirSession LÈVE (base absente), ne rend PAS null (ce serait un refus d'identifiants)", async () => {
    // LA distinction critique de LM54.3 : `null` = 401 « identifiants
    // refusés ». Une panne de base rendue `null` mentirait à la praticienne
    // sur ses identifiants. Elle doit lever, pour que la route rende 503.
    await expect(auth.ouvrirSession(OWNER_EMAIL, OWNER_MDP)).rejects.toThrow();
  });
});

describe.skipIf(!ACTIF)(
  "verifierDemarrage — base injoignable SANS toucher au pool de l'application",
  () => {
    /**
     * La même preuve que ci-dessus, mais par l'URL passée en argument
     * implicite : `verifierDemarrage` lit `MINDCARE_DATABASE_URL` à travers
     * `obtenirPool()`. On vérifie ici le CHEMIN DE DÉFAUT — le pool partagé
     * étant déjà testé, ce bloc confirme que le diagnostic est bien
     * `base-injoignable` quand RIEN ne répond sur le port applicatif.
     */
    it("diagnostic et détail sans fuite d'URL", async () => {
      const sauve = process.env.MINDCARE_DATABASE_URL;
      await fermerPool();
      process.env.MINDCARE_DATABASE_URL = URL_MORTE;
      try {
        const etat = await demarrage.verifierDemarrage(process.cwd());
        expect(etat.ok).toBe(false);
        expect(etat.probleme).toBe("base-injoignable");
        // Le détail ne doit JAMAIS contenir l'URL (elle porte le mot de passe).
        expect(JSON.stringify(etat)).not.toContain("postgresql://");
      } finally {
        await fermerPool();
        process.env.MINDCARE_DATABASE_URL = sauve;
      }
    });
  },
);
