/**
 * Phase 3 — l'authentification locale, éprouvée contre une vraie base.
 *
 * Comme `identite-pool.test.ts`, ce fichier ne simule rien : le comportement
 * qu'on cherche à prouver vit dans pgcrypto, dans les policies et dans les
 * privilèges de rôle. Un simulacre ne prouverait que sa propre cohérence.
 *
 * ⚠️ LA LEÇON DE LA PHASE 2 EST APPLIQUÉE ICI. Là-bas, les 7 tests restaient
 * verts alors qu'on avait réintroduit la faille, parce qu'un autre verrou la
 * masquait. Chaque test ci-dessous a donc été écrit en se demandant : « quelle
 * mutation du code le ferait passer au rouge ? » Quand la réponse était
 * « aucune », le test a été réécrit. Les cas qu'aucun test ne peut distinguer
 * sont couverts par les contrôles 11 et 12 de `scripts/preflight.sh`.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const URL_TEST = process.env.MINDCARE_TEST_DATABASE_URL;
const ACTIF = URL_TEST !== undefined && URL_TEST.trim() !== "";

// Comptes du semis 015. Leur `encrypted_password` vaut littéralement
// 'CONNEXION-IMPOSSIBLE' : ils servent de cas « hachage hérité ».
const DR_A = "00000000-0000-0000-0000-0000000000a1";
const EMAIL_A = "owner.dev@invalid.local";

// Le compte que ces tests fabriquent, avec un VRAI hachage bcrypt.
const UID_ESSAI = "00000000-0000-0000-0000-0000000000e1";
const EMAIL_ESSAI = "essai.phase3@invalid.local";
const MDP_ESSAI = "un-mot-de-passe-de-test-2026!";

let withAuthGate: typeof import("@/server/db/withCaller").withAuthGate;
let withCaller: typeof import("@/server/db/withCaller").withCaller;
let fermerPool: typeof import("@/server/db/pool").fermerPool;
let auth: typeof import("@/server/auth/session");

beforeAll(async () => {
  if (!ACTIF) return;
  process.env.MINDCARE_DATABASE_URL = URL_TEST;
  const modPool = await import("@/server/db/pool");
  const modCaller = await import("@/server/db/withCaller");
  fermerPool = modPool.fermerPool;
  withAuthGate = modCaller.withAuthGate;
  withCaller = modCaller.withCaller;
  auth = await import("@/server/auth/session");

  // On fabrique un compte utilisable. `postgres` applique les migrations, mais
  // les tests tournent sous `mindcare_app` — qui ne peut PAS écrire dans
  // auth.users. C'est précisément ce qu'on veut prouver plus bas, donc le
  // compte est posé par la porte... qui n'existe pas pour la création.
  //
  // On passe donc par une connexion d'administration distincte, exactement
  // comme le fera `scripts/compte-praticienne.sh` en production : la création
  // de comptes est un geste d'ADMINISTRATION, pas une fonctionnalité de
  // l'application. Ce test le reflète au lieu de le contourner.
  const { Client } = await import("pg");
  const admin = new Client({ connectionString: process.env.MINDCARE_ADMIN_DATABASE_URL });
  await admin.connect();
  await admin.query(
    `INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                             created_at, updated_at)
     VALUES ($1, '00000000-0000-0000-0000-000000000000', 'authenticated',
             'authenticated', $2, public.crypt($3, public.gen_salt('bf')), now(), now())
     ON CONFLICT (id) DO UPDATE
       SET encrypted_password = public.crypt($3, public.gen_salt('bf')),
           email = $2`,
    [UID_ESSAI, EMAIL_ESSAI, MDP_ESSAI],
  );
  // Un profil actif, sans quoi `verify_password` refuse (070 §4a).
  await admin.query(
    `INSERT INTO app.profiles (id, cabinet_id, role, full_name, is_active)
     SELECT $1, c.id, 'practitioner', 'Compte d''essai phase 3', true
       FROM app.cabinets c LIMIT 1
     ON CONFLICT (id) DO UPDATE SET is_active = true`,
    [UID_ESSAI],
  );
  await admin.end();
});

afterAll(async () => {
  if (!ACTIF) return;
  await fermerPool();
});

describe.skipIf(!ACTIF)("authentification locale", () => {
  it("un mot de passe correct rend l'identité", async () => {
    const s = await auth.ouvrirSession(EMAIL_ESSAI, MDP_ESSAI);
    expect(s).not.toBeNull();
    expect(s?.userId).toBe(UID_ESSAI);
    // Le jeton doit être long et aléatoire, pas un identifiant déguisé.
    expect((s?.jeton ?? "").length).toBeGreaterThanOrEqual(43);
    expect(s?.jeton).not.toContain(UID_ESSAI);
  });

  it("un mot de passe faux refuse, sans dire pourquoi", async () => {
    const s = await auth.ouvrirSession(EMAIL_ESSAI, "ce-n-est-pas-le-bon");
    expect(s).toBeNull();
  });

  it("un compte inconnu refuse de la même façon", async () => {
    const s = await auth.ouvrirSession("personne@invalid.local", MDP_ESSAI);
    expect(s).toBeNull();
  });

  it("un compte au hachage hérité (semis 015) refuse sans lever", async () => {
    await expect(auth.ouvrirSession(EMAIL_A, "n-importe-quoi")).resolves.toBeNull();
  });

  it("un hachage DES est REFUSÉ, et pas seulement 'pas reconnu'", async () => {
    // ⚠️ CE TEST EST ÉCRIT POUR MORDRE, et il a fallu deux essais pour y
    // arriver. Le premier vérifiait le compte de 015 : il restait vert même
    // après suppression du filtre de forme bcrypt, parce que le refus venait
    // d'ailleurs (le hachage DES calculé ne coïncidait pas). Il ne prouvait donc
    // rien du filtre — exactement le défaut trouvé en phase 2.
    //
    // Celui-ci construit le cas RÉELLEMENT dangereux : un compte dont le
    // `encrypted_password` est un vrai hachage DES, qui se re-vérifie. Sans le
    // filtre, la connexion RÉUSSIT. Avec, elle est refusée.
    //
    // Et le second `expect` mesure pourquoi ça compte : DES n'utilise que les 8
    // premiers caractères, donc un mot de passe DIFFÉRENT ouvrirait la porte.
    const { Client } = await import("pg");
    const admin = new Client({ connectionString: process.env.MINDCARE_ADMIN_DATABASE_URL });
    await admin.connect();
    const UID_DES = "00000000-0000-0000-0000-0000000000e2";
    const EMAIL_DES = "hash.des@invalid.local";
    try {
      await admin.query(
        `INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                                 created_at, updated_at)
         VALUES ($1, '00000000-0000-0000-0000-000000000000', 'authenticated',
                 'authenticated', $2, public.crypt($3, public.gen_salt('des')), now(), now())
         ON CONFLICT (id) DO UPDATE
           SET encrypted_password = public.crypt($3, public.gen_salt('des')), email = $2`,
        [UID_DES, EMAIL_DES, "motdepasse-ABCDEF"],
      );
      await admin.query(
        `INSERT INTO app.profiles (id, cabinet_id, role, full_name, is_active)
         SELECT $1, c.id, 'practitioner', 'Compte DES', true FROM app.cabinets c LIMIT 1
         ON CONFLICT (id) DO UPDATE SET is_active = true`,
        [UID_DES],
      );

      // Le bon mot de passe lui-même doit être refusé : on n'accepte QUE bcrypt.
      await expect(auth.ouvrirSession(EMAIL_DES, "motdepasse-ABCDEF")).resolves.toBeNull();
      // Et celui-ci, qui ne diffère qu'après le 8ᵉ caractère, serait accepté par
      // DES. C'est la faille que le filtre ferme.
      await expect(auth.ouvrirSession(EMAIL_DES, "motdepasse-ZZZZZZ")).resolves.toBeNull();
    } finally {
      await admin.query("DELETE FROM app.profiles WHERE id = $1", [UID_DES]);
      await admin.query("DELETE FROM auth.users WHERE id = $1", [UID_DES]);
      await admin.end();
    }
  });

  it("la casse et les espaces de l'email n'empêchent pas la connexion", async () => {
    const s = await auth.ouvrirSession(`  ${EMAIL_ESSAI.toUpperCase()}  `, MDP_ESSAI);
    expect(s?.userId).toBe(UID_ESSAI);
  });

  it("un jeton valide se résout en identité, un jeton inventé non", async () => {
    const s = await auth.ouvrirSession(EMAIL_ESSAI, MDP_ESSAI);
    expect(s).not.toBeNull();
    await expect(auth.resoudreSession(s?.jeton)).resolves.toBe(UID_ESSAI);
    await expect(auth.resoudreSession("jeton-invente-de-toutes-pieces")).resolves.toBeNull();
    await expect(auth.resoudreSession(undefined)).resolves.toBeNull();
  });

  it("une session révoquée est refusée IMMÉDIATEMENT", async () => {
    const s = await auth.ouvrirSession(EMAIL_ESSAI, MDP_ESSAI);
    expect(await auth.resoudreSession(s?.jeton)).toBe(UID_ESSAI);
    await auth.fermerSession(s?.jeton);
    // C'est la propriété qu'un JWT ne peut pas offrir.
    expect(await auth.resoudreSession(s?.jeton)).toBeNull();
  });

  it("la base stocke EXACTEMENT le SHA-256 du jeton, et rien d'autre", async () => {
    // ⚠️ DEUXIÈME RÉDACTION. La première cherchait le jeton complet par
    // `LIKE '%jeton%'` dans la colonne. Elle restait VERTE quand on remplaçait
    // le hachage par « les 32 premiers caractères du jeton en clair » : la
    // sous-chaîne cherchée (43 caractères) ne pouvait pas s'y trouver. Elle
    // prouvait donc l'absence d'une forme de fuite, pas la présence du hachage.
    //
    // Celle-ci calcule le SHA-256 ATTENDU indépendamment, dans le test, et exige
    // que la ligne stockée soit exactement celui-là. Toute autre valeur — jeton
    // brut, préfixe, autre algorithme — la fait échouer.
    const { createHash } = await import("node:crypto");
    const s = await auth.ouvrirSession(EMAIL_ESSAI, MDP_ESSAI);
    const jeton = s?.jeton ?? "";
    const attendu = createHash("sha256").update(jeton, "utf8").digest();

    const { Client } = await import("pg");
    const admin = new Client({ connectionString: process.env.MINDCARE_ADMIN_DATABASE_URL });
    await admin.connect();
    try {
      const r = await admin.query<{ n: string }>(
        "SELECT count(*) AS n FROM auth.sessions WHERE token_sha256 = $1",
        [attendu],
      );
      expect(r.rows[0]?.n).toBe("1");

      // Et aucune ligne ne doit contenir le jeton lui-même, sous quelque
      // longueur que ce soit : on balaye les préfixes plutôt qu'une seule forme.
      const prefixes = [8, 16, 24, 32, jeton.length].map((n) => jeton.slice(0, n));
      for (const pref of prefixes) {
        const f = await admin.query<{ n: string }>(
          "SELECT count(*) AS n FROM auth.sessions WHERE position($1::bytea in token_sha256) > 0",
          [Buffer.from(pref, "utf8")],
        );
        expect(f.rows[0]?.n).toBe("0");
      }
    } finally {
      await admin.end();
    }
  });

  it("deux connexions donnent deux jetons différents", async () => {
    const a = await auth.ouvrirSession(EMAIL_ESSAI, MDP_ESSAI);
    const b = await auth.ouvrirSession(EMAIL_ESSAI, MDP_ESSAI);
    expect(a?.jeton).not.toBe(b?.jeton);
    // Et les deux restent valides : le cabinet a plusieurs postes.
    expect(await auth.resoudreSession(a?.jeton)).toBe(UID_ESSAI);
    expect(await auth.resoudreSession(b?.jeton)).toBe(UID_ESSAI);
  });

  it("une session ouverte NE PEUT PAS appeler les portes d'authentification", async () => {
    // Le cœur de 070 §5. Sous `authenticated`, EXECUTE est refusé : une session
    // déjà ouverte ne peut ni forger d'autres sessions, ni éprouver des mots de
    // passe à volonté.
    const refus = await withCaller(UID_ESSAI, async (q) => {
      try {
        await q.query("SELECT auth.verify_password($1, $2)", [EMAIL_ESSAI, MDP_ESSAI]);
        return "AUTORISÉ";
      } catch {
        return "refusé";
      }
    });
    expect(refus).toBe("refusé");

    const refusForge = await withCaller(UID_ESSAI, async (q) => {
      try {
        await q.query("SELECT auth.create_session($1, $2)", [DR_A, Buffer.alloc(32, 7)]);
        return "AUTORISÉ";
      } catch {
        return "refusé";
      }
    });
    expect(refusForge).toBe("refusé");
  });

  it("les hachages de mots de passe restent illisibles depuis l'application", async () => {
    const refus = await withCaller(UID_ESSAI, async (q) => {
      try {
        await q.query("SELECT encrypted_password FROM auth.users LIMIT 1");
        return "LISIBLE";
      } catch {
        return "refusé";
      }
    });
    expect(refus).toBe("refusé");
  });

  it("la table des sessions est illisible depuis l'application", async () => {
    const refus = await withCaller(UID_ESSAI, async (q) => {
      try {
        await q.query("SELECT token_sha256 FROM auth.sessions LIMIT 1");
        return "LISIBLE";
      } catch {
        return "refusé";
      }
    });
    expect(refus).toBe("refusé");
  });

  it("withAuthGate n'endosse aucun rôle et ne porte aucune identité", async () => {
    const etat = await withAuthGate(async (q) => {
      const r = await q.query<{ role: string; uid: string | null }>(
        "SELECT current_user AS role, auth.uid()::text AS uid",
      );
      return r[0];
    });
    expect(etat?.role).toBe("mindcare_app");
    expect(etat?.uid).toBeNull();
  });

  it("hors des portes, withAuthGate ne peut RIEN lire du cabinet", async () => {
    // La propriété qui rend l'enveloppe sans identité acceptable : `NOINHERIT`
    // fait qu'elle n'ouvre pas un accès, elle ouvre quatre fonctions.
    const refus = await withAuthGate(async (q) => {
      try {
        await q.query("SELECT count(*) FROM app.profiles");
        return "LISIBLE";
      } catch {
        return "refusé";
      }
    });
    expect(refus).toBe("refusé");
  });

  it("un compte désactivé ne peut plus ouvrir de session", async () => {
    const { Client } = await import("pg");
    const admin = new Client({ connectionString: process.env.MINDCARE_ADMIN_DATABASE_URL });
    await admin.connect();
    await admin.query("UPDATE app.profiles SET is_active = false WHERE id = $1", [UID_ESSAI]);
    try {
      await expect(auth.ouvrirSession(EMAIL_ESSAI, MDP_ESSAI)).resolves.toBeNull();
    } finally {
      await admin.query("UPDATE app.profiles SET is_active = true WHERE id = $1", [UID_ESSAI]);
      await admin.end();
    }
  });

  it("un mot de passe de plus de 72 octets est refusé, pas tronqué", async () => {
    // bcrypt ignore silencieusement au-delà de 72 octets. Sans la borne de
    // 070 §4a, ces deux mots de passe seraient équivalents pour la base.
    const long = "a".repeat(80);
    await expect(auth.ouvrirSession(EMAIL_ESSAI, long)).resolves.toBeNull();
  });
});

describe.skipIf(!ACTIF)("cohérence du cookie de session", () => {
  it("refuse un cookie en clair sur une écoute non locale", () => {
    delete process.env.MC_HTTPS;
    expect(() => auth.asserterCoherenceCookie("192.168.1.20:3000")).toThrow();
    expect(() => auth.asserterCoherenceCookie("mindcare.cabinet.local")).toThrow();
  });

  it("accepte la boucle locale, et le réseau dès que TLS est annoncé", () => {
    delete process.env.MC_HTTPS;
    expect(() => auth.asserterCoherenceCookie("127.0.0.1:3000")).not.toThrow();
    expect(() => auth.asserterCoherenceCookie("localhost:3000")).not.toThrow();
    process.env.MC_HTTPS = "1";
    expect(() => auth.asserterCoherenceCookie("192.168.1.20")).not.toThrow();
    delete process.env.MC_HTTPS;
  });

  it("le cookie est httpOnly, sameSite lax, et non-secure hors TLS", () => {
    delete process.env.MC_HTTPS;
    const o = auth.optionsCookie(3600);
    expect(o.httpOnly).toBe(true);
    expect(o.sameSite).toBe("lax");
    expect(o.secure).toBe(false);
    process.env.MC_HTTPS = "1";
    expect(auth.optionsCookie(3600).secure).toBe(true);
    delete process.env.MC_HTTPS;
  });
});
