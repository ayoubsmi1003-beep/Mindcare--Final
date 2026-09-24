/**
 * `preuves-recherche.ts` — M07 slice 3 · récupération gouvernée pour la passerelle.
 *
 * Le chemin connaissance récupère les preuves AVANT l'appel au modèle :
 * hybride-live (lexical + BGE-M3 local paresseux, calibration A3) via les
 * portes allowlistées, sous l'identité de l'appelante (le `rpc` injecté porte
 * déjà le JWT via `withCaller`). Même orchestration partagée que le service
 * (`orchestrerRecherche`) : validation + gouvernance + fusion + rerank +
 * qualification + budget — UNE sémantique, pas deux.
 *
 * Échec de porte ou modèle absent → lexical seul ou liste vide (dégradations
 * honnêtes : le prompt v3.2 instruit le constat d'absence, jamais une panne
 * ne tue la réponse). Zéro octet externe : l'embedding est calculé sur la
 * machine (M05). Pureté testable : le `rpc` et le vecteur sont injectés,
 * aucune I/O ici.
 */

import { LIMITES, orchestrerRecherche } from "@/server/knowledge/recherche";
import { CALIBRATION_A3 } from "@/server/knowledge/rerank";
import { PORTES, porteLexicale, porteVectorielle } from "@/server/knowledge/stockage";
import { vecteurRequeteProduction } from "@/server/knowledge/vecteur-production";
import { contientIdentifiantExactLivre, fusionnerLignesLivres, identifiantsExactsLivre, selectionnerExtraitLivre } from "@/server/knowledge/livres";
import { contientDoseOcrNonLiberee } from "@/server/jarvis/dose-ocr-gate";
import { validerPreuve } from "@/shared/jarvis/preuves";
import type { PreuveConnnaissance } from "@/shared/jarvis/preuves";

export interface RpcPreuves {
  readonly rpc: <T = unknown>(
    nom: string,
    args?: Readonly<Record<string, unknown>>,
  ) => Promise<{ readonly data: T | null; readonly error: { readonly message?: unknown } | null }>;
}

/** Vecteur requête injectable (le réel : BGE-M3 local paresseux, `null` = lexical seul). */
export type FnVecteurPreuves = (requete: string) => Promise<readonly number[] | null>;

/** Extraits plafonnés au contrat fil (le client revalide de toute façon). */
export const MAX_EXTRAIT_FIL = 800;

export type DiagnosticLivres =
  | "recherche-indisponible"
  | "recherche-partielle"
  | "recherche-lexicale-indisponible"
  | "livres-non-recherchables"
  | "aucun-passage-accessible"
  | "provenance-invalide"
  | "identifiant-introuvable"
  | "conflit-ocr-connu"
  | "valeur-non-confirmee"
  | "ocr-incertain"
  | "dose-ocr-non-verifiee";

export interface ResultatPreuvesLivres {
  readonly preuves: PreuveConnnaissance[];
  readonly diagnostic: DiagnosticLivres | null;
}

/** Image-checked source/OCR conflicts, pinned to the affected page or chunk. */
const PAGES_CONFLIT_TAYLOR = new Map([
  ["eef0d441", 678], ["377fcac6", 680],
  ["a13a0972", 683], ["5244599a", 733],
  // Rotated-table salad class, batch 6: staged 7g has no printed counterpart (p549).
  ["2f4cab28", 549],
  // Misread class, batch 6: staged 2500mcg misreads printed ≥500mcg/L (p234).
  ["5e57fbae", 234],
  // Misread class, batch 7: staged u1/1g misreads printed µg (p342);
  // staged m3g/3g salad inside mg-a-day rows (p379, p770).
  ["a2eda7d2", 342], ["6e8b6cbf", 379], ["b4620a40", 770],
]);

function conflitOcrConnu(passage: { bookNumber: number; chunkId: string; pages: readonly { globalPhysicalPage: number; printedPage: string | null }[] }): boolean {
  return (passage.bookNumber === 1 && passage.chunkId === "910e7b4d"
      && passage.pages.some((page) => page.globalPhysicalPage === 306))
    || (passage.bookNumber === 2 && passage.chunkId === "83377756"
      && passage.pages.some((page) => page.globalPhysicalPage === 226))
    || (passage.bookNumber === 6 && passage.pages.some((page) =>
      page.globalPhysicalPage === PAGES_CONFLIT_TAYLOR.get(passage.chunkId)))
    || (passage.bookNumber === 6 && passage.pages.some((page) =>
      page.globalPhysicalPage === 500 && page.printedPage === "4"));
}

export async function recupererPreuves(
  client: RpcPreuves,
  question: string,
  vecteurRequete: FnVecteurPreuves = vecteurRequeteProduction,
): Promise<PreuveConnnaissance[]> {
  try {
    const requete = question.slice(0, 500);
    const porte = porteLexicale(requete, "toutes", LIMITES.LEXICAL);
    const { error, data } = await client.rpc<unknown[]>("search_knowledge_lexical", {
      p_requete: porte.args["p_requete"],
      p_langue: porte.args["p_langue"],
      p_limite: porte.args["p_limite"],
    });
    if (error !== null || !Array.isArray(data)) return [];
    // Jambe vectorielle (hybride-live) : modèle absent ou porte en panne →
    // lexical seul, jamais d'exception (même honnêteté que la jambe lexicale).
    let lignesVectorielles: readonly unknown[] = [];
    const vecteur = await vecteurRequete(requete).catch(() => null);
    if (vecteur !== null) {
      const porteV = porteVectorielle(JSON.stringify([...vecteur]), LIMITES.VECTORIEL);
      const resVec = await client
        .rpc<unknown[]>("search_knowledge_vector", {
          p_embedding_json: porteV.args["p_embedding_json"],
          p_limite: porteV.args["p_limite"],
        })
        .catch(() => ({ error: { message: "indisponible" }, data: null }));
      if (resVec.error === null && Array.isArray(resVec.data)) lignesVectorielles = resVec.data;
    }
    const { evidences } = await orchestrerRecherche(question, data, lignesVectorielles, undefined, CALIBRATION_A3);
    return evidences.map((e) => ({
      titre: e.sourceTitre,
      section: e.section,
      version: e.sourceVersion,
      extrait: e.texte.slice(0, MAX_EXTRAIT_FIL),
    }));
  } catch {
    return [];
  }
}

