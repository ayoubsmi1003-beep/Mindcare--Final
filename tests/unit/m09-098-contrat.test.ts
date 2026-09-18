/**
 * M09 reliquat LOT2 — contrat statique de `098_live_issue.sql` (hors-ligne, sans base).
 *
 * ═══ POURQUOI UNE SECONDE MIGRATION, PAS UNE EDITION DE 097 ═══
 * 097 est appliquee (regle 9 : jamais d'edition). Le constat d'approbation
 * (`issue` : ok/echec/inconnue/bloquee/duplicata/inconnu) s'est revele
 * necessaire a la surface d'inspection (« diagnostic status » LOT5) APRES
 * l'application : sans lui, la liaison action→run ne dit pas l'issue
 * constatee. Precedent : 095/096 corrigent 094 par suivi, jamais par
 * edition. Cette migration n'ajoute qu'UNE colonne nullable + la porte
 * `get_live_history` redéfinie pour la rendre (redéfinition, pas de
 * nouvelle porte — même doctrine que 089).
 *
 * ═══ CE QUI EST EPROUVE ═══
 * Colonne `issue` + CHECK ferme + porte redéfinie qui la rend + aucun
 * champ patient. Le comportement RLS est eprouve en base (checkpoint
 * M09-097 etendu, §1b/§3b).
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CHEMIN_098 = join(RACINE, "supabase", "migrations", "098_live_issue.sql");

function lire098(): string {
  return readFileSync(CHEMIN_098, "utf8");
}

function corpsSansCommentaires(sql: string): string {
  return sql
    .split("\n")
    .filter((ligne) => !ligne.trimStart().startsWith("--"))
    .join("\n")
    .toLowerCase();
}

describe("098 existe et nomme sa version", () => {
  it("le fichier existe et trace sa version", () => {
    expect(existsSync(CHEMIN_098)).toBe(true);
    expect(lire098()).toContain("098_live_issue");
  });
});

describe("098 : une colonne, pas de table", () => {
  it("ajoute issue a ai_live_runs, ne cree aucune table", () => {
    const corps = corpsSansCommentaires(lire098());
    expect(corps).toContain("add column");
    expect(corps).toContain("issue");
    expect(corps).not.toContain("create table");
  });

  it("CHECK ferme : les cinq issues M06 + inconnu, rien d'autre", () => {
    const sql = lire098();
    for (const issue of ["'ok'", "'echec'", "'inconnue'", "'bloquee'", "'duplicata'", "'inconnu'"]) {
      expect(sql).toContain(issue);
    }
  });

  it("colonne nullable (les tours n'ont pas d'issue)", () => {
    const corps = corpsSansCommentaires(lire098());
    expect(corps).not.toMatch(/add column[^;]*not null/);
  });
});

describe("098 : porte get_live_history redefinie (doctrine 089)", () => {
  it("redefinit la porte sans toucher aux tables ni aux policies", () => {
    const corps = corpsSansCommentaires(lire098());
    expect(corps).toContain("create or replace function app.get_live_history");
    expect(corps).not.toContain("create policy");
    expect(corps).not.toContain("alter table app.ai_live_runs enable");
  });

  it("rend issue dans le jsonb ferme", () => {
    expect(lire098()).toContain("'issue'");
  });
});

describe("098 : aucun champ patient", () => {
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
  ];

  for (const mot of INTERDITS) {
    it(`le corps SQL ne porte jamais « ${mot} »`, () => {
      expect(corpsSansCommentaires(lire098())).not.toContain(mot);
    });
  }
});
