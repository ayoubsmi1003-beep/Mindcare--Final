/**
 * `embeddings-local.ts` — M07 R3 · le CÂBLAGE LOCAL BGE-M3 (serveur uniquement).
 *
 * ═══ CE QUE C'EST ═══
 * La partie PURE du runtime de production : résolution du dossier modèle
 * (env → resources → cache dev), vérification SHA-256 des artefacts, promotion
 * recette JSON → `ConfigFournisseurLocal` avec rejet de dérive, littéral
 * pgvector, découpage en lots. La session ONNX + le tokenizer sont branchés
 * par la fabrique d'inférence (R3-A, sonde dédiée) — jamais ici de `fetch`,
 * jamais de `pg`, jamais de réseau.
 *
 * ═══ CE QUE CE N'EST PAS ═══
 *   · Pas une inférence : `InferenceLocale` est CONSTRUITE ailleurs et injectée
 *     dans `FournisseurLocalOnnx` (`embeddings.ts`). Ici, que du déterminisme.
 *   · Pas une écriture : aucun accès base (règle `pg` → `pool.ts` seul).
 *   · Pas du navigateur : `node:crypto` — serveur Next / main Electron / scripts.
 */

import { createHash } from "node:crypto";

import { CHUNKER_VERSION } from "./decoupage";
import { DIMENSION_VECTEUR_PROD, type ConfigFournisseurLocal, type InferenceLocale, type ResultatEmbedding } from "./embeddings";

/** Les 3 artefacts suivis par la recette (noms exacts du snapshot HF). */
export const NOM_FICHIERS_MODELE = ["model.onnx", "model.onnx_data", "tokenizer.json"] as const;

/**
 * La recette GELÉE (miroir de `knowledge/recette-embedding-pinee.json`,
 * champs versionnés). `configLocaleDepuisRecette` refuse tout JSON qui
 * n'y correspond pas à l'octet logique près — jamais de coexistence.
 */
export const RECETTE_GELEE = {
  modele: "BAAI/bge-m3",
  version: "5617a9f61b028005a4858fdac845db406aefb181",
  dimensions: 1024,
  /** Tag versionné du R2 (le JSON porte la prose « l2 native (…) », assertée). */
  normalisation: "l2-native-tete-sentence-embedding-v1",
  marqueurNormalisationJson: "l2 native",
  instruction_requete: "",
  instruction_document: "",
  distance: "cosine",
  versionChunk: CHUNKER_VERSION,
} as const;

/** Candidats dossier modèle, dans l'ordre de priorité (env d'abord). */
export interface DossiersModeles {
  readonly env?: string;
  readonly ressources?: string;
  readonly cache?: string;
}

/**
 * Résout le dossier modèle : premier candidat renseigné qui existe.
 * `existe` est injecté (pureté testable ; la fabrique passe `existsSync`).
 * Aucun candidat viable → `modele-introuvable`, jamais de devinette.
 */
export function resoudreDossierModele(
  candidats: DossiersModeles,
  existe: (chemin: string) => boolean,
): string {
  for (const candidat of [candidats.env, candidats.ressources, candidats.cache]) {
    if (candidat !== undefined && candidat.trim() !== "" && existe(candidat)) {
      return candidat;
    }
  }
  throw new Error(
    "Recette locale introuvable : modele-introuvable (renseigner MINDCARE_BGE_M3_DIR ou peupler resources/models).",
  );
}

/**
 * Extrait les empreintes `{nom de fichier → sha256}` depuis les clés de la
 * recette (`model_onnx`, `model_onnx_data`, `tokenizer_json`). Clé absente ou
 * sha non hex-64 → rejet : on ne vérifie jamais un fichier sans référence.
 */
