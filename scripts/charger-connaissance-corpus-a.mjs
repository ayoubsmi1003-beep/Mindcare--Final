/** R1 (a) : pipeline offline — manifeste vers candidats quarantaine. */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  FIXTURE_IDS, INTERDITS_MEDICAMENT, MARQUEURS_PATIENT,
  hacherTexteFNV, normaliserMarkdown, normaliserTexte,
  sha256Hex, uuidDeterministe, validerQuarantaine,
} from "./charger-connaissance-socle.mjs";
import { sectionsDeMarkdown } from "./charger-connaissance-decoupe.mjs";
import { analyserEtiquette, canoniqueBrut, lireXlsxPremiereColonne } from "./charger-connaissance-medicaments.mjs";

export function pipelineCorpusA(racine, entrees, rapport) {
  const candidats = [];
  for (const e of entrees) {
    if (e.source_id === "corpus-b-medicaments") continue;
    rapport.decouverts += 1;
    if (FIXTURE_IDS.has(e.source_id)) {
      rapport.rejetes.push({ source_id: e.source_id, motif: "fixture-interdite" });
      continue;
    }
    const fichier = join(racine, "knowledge", "sources", e.source_id, `${e.version}.md`);
    if (!existsSync(fichier)) {
      rapport.rejetes.push({ source_id: e.source_id, motif: "source-introuvable" });
      continue;
    }
    const contenu = normaliserMarkdown(readFileSync(fichier, "utf8"));
    const hash = sha256Hex(contenu);
    const verdict = validerQuarantaine({
      titre: e.titre ?? "", version: e.version ?? "", langue: e.langue ?? "fr",
      classification: e.classification ?? "INCONNU",
      provenance: { emetteur: e.emetteur ?? "", reference: e.reference ?? "" },
      hashContenu: hash, approuvePar: e.approved_by ?? "", approuveLe: e.approved_at ?? "",
      revue: { relecteur: e.reviewed_by ?? "", revueLe: e.reviewed_at ?? "", revueDueLe: e.review_due_at ?? null },
      fixture: e.fixture === true,
    });
    if (!verdict.ok) {
      rapport.rejetes.push({ source_id: e.source_id, motif: verdict.motif });
      continue;
    }
    const sections = sectionsDeMarkdown(contenu);
    if (sections.some((s) => MARQUEURS_PATIENT.some((re) => re.test(s.texte)))) {
      rapport.rejetes.push({ source_id: e.source_id, motif: "contenu-patient-suspect" });
      continue;
    }
    const sourceUuid = uuidDeterministe(`m07-r1|${e.source_id}|${e.version}`);
    const chunks = [];
    const occ = new Map();
    sections.forEach((s, ordinal) => {
      const texteHash = hacherTexteFNV(s.texte);
      const cle = `${e.source_id}|${e.version}|${s.section}|${texteHash}`;
      const occurrence = occ.get(cle) ?? 0;
      occ.set(cle, occurrence + 1);
      chunks.push({ chunkId: hacherTexteFNV([sourceUuid, e.version, s.section, "", texteHash, String(occurrence)].join("|")), section: s.section, ordinal, langue: e.langue, texte: s.texte, texteHash, occurrence });
    });
    candidats.push({ entree: e, sourceUuid, hash, statut: e.statut ?? "reviewed", approbation: verdict.approbation, chunks });
    rapport.acceptes.push({ source_id: e.source_id, chunks: chunks.length, statut: e.statut ?? "reviewed", approbation: verdict.approbation, hash });
    rapport.chunks += chunks.length;
  }
  return candidats;
}
