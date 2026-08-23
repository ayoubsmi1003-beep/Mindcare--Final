/**
 * dburl.mjs — portage FIDÈLE de `scripts/lib/dburl.sh` pour PowerShell/Node.
 *
 * POURQUOI CE FICHIER EXISTE : le shell `bash` de ce poste est WSL SANS
 * intégration Docker Desktop (piège déjà payé, STATE V9) ; les scripts .sh qui
 * appellent `docker run postgres:15` ne peuvent donc pas être exécutés tels
 * quels depuis la session. Ce module rejoue EXACTEMENT la même résolution :
 *   - lecture de la PREMIÈRE ligne `DATABASE_URL=` de `.env` (jamais `source`) ;
 *   - suppression de CR/LF et des espaces d'encadrement, des guillemets ;
 *   - encodage du mot de passe sur le DERNIER `@` (un hôte n'en contient pas),
 *     sans ré-encoder un `%xx` existant ;
 *   - refus de la connexion DIRECTE (`@db.<ref>.supabase.co`, IPv6 seul) ;
 *   - le secret n'est JAMAIS retourné en clair à l'appelant : seules deux
 *     fonctions sûres sont exportées (hôte seul, exécution psql Docker).
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export function lireDatabaseUrl() {
  const envBrut = readFileSync(path.join(RACINE, ".env"), "utf8");
  let url = "";
  for (const ligne of envBrut.split(/\r?\n/)) {
    const m = /^DATABASE_URL=(.*)$/.exec(ligne);
    if (m !== null) {
      url = m[1];
      break;
    }
  }
  url = url.replace(/[\r\n]/g, "").trim();
  url = url.replace(/^"/, "").replace(/"$/, "").replace(/^'/, "").replace(/'$/, "");
  return encoderMotDePasse(url);
}

function encoderMotDePasse(url) {
  if (!/^postgres(ql)?:\/\/[^/]*@/.test(url)) return url;
  const scheme = url.slice(0, url.indexOf("://"));
  const reste = url.slice(scheme.length + 3);
  const posAt = reste.lastIndexOf("@");
  if (posAt < 0) return url;
  const creds = reste.slice(0, posAt);
  const queue = reste.slice(posAt + 1);
  const posDeux = creds.indexOf(":");
  if (posDeux < 0) return url;
  const user = creds.slice(0, posDeux);
  const pass = creds.slice(posDeux + 1);
  let enc = pass;
  if (!/%[0-9A-Fa-f][0-9A-Fa-f]/.test(pass)) {
    enc = pass
      .replaceAll("%", "%25")
      .replaceAll("#", "%23")
      .replaceAll("[", "%5B")
      .replaceAll("]", "%5D")
      .replaceAll("/", "%2F")
      .replaceAll("?", "%3F")
      .replaceAll("&", "%26")
      .replaceAll("@", "%40")
      .replaceAll(":", "%3A")
      .replaceAll(" ", "%20");
  }
  return `${scheme}://${user}:${enc}@${queue}`;
}

/** Hôte SEUL — la seule partie de l'URL autorisée à s'afficher. */
export function hoteSeul(url) {
  const m = /@([^:/?]+)/.exec(url);
  return m?.[1] ?? "(hôte illisible)";
}

function estDirecte(url) {
  return /@db\.[a-z0-9]+\.supabase\.co/.test(url);
}

/**
 * Exécute psql dans `postgres:15` avec l'URL passée par l'ENVIRONNEMENT du
 * conteneur (-e PGURL sans valeur : jamais sur une ligne de commande ni dans
 * un texte affiché). Rend {rc, out}. L'appelant n'imprime que ce qu'il juge
 * sûr — jamais `out` brut quand il peut porter un contexte d'erreur.
 */
export function psql(sql, { silenceSortie = false, vars = {} } = {}) {
  const url = lireDatabaseUrl();
  if (url === "") {
    return { rc: 2, out: "DATABASE_URL introuvable dans .env" };
  }
  if (estDirecte(url)) {
    return {
      rc: 2,
      out:
        "DATABASE_URL utilise la connexion DIRECTE (IPv6 seul). " +
        "Prendre la chaîne du SESSION POOLER (scripts/lib/dburl.sh §dburl_direct_advice).",
    };
  }
  // Piège DNS flottant : si MC_PIN_HOST/MC_PIN_IP sont posés, l'hôte est
  // épinglé dans le conteneur (`--add-host`) — méthode documentée en STATE.
  const pinHost = process.env["MC_PIN_HOST"] ?? "";
  const pinIp = process.env["MC_PIN_IP"] ?? "";
  const epinglage =
    pinHost !== "" && pinIp !== "" ? ["--add-host", `${pinHost}:${pinIp}`] : [];
  // `-e NOM` sans valeur : la variable est reprise de l'environnement du
  // processus hôte vers le conteneur, sans apparaître en argument.
  const passeVars = Object.keys(vars).flatMap((nom) => ["-e", nom]);
  const res = spawnSync(
    "docker",
    [
      "run", "--rm", "-i", "-e", "PGURL", ...epinglage, ...passeVars,
      "postgres:15", "sh", "-c", 'psql "$PGURL" -qtAX -v ON_ERROR_STOP=1',
    ],
    { input: sql, encoding: "utf8", timeout: 120_000, env: { ...process.env, PGURL: url } },
  );
  const out = `${res.stdout ?? ""}${res.stderr ?? ""}`.trim();
  return {
    rc: res.status ?? (res.error !== null ? 3 : 1),
    out: silenceSortie ? `(sortie masquée, rc=${res.status})` : out,
  };
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const url = lireDatabaseUrl();
  if (url === "") {
    console.log("ROUGE — DATABASE_URL introuvable.");
    process.exit(1);
  }
  if (estDirecte(url)) {
    console.log("ROUGE — connexion DIRECTE détectée. Voir scripts/lib/dburl.sh.");
    process.exit(1);
  }
  console.log(`Cible : ${hoteSeul(url)} (identifiants non affichés)`);
}