export function extraireEmpreintes(recette: unknown): Record<string, string> {
  if (typeof recette !== "object" || recette === null) {
    throw new Error("Recette locale illisible : recette-vide ou type inattendu.");
  }
  const bloc = (recette as Record<string, unknown>)["artifact_sha256"];
  if (typeof bloc !== "object" || bloc === null) {
    throw new Error("Recette locale illisible : recette-incomplete (artifact_sha256).");
  }
  const shas = bloc as Record<string, unknown>;
  const association: ReadonlyArray<readonly [cle: string, fichier: string]> = [
    ["model_onnx", "model.onnx"],
    ["model_onnx_data", "model.onnx_data"],
    ["tokenizer_json", "tokenizer.json"],
  ];
  const sortie: Record<string, string> = {};
  for (const [cle, fichier] of association) {
    const valeur = shas[cle];
    if (typeof valeur !== "string" || !/^[0-9a-f]{64}$/.test(valeur)) {
      throw new Error(`Recette locale illisible : empreinte-invalide (${cle}).`);
    }
    sortie[fichier] = valeur;
  }
  return sortie;
}

/**
 * Variante par flux de `verifierEmpreintes` : assemble les morceaux AVANT le
 * hash (le `.onnx_data` de 2,2 Go dépasse la taille max d'un `Buffer` Node —
 * `readFileSync` y échoue avec `ERR_FS_FILE_TOO_LARGE`). `ouvrirLecture` est
 * injecté (le réel : `fs.createReadStream`). Mêmes messages, même refus.
 */
export async function verifierEmpreintesParFlux(
  dossier: string,
  empreintes: Readonly<Record<string, string>>,
  ouvrirLecture: (chemin: string) => AsyncIterable<Uint8Array>,
): Promise<void> {
  for (const [nom, attendu] of Object.entries(empreintes)) {
    let flux: AsyncIterable<Uint8Array>;
    try {
      flux = ouvrirLecture(`${dossier}/${nom}`);
    } catch {
      throw new Error(`Recette locale illisible : ${nom} manquant sous ${dossier}.`);
    }
    const condensat = createHash("sha256");
    try {
      for await (const morceau of flux) {
        condensat.update(morceau);
      }
    } catch {
      throw new Error(`Recette locale illisible : ${nom} illisible sous ${dossier}.`);
    }
    if (condensat.digest("hex") !== attendu) {
      throw new Error(`Recette locale corrompue : empreinte-invalide pour ${nom}.`);
    }
  }
}

/**
 * Vérifie les empreintes SHA-256 des artefacts AVANT toute inférence.
 * `lire` est injecté (la fabrique passe `readFileSync`). Fichier illisible
 * ou octet altéré → erreur nommant le fichier, rien n'est chargé.
 */
export function verifierEmpreintes(
  dossier: string,
  empreintes: Readonly<Record<string, string>>,
  lire: (chemin: string) => Buffer,
): void {
  for (const [nom, attendu] of Object.entries(empreintes)) {
    let contenu: Buffer;
    try {
      contenu = lire(`${dossier}/${nom}`);
    } catch {
      throw new Error(`Recette locale illisible : ${nom} manquant sous ${dossier}.`);
    }
    const observe = createHash("sha256").update(contenu).digest("hex");
    if (observe !== attendu) {
      throw new Error(`Recette locale corrompue : empreinte-invalide pour ${nom}.`);
    }
  }
}

/**
 * Promeut la recette JSON épinglée en config locale. Chaque champ gelé est
 * comparé ; le moindre écart → `recette-derive` (ré-embedding humain, jamais
 * de mélange silencieux). JSON illisible → `recette-illisible`.
 */
