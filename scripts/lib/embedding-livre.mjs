/**
 * `embedding-livre.mjs` — le chargeur d'embedding des outils de livre.
 *
 * ═══ CE QUE C'EST ═══
 * Le SEUL endroit où un script d'évaluation ou de backfill charge un modèle
 * ONNX pour les livres : vérification du manifeste SHA-256, tokenizer,
 * session CPU, troncature, pooling moyen pondéré par le masque, L2.
 *
 * ═══ CE QUE CE N'EST PAS ═══
 *   · Pas le runtime de production : celui-ci vit dans
 *     `src/server/knowledge/vecteur-production.ts` et reste fail-closed.
 *   · Pas un téléchargement : le dossier doit déjà exister (voir
 *     `scripts/telecharger-modele-book.mjs`), avec son `manifeste.json`.
 *   · Pas un juge de qualité : il rend des vecteurs, rien de plus.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Vérifie chaque fichier du manifeste avant tout chargement. */
export function verifierManifeste(dossier) {
  const chemin = join(dossier, "manifeste.json");
  if (!existsSync(chemin)) throw new Error(`manifeste absent : ${chemin}`);
  const manifeste = JSON.parse(readFileSync(chemin, "utf8"));
  for (const [nom, attendu] of Object.entries(manifeste.fichiers ?? {})) {
    const fichier = join(dossier, nom);
    if (!existsSync(fichier)) throw new Error(`artefact manquant : ${nom}`);
    const observe = createHash("sha256").update(readFileSync(fichier)).digest("hex");
    if (observe !== attendu.sha256) throw new Error(`empreinte invalide : ${nom}`);
  }
  return manifeste;
}

const PREFIXES = {
  "e5-small": { requete: "query: ", passage: "passage: " },
  "e5-small-int8": { requete: "query: ", passage: "passage: " },
  "horizon-small": { requete: "", passage: "" },
};

/**
 * Charge le modèle et rend `{ embed, dimensions, prefixes }`. `embed` prend un
 * tableau de textes DÉJÀ préfixés par l'appelant ? Non : il applique lui-même
 * le préfixe de la carte (`query:`/`passage:`), pour qu'aucun appelant ne
 * puisse oublier la convention du modèle.
 */
export async function chargerEmbeddeur({ dossier, slug, maxTokens = 128, threads = 2 }) {
  const manifeste = verifierManifeste(dossier);
  const dimensions = manifeste.dimensions;
  const prefixes = PREFIXES[slug] ?? { requete: "", passage: "" };
  const ort = await import("onnxruntime-node");
  const { Tokenizer } = await import("@huggingface/tokenizers");
  const tokenizer = new Tokenizer(
    JSON.parse(readFileSync(join(dossier, "tokenizer.json"), "utf8")),
    JSON.parse(readFileSync(join(dossier, "tokenizer_config.json"), "utf8")),
  );
  const session = await ort.InferenceSession.create(join(dossier, "model.onnx"),
    { intraOpNumThreads: threads, executionProviders: ["cpu"], graphOptimizationLevel: "all" });
  const sortieNom = session.outputNames.includes("sentence_embedding") ? "sentence_embedding" : session.outputNames[0];
  const troisEntrees = session.inputNames.includes("token_type_ids");

  const encoder = (textes) => {
    const tronques = textes.map((texte) => {
      const enc = tokenizer.encode(texte);
      let ids = [...enc.ids];
      let masque = [...enc.attention_mask];
      if (ids.length > maxTokens) {
        const dernier = ids[ids.length - 1] ?? 0;
        const dernierMasque = masque[masque.length - 1] ?? 1;
        ids = [...ids.slice(0, maxTokens - 1), dernier];
        masque = [...masque.slice(0, maxTokens - 1), dernierMasque];
      }
      return { ids, masque };
    });
    let longueur = 0;
    for (const t of tronques) if (t.ids.length > longueur) longueur = t.ids.length;
    const n = tronques.length;
    const ids = new BigInt64Array(n * longueur);
    const masque = new BigInt64Array(n * longueur);
    const types = new BigInt64Array(n * longueur);
    tronques.forEach((t, i) => {
      for (let j = 0; j < longueur; j++) {
        ids[i * longueur + j] = BigInt(t.ids[j] ?? 0);
        masque[i * longueur + j] = BigInt(t.masque[j] ?? 0);
      }
    });
    return { ids, masque, types, n, longueur };
  };

  const moyenner = (data, n, longueur, masque) => {
    const sortie = [];
    for (let i = 0; i < n; i++) {
      const vecteur = new Float64Array(dimensions);
      let total = 0;
      for (let j = 0; j < longueur; j++) {
        const poids = Number(masque[i * longueur + j]);
        if (poids === 0) continue;
        total += poids;
        for (let d = 0; d < dimensions; d++) vecteur[d] += data[(i * longueur + j) * dimensions + d] * poids;
      }
      const norme = Math.sqrt(vecteur.reduce((s, v) => s + v * v, 0));
      if (!(norme > 0) || !Number.isFinite(norme)) throw new Error("vecteur nul ou non fini");
      sortie.push(Float32Array.from(vecteur, (v) => v / (total * norme)));
    }
    return sortie;
  };

  /** `mode` = "passage" | "requete". Rend un vecteur par texte. */
  const embed = async (textes, mode = "passage") => {
    if (textes.length === 0) return [];
    const prefixe = mode === "requete" ? prefixes.requete : prefixes.passage;
    const enc = encoder(textes.map((texte) => `${prefixe}${texte}`));
    const entrees = {
      input_ids: new ort.Tensor("int64", enc.ids, [enc.n, enc.longueur]),
      attention_mask: new ort.Tensor("int64", enc.masque, [enc.n, enc.longueur]),
    };
    if (troisEntrees) entrees.token_type_ids = new ort.Tensor("int64", enc.types, [enc.n, enc.longueur]);
    const resultat = await session.run(entrees);
    const tete = resultat[sortieNom];
    const dims = tete.dims;
    const dimension = dims[dims.length - 1];
    if (dimension !== dimensions) throw new Error(`dimension ${dimension} ≠ manifeste ${dimensions}`);
    if (dims.length === 3) return moyenner(tete.data, enc.n, enc.longueur, enc.masque);
    return Array.from({ length: enc.n }, (_, i) => Float32Array.from(tete.data.slice(i * dimension, (i + 1) * dimension)));
  };

  return { embed, dimensions, manifeste, prefixes };
}

/** Littéral pgvector déterministe, refusant tout composant non fini. */
export function vecteurPg(vecteur) {
  const morceaux = [];
  for (const composante of vecteur) {
    if (typeof composante !== "number" || !Number.isFinite(composante)) throw new Error("composante non finie");
    morceaux.push(String(composante));
  }
  return `[${morceaux.join(",")}]`;
}
