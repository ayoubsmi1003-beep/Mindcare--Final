/**
 * Phase 4 — la frontière de données, éprouvée contre une vraie base.
 *
 * Ce fichier n'appelle PAS les Route Handlers par HTTP : Next les fournit un
 * contexte (`cookies()`, `headers()`) qu'un test unitaire ne peut pas
 * fabriquer honnêtement. Ce qui EST éprouvé ici, contre PostgreSQL :
 *   · la validation d'entrée (`EntreeRpc`, `EntreeSelect`) ;
 *   · les deux allowlists ;
 *   · le contrôle de démarrage, contre le catalogue réel ;
 *   · le traducteur SQL de `pgPort`, sur des cas limites.
 *
 * La traversée HTTP complète — cookie, session, RLS bout-en-bout — est
 * éprouvée par `tests/integration/bout-en-bout.test.ts`, qui lance un vrai
 * serveur Next. Les deux sont nécessaires : celui-ci localise un défaut,
 * celui-là prouve que la chaîne entière tourne.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const URL_TEST = process.env.MINDCARE_TEST_DATABASE_URL;
const ACTIF = URL_TEST !== undefined && URL_TEST.trim() !== "";

const DR_A = "00000000-0000-0000-0000-0000000000a1";

let withCaller: typeof import("@/server/db/withCaller").withCaller;
let fermerPool: typeof import("@/server/db/pool").fermerPool;
let frontiere: typeof import("@/server/db/frontiere");
let pgPort: typeof import("@/server/db/pgPort");
let allowlist: typeof import("@/server/db/allowlist.generated");

beforeAll(async () => {
  if (!ACTIF) return;
  process.env.MINDCARE_DATABASE_URL = URL_TEST;
  const modPool = await import("@/server/db/pool");
  fermerPool = modPool.fermerPool;
  withCaller = (await import("@/server/db/withCaller")).withCaller;
  frontiere = await import("@/server/db/frontiere");
  pgPort = await import("@/server/db/pgPort");
  allowlist = await import("@/server/db/allowlist.generated");
});

afterAll(async () => {
  if (!ACTIF) return;
  await fermerPool();
});

describe.skipIf(!ACTIF)("contrôle de démarrage", () => {
  it("l'allowlist correspond au catalogue réel de la base", async () => {
    // Le test qui attrape une fonction supprimée par une migration future, ou
    // un droit retiré. Il ne simule pas `pg_proc` : il l'interroge.
    await expect(
      withCaller(null, (q) => frontiere.verifierAllowlist(q)),
    ).resolves.toBeUndefined();
  });

  it("échoue si l'allowlist cite une fonction absente", async () => {
    // Mutation exercée depuis le test lui-même : on éprouve le contrôle, pas
    // seulement le cas nominal. Sans cela, ce serait un test qui ne mord pas.
    const vraies = allowlist.RPC_AUTORISES;
    const gonflee = new Set([...vraies, "fonction_qui_n_existe_pas_du_tout"]);
    // On réécrit l'ensemble exporté le temps du test.
    Object.defineProperty(allowlist, "RPC_AUTORISES", {
      value: gonflee,
      configurable: true,
    });
    try {
      await expect(
        withCaller(null, (q) => frontiere.verifierAllowlist(q)),
      ).rejects.toThrow(/Absentes de pg_proc/);
    } finally {
      Object.defineProperty(allowlist, "RPC_AUTORISES", {
        value: vraies,
        configurable: true,
      });
    }
  });
});

describe.skipIf(!ACTIF)("allowlist — ce qui passe et ce qui ne passe pas", () => {
  it("accepte une fonction réellement appelée par un service", () => {
    expect(frontiere.rpcAutorise("get_patient")).toBe(true);
    expect(frontiere.rpcAutorise("search_patients")).toBe(true);
    expect(frontiere.rpcAutorise("dashboard_today")).toBe(true);
  });

  it("refuse une fonction qui existe en base mais qu'aucun service n'appelle", () => {
    // `app.set_deployment_environment` existe (016) et n'est appelée par aucun
    // service. Elle ne doit donc PAS être atteignable depuis le réseau : c'est
    // exactement ce que l'allowlist dérivée apporte par rapport à « tout ce que
    // authenticated peut exécuter ».
    expect(frontiere.rpcAutorise("set_deployment_environment")).toBe(false);
    expect(frontiere.rpcAutorise("log_read")).toBe(false);
    expect(frontiere.rpcAutorise("crypt")).toBe(false);
  });

  it("refuse une relation hors des trois lues en direct", () => {
    expect(
      frontiere.selectAutorise({ relation: "patients", columns: ["id"] }),
    ).toBe(false);
    expect(
      frontiere.selectAutorise({ relation: "clinical_notes", columns: ["id"] }),
    ).toBe(false);
  });

  it("refuse une colonne non citée, même sur une relation autorisée", () => {
    expect(
      frontiere.selectAutorise({ relation: "profiles", columns: ["id", "role"] }),
    ).toBe(true);
    // `signature_block` existe sur profiles mais aucun service ne la lit.
    expect(
      frontiere.selectAutorise({ relation: "profiles", columns: ["signature_block"] }),
    ).toBe(false);
  });

  it("borne AUSSI les colonnes de filtre et de tri", () => {
    // Le trou classique : borner `columns` en oubliant que `filters` finit
    // dans le SQL au même titre.
    expect(
      frontiere.selectAutorise({
        relation: "profiles",
        columns: ["id"],
        filters: [{ column: "signature_block", op: "eq", value: "x" }],
      }),
    ).toBe(false);
    expect(
      frontiere.selectAutorise({
        relation: "profiles",
        columns: ["id"],
        order: [{ column: "signature_block", ascending: true }],
      }),
    ).toBe(false);
  });
});

describe.skipIf(!ACTIF)("validation d'entrée", () => {
  it("refuse une clé d'argument qui n'est pas un nom de paramètre", () => {
    for (const cle of ["p id", "P_ID", "p-id", "1p", "p_id; DROP", ""]) {
      const r = frontiere.EntreeRpc.safeParse({ name: "get_patient", args: { [cle]: "x" } });
      expect(r.success, `clé « ${cle} » aurait dû être refusée`).toBe(false);
    }
  });

  it("accepte les clés légitimes", () => {
    const r = frontiere.EntreeRpc.safeParse({
      name: "get_patient",
      args: { p_id: "00000000-0000-0000-0000-000000000001" },
    });
    expect(r.success).toBe(true);
  });

  it("refuse une valeur non scalaire", () => {
    expect(
      frontiere.EntreeRpc.safeParse({ name: "x", args: { p_a: { imbrique: 1 } } }).success,
    ).toBe(false);
    expect(
      frontiere.EntreeRpc.safeParse({ name: "x", args: { p_a: [1, 2] } }).success,
    ).toBe(false);
  });

  it("borne le nombre d'arguments et la taille des chaînes", () => {
    const trop: Record<string, string> = {};
    for (let i = 0; i < 33; i += 1) trop[`p_${i}`] = "x";
    expect(frontiere.EntreeRpc.safeParse({ name: "x", args: trop }).success).toBe(false);

    const longue = { name: "x", args: { p_a: "z".repeat(65_537) } };
    expect(frontiere.EntreeRpc.safeParse(longue).success).toBe(false);
  });

  it("borne limit à 500 — au-delà ce n'est plus un écran, c'est un export", () => {
    expect(
      frontiere.EntreeSelect.safeParse({ relation: "profiles", columns: ["id"], limit: 500 })
        .success,
    ).toBe(true);
    expect(
      frontiere.EntreeSelect.safeParse({ relation: "profiles", columns: ["id"], limit: 501 })
        .success,
    ).toBe(false);
  });

  it("refuse columns vide — `SelectSpec` n'accepte pas la relation entière", () => {
    expect(
      frontiere.EntreeSelect.safeParse({ relation: "profiles", columns: [] }).success,
    ).toBe(false);
  });
});

describe.skipIf(!ACTIF)("traducteur SQL", () => {
  it("lie les valeurs, n'interpole que les identifiants", () => {
    const { texte, valeurs } = pgPort.construireSelect({
      relation: "profiles",
      columns: ["id", "role"],
      filters: [{ column: "id", op: "eq", value: DR_A }],
      limit: 1,
    });
    expect(texte).toContain('"id"');
    expect(texte).toContain("$1");
    // La valeur ne doit JAMAIS apparaître dans le texte de la requête.
    expect(texte).not.toContain(DR_A);
    expect(valeurs).toContain(DR_A);
  });

  it("traduit `eq null` en IS NULL", () => {
    // `colonne = NULL` ne rend jamais vrai : une lecture qui rend zéro ligne au
    // lieu des lignes attendues est un défaut long à voir.
    const { texte } = pgPort.construireSelect({
      relation: "notifications",
      columns: ["id"],
      filters: [{ column: "read_at", op: "eq", value: null }],
    });
    expect(texte).toContain('"read_at" IS NULL');
    expect(texte).not.toContain("= $");
  });

  it("appelle les fonctions par paramètres NOMMÉS", () => {
    // L'ordre des clés d'un objet JSON n'est pas un contrat : un appel
    // positionnel intervertirait `p_limit` et `p_offset` le jour où un appelant
    // sérialise autrement.
    const { texte } = pgPort.construireRpc("search_patients", {
      p_query: "x",
      p_limit: 10,
      p_offset: 0,
    });
    expect(texte).toContain('"p_query" := $1');
    expect(texte).toContain("SELECT * FROM app.");
  });

  it("une tentative d'injection reste UN IDENTIFIANT, et la table survit", async () => {
    // ⚠️ PREMIÈRE RÉDACTION REJETÉE. Elle affirmait `expect(texte).not.toMatch(
    // /DROP TABLE …/)` — assertion FAUSSE : le texte contient bien ces mots,
    // puisqu'ils sont à l'intérieur d'un identifiant entre guillemets. Le test
    // échouait alors que le code était correct. Une assertion sur la FORME du
    // SQL mesure la façon dont on l'a écrit, pas la propriété qu'on veut.
    //
    // Ce qu'on veut prouver est OBSERVABLE : la charge n'est jamais exécutée.
    // On l'envoie donc à PostgreSQL et on vérifie que la table est toujours là.
    const charge = 'id"; DROP TABLE app.patients; --';

    const { texte } = pgPort.construireSelect({
      relation: "profiles",
      columns: [charge],
    });
    // Le guillemet est doublé : la chaîne d'identifiant ne peut pas se refermer.
    expect(texte).toContain('""');

    const resultat = await withCaller(DR_A, async (q) => {
      const port = pgPort.faireePgPort(q, "test");
      const r = await port.select({ relation: "profiles", columns: [charge] });
      return r.ok ? "EXECUTE" : r.error.code;
    });
    // PostgreSQL traite la charge comme un nom de colonne inconnu.
    expect(resultat).not.toBe("EXECUTE");

    // Et la preuve qui compte : la table est intacte.
    const survit = await withCaller(DR_A, async (q) => {
      const r = await q.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'app' AND c.relname = 'patients'",
      );
      return r[0]?.n;
    });
    expect(survit).toBe("1");
  });
});

describe.skipIf(!ACTIF)("la RLS décide, pas l'allowlist", () => {
  it("une porte autorisée reste soumise à la RLS", async () => {
    // Le point le plus important de la phase : même en passant l'allowlist,
    // l'appelant n'obtient que ce que la RLS lui accorde. Sans identité, la
    // porte ne rend rien — elle ne lève pas, elle ne rend rien.
    const lignes = await withCaller(DR_A, async (q) => {
      const port = pgPort.faireePgPort(q, "test");
      const r = await port.rpc<{ id: string }>("search_patients", {
        p_query: null,
        p_limit: 5,
        p_offset: 0,
      });
      return r.ok ? r.data : null;
    });
    // La base est vide de patients (données synthétiques seulement) : ce qui
    // compte est que l'appel ABOUTISSE sous identité, sans erreur de droits.
    expect(lignes).not.toBeNull();
  });

  it("ADR-019 tient à travers la frontière : pas de SELECT direct sur patients", async () => {
    const refus = await withCaller(DR_A, async (q) => {
      const port = pgPort.faireePgPort(q, "test");
      const r = await port.select({ relation: "patients", columns: ["id"] });
      return r.ok ? "LU" : r.error.code;
    });
    expect(refus).toBe("interdit");
  });
});
