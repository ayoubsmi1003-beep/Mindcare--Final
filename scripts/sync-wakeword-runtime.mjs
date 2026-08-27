/**
 * sync-wakeword-runtime — recopie le runtime ONNX dans `public/wakeword/ort/`.
 *
 *   node scripts/sync-wakeword-runtime.mjs          (appelé par `postinstall`)
 *   node scripts/sync-wakeword-runtime.mjs --verifier   (ne copie rien)
 *
 * ═══ POURQUOI CE SCRIPT EXISTE ═══
 *
 * Les MODÈLES (`alexa.onnx`, `embedding_model.onnx`, `melspectrogram.onnx`) sont
 * suivis par git : ce sont des choix de produit, ils pèsent 3 Mio, et le mot de
 * réveil qu'ils portent est une décision, pas une dépendance.
 *
 * Le RUNTIME, lui, ne l'est pas : 41 Mio de binaires qui seraient réécrits à
 * chaque montée de version d'`onnxruntime-web`, pour une valeur nulle — c'est
 * exactement le contenu de `node_modules`. Il se régénère donc, et il se
 * régénère AUTOMATIQUEMENT, parce qu'une étape manuelle est une étape qu'on
 * oublie.
 *
 * ⚠️ CE QUE CE SCRIPT EMPÊCHE DE SE REPRODUIRE, ET ÇA S'EST PRODUIT.
 *
 * Le 2026-08-27, `public/wakeword/ort/` contenait la paire
 * `ort-wasm-simd-threaded.{mjs,wasm}` — mais `import("onnxruntime-web")` charge
 * la variante **jsep** (celle qui sait parler WebGPU), et elle seule. Résultat :
 *     GET /wakeword/ort/ort-wasm-simd-threaded.jsep.mjs → 404
 * Le mot de réveil n'a JAMAIS pu s'armer, sur aucun poste, depuis toujours.
 * Personne ne l'a vu parce que `eval-reveil-pipeline` exécute l'ONNX sous Node,
 * où le chargement ne passe pas du tout par là — et qu'il était vert.
 *
 * On ne recopie donc pas « les fichiers qu'on croit utiles » : on recopie LES
 * QUATRE VARIANTES, et on ÉCHOUE bruyamment si l'une manque à la source.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CIBLE = path.join(RACINE, "public", "wakeword", "ort");
const VERIFIER = process.argv.includes("--verifier");

/**
 * Les deux paires. La `jsep` est celle que charge réellement le navigateur ; la
 * simple reste pour un repli sans WebGPU. Les `.mjs` sont les chargeurs, les
 * `.wasm` le moteur — un chargeur sans son moteur échoue au premier mot.
 */
const REQUIS = [
  "ort-wasm-simd-threaded.mjs",
  "ort-wasm-simd-threaded.wasm",
  "ort-wasm-simd-threaded.jsep.mjs",
  "ort-wasm-simd-threaded.jsep.wasm",
];

/** Trouve `dist/` d'onnxruntime-web, quelle que soit la disposition de pnpm. */
function trouverDist() {
  const direct = path.join(RACINE, "node_modules", "onnxruntime-web", "dist");
  if (existsSync(direct)) return direct;
  const magasin = path.join(RACINE, "node_modules", ".pnpm");
  if (!existsSync(magasin)) return null;
  for (const e of readdirSync(magasin)) {
    if (!e.startsWith("onnxruntime-web@")) continue;
    const p = path.join(magasin, e, "node_modules", "onnxruntime-web", "dist");
    if (existsSync(p)) return p;
  }
  return null;
}

const dist = trouverDist();
if (dist === null) {
  // Pas une panne : `postinstall` peut tourner avant que tout soit en place.
  // On le DIT quand même — un silence ici redonnerait le 404 de départ.
  console.log("wakeword : onnxruntime-web introuvable, runtime non synchronisé.");
  process.exit(0);
}

mkdirSync(CIBLE, { recursive: true });

let copies = 0;
let aJour = 0;
const manquants = [];

for (const nom of REQUIS) {
  const source = path.join(dist, nom);
  if (!existsSync(source)) {
    manquants.push(nom);
    continue;
  }
  const destination = path.join(CIBLE, nom);
  // Comparaison par taille : ces fichiers ne changent qu'avec la version du
  // paquet, et un hachage de 27 Mio à chaque install coûterait plus qu'il ne
  // rapporte.
  const identique =
    existsSync(destination) && statSync(destination).size === statSync(source).size;
  if (identique) {
    aJour += 1;
    continue;
  }
  if (!VERIFIER) copyFileSync(source, destination);
  copies += 1;
  console.log(`wakeword : ${VERIFIER ? "à copier" : "copié"} ${nom}`);
}

if (manquants.length > 0) {
  // ⚠️ ON ÉCHOUE. Une variante absente de la source signifie que le paquet a
  // changé de disposition ; continuer en silence rendrait un `public/` qui a
  // l'air complet et un mot de réveil qui ne s'arme pas.
  console.error(`ROUGE — variantes absentes d'onnxruntime-web : ${manquants.join(", ")}`);
  console.error("       Le mot de réveil ne pourra pas s'armer. Vérifier la version du paquet.");
  process.exit(1);
}

if (VERIFIER) {
  console.log(
    copies === 0
      ? `wakeword : runtime à jour (${aJour}/${REQUIS.length}).`
      : `wakeword : ${copies} fichier(s) à synchroniser — lancer sans --verifier.`,
  );
  process.exit(copies === 0 ? 0 : 1);
}

console.log(`wakeword : runtime prêt (${copies} copié(s), ${aJour} déjà à jour).`);
