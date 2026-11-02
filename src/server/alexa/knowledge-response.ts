import type { AlexaEvent, AlexaSource } from "@/shared/alexa/turn";
import type { AlexaLanguage } from "@/shared/alexa/request-plan";
import { dialogue } from "@/i18n/alexa-dialogue";
import type { SourceCitation } from "@/server/knowledge/pages";
import { retirerMarqueursPageAffichage } from "@/server/knowledge/pages";
import type { readKnowledge } from "./knowledge-adapter";
import { localDisplay } from "./local-response";
import { isKnowledgeLocationQuestion } from "./knowledge-query";

export type KnowledgeResult = Awaited<ReturnType<typeof readKnowledge>>;
type SentenceEvent = Extract<AlexaEvent, { type: "sentence" }>;
type Preuve = KnowledgeResult["preuves"][number];

const approvedBookName = /\b(?:dsm\b|dsm[‐‑‒–—-]?\s*5(?:[‐‑‒–—-]?\s*tr)?|diagnostic and statistical manual of mental disorders|manuel diagnostique et statistique des troubles mentaux|maudsley|taylor|stahl|prescriber(?:['’])?s guide|essential psychopharmacology)\b/iu;
const leadingBookAttribution = /^(?:(?:according to|as described in|selon|d['’]apres)\s+)?(?:(?:the|le|la)\s+)?(?:dsm[‐‑‒–—-]?\s*5(?:[‐‑‒–—-]?\s*tr)?|diagnostic and statistical manual of mental disorders|manuel diagnostique et statistique des troubles mentaux|(?:the\s+)?maudsley(?:\s+prescribing guidelines in psychiatry)?|taylor|(?:the\s+)?prescriber(?:['’])?s guide(?:\s*\(stahl['’]s essential psychopharmacology\))?|stahl(?:['’]s essential psychopharmacology)?|essential psychopharmacology)\s*[,;:]\s*/iu;

/** Book identity stays in structured source metadata, never in spoken excerpts. */
export function mentionsKnowledgeBookTitle(text: string): boolean {
  return approvedBookName.test(text.normalize("NFKC"));
}

/** Keep a literal passage when only its opening book attribution needs removal. */
export function knowledgeExcerptForSpeech(text: string): string | null {
  const excerpt = retirerMarqueursPageAffichage(text).trim();
  const withoutAttribution = excerpt.replace(leadingBookAttribution, "").trimStart();
  return withoutAttribution && !mentionsKnowledgeBookTitle(withoutAttribution) ? withoutAttribution : null;
}

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
  mixed = false, identities: readonly string[] = [], question?: string): SentenceEvent[] {
  const copy = dialogue(language);
  const message = (text: string): SentenceEvent => ({ type: "sentence", text, kind: "knowledge", sources: [] });
  const omissions = "omittedLongPassages" in result && result.omittedLongPassages ? [message(copy.longKnowledge)] : [];
  if (question && isKnowledgeLocationQuestion(question)) {
    if (result.etat !== "ok") return [message(result.etat === "faible" ? copy.weakKnowledge
      : result.etat === "panne" ? copy.knowledgeUnavailable : copy.noKnowledge), ...omissions];
    const proof = result.preuves.find(item => typeof item.section === "string" && item.section.trim()
      && "page" in item && typeof item.page?.libelle === "string" && item.page.libelle.trim());
    if (!proof || !proof.section || !("page" in proof) || !proof.page) return [message(copy.noKnowledge), ...omissions];
    const locator = localDisplay(`${proof.section} — ${proof.page.libelle}`, identities);
    return [{ type: "sentence", text: locator, kind: "knowledge",
      sources: [{ ...knowledgeSource(proof, identities), excerpt: locator }] }];
  }
  if (result.etat !== "ok") return [message(result.etat === "faible" ? copy.weakKnowledge
    : result.etat === "panne" ? copy.knowledgeUnavailable : copy.noKnowledge), ...omissions];
  const speakableProofs = result.preuves.flatMap(proof => {
    const excerpt = knowledgeExcerptForSpeech(proof.extrait);
    return excerpt ? [{ proof, excerpt }] : [];
  });
  if (!speakableProofs.length) return [{ ...message(copy.noKnowledge), sources: result.preuves.map(proof => knowledgeSource(proof, identities)) }, ...omissions];
  return [
    ...(mixed ? [message(copy.separateKnowledge)] : []),
    ...speakableProofs.map(({ proof, excerpt }): SentenceEvent => ({ type: "sentence",
      text: localDisplay(excerpt, identities), kind: "knowledge",
      sources: [{ ...knowledgeSource(proof, identities), excerpt }],
    })),
    ...omissions,
  ];
}
