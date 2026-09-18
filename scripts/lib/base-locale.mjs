#!/usr/bin/env node
/**
 * base-locale — le CYCLE DE VIE de la base locale de développement.
 *
 * ═══ POURQUOI CE MODULE EXISTE ══════════════════════════════════════════════
 *
 * `MINDCARE_DATABASE_URL` pointe sur `127.0.0.1:55441` — le conteneur Docker
 * `mc-p3` (pgvector/pgvector:0.8.6-pg16 : PostgreSQL 16.15 + pgvector 0.8.6,
 * ICU fr-DZ, reconstruit en phase 3-6 de pg-local puis réconcilié PG16+M07).
 * Ce conteneur vit dans le Docker Desktop du poste. Trois états réels, mesurés
 * au fil des sessions :
 *
 *   1. Docker Desktop arrêté (au démarrage du PC) → le démon est injoignable,
 *      `docker` rend une erreur de pipe nommé.
 *   2. Docker démarre, `mc-p3` n'est pas encore prêt → le port 55441 refuse
 *      les connexions (ECONNREFUSED) PENDANT une fenêtre de quelques secondes.
 *   3. Le conteneur écoute MAIS PostgreSQL n'a pas fini son `startup` → le port
 *      accepte la connexion puis la rejette, ou `psql` rend "the database system
 *      is starting up".
 *
 * Avant ce module, `pnpm dev` voyait l'état 1/2/3 au premier essai et passait
 * OUTRE grâce à `--allow-degraded` : Next.js démarrait SAIN aux yeux du
 * navigateur, puis CHAQUE appel `/api/auth/sign-in` rendait 503 et
 * `getInstallationStatus` « indisponible ». C'est exactement la panne LM54.3.
 *
 * La solution n'est pas de retirer l'information d'erreur (503 reste le bon
 * statut quand la base manque EN COURS DE SESSION) mais de ne jamais SERVIR
 * tant que la dépendance obligatoire n'est pas PRÊTE — et de le PROUVER par
 * `pg_isready`, pas par une sonde TCP qui confond « le port écoute » et
 * « PostgreSQL accepte les requêtes ».
 *
 * ═══ CE QUE CE MODULE FAIT, DANS L'ORDRE ═════════════════════════════════════
 *
 *   a. attendre que le démon Docker réponde (`docker info`) — il démarre
 *      au lancement du PC et peut prendre ~30 s ;
 *   b. vérifier que le conteneur `mc-p3` existe — s'il n'existe pas, le
 *      signaler avec la commande de reconstruction exacte, jamais le créer
 *      en silence (sa configuration ICU fr-DZ est un acte d'installation,
 *      cf. checkpoints/pg-local/phase3-verdicts.md) ;
 *   c. le DÉMARRER s'il est arrêté (`docker start`) — c'est le geste le plus
 *      fréquent : Docker Desktop préserve le conteneur, il ne le relance pas
 *      tous seul sauf politique `unless-stopped` déjà posée (on la présume,
 *      on la vérifie, on n'en dépend pas) ;
 *   d. attendre `pg_isready` DANS le conteneur — c'est la seule sonde qui
 *      distingue « PostgreSQL accepte » de « le port répond » ;
 *   e. vérifier la base par CONNEXION RÉELLE avec les identifiants applicatifs
 *      (`mindcare_app`), pas seulement par `pg_isready -U postgres` : c'est le
 *      chemin exact que prendra `withAuthGate`, donc l'échec éventuel est
 *      découvert ICI, avec un message qui nomme l'organe, pas à l'écran.
 *
 * Aucune de ces étapes ne peut être sautée : chacune a déjà produit une
 * panne distincte. Le budget total est borné pour que `pnpm dev` échoue VITE
 * et EXPLICITEMENT plutôt que lentement et mystérieusement.
 *
 * ⚠️ SÉCURITÉ : ce module n'affiche JAMAIS `MINDCARE_DATABASE_URL` — elle
 * porte le mot de passe. Les messages nomment le conteneur, le port, l'hôte
 * et les états, jamais les identifiants.
 */

import { spawn } from "node:child_process";
import { createConnection } from "node:net";

/**
 * Le conteneur de développement, figé à sa définition d'installation
 * (phase 3-6 de pg-local). Toute divergence = base à reconstruire, pas
 * à deviner.
 */
