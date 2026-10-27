import type { AlexaEvent, AlexaSource } from "@/shared/alexa/turn";
import type { AlexaLanguage } from "@/shared/alexa/request-plan";
import { dialogue } from "@/i18n/alexa-dialogue";
import type { SourceCitation } from "@/server/knowledge/pages";
import type { readKnowledge } from "./knowledge-adapter";
import { localDisplay } from "./local-response";

export type KnowledgeResult = Awaited<ReturnType<typeof readKnowledge>>;
type SentenceEvent = Extract<AlexaEvent, { type: "sentence" }>;
type Preuve = KnowledgeResult["preuves"][number];

/**
 * L'étiquette d'une source : titre, section, puis ÉDITION VÉRIFIÉE quand elle
 * est résolue (sinon la version de source, comme avant), puis la page vérifiée.
 * La page n'apparaît que si le marqueur du chunk la donne ET qu'elle appartient
 * bien à l'ouvrage — jamais de page supposée.
 */
export function knowledgeSource(proof: Preuve, identities: readonly string[] = []): AlexaSource {
  const detail = proof.edition?.edition ?? proof.version;
  const page = "page" in proof && proof.page ? proof.page.libelle : null;
  return { id: proof.chunkId, type: "knowledge",
    label: localDisplay([proof.titre, proof.section, detail, page].filter(Boolean).join(" · "), identities),
    version: proof.version, provenance: { sourceId: proof.sourceId, chunkId: proof.chunkId,
      versionChunk: proof.versionChunk, unitId: proof.unitId, parentTexteHash: proof.parentTexteHash,
      enfantIndex: proof.enfantIndex, enfantsTotal: proof.enfantsTotal,
      ...(proof.edition ? { edition: proof.edition.edition, annee: proof.edition.annee } : {}),
      ...("page" in proof && proof.page?.pageImprimee != null ? { pageImprimee: proof.page.pageImprimee } : {}),
      ...("page" in proof && proof.page?.pagePdf != null ? { pagePdf: proof.page.pagePdf } : {}) } };
}

/**
 * La citation vérifiée d'une preuve, pour la ligne de sources assemblée par le
 * serveur. Aucune valeur n'est déduite : édition et page viennent des
 * métadonnées résolues au moment de la récupération.
 */
export function citationDePreuve(proof: Preuve): SourceCitation {
  return {
    titre: proof.titre,
    edition: proof.edition?.edition ?? null,
    annee: proof.edition?.annee ?? null,
    pageImprimee: "page" in proof ? proof.page?.pageImprimee ?? null : null,
    pagePdf: "page" in proof ? proof.page?.pagePdf ?? null : null,
  };
}

/** Book excerpts remain attributed evidence, never an individualized clinical conclusion. */
export function knowledgeResponseEvents(result: KnowledgeResult, language: AlexaLanguage,
  mixed = false, identities: readonly string[] = []): SentenceEvent[] {
  const copy = dialogue(language);
  const message = (text: string): SentenceEvent => ({ type: "sentence", text, kind: "knowledge", sources: [] });
  const omissions = "omittedLongPassages" in result && result.omittedLongPassages ? [message(copy.longKnowledge)] : [];
  if (result.etat !== "ok") return [message(result.etat === "faible" ? copy.weakKnowledge
    : result.etat === "panne" ? copy.knowledgeUnavailable : copy.noKnowledge), ...omissions];
  return [
    ...(mixed ? [message(copy.separateKnowledge)] : []),
    ...result.preuves.map((proof): SentenceEvent => ({ type: "sentence",
      text: localDisplay(proof.extrait, identities), kind: "knowledge",
      sources: [knowledgeSource(proof, identities)],
    })),
    ...omissions,
  ];
}