/** Medical route: never consult the general R1 gates or use R1 as fallback. */
export async function recupererPreuvesLivresAvecDiagnostic(
  client: RpcPreuves,
  question: string,
  vecteurRequete: FnVecteurPreuves = vecteurRequeteProduction,
): Promise<ResultatPreuvesLivres> {
  try {
    const requete = question.slice(0, 500);
    const lexical = await client.rpc<unknown[]>(PORTES.LIVRE_LEXICALE, {
      p_requete: requete, p_langue: "toutes", p_limite: LIMITES.LEXICAL,
    }).catch(() => ({ data: null, error: { message: "unavailable" } }));
    const lexicalDisponible = lexical.error === null && Array.isArray(lexical.data);
    const lignesLexicales = lexicalDisponible ? lexical.data : [];
    let vector: readonly unknown[] = [];
    const embedding = await vecteurRequete(requete).catch(() => null);
    let vectorDisponible = embedding !== null;
    if (embedding !== null) {
      const result = await client.rpc<unknown[]>(PORTES.LIVRE_VECTORIELLE, {
        p_embedding_json: JSON.stringify([...embedding]), p_limite: LIMITES.VECTORIEL,
      }).catch(() => ({ data: null, error: { message: "unavailable" } }));
      if (result.error === null && Array.isArray(result.data)) vector = result.data;
      else vectorDisponible = false;
    }
    const candidats = fusionnerLignesLivres(lignesLexicales, vector);
    if (candidats.length === 0) {
      if (lignesLexicales.length + vector.length === 0) {
        const availability = await client.rpc<{ total_books: number; eligible_chunks: number | string }[]>(
          PORTES.LIVRE_DISPONIBILITE,
        ).catch(() => ({ data: null, error: { message: "unavailable" } }));
        const state = availability.error === null && Array.isArray(availability.data)
          ? availability.data[0] : undefined;
        if (state !== undefined && state.total_books > 0 &&
          (state.eligible_chunks === 0 || state.eligible_chunks === "0")) {
          return { preuves: [], diagnostic: "livres-non-recherchables" };
        }
        return { preuves: [], diagnostic: lexicalDisponible && vectorDisponible
          ? "aucun-passage-accessible"
          : !lexicalDisponible && vectorDisponible ? "recherche-lexicale-indisponible"
            : lexicalDisponible ? "recherche-partielle" : "recherche-indisponible" };
      }
      return { preuves: [], diagnostic: "provenance-invalide" };
    }
    const identifiants = identifiantsExactsLivre(requete);
    const correspondants = candidats.filter((p) => identifiants.every((id) =>
      contientIdentifiantExactLivre(p.sourceText, id)));
    if (correspondants.length === 0) {
      const codeImprimeEnConflit = identifiants.length === 1
        && (identifiants[0] === "na07.6z" || identifiants[0] === "8b02")
        && candidats.some((p) => p.bookNumber === 2 && conflitOcrConnu(p));
      return { preuves: [], diagnostic: codeImprimeEnConflit
        ? "conflit-ocr-connu" : "identifiant-introuvable" };
    }
    const extraits = correspondants.map((p) => selectionnerExtraitLivre(p, requete))
      .filter((p): p is NonNullable<typeof p> => p !== null);
    if (extraits.length === 0) return { preuves: [], diagnostic: "valeur-non-confirmee" };
    const sansConflit = extraits.filter((p) => !conflitOcrConnu(p));
    if (sansConflit.length === 0) return { preuves: [], diagnostic: "conflit-ocr-connu" };
    const recevables = sansConflit.filter((p) => p.ocrReviewStatus === "accepted" && !contientDoseOcrNonLiberee(p.extrait));
    if (recevables.length === 0) return { preuves: [], diagnostic:
      sansConflit.some((p) => contientDoseOcrNonLiberee(p.extrait)) ? "dose-ocr-non-verifiee" : "ocr-incertain" };
    const preuves = recevables.slice(0, LIMITES.FINAL)
      .map((p) => validerPreuve({
        titre: p.titleExact, section: p.headingPath.join(" › "), version: p.sourceVersion,
        extrait: p.extrait, id: crypto.randomUUID(),
        livre: { numero: p.bookNumber, edition: p.edition, pages: p.pages,
          ocrReviewStatus: p.ocrReviewStatus },
      }))
      .filter((p): p is PreuveConnnaissance => p !== null);
    return { preuves, diagnostic: preuves.length ? null : "provenance-invalide" };
  } catch {
    return { preuves: [], diagnostic: "recherche-indisponible" };
  }
}

/** Compatibility for callers that only need the evidence list. */
export async function recupererPreuvesLivres(
  client: RpcPreuves,
  question: string,
  vecteurRequete: FnVecteurPreuves = vecteurRequeteProduction,
): Promise<PreuveConnnaissance[]> {
  return (await recupererPreuvesLivresAvecDiagnostic(client, question, vecteurRequete)).preuves;
}
