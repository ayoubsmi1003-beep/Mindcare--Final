/**
 * embeddings-runtime — M07 R3 · socle partagé sonde + backfill (Node uniquement).
 *
 * Compile le sous-ensemble vivant (`server/knowledge`) vers `.eval-out/<nom>`
 * (git-ignoré, reconstruit à chaque run — même discipline que
 * `checkpoint-jarvis-couche.sh` + `reecrire-alias-eval.mjs`), charge les
 * binaires natifs (`onnxruntime-node`, `@huggingface/tokenizers`, imports
 * dynamiques : jamais dans le graphe statique), résout le dossier modèle.
 * Échec franc (throw) à chaque étape — les appelants traduisent en verdict.
 */

import { execFileSync } from "node:child_process";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/** Cache dev de la mesure R2 (repli dernier — l'explicite gagne toujours). */
export const CACHE_DEV_R2 =
  "C:\\Users\\ABCINF~1\\AppData\\Local\\Temp\\opencode\\r2bench-hf\\models--BAAI--bge-m3\\snapshots\\5617a9f61b028005a4858fdac845db406aefb181\\onnx";

/** Témoin Rust R2 (`ref-tokens.py`) : tête d'encodage FR, à l'octet près. */
export const TEMOIN_TETE_FR = [0, 59528, 437, 21, 3864, 18709, 8, 21];

/**
 * Compile un sous-ensemble vivant en CommonJS sous `.eval-out/<nom>/`.
 * `entree` défaut : `embeddings-local.ts` (+ dépendances suivies par tsc).
 * Détruit la sortie précédente AVANT (jamais de `.js` d'hier en cas d'échec —
 * même règle que le checkpoint). Retourne les modules chargés selon l'entrée :
 * toujours `local` + `embeddings` (connaissance), plus, si l'entrée est le
 * service, `service` + `db` (setDbPort).
 */
export async function compilerConnaissance(
  racine,
  nom,
  entree = "src/server/knowledge/embeddings-local.ts",
) {
  const sortie = join(racine, ".eval-out", nom);
  rmSync(sortie, { recursive: true, force: true });
  const tsconfig = join(racine, ".eval-out", `${nom}.tsconfig.json`);
  writeFileSync(
    tsconfig,
    JSON.stringify({
      compilerOptions: {
        target: "es2022",
        lib: ["es2022", "dom"],
        module: "commonjs",
        moduleResolution: "node",
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        noEmitOnError: true,
        outDir: `./${nom}`,
        rootDir: "../src",
        baseUrl: "..",
        paths: { "@/*": ["./src/*"] },
        types: ["node"],
      },
      include: [`../${entree}`, "../src/server/knowledge/embeddings-local.ts"],
    }),
  );
  try {
    execFileSync(
      process.execPath,
      [join(racine, "node_modules", "typescript", "bin", "tsc"), "-p", tsconfig],
      { cwd: racine, stdio: "pipe" },
    );
  } catch (err) {
    const stderr =
      err.stderr !== undefined
        ? String(err.stderr).slice(0, 2000)
        : String(err.message ?? err).slice(0, 2000);
    throw new Error(`compilation ${nom} : ${stderr}`);
  }
  writeFileSync(join(sortie, "package.json"), JSON.stringify({ type: "commonjs" }));
  execFileSync(process.execPath, [join(racine, "scripts", "reecrire-alias-eval.mjs"), sortie], {
    cwd: racine,
    stdio: "pipe",
  });
  const baseConnaissance = pathToFileURL(join(sortie, "server", "knowledge")).href;
  const local = await import(`${baseConnaissance}/embeddings-local.js`);
  const embeddings = await import(`${baseConnaissance}/embeddings.js`);
  if (entree === "src/services/connaissance-recherche.ts") {
    const baseServices = pathToFileURL(join(sortie, "services")).href;
    const service = await import(`${baseServices}/connaissance-recherche.js`);
    const db = await import(`${baseServices}/db/index.js`);
    return { sortie, local, embeddings, service, db };
  }
  return { sortie, local, embeddings };
}

/** Binaires natifs (postinstalls `allowBuilds`, cf. pnpm-workspace.yaml). */
export async function chargerBinaireNatif() {
  const ort = await import("onnxruntime-node");
  const { Tokenizer } = await import("@huggingface/tokenizers");
  return { ort, Tokenizer };
}

/**
 * Résolution prouvée : explicite d'abord (--dossier > env), puis
 * resources/models, puis cache dev. Explicite inexistant = throw (jamais de
 * repli silencieux) ; rien de viable = throw `modele-introuvable`.
 */
export function resoudreDossierProuve(local, recette, racine, explicite) {
  const chemin = explicite ?? "";
  if (chemin !== "" && !existsSync(chemin)) {
    throw new Error(`dossier explicite introuvable : ${chemin}`);
  }
  return local.resoudreDossierModele(
    {
      env: chemin,
      ressources: join(racine, "resources", "models", "bge-m3", String(recette.revision)),
      cache: CACHE_DEV_R2,
    },
    (p) => existsSync(p),
  );
}

/** Parité tokenizer : la tête FR doit égaler le témoin Rust à l'octet. */
export function verifierPariteTokens(local, tokenizer, texte) {
  const enc = local.encoderLot(tokenizer, [texte]);
  const tete = (enc.ids[0] ?? []).slice(0, 8);
  const ok = tete.length === 8 && tete.every((v, i) => v === TEMOIN_TETE_FR[i]);
  if (!ok) {
    throw new Error(`parite-tokens : tête=${tete.join(",")} attendu=${TEMOIN_TETE_FR.join(",")}`);
  }
}
