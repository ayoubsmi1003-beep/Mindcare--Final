/**
 * M09 reliquat LOT5 — contrat statique de `099_listes_observabilite.sql` (hors-ligne, sans base).
 *
 * ═══ POURQUOI DES PORTES DE LISTE ═══
 * `get_live_history` / `get_replay_history` lisent UN run : sans liste,
 * l'écran d'inspection ne peut nommer aucun run (l'ingest operateur est
 * hors navigateur). Ces deux portes rendent les en-têtes seuls (champs
 * deja exposes par les portes d'historique, aucun champ nouveau),
 * bornees 1..100, plus recents d'abord. Lecture seule, meme RLS que
 * 094/097 (owner/practitioner, [] hors perimetre — une liste vide est la
 * reponse honnete dans tous les cas, jamais d'oracle).
 *
 * ═══ CE QUI EST EPROUVE ═══
 * Deux portes list_*, aucune table/policy/grant nouveaux, bornes, champs
 * fermes, aucun champ patient. La RLS est eprouvee en base (checkpoint
 * M09-097 §8).
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CHEMIN_099 = join(RACINE, "supabase", "migrations", "099_listes_observabilite.sql");

function lire099(): string {
  return readFileSync(CHEMIN_099, "utf8");
}

function corpsSansCommentaires(sql: string): string {
  return sql
    .split("\n")
    .filter((ligne) => !ligne.trimStart().startsWith("--"))
    .join("\n")
    .toLowerCase();
}

describe("099 existe et nomme sa version", () => {
  it("le fichier existe et trace sa version", () => {
    expect(existsSync(CHEMIN_099)).toBe(true);
    expect(lire099()).toContain("099_listes_observabilite");
  });
});

describe("099 : deux portes de liste, rien d'autre", () => {
  it("expose list_live_runs et list_replay_runs", () => {
    const corps = corpsSansCommentaires(lire099());
    expect(corps).toContain("create or replace function app.list_live_runs");
    expect(corps).toContain("create or replace function app.list_replay_runs");
  });

  it("ne cree ni table, ni policy, ni grant nouveau", () => {
    const corps = corpsSansCommentaires(lire099());
    expect(corps).not.toContain("create table");
    expect(corps).not.toContain("create policy");
    expect(corps).not.toContain("grant select on app.");
  });

  it("borne 1..100, plus recents d'abord", () => {
    const sql = lire099();
    expect(sql).toContain("100");
    expect(sql).toContain("DESC");
  });

  it("portes DEFINER possedees, search_path fige, execute aux seuls authentifies", () => {
    const sql = lire099();
    expect(sql).toContain("OWNER TO app_gatekeeper");
    expect(sql).toContain("SET search_path = app, audit, pg_catalog");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION app.list_live_runs");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION app.list_replay_runs");
  });
});

describe("099 : aucun champ nouveau, aucun champ patient", () => {
  const INTERDITS = [
    "extrait",
    "tool_args",
    "patient_id",
    "conversation_id",
    "ancre",
    "mention",
    "prompt_text",
    "reponse_modele",
    "contenu_clinique",
    "snapshot",
  ];

  for (const mot of INTERDITS) {
    it(`le corps SQL ne porte jamais « ${mot} »`, () => {
      // `nb_snapshots` / `nbSnapshots` : compteurs bornes, pas des contenus.
      const corps = corpsSansCommentaires(lire099())
        .replaceAll("nb_snapshots", "nb_x")
        .replaceAll("nbsnapshots", "nb_x");
      expect(corps).not.toContain(mot);
    });
  }
});