export function configLocaleDepuisRecette(recette: unknown): ConfigFournisseurLocal {
  if (typeof recette !== "object" || recette === null) {
    throw new Error("Recette locale illisible : recette-vide ou type inattendu.");
  }
  const json = recette as Record<string, unknown>;
  const champTexte = (cle: string): string => {
    const valeur = json[cle];
    if (typeof valeur !== "string" || valeur === "") {
      throw new Error(`Recette locale illisible : recette-incomplete (${cle}).`);
    }
    return valeur;
  };
  const modele = champTexte("model");
  const version = champTexte("revision");
  const dimensions = json["dimensions"];
  const distance = champTexte("distance");
  const prefixeRequete = json["query_prefix"];
  const prefixeDocument = json["document_prefix"];
  const decoupeur = champTexte("chunking_version");
  const normalisationJson = champTexte("normalization");
  const ecarts: string[] = [];
  if (modele !== RECETTE_GELEE.modele) ecarts.push("model");
  if (version !== RECETTE_GELEE.version) ecarts.push("revision");
  if (dimensions !== RECETTE_GELEE.dimensions) ecarts.push("dimensions");
  if (distance !== RECETTE_GELEE.distance) ecarts.push("distance");
  if (prefixeRequete !== RECETTE_GELEE.instruction_requete) ecarts.push("query_prefix");
  if (prefixeDocument !== RECETTE_GELEE.instruction_document) ecarts.push("document_prefix");
  if (decoupeur !== RECETTE_GELEE.versionChunk) ecarts.push("chunking_version");
  if (!normalisationJson.startsWith(RECETTE_GELEE.marqueurNormalisationJson)) {
    ecarts.push("normalization");
  }
  if (ecarts.length > 0) {
    throw new Error(`Recette locale dérivée : recette-derive (${ecarts.join(", ")}).`);
  }
  return {
    modele: RECETTE_GELEE.modele,
    version: RECETTE_GELEE.version,
    dimensions: RECETTE_GELEE.dimensions,
    normalisation: RECETTE_GELEE.normalisation,
    instruction_requete: RECETTE_GELEE.instruction_requete,
    instruction_document: RECETTE_GELEE.instruction_document,
    distance: RECETTE_GELEE.distance,
    versionChunk: RECETTE_GELEE.versionChunk,
  };
}

/**
 * Formate un vecteur en littéral pgvector (`[v,v,…]`, `String(n)` =
 * aller-retour le plus court déterministe). Composante non finie →
 * refus : jamais de vecteur corrompu vers la base.
 */
export function formaterVecteurPg(vecteur: readonly number[]): string {
  if (vecteur.length === 0) {
    throw new Error("Vecteur vide : rien à formater.");
  }
  for (const composante of vecteur) {
    if (typeof composante !== "number" || !Number.isFinite(composante)) {
      throw new Error("Vecteur non fini : composante inexploitable.");
    }
  }
  return `[${vecteur.map((n) => String(n)).join(",")}]`;
}

/**
 * Découpe des items en lots de `taille` (ordre préservé, dernier lot
 * partiel). `taille` non entière ou ≤ 0 → refus.
 */
export function decouperLots<T>(items: readonly T[], taille: number): T[][] {
  if (!Number.isInteger(taille) || taille <= 0) {
    throw new Error("Découpage impossible : taille de lot invalide.");
  }
  const lots: T[][] = [];
  for (let i = 0; i < items.length; i += taille) {
    lots.push(items.slice(i, i + taille));
  }
  return lots;
}

// ─── Inférence : encodage, session, fabrique (ORT branché par injection) ────

/** Longueur max d'entrée — recette R2 : truncation 512, spéciaux préservés. */
export const TRONCATURE_MAX = 512 as const;

/** Taille de lot d'inférence — substrat de mesure R2. */
export const TAILLE_LOT_INFERENCE = 8 as const;

/** Sortie minimale d'un tokenizer (suffit à l'inférence BGE-M3). */
export interface EncodageLocal {
  readonly ids: readonly number[];
  readonly attention_mask: readonly number[];
}

/** Tokenizer injecté (le réel : `@huggingface/tokenizers`, pur JS). */
export interface TokenizerLocalMinimal {
  encode(texte: string): EncodageLocal;
  token_to_id(token: string): number | undefined;
}

/** Session ONNX injectée (la réelle : `onnxruntime-node`, CPU). */
export interface SessionOnnxMinimale {
  readonly inputNames: readonly string[];
  readonly outputNames: readonly string[];
  run(entrees: Record<string, unknown>): Promise<Record<string, { readonly data: ArrayLike<number> }>>;
}

/** Constructeur de tenseur injecté (`new ort.Tensor("int64", …)`). */
export interface ConstructeurTenseur {
  new (type: string, data: BigInt64Array, dims: readonly number[]): unknown;
}

/** Fragment ORT minimal requis (jamais importé statiquement ici). */
export interface OrtMinimal {
  readonly Tensor: ConstructeurTenseur;
}

/** Options de session — recette R2 : CPU, 4 fils intra-op. */
export interface OptionsSessionLocale {
  readonly intraOpNumThreads: number;
  readonly executionProviders: readonly string[];
}

/** Fabrique de session injectée (le réel : `InferenceSession.create`). */
export interface FabriqueSession {
  creerSession(chemin: string, options: OptionsSessionLocale): Promise<SessionOnnxMinimale>;
}

