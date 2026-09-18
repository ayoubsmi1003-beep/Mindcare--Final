/**
 * M09 reliquat LOT1 — contrat statique de `097_live_runs.sql` (hors-ligne, sans base).
 *
 * ═══ CE QUI EST EPROUVE ═══
 * La migration miroir de 094 existe et porte : les trois tables
 * (runs/calls/proofs), RLS ENABLE+FORCE, proprietaire app_gatekeeper,
 * search_path fige, triggers trg_audit, CHECK hexadecimaux, les trois portes
 * de lecture/purge/stats, la retention 12 mois, et AUCUN champ patient
 * (noms, ids bruts, textes, args/resultats d'outils, snapshots, extraits).
 *
 * ═══ CE QUI NE L'EST PAS ICI ═══
 * Le comportement RLS reel (eprouve contre la base locale : voir
 * `scripts/checkpoint-m09-097.sql`), l'application operateur, la qualite live.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Racine du depot : deux niveaux au-dessus de tests/unit.
const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CHEMIN_097 = join(RACINE, "supabase", "migrations", "097_live_runs.sql");

function lire097(): string {
  return readFileSync(CHEMIN_097, "utf8");
}

/** Corps sans les commentaires `--` : les interdits n'y sont nommes que pour dire JAMAIS. */
function corpsSansCommentaires(sql: string): string {
  const sansCommentaires = sql
    .split("\n")
    .filter((ligne) => !ligne.trimStart().startsWith("--"))
    .join("\n")
    .toLowerCase();
  // `nb_snapshots` / `nbSnapshots` sont des compteurs bornes (>= 0), pas des
  // contenus : meme doctrine que les compteurs 094. On neutralise les
  // identifiants avant le balayage pour ne pas confondre les compteurs avec
  // des snapshots stockes.
  return sansCommentaires
    .replaceAll("nb_snapshots", "nb_compteur_contexte")
    .replaceAll("nbsnapshots", "nb_compteur_contexte");
}

describe("097 existe et nomme sa version", () => {
  it("le fichier existe et n'est pas vide", () => {
    expect(existsSync(CHEMIN_097)).toBe(true);
    expect(lire097().trim().length).toBeGreaterThan(0);
  });

  it("trace sa version dans schema_migrations", () => {
    expect(lire097()).toContain("097_live_runs");
  });
});

describe("097 : les trois tables, et elles seules", () => {
  it("cree ai_live_runs, ai_live_calls, ai_live_proofs", () => {
    const sql = lire097();
    expect(sql).toContain("CREATE TABLE app.ai_live_runs");
    expect(sql).toContain("CREATE TABLE app.ai_live_calls");
    expect(sql).toContain("CREATE TABLE app.ai_live_proofs");
  });

  it("ne modifie aucune table existante (pas d'ALTER hors CREATE POLICY/TRIGGER/INDEX)", () => {
    const corps = corpsSansCommentaires(lire097());
    expect(corps).not.toContain("alter table app.ai_replay");
  });
});

describe("097 : verrouillage RLS et propriete (motif 094)", () => {
  it("RLS ENABLE + FORCE sur les trois tables", () => {
    const sql = lire097();
    for (const table of ["ai_live_runs", "ai_live_calls", "ai_live_proofs"]) {
      expect(sql).toContain(`ALTER TABLE app.${table} ENABLE ROW LEVEL SECURITY`);
      expect(sql).toContain(`ALTER TABLE app.${table} FORCE  ROW LEVEL SECURITY`);
    }
  });

  it("portes DEFINER possedees par app_gatekeeper, search_path fige", () => {
    const sql = lire097();
    expect(sql).toContain("OWNER TO app_gatekeeper");
    expect(sql).toContain("SET search_path = app, audit, pg_catalog");
  });

  it("triggers d'audit sur les trois tables (motif 013/058)", () => {
    const sql = lire097();
    expect(sql.match(/CREATE TRIGGER trg_audit/g)?.length).toBe(3);
  });

  it("revocation large, grants etroits, retrait du privilege de transfert", () => {
    const sql = lire097();
    expect(sql).toContain("REVOKE ALL ON app.ai_live_runs");
    expect(sql).toContain("GRANT SELECT ON app.ai_live_runs");
    expect(sql).toContain("REVOKE CREATE ON SCHEMA app FROM app_gatekeeper");
  });
});

describe("097 : CHECK hexadecimaux (l'autorite est la base, pas le JS)", () => {
  it("exige sha256 64-hex et empreintes 8-hex", () => {
    const sql = lire097();
    expect(sql).toContain("^[0-9a-f]{64}$");
    expect(sql).toContain("^[0-9a-f]{8}$");
  });

  it("ferme les enums chemin/verdict/famille", () => {
    const sql = lire097();
    expect(sql).toContain("'connaissance'");
    expect(sql).toContain("'m09-live-v2'");
  });
});

describe("097 : les trois portes", () => {
  it("expose get_live_history, purger_lives, get_observability_stats", () => {
    const sql = lire097();
    expect(sql).toContain("app.get_live_history");
    expect(sql).toContain("app.purger_lives");
    expect(sql).toContain("app.get_observability_stats");
  });

  it("purger_lives sans grant applicatif (operateur seul)", () => {
    const corps = corpsSansCommentaires(lire097());
    expect(corps).not.toMatch(/grant execute on function app\.purger_lives/i);
  });

  it("retention 12 mois par defaut, bornes de purge", () => {
    const sql = lire097();
    expect(sql).toContain("12 months");
  });
});

describe("097 : aucun champ patient, par construction", () => {
  const INTERDITS = [
    "extrait",
    "tool_args",
    "patient_id",
    "conversation_id",
    "snapshot",
    "ancre",
    "mention",
    "prompt_text",
    "reponse_modele",
    "contenu_clinique",
  ];

  for (const mot of INTERDITS) {
    it(`le corps SQL ne porte jamais « ${mot} »`, () => {
      expect(corpsSansCommentaires(lire097())).not.toContain(mot);
    });
  }
});
