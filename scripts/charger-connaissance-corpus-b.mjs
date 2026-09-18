/** R1 (b) : catalogue medicaments vers libelles + chunks quarantaine. */
import { join } from "node:path";
import {
  INTERDITS_MEDICAMENT, MARQUEURS_PATIENT,
  hacherTexteFNV, normaliserTexte, sha256Hex,
  uuidDeterministe, validerQuarantaine,
} from "./charger-connaissance-socle.mjs";
import { analyserEtiquette, canoniqueBrut, lireXlsxPremiereColonne } from "./charger-connaissance-medicaments.mjs";

export function pipelineCorpusB(racine, entrees, rapport, limite) {
  const entreeB = entrees.find((e) => e.source_id === "corpus-b-medicaments");
  if (entreeB === undefined) return [];
  rapport.decouverts += 1;
  const brutes = lireXlsxPremiereColonne(join(racine, "docs", "Médicaments.xlsx"));
  const vus = new Map();
  for (const r of brutes) {
    if (r === null || r === undefined) continue;
    const canon = canoniqueBrut(r);
    if (canon === "") continue;
    rapport.medicaments.total += 1;
    const fp = sha256Hex(canon);
    if (vus.has(fp)) { rapport.medicaments.doublons += 1; continue; }
    vus.set(fp, canon);
  }
  rapport.medicaments.uniques = vus.size;
  let lignes = [...vus.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  if (limite !== null && Number.isFinite(limite)) lignes = lignes.slice(0, Math.max(0, limite));
  const libelles = [];
  for (const [fp, canon] of lignes) {
    if (INTERDITS_MEDICAMENT.some((re) => re.test(canon))) { rapport.medicaments.rejetes += 1; continue; }
    if (MARQUEURS_PATIENT.some((re) => re.test(canon))) { rapport.medicaments.rejetes += 1; continue; }
    const { marque, forme, dosage } = analyserEtiquette(canon);
    libelles.push({ marque, forme, dosage, empreinte: fp });
  }
  rapport.medicaments.libelles = libelles.length;
  const sourceUuidB = uuidDeterministe(`m07-r1|corpus-b-medicaments|${entreeB.version}`);
  const hashB = sha256Hex(lignes.map(([fp]) => fp).join("\n"));
  const verdictB = validerQuarantaine({
    titre: entreeB.titre ?? "", version: entreeB.version ?? "", langue: "fr",
    classification: entreeB.classification ?? "INCONNU",
    provenance: { emetteur: entreeB.emetteur ?? "", reference: entreeB.reference ?? "" },
    hashContenu: hashB,
    approuvePar: entreeB.approved_by ?? "", approuveLe: entreeB.approved_at ?? "",
    revue: { relecteur: entreeB.reviewed_by ?? "", revueLe: entreeB.reviewed_at ?? "", revueDueLe: entreeB.review_due_at ?? null },
    fixture: entreeB.fixture === true,
  });
  if (!verdictB.ok) {
    rapport.rejetes.push({ source_id: "corpus-b-medicaments", motif: verdictB.motif, libelles_ignores: libelles.length });
    return [];
  }
  const chunksB = libelles.map((l, i) => {
    const texte = normaliserTexte(`Catalogue — ${l.marque ?? "?"}${l.forme ? ` — ${l.forme}` : ""}${l.dosage ? ` — ${l.dosage}` : ""} [ref ${l.empreinte.slice(0, 12)}]`);
    const texteHash = hacherTexteFNV(texte);
    return { chunkId: hacherTexteFNV([sourceUuidB, entreeB.version, "Catalogue", "", texteHash, "0"].join("|")), section: "Catalogue", ordinal: i, langue: "fr", texte, texteHash, occurrence: 0 };
  });
  const statut = entreeB.statut ?? "classified";
  rapport.acceptes.push({ source_id: "corpus-b-medicaments", chunks: chunksB.length, statut, approbation: verdictB.approbation, hash: hashB });
  rapport.chunks += chunksB.length;
  return [{ entree: entreeB, sourceUuid: sourceUuidB, hash: hashB, statut, approbation: verdictB.approbation, chunks: chunksB }];
}