/**
 * Encode un lot : troncature à `maxLongueur` en gardant les spéciaux
 * (511 premiers + dernier, parité `enable_truncation` R2), puis padding
 * à droite au max du lot avec `[PAD]` (ou 0, parité R2), masques 0/1.
 */
export function encoderLot(
  tokenizer: TokenizerLocalMinimal,
  textes: readonly string[],
  maxLongueur: number = TRONCATURE_MAX,
): { readonly ids: number[][]; readonly attention_mask: number[][] } {
  if (!Number.isInteger(maxLongueur) || maxLongueur <= 2) {
    throw new Error("Encodage impossible : longueur max invalide.");
  }
  if (textes.length === 0) {
    return { ids: [], attention_mask: [] };
  }
  const idPad = tokenizer.token_to_id("[PAD]") ?? 0;
  const tronques = textes.map((texte) => {
    const enc = tokenizer.encode(texte);
    let ids = [...enc.ids];
    let masque = [...enc.attention_mask];
    if (ids.length > maxLongueur) {
      const dernierId = ids[ids.length - 1] ?? idPad;
      const dernierMasque = masque[masque.length - 1] ?? 0;
      ids = [...ids.slice(0, maxLongueur - 1), dernierId];
      masque = [...masque.slice(0, maxLongueur - 1), dernierMasque];
    }
    return { ids, masque };
  });
  let longueur = 0;
  for (const t of tronques) {
    if (t.ids.length > longueur) longueur = t.ids.length;
  }
  const ids: number[][] = [];
  const attention_mask: number[][] = [];
  for (const t of tronques) {
    const remplissage = longueur - t.ids.length;
    ids.push([...t.ids, ...Array<number>(remplissage).fill(idPad)]);
    attention_mask.push([...t.masque, ...Array<number>(remplissage).fill(0)]);
  }
  return { ids, attention_mask };
}

/**
 * Normalisation L2 explicite (la tête est déjà ~normée ; R2 renormalise
 * quand même — ceinture + bretelles, à l'identique). Vecteur nul ou non
 * fini → refus : jamais de NaN vers la base.
 */
export function normaliserL2(vecteur: readonly number[]): number[] {
  let somme = 0;
  for (const composante of vecteur) {
    if (typeof composante !== "number" || !Number.isFinite(composante)) {
      throw new Error("Vecteur non fini : normalisation impossible.");
    }
    somme += composante * composante;
  }
  const norme = Math.sqrt(somme);
  if (!(norme > 0) || !Number.isFinite(norme)) {
    throw new Error("Vecteur nul : normalisation impossible (vecteur-nul).");
  }
  return vecteur.map((composante) => composante / norme);
}

/**
 * Construit l'`InferenceLocale` depuis une session + un tokenizer injectés.
 * Vérifie le contrat du graphe épinglé (entrées `input_ids`/`attention_mask`,
 * sortie `sentence_embedding`) AVANT tout run — graphe inattendu = refus,
 * jamais d'inférence aveugle. Lots de 8 (R2), tenseurs int64 BigInt.
 */
