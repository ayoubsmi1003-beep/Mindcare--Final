/**
 * LE test de la phase 2 : une identité ne franchit jamais la frontière d'une
 * requête.
 *
 * Jusqu'ici, PostgREST ouvrait une connexion par requête et l'identité venait du
 * JWT : la question ne se posait pas. Avec un pool, deux requêtes successives
 * partagent la même connexion PostgreSQL, et `pg` ne la réinitialise pas. Si
 * `withCaller` posait l'identité avec `SET` au lieu de `SET LOCAL`, la
 * praticienne B lirait les dossiers de la praticienne A — sans erreur, sans
 * trace, sans symptôme visible à l'écran.
 *
 * ⚠️ CE FICHIER EXIGE UNE VRAIE BASE. Il ne simule rien : un port factice
 * prouverait seulement que le mock est cohérent avec lui-même, alors que le
 * défaut qu'on cherche vit dans le comportement de PostgreSQL et du pilote. Sans
 * `MINDCARE_TEST_DATABASE_URL`, les tests sont IGNORÉS et le disent — ils ne
 * passent pas au vert en silence, ce qui reviendrait à affirmer une propriété
 * qu'on n'a pas mesurée.
 *
 * POURQUOI UN POOL À UNE SEULE CONNEXION. Avec la taille par défaut, deux
 * requêtes concurrentes obtiennent presque toujours deux connexions distinctes,
 * et le test passerait même si `withCaller` était écrit avec `SET`. En forçant
 * `max = 1`, la réutilisation est GARANTIE : c'est le pire cas, donc le seul qui
 * prouve quelque chose.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const URL_TEST = process.env.MINDCARE_TEST_DATABASE_URL;
const ACTIF = URL_TEST !== undefined && URL_TEST.trim() !== "";

const DR_A = "00000000-0000-0000-0000-0000000000a1";
const DR_B = "00000000-0000-0000-0000-0000000000a2";

// Le pool est mémoïsé par `pool.ts` sur un symbole global : on pose l'URL et la
// taille AVANT le premier import, sinon la mémoïsation fige les réglages par
// défaut et `max = 1` n'aurait aucun effet.
let withCaller: typeof import("@/server/db/withCaller").withCaller;
let fermerPool: typeof import("@/server/db/pool").fermerPool;

beforeAll(async () => {
  if (!ACTIF) return;
  process.env.MINDCARE_DATABASE_URL = URL_TEST;
  const modPool = await import("@/server/db/pool");
  const modCaller = await import("@/server/db/withCaller");
  fermerPool = modPool.fermerPool;
  withCaller = modCaller.withCaller;
});

afterAll(async () => {
  if (!ACTIF) return;
  await fermerPool();
});

describe.skipIf(!ACTIF)("withCaller — étanchéité de l'identité", () => {
  it("rend l'identité posée, et NULL quand il n'y en a pas", async () => {
    const connecte = await withCaller(DR_A, async (q) => {
      const r = await q.query<{ uid: string | null }>("SELECT auth.uid()::text AS uid");
      return r[0]?.uid ?? null;
    });
    expect(connecte).toBe(DR_A);

    const visiteur = await withCaller(null, async (q) => {
      const r = await q.query<{ uid: string | null }>("SELECT auth.uid()::text AS uid");
      return r[0]?.uid ?? null;
    });
    expect(visiteur).toBeNull();
  });

  it("l'identité ne survit pas à la transaction, sur la MÊME connexion", async () => {
    await withCaller(DR_A, async (q) => {
      await q.query("SELECT 1");
    });
    // Emprunt suivant : sur un pool à une connexion, c'est physiquement la même.
    const apres = await withCaller(null, async (q) => {
      const r = await q.query<{ uid: string | null }>("SELECT auth.uid()::text AS uid");
      return r[0]?.uid ?? null;
    });
    expect(apres).toBeNull();
  });

  it("une transaction qui ÉCHOUE ne laisse pas son identité derrière elle", async () => {
    // Le chemin d'erreur est celui qu'on oublie de tester, et c'est celui qui
    // laisse un `SET` en place quand le ROLLBACK est écrit à la main.
    await expect(
      withCaller(DR_B, async (q) => {
        await q.query("SELECT 1 / 0");
      }),
    ).rejects.toBeDefined();

    const apres = await withCaller(null, async (q) => {
      const r = await q.query<{ uid: string | null }>("SELECT auth.uid()::text AS uid");
      return r[0]?.uid ?? null;
    });
    expect(apres).toBeNull();
  });

  it("deux appelants entrelacés ne voient jamais l'identité de l'autre", async () => {
    // Chaque appel lit son identité APRÈS une attente, donc après que l'autre
    // a eu toutes les occasions de poser la sienne. Sur un pool à une connexion,
    // les deux transactions se sérialisent sur le même socket : si l'identité
    // était de portée session, la seconde lecture rendrait la mauvaise valeur.
    const lire = (uid: string) =>
      withCaller(uid, async (q) => {
        await q.query("SELECT pg_sleep(0.05)");
        const r = await q.query<{ uid: string | null }>("SELECT auth.uid()::text AS uid");
        return r[0]?.uid ?? null;
      });

    const resultats = await Promise.all([
      lire(DR_A),
      lire(DR_B),
      lire(DR_A),
      lire(DR_B),
      lire(DR_A),
    ]);

    expect(resultats).toEqual([DR_A, DR_B, DR_A, DR_B, DR_A]);
  });

  it("le rôle endossé retombe lui aussi à chaque transaction", async () => {
    const dedans = await withCaller(DR_A, async (q) => {
      const r = await q.query<{ role: string }>("SELECT current_user AS role");
      return r[0]?.role ?? "";
    });
    expect(dedans).toBe("authenticated");

    const visiteur = await withCaller(null, async (q) => {
      const r = await q.query<{ role: string }>("SELECT current_user AS role");
      return r[0]?.role ?? "";
    });
    expect(visiteur).toBe("anon");
  });

  it("hors enveloppe, le rôle de connexion n'a AUCUN droit (NOINHERIT)", async () => {
    // La propriété qui transforme un oubli d'enveloppe en panne bruyante plutôt
    // qu'en fuite silencieuse. On la mesure en annulant l'endossement au sein
    // même d'une transaction : on retrouve `mindcare_app` nu.
    const refus = await withCaller(DR_A, async (q) => {
      await q.query("RESET ROLE");
      try {
        await q.query("SELECT count(*) FROM app.profiles");
        return "LECTURE AUTORISÉE";
      } catch {
        return "refusé";
      }
    });
    expect(refus).toBe("refusé");
  });

  it("ADR-019 tient sous l'adaptateur : pas de SELECT direct sur app.patients", async () => {
    const refus = await withCaller(DR_A, async (q) => {
      try {
        await q.query("SELECT count(*) FROM app.patients");
        return "LECTURE AUTORISÉE";
      } catch {
        return "refusé";
      }
    });
    expect(refus).toBe("refusé");
  });
});