export const CONTENEUR_DEV = "mc-p3";
export const IMAGE_DEV = "pgvector/pgvector:0.8.6-pg16";
export const PORT_HOTE = 55441;
export const HOTE = "127.0.0.1";

/** Budgets — bornés pour échouer vite et explicite. */
const BUDGET_DEMON_MS = 45_000; // Docker Desktop qui démarre au boot
const BUDGET_PRET_MS = 30_000; // startup PostgreSQL d'un conteneur froid
const INTERVALLE_MS = 500;

function docker(args, { timeoutMs = 15_000 } = {}) {
  return new Promise((resoudre) => {
    const p = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });
    let sortie = "";
    let erreur = "";
    const minuteur = setTimeout(() => {
      p.kill();
      resoudre({ ok: false, code: null, out: sortie, err: `${erreur} (délai dépassé)` });
    }, timeoutMs);
    p.stdout?.on("data", (d) => {
      sortie += d.toString();
    });
    p.stderr?.on("data", (d) => {
      erreur += d.toString();
    });
    p.on("error", (e) => {
      clearTimeout(minuteur);
      resoudre({ ok: false, code: null, out: sortie, err: String(e?.message ?? e) });
    });
    p.on("close", (code) => {
      clearTimeout(minuteur);
      resoudre({ ok: code === 0, code, out: sortie.trim(), err: erreur.trim() });
    });
  });
}

