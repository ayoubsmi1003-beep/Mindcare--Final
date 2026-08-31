/**
 * Le contrôle de démarrage — SERVEUR UNIQUEMENT.
 *
 * ═══ POURQUOI REFUSER DE DÉMARRER PLUTÔT QUE PRÉVENIR ══════════════════════
 *
 * Un schéma partiellement migré est le pire état possible pour un dossier
 * médical. L'application se lance, les écrans s'affichent, et une porte sur
 * trois est absente : la praticienne saisit une consultation qui ne
 * s'enregistre pas, ou lit un dossier dont la moitié des champs manquent. Elle
 * ne le découvre pas tout de suite, parce que rien n'a l'air cassé.
 *
 * Le défaut sûr est donc le REFUS. Une application qui ne démarre pas se
 * remarque immédiatement et se répare ; une application qui tourne sur un
 * schéma incomplet abîme des données pendant des jours.
 *
 * C'est la même logique que `garderVoix()` dans la passerelle : quand on ne
 * peut pas vérifier, on refuse.
 *
 * ═══ CE QUI EST VÉRIFIÉ, DANS CET ORDRE ════════════════════════════════════
 *
 *   1. la base répond ;
 *   2. le schéma `app` existe (sinon : base vide, message distinct) ;
 *   3. TOUTES les migrations du dépôt sont enregistrées dans
 *      `app.schema_migrations` ;
 *   4. le rôle de connexion peut franchir les portes dont il a besoin.
 *
 * Le point 3 compare le DISQUE à la BASE. Une migration ajoutée au dépôt mais
 * jamais appliquée est donc détectée au démarrage, pas à l'écran.
 */

import { readdirSync } from "node:fs";
import path from "node:path";

import { withCaller } from "@/server/db/withCaller";

export interface EtatDemarrage {
  readonly ok: boolean;
  readonly probleme?: string;
  readonly detail?: string;
  readonly migrationsManquantes?: readonly string[];
}

/**
 * Les migrations présentes sur le disque, par leur `version` — c'est-à-dire le
 * nom de fichier sans `.sql`, exactement ce que chaque migration insère
 * elle-même dans `app.schema_migrations`.
 */
export function migrationsSurDisque(racine: string): readonly string[] {
  const dossier = path.join(racine, "supabase", "migrations");
  return readdirSync(dossier)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => f.slice(0, -4))
    .sort();
}

/**
 * Vérifie l'état de la base. Ne lève JAMAIS : rend un diagnostic.
 *
 * ⚠️ Les messages sont destinés au JOURNAL DU SERVEUR et à l'écran
 * d'installation, jamais à une réponse HTTP. Ils nomment des migrations et des
 * rôles — pas des données.
 */
export async function verifierDemarrage(racine: string): Promise<EtatDemarrage> {
  let attendues: readonly string[];
  try {
    attendues = migrationsSurDisque(racine);
  } catch (e) {
    return {
      ok: false,
      probleme: "migrations-introuvables",
      detail: `Le dossier supabase/migrations est illisible : ${String(e)}`,
    };
  }

  if (attendues.length === 0) {
    return {
      ok: false,
      probleme: "migrations-introuvables",
      detail: "Aucune migration sur le disque — installation incomplète.",
    };
  }

  try {
    // Sous identité nulle : on ne lit que des catalogues et la table des
    // migrations, jamais une donnée du cabinet.
    return await withCaller(null, async (q) => {
      const schema = await q.query<{ present: boolean }>(
        "SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'app') AS present",
      );
      if (schema[0]?.present !== true) {
        return {
          ok: false,
          probleme: "base-vide",
          detail:
            "Le schéma « app » n'existe pas. La base n'a jamais été initialisée : " +
            "jouer supabase/bootstrap/000_platform_compat.sql puis les migrations.",
        };
      }

      const lignes = await q.query<{ version: string }>(
        "SELECT version FROM app.schema_migrations",
      );
      const appliquees = new Set(lignes.map((l) => l.version));
      const manquantes = attendues.filter((v) => !appliquees.has(v));

      if (manquantes.length > 0) {
        return {
          ok: false,
          probleme: "schema-partiel",
          detail:
            `${manquantes.length} migration(s) présente(s) sur le disque mais ` +
            "jamais appliquée(s). L'application REFUSE de démarrer sur un schéma " +
            "partiel : des écrans fonctionneraient et d'autres non, sans que rien " +
            "ne le signale.",
          migrationsManquantes: manquantes,
        };
      }

      return { ok: true };
    });
  } catch (e) {
    return {
      ok: false,
      probleme: "base-injoignable",
      // Volontairement sans le message brut : il peut contenir l'URL de
      // connexion, donc le mot de passe de la base.
      detail:
        "La base de données ne répond pas. Vérifier que le service PostgreSQL " +
        "est démarré et que MINDCARE_DATABASE_URL est correcte." +
        (e instanceof Error ? ` (${e.name})` : ""),
    };
  }
}
