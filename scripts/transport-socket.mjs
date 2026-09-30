/**
 * transport-socket — M07 R3-P3 · transport superuser local PARTAGÉ.
 *
 * Contexte : `MINDCARE_ADMIN_DATABASE_URL` n'existe pas (vérifié : `.env`
 * n'expose que `MINDCARE_DATABASE_URL`, 42501 en écriture). Les écritures de
 * staging passent donc par le socket superuser local (`docker exec mc-p3`,
 * `ON_ERROR_STOP=1`), avec statements volumineux par FICHIER (pas de limite
 * de ligne de commande, pas de troncature — incident R3 : base64 coupé).
 *
 * Discipline : interpolation via `lierParams` (une passe, testée) + preuve
 * par `RETURNING` côté appelant (identité + cardinalité). L'exécuteur est
 * injectable (`executer`) pour tests sans docker. Zéro secret, zéro PII.
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { lierParams } from "./remplir-embeddings-sql.mjs";

export const CONTENEUR_DB = "mc-p3";
export const BASE_DB = "mindcare";
export const ROLE_DB = "postgres";

/**
 * Exécute un script : fichier + `psql -f` si volumineux (défaut > 8000
 * car.), `-c` sinon. Nettoie `/tmp/r3-lot.sql` en finally. Retourne stdout.
 * Toute erreur docker/psql throw (ON_ERROR_STOP : échec fermé).
 */
export function execSocket(racine, script, options = {}) {
  const {
    executer = execFileSync,
    parFichier = script.length > 8000,
    fichierHost = join(racine, "knowledge", ".lot-socket.sql"),
    fichierConteneur = "/tmp/r3-lot.sql",
  } = options;
  const base = ["exec", CONTENEUR_DB, "psql", "-U", ROLE_DB, "-d", BASE_DB, "-v", "ON_ERROR_STOP=1", "-qAt"];
  if (!parFichier) {
    return executer("docker", [...base, "-c", script], { cwd: racine, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  }
  writeFileSync(fichierHost, script + "\n", "utf8");
  executer("docker", ["cp", fichierHost, `${CONTENEUR_DB}:${fichierConteneur}`], { cwd: racine });
  try {
    return executer("docker", [...base, "-f", fichierConteneur], {
      cwd: racine, encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
    });
  } finally {
    try {
      executer("docker", ["exec", CONTENEUR_DB, "rm", fichierConteneur], { cwd: racine });
    } catch {
      /* nettoyage best-effort */
    }
  }
}

/**
 * Requête `{texte, params}` → lignes brutes (`-qAt`, séparateur `|`).
 * Interpolation `lierParams` (throw si $N hors borne — jamais de résiduel).
 */
export function lignesSocket(racine, requete, options = {}) {
  const liee = lierParams(requete.texte, requete.params);
  const sortie = execSocket(racine, liee, options).trim();
  return sortie === "" ? [] : sortie.split("\n");
}
