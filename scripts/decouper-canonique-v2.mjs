/**
 * decouper-canonique-v2 — DECOUPEUR STRUCT-V2 (pur, deterministe, zero ecriture en base).
 *
 * ═══ CE QUE C'EST ═══
 * Le projecteur canonique -> chunks : chaque unite canonique (units.jsonl)
 * devient >= 1 chunk borne, identite stable, avec trainee d'en-tetes
 * (Book › Part › Chapter ...) dans `texte_indexable`. Les frontieres suivent
 * la structure (jamais de coupe au milieu d'un critere/table) ; seule
 * exception bornee : un passage monstrueux (> LIMITE_TEXTE) est coupe sur
 * des frontieres de phrases, dans l'ordre.
 *
 * ═══ CE QUE CE N'EST PAS ═══
 * Ni un embedding, ni un chargement PG, ni une activation : sortie JSONL
 * dans le dossier canonique, consommee plus tard par la recette d'embedding
 * puis le chargeur Gate C. Aucun INSERT/UPDATE/DELETE dans ce fichier.
 *
 *   node scripts/decouper-canonique-v2.mjs [--livre <book_id>] [--version <sha256:...>]
 */
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const CHUNKER_VERSION = "struct-v2";
export const NORMALISATION_CHUNK = "nfkc-espace-v1";
export const LIMITE_TEXTE = 2000;

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function normaliserTexte(texte) {
  return texte.normalize("NFKC").replace(/\s+/g, " ").trim();
}

export function hacherTexte(texte) {
  return createHash("sha256").update(texte, "utf8").digest("hex");
}

/** Coupe un long texte sur des frontieres de phrases (FR), bourrage glouton <= limite. */
export function couperPhrases(texte, limite = LIMITE_TEXTE) {
  const phrases = texte.split(/(?<=[.!?…;:])\s+(?=[A-ZÀ-Þ0-9«"'\(\[])/);
  const morceaux = [];
  let courant = "";
  for (const phrase of phrases) {
    if (!phrase) continue;
    const essai = courant ? `${courant} ${phrase}` : phrase;
    if (essai.length <= limite) {
      courant = essai;
      continue;
    }
    if (courant) morceaux.push(courant);
    if (phrase.length <= limite) {
      courant = phrase;
    } else {
      // Phrase pathologique : coupe dure sur espace, jamais au milieu d'un mot.
      let reste = phrase;
      courant = "";
      while (reste.length > limite) {
        let coupure = reste.lastIndexOf(" ", limite);
        if (coupure < limite * 0.5) coupure = limite;
        morceaux.push(reste.slice(0, coupure).trim());
        reste = reste.slice(coupure).trim();
      }
      courant = reste;
    }
  }
  if (courant) morceaux.push(courant);
  return morceaux.filter((m) => m.length > 0);
}

export function texteIndexable(unite, titreCourt) {
  const fil = [titreCourt, ...(unite.structural_path ?? []), unite.title].filter(Boolean);
  return `${fil.join(" › ")} — ${unite.texte ?? ""}`.trim();
}

/** Projette une unite canonique en chunks. Entree/sortie pures (aucune I/O ici). */
export function decouperUnite(unite, { titreCourt, sourceVersion }) {
  const texte = normaliserTexte(unite.evidence_wording ?? "");
  if (!texte) return [];
  const texteHash = hacherTexte(texte);
  const morceaux = texte.length <= LIMITE_TEXTE ? [texte] : couperPhrases(texte);
  return morceaux.map((morceau, occurrence) => {
    const chunkId = hacherTexte(`${sourceVersion}|${unite.id}|${texteHash}|${occurrence}`);
    const morceauNormalise = { ...unite, texte: morceau };
    return {
      chunk_id: chunkId,
      book_id: unite.book_id,
      source_version: sourceVersion,
      unit_id: unite.id,
      titre_source: titreCourt,
      structural_path: unite.structural_path ?? [],
      section: (unite.structural_path ?? []).join(" / ") || null,
      occurrence,
      langue: unite.language ?? "fr",
      texte: morceau,
      texte_hash: hacherTexte(morceau),
      texte_indexable: texteIndexable(morceauNormalise, titreCourt),
      page_start: unite.page_start ?? null,
      page_end: unite.page_end ?? null,
      printed_page_start: unite.printed_page_start ?? null,
      printed_page_end: unite.printed_page_end ?? null,
      concept_ids: unite.concept_ids ?? [],
      entity_ids: unite.entity_ids ?? [],
      table_figure_ids: unite.table_figure_ids ?? [],
      chunker_version: CHUNKER_VERSION,
      normalisation: NORMALISATION_CHUNK,
      provenance: { ...(unite.provenance ?? {}), chunker: CHUNKER_VERSION },
      confidence: unite.confidence ?? null,
      validation_status: unite.validation_status ?? "needs_review",
    };
  });
}

async function lireJsonl(chemin) {
  const lignes = [];
  const rl = createInterface({ input: createReadStream(chemin, "utf8"), crlfDelay: Infinity });
  for await (const ligne of rl) {
    if (ligne.trim()) lignes.push(JSON.parse(ligne));
  }
  return lignes;
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (nom, defaut) => {
    const i = args.indexOf(nom);
    return i >= 0 && args[i + 1] ? args[i + 1] : defaut;
  };
  const livre = opt("--livre", "dsm5-fr-2015-elsevier");
  const version = opt("--version", "sha256:be145e65aa8291dcb59e56ad61b86bcc41d4145ab2344a1c50f10582dcfa1d53");
  const dossier = join(RACINE, "knowledge", "canonical-v2", livre, version.replace("sha256:", "sha256-"));
  const unites = await lireJsonl(join(dossier, "units.jsonl"));
  const book = JSON.parse(readFileSync(join(dossier, "book.json"), "utf8"));
  const titreCourt = `${book.title ?? livre} (${book.edition ?? book.publication_year ?? ""})`.trim();
  const sortie = join(dossier, "chunks-v2.jsonl");
  const flux = createWriteStream(sortie, "utf8");
  let total = 0;
  let multi = 0;
  let maxTexte = 0;
  let maxIndexable = 0;
  for (const unite of unites) {
    const chunks = decouperUnite(unite, { titreCourt, sourceVersion: version });
    if (chunks.length === 0) continue;
    if (chunks.length > 1) multi += 1;
    for (const chunk of chunks) {
      flux.write(`${JSON.stringify(chunk)}\n`);
      total += 1;
      maxTexte = Math.max(maxTexte, chunk.texte.length);
      maxIndexable = Math.max(maxIndexable, chunk.texte_indexable.length);
    }
  }
  await new Promise((resolveFin) => flux.end(resolveFin));
  const manifeste = {
    chunker_version: CHUNKER_VERSION,
    normalisation: NORMALISATION_CHUNK,
    limite_texte: LIMITE_TEXTE,
    unites_lues: unites.length,
    chunks_emis: total,
    unites_multi_chunks: multi,
    texte_max: maxTexte,
    indexable_max: maxIndexable,
  };
  writeFileSync(join(dossier, "chunks-v2.manifest.json"), `${JSON.stringify(manifeste, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(manifeste));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
