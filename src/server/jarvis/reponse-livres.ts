/** Deterministic, extractive book answer. No model-generated medical claims. */
import { AUCUNE_PREUVE_LIVRES, DIAGNOSTICS_LIVRES, NOMS_DOSSIERS_LIVRES, PAGE_IMPRIMEE, PAGE_PDF, PASSAGES_LIVRES, TITRE_IMPRIME } from "@/i18n/connaissance";
import type { PreuveConnnaissance } from "@/shared/jarvis/preuves";
import type { DiagnosticLivres } from "./preuves-recherche";
import { contientDoseOcrNonLiberee } from "./dose-ocr-gate";

export function reponseLivres(passages: readonly PreuveConnnaissance[], diagnostic: DiagnosticLivres | null = null): string {
  if (passages.length === 0) return diagnostic === null ? AUCUNE_PREUVE_LIVRES : DIAGNOSTICS_LIVRES[diagnostic];
  const items = passages.filter((p) => p.livre !== undefined && p.livre.ocrReviewStatus === "accepted" &&
    !contientDoseOcrNonLiberee(p.extrait)).map((p) => {
    const book = p.livre!;
    const pages = book.pages.map((page) => `${PAGE_PDF} ${page.physicalPage} (${page.splitId})` +
      (page.printedPage === null ? "" : `, ${PAGE_IMPRIMEE} ${page.printedPage}`)).join(" ; ");
    const number = `B${String(book.numero).padStart(2, "0")}`;
    const dossier = NOMS_DOSSIERS_LIVRES[book.numero] ?? p.titre;
    return `« ${p.extrait} »\n[${number} — ${dossier}, ${book.edition} · ${p.section ?? ""} · ${pages}]\n${TITRE_IMPRIME} : ${p.titre}`;
  });
  return items.length === 0 ? AUCUNE_PREUVE_LIVRES : `${PASSAGES_LIVRES}\n\n${items.join("\n\n")}`;
}