export function inferenceDepuisSession(
  ort: OrtMinimal,
  session: SessionOnnxMinimale,
  tokenizer: TokenizerLocalMinimal,
  options: { readonly tailleLot?: number } = {},
): InferenceLocale {
  const tailleLot = options.tailleLot ?? TAILLE_LOT_INFERENCE;
  if (!Number.isInteger(tailleLot) || tailleLot <= 0) {
    throw new Error("Inférence impossible : taille de lot invalide.");
  }
  if (
    session.inputNames.length !== 2 ||
    session.inputNames[0] !== "input_ids" ||
    session.inputNames[1] !== "attention_mask"
  ) {
    throw new Error("Session ONNX inattendue : graphe-inattendu (entrées).");
  }
  const indexTete = session.outputNames.indexOf("sentence_embedding");
  if (indexTete < 0) {
    throw new Error("Session ONNX inattendue : graphe-inattendu (tête sentence_embedding absente).");
  }
  const nomTete = session.outputNames[indexTete] ?? "sentence_embedding";
  return async (textes: readonly string[]) => {
    if (textes.length === 0) {
      return { vecteurs: [] };
    }
    const vecteurs: number[][] = [];
    for (const lot of decouperLots([...textes], tailleLot)) {
      const enc = encoderLot(tokenizer, lot);
      const n = lot.length;
      const premiere = enc.ids[0];
      const L = premiere !== undefined ? premiere.length : 0;
      const ids = new BigInt64Array(n * L);
      const masque = new BigInt64Array(n * L);
      for (let i = 0; i < n; i++) {
        const ligneIds = enc.ids[i] ?? [];
        const ligneMasque = enc.attention_mask[i] ?? [];
        for (let j = 0; j < L; j++) {
          ids[i * L + j] = BigInt(ligneIds[j] ?? 0);
          masque[i * L + j] = BigInt(ligneMasque[j] ?? 0);
        }
      }
      const sorties = await session.run({
        input_ids: new ort.Tensor("int64", ids, [n, L]),
        attention_mask: new ort.Tensor("int64", masque, [n, L]),
      });
      const tete = sorties[nomTete];
      if (tete === undefined) {
        throw new Error("Session ONNX inattendue : sortie sentence_embedding manquante.");
      }
      const data = Array.from(tete.data);
      for (let r = 0; r < n; r++) {
        const ligne = data.slice(r * DIMENSION_VECTEUR_PROD, (r + 1) * DIMENSION_VECTEUR_PROD);
        if (ligne.length !== DIMENSION_VECTEUR_PROD) {
          throw new Error("Session ONNX inattendue : dimension-inattendue (tête).");
        }
        vecteurs.push(normaliserL2(ligne));
      }
    }
    return { vecteurs };
  };
}

/** Session + tokenizer prêts (fabrique `chargerSessionLocale`). */
export interface SessionLocalePrete {
  readonly tokenizer: TokenizerLocalMinimal;
  readonly session: SessionOnnxMinimale;
}

/** Fournisseur apte à la voie requête (préfixe recette + embed). */
export interface FournisseurRequete {
  texteRequete(texte: string): string;
  embed(input: string[]): Promise<ResultatEmbedding>;
}

/**
 * Adapte un fournisseur en `vecteurRequete` du service
 * (`connaissance-recherche.ts`) : préfixe requête de la recette, premier
 * vecteur — échec ou vide → `null` (lexical seul, jamais d'exception).
 * Voie REQUÊTE (texte utilisateur) : aucune porte C4 ici — la barrière
 * corpus s'applique à l'embedding des documents (backfill), pas aux questions.
 */
export function vecteurRequeteDepuisFournisseur(
  fournisseur: FournisseurRequete,
): (requete: string) => Promise<readonly number[] | null> {
  return async (requete: string) => {
    const resultat = await fournisseur.embed([fournisseur.texteRequete(requete)]);
    if (!resultat.ok) return null;
    return resultat.vecteurs[0] ?? null;
  };
}

/**
 * Charge le tokenizer (`tokenizer.json` + `tokenizer_config.json`) puis crée
 * la session sur `model.onnx` (CPU, 4 fils — recette R2). JSON invalide →
 * `tokenizer-illisible` AVANT toute création de session.
 */
export async function chargerSessionLocale(
  dossier: string,
  lireFichier: (chemin: string) => string,
  creerTokenizer: (json: unknown, config: unknown) => TokenizerLocalMinimal,
  fabrique: FabriqueSession,
): Promise<SessionLocalePrete> {
  let brutJson: string;
  let brutConfig: string;
  try {
    brutJson = lireFichier(`${dossier}/tokenizer.json`);
    brutConfig = lireFichier(`${dossier}/tokenizer_config.json`);
  } catch {
    throw new Error("Tokenizer illisible : tokenizer.json/tokenizer_config.json manquants.");
  }
  let json: unknown;
  let config: unknown;
  try {
    json = JSON.parse(brutJson) as unknown;
    config = JSON.parse(brutConfig) as unknown;
  } catch {
    throw new Error("Tokenizer illisible : tokenizer-illisible (JSON invalide).");
  }
  const tokenizer = creerTokenizer(json, config);
  const session = await fabrique.creerSession(`${dossier}/model.onnx`, {
    intraOpNumThreads: 4,
    executionProviders: ["cpu"],
  });
  return { tokenizer, session };
}
