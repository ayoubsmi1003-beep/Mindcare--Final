#!/usr/bin/env node
/**
 * telecharger-modele-book — provisionne UN modèle d'embedding de livre, hors dépôt.
 *
 *   node scripts/telecharger-modele-book.mjs --modele e5-small [--force]
 *   node scripts/telecharger-modele-book.mjs --modele horizon-small [--force]
 *
 * ═══ CE QUE CE SCRIPT FAIT ═══
 * Télécharge les artefacts ONNX + tokenizer d'un candidat dans
 * `%LOCALAPPDATA%/MindCare/modeles/<slug>/`, vérifie la taille, calcule le
 * SHA-256 de chaque fichier et l'écrit dans `manifeste.json`. Le manifeste est
 * la matière première de la recette épinglée : rien n'est chargé en production
 * sans ces empreintes.
 *
 * ═══ CE QU'IL NE FAIT PAS ═══
 *   · Aucune écriture en base, aucune activation, aucun embedding.
 *   · Aucun téléchargement en production : le runtime lit le dossier local et
 *     refuse tout fichier dont l'empreinte ne correspond pas.
 *   · Aucun modèle « au hasard » : chaque candidat est déclaré ici avec sa
 *     révision Hugging Face exacte.
 */
import { createHash } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readFileSync, rm, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const CANDIDATS = {
  "e5-small": {
    modele: "intfloat/multilingual-e5-small",
    revision: "614241f622f53c4eeff9890bdc4f31cfecc418b3",
    dimensions: 384,
    licence: "MIT",
    fichiers: [
      { distant: "onnx/model.onnx", local: "model.onnx" },
      { distant: "onnx/tokenizer.json", local: "tokenizer.json" },
      { distant: "onnx/tokenizer_config.json", local: "tokenizer_config.json" },
      { distant: "onnx/special_tokens_map.json", local: "special_tokens_map.json" },
      { distant: "config.json", local: "config.json" },
    ],
  },
  "e5-small-int8": {
    modele: "intfloat/multilingual-e5-small",
    revision: "614241f622f53c4eeff9890bdc4f31cfecc418b3",
    dimensions: 384,
    licence: "MIT",
    fichiers: [
      { distant: "onnx/model_quint8_avx2.onnx", local: "model.onnx" },
      { distant: "onnx/tokenizer.json", local: "tokenizer.json" },
      { distant: "onnx/tokenizer_config.json", local: "tokenizer_config.json" },
      { distant: "onnx/special_tokens_map.json", local: "special_tokens_map.json" },
      { distant: "config.json", local: "config.json" },
    ],
  },
  "horizon-small": {
    modele: "Horizon-Labs/multilingual-embedding-small",
    revision: "6418071ac0a526fea6f72230390298d5e1a5c7b7",
    dimensions: 384,
    licence: "Apache-2.0",
    fichiers: [
      { distant: "onnx/model.onnx", local: "model.onnx" },
      { distant: "tokenizer.json", local: "tokenizer.json" },
      { distant: "tokenizer_config.json", local: "tokenizer_config.json" },
      { distant: "special_tokens_map.json", local: "special_tokens_map.json" },
      { distant: "config.json", local: "config.json" },
    ],
  },
  "mmarco-rerank": {
    modele: "cross-encoder/mmarco-mMiniLMv2-L12-H384-v1",
    revision: "1427fd652930e4ba29e8149678df786c240d8825",
    dimensions: 0,
    licence: "Apache-2.0",
    fichiers: [
      { distant: "onnx/model.onnx", local: "model.onnx" },
      { distant: "tokenizer.json", local: "tokenizer.json" },
      { distant: "tokenizer_config.json", local: "tokenizer_config.json" },
      { distant: "special_tokens_map.json", local: "special_tokens_map.json" },
      { distant: "config.json", local: "config.json" },
    ],
  },
};

const args = process.argv.slice(2);
const nom = args.includes("--modele") ? args[args.indexOf("--modele") + 1] : null;
const force = args.includes("--force");
const candidat = nom ? CANDIDATS[nom] : undefined;
if (!candidat) {
  console.error(`Modèle inconnu. Candidats : ${Object.keys(CANDIDATS).join(", ")}`);
  process.exit(1);
}
const base = process.env.LOCALAPPDATA ?? process.env.TEMP;
const dossier = resolve(base, "MindCare", "modeles", nom);
mkdirSync(dossier, { recursive: true });

const sha256 = (chemin) => {
  const hash = createHash("sha256");
  hash.update(readFileSync(chemin));
  return hash.digest("hex");
};

console.log(`Modèle ${candidat.modele} @ ${candidat.revision.slice(0, 12)} → ${dossier}`);
const manifeste = { modele: candidat.modele, revision: candidat.revision, dimensions: candidat.dimensions,
  licence: candidat.licence, fichiers: {}, telecharge_le: new Date().toISOString() };

for (const fichier of candidat.fichiers) {
  const cible = join(dossier, fichier.local);
  const url = `https://huggingface.co/${candidat.modele}/resolve/${candidat.revision}/${fichier.distant}`;
  if (existsSync(cible) && force) {
    await rm(cible, { force: true });
  }
  // Reprise sur incident réseau : on reprend à la taille déjà écrite (le
  // serveur HF accepte Range). 3 tentatives, puis échec explicite.
  let telecharge = false;
  for (let essai = 1; essai <= 3 && !telecharge; essai += 1) {
    try {
      const depart = existsSync(cible) ? statSync(cible).size : 0;
      const reponse = await fetch(url, {
        redirect: "follow",
        headers: depart > 0 ? { Range: `bytes=${depart}-` } : {},
      });
      if ((reponse.status !== 200 && reponse.status !== 206) || reponse.body === null) {
        throw new Error(`HTTP ${reponse.status}`);
      }
      if (depart > 0 && reponse.status === 200) {
        // Le serveur ignore Range : on recommence à zéro plutôt que d'ajouter.
        await rm(cible, { force: true });
      }
      const total = Number(reponse.headers.get("content-length") ?? 0);
      console.log(`  ↓ ${fichier.local} (essai ${essai}, +${(total / 1_048_576).toFixed(1)} Mo)`);
      await pipeline(Readable.fromWeb(reponse.body), createWriteStream(cible, { flags: depart > 0 && reponse.status === 206 ? "a" : "w" }));
      telecharge = true;
    } catch (erreur) {
      console.error(`  … ${fichier.local} essai ${essai} interrompu : ${String(erreur?.message ?? erreur).slice(0, 120)}`);
      if (essai === 3) {
        console.error(`  ROUGE ${fichier.local} : téléchargement impossible après 3 essais (partiel conservé pour reprise)`);
        process.exit(1);
      }
      await new Promise((resolve) => setTimeout(resolve, 2000 * essai));
    }
  }
  const taille = statSync(cible).size;
  manifeste.fichiers[fichier.local] = { octets: taille, sha256: sha256(cible) };
  console.log(`  ✓ ${fichier.local} — ${taille} o — ${manifeste.fichiers[fichier.local].sha256.slice(0, 16)}…`);
}

writeFileSync(join(dossier, "manifeste.json"), JSON.stringify(manifeste, null, 2));
console.log(`\nManifeste écrit : ${join(dossier, "manifeste.json")}`);