function dormir(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Le port répond-il ? Sonde TCP brute — utilisée SEULEMENT comme
 * accélérateur de boucle (attendre que le port s'ouvre avant de
 * consommer un `pg_isready`), jamais comme preuve de disponibilité.
 */
function portOuvert(port = PORT_HOTE, hote = HOTE, delaiMs = 1_500) {
  return new Promise((resoudre) => {
    const sonde = createConnection({ port, host: hote });
    const conclure = (valeur) => {
      try {
        sonde.destroy();
      } catch {
        /* ignore */
      }
      resoudre(valeur);
    };
    sonde.setTimeout(delaiMs);
    sonde.once("connect", () => conclure(true));
    sonde.once("timeout", () => conclure(false));
    sonde.once("error", () => conclure(false));
  });
}

/**
 * Étape a — le démon Docker répond-il ?
 *
 * `docker info` est le test canonique (c'est celui de checkpoint-pg-local.sh).
 * Windows rend l'erreur de pipe nommé quand Docker Desktop n'est pas lancé :
 * c'est LE cas le plus fréquent au démarrage du PC, et il faut l'attendre
 * (lancement automatique) ou le dire (jamais installé/désactivé).
 */
export async function attendreDemon(budgetMs = BUDGET_DEMON_MS) {
  const echeance = Date.now() + budgetMs;
  let derniereErreur = "";
  for (;;) {
    const r = await docker(["info"], { timeoutMs: 10_000 });
    if (r.ok) return { ok: true };
    derniereErreur = r.err !== "" ? r.err : `code ${r.code}`;
    if (Date.now() >= echeance) break;
    await dormir(1_000);
  }
  return {
    ok: false,
    erreur: derniereErreur,
    action:
      "Lancer Docker Desktop (il peut mettre ~30 s à démarrer après le boot), " +
      "puis relancer la commande. Le conteneur " +
      CONTENEUR_DEV +
      " vit dans son moteur.",
  };
}

/**
 * Étapes b-c — le conteneur existe, et est-il démarré ?
 *
 * Rend `inexistant: true` quand le conteneur n'existe pas du tout : la
 * reconstruction est un acte D'INSTALLATION (ordre exact de l'installateur,
 * cf. phase6-verdicts.md), pas un geste automatique de `pnpm dev`.
 */
export async function assurerConteneur() {
  const inspect = await docker([
    "inspect",
    "-f",
    "{{.State.Running}} {{.State.Status}}",
    CONTENEUR_DEV,
  ]);
  if (!inspect.ok) {
    return {
      ok: false,
      inexistant: true,
      action:
        "Le conteneur " +
        CONTENEUR_DEV +
        " n'existe pas. Le reconstruire selon checkpoints/pg-local/ " +
        "(000_platform_compat → migrations → 010_app_role, mot de passe applicatif), " +
        "puis relancer. On ne reconstruit JAMAIS une base applicative en silence.",
    };
  }

  const [running, status] = inspect.out.split(/\s+/);
  if (running === "true") return { ok: true };

  console.log(
    `[base-locale] conteneur ${CONTENEUR_DEV} en état « ${status ?? "?" } » — démarrage…`,
  );
  const start = await docker(["start", CONTENEUR_DEV], { timeoutMs: 30_000 });
  if (!start.ok) {
    return {
      ok: false,
      erreur: start.err,
      action: `docker start ${CONTENEUR_DEV} a échoué. Consulter « docker logs ${CONTENEUR_DEV} ».`,
    };
  }
  return { ok: true };
}

/**
 * Étape d — `pg_isready` DANS le conteneur.
 *
 * ⚠️ `pg_isready` ne teste PAS les identifiants : il dit si le serveur accepte
 * des connexions. C'est pour ça que l'étape e existe — les deux mesurent des
 * choses différentes, et chacune a déjà produit une panne distincte.
 */
export async function attendrePret(budgetMs = BUDGET_PRET_MS) {
  const echeance = Date.now() + budgetMs;
  for (;;) {
    // Attendre que le port s'ouvre d'abord : ça évite de consommer des
    // `pg_isready` pendant que Docker mappe encore le port.
    if (await portOuvert()) {
      const r = await docker(["exec", CONTENEUR_DEV, "pg_isready", "-U", "postgres", "-d", "mindcare"], {
        timeoutMs: 10_000,
      });
      if (r.ok) return { ok: true };
    }
    if (Date.now() >= echeance) break;
    await dormir(INTERVALLE_MS);
  }
  return {
    ok: false,
    action:
      "PostgreSQL n'accepte pas de connexions sur " +
      HOTE +
      ":" +
      PORT_HOTE +
      " après " +
      Math.round(budgetMs / 1000) +
      " s. Consulter « docker logs " +
      CONTENEUR_DEV +
      " » — un recovery après arrêt brutal peut prendre du temps.",
  };
}

/**
 * Étape e — connexion RÉELLE sous l'identité applicative.
 *
 * C'est le chemin exact de `withAuthGate` : même hôte/port/base/rôle que le
 * pool de l'application. Une panne de mot de passe, de rôle ou de base
 * `mindcare` est donc découverte ICI avec un message qui nomme l'organe —
 * pas à l'écran derrière un 503.
 */
export async function sondeApplicative(url) {
  const pg = (await import("pg")).default;
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5_000 });
  try {
    await client.connect();
    const r = await client.query("SELECT 1 AS un");
    if (r.rows[0]?.un !== 1) {
      await client.end().catch(() => {});
      return { ok: false, erreur: "La sonde applicative a rendu une réponse inattendue." };
    }
    await client.end();
    return { ok: true };
  } catch (e) {
    await client.end().catch(() => {});
    return {
      ok: false,
      code: e?.code ?? e?.name ?? "erreur",
      // Jamais le message brut : il contient l'URL, donc le mot de passe.
      erreur:
        "La connexion applicative vers " +
        HOTE +
        ":" +
        PORT_HOTE +
        " a échoué (" +
        (e?.code ?? e?.name ?? "erreur") +
        ").",
    };
  }
}

/**
 * LE POINT D'ENTRÉE — garantit la chaîne complète démon → conteneur → prêt →
 * connexion applicative. Rend un diagnostic structuré ; ne fait JAMAIS
 * `process.exit` (c'est le rôle de l'appelant de décider du refus).
 */
export async function garantirBaseLocale(url, { budgetDemonMs, budgetPretMs } = {}) {
  const demon = await attendreDemon(budgetDemonMs);
  if (!demon.ok) {
    return { ok: false, etape: "demon-docker", ...demon };
  }
  console.log("[base-locale] démon Docker joignable.");

  const conteneur = await assurerConteneur();
  if (!conteneur.ok) {
    return { ok: false, etape: "conteneur", ...conteneur };
  }

  const pret = await attendrePret(budgetPretMs);
  if (!pret.ok) {
    return { ok: false, etape: "pret", ...pret };
  }
  console.log("[base-locale] PostgreSQL prêt (pg_isready).");

  const sonde = await sondeApplicative(url);
  if (!sonde.ok) {
    return { ok: false, etape: "connexion-applicative", ...sonde };
  }
  console.log("[base-locale] connexion applicative vérifiée (mindcare_app).");

  return { ok: true };
}
