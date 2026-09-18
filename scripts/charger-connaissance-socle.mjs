/**
 * charger-connaissance-socle — M07 R1 · socle offline du chargeur (ADR-037).
 * Hachage, UUID deterministe, miroir validerSource, decoupage borne,
 * lecture XLSX, etiquettes medicaments. Zero reseau. (1/2)
 */
import { createHash } from "node:crypto";
import AdmZip from "adm-zip";

export const FIXTURE_IDS = new Set([
  "guide-anxiete", "guide-sevrage", "guide-panique", "guide-humeur",
  "dalil-qalaq", "dalil-halaa", "nasiha-qalaq", "notice-paroxetine",
  "guide-anxiete-v2024", "guide-revue-due", "guide-piege-inerte", "note-compta",
  // Les trois derniers fermes par PARITE avec le corpus d'eval (15 fixtures) :
  // un protocole revoque, un brouillon de posologie, un resume de cas C2.
  "ancien-protocole", "brouillon-poso", "synthese-cas",
]);
export const INTERDITS_MEDICAMENT = [
  /posologie/i, /indication/i, /contre-indication/i, /contreindication/i,
  /traitement\s*:/i, /prescr/i,
];
export const MARQUEURS_PATIENT = [
  /\bD-\d/i, /\bP\d{2,}\b/, /{{\s*PATIENT/i, /patient_id/i,
  /Karim|Belkacem|Nadia|Mahmoud/i, /0[5-7]\d{8}/,
];
export function sha256Hex(t) {
  return createHash("sha256").update(t, "utf8").digest("hex");
}
export function normaliserMarkdown(t) {
  return t.normalize("NFKC").replace(/\r\n/g, "\n").trim() + "\n";
}
export function normaliserTexte(t) {
  return t.normalize("NFKC").replace(/\s+/g, " ").trim();
}
export function hacherTexteFNV(c) {
  let h = 0x811c9dc5;
  for (let i = 0; i < c.length; i++) {
    h ^= c.charCodeAt(i) ?? 0;
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
export function uuidDeterministe(nom) {
  const NS = Buffer.from("6ba7b8119dad11d180b400c04fd430c8", "hex");
  const h = createHash("sha1").update(Buffer.concat([NS, Buffer.from(nom, "utf8")])).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}
/** Miroir de validerSource — parite assertee en test R1. */
export function validerDossierLocal(d) {
  if (d.fixture === true) return { ok: false, motif: "fixture-interdite" };
  if ((d.titre ?? "").trim() === "") return { ok: false, motif: "titre-manquant" };
  if ((d.version ?? "").trim() === "") return { ok: false, motif: "version-manquante" };
  if (d.classification !== "C4") return { ok: false, motif: "classification-non-c4" };
  if ((d.provenance?.emetteur ?? "").trim() === "" || (d.provenance?.reference ?? "").trim() === "") {
    return { ok: false, motif: "provenance-incomplete" };
  }
  if (!/^[0-9a-f]{8,128}$/i.test(d.hashContenu ?? "")) return { ok: false, motif: "hash-manquant" };
  if ((d.approuvePar ?? "").trim() === "" || (d.approuveLe ?? "").trim() === "") {
    return { ok: false, motif: "approbation-incomplete" };
  }
  if ((d.revue?.relecteur ?? "").trim() === "" || (d.revue?.revueLe ?? "").trim() === "") {
    return { ok: false, motif: "revue-incomplete" };
  }
  return { ok: true };
}
/**
 * Regle QUARANTAINE R1 : les rejets durs (structure, C4, provenance, hash,
 * fixture) bloquent le staging. Une approbation/revue manquante ne bloque
 * PAS le staging : le dossier reste en statut non-actif avec l'exigence
 * explicite `approbation: "en-attente"` — l'activation (R3) exige l'acte
 * humain signe. Aucune approbation n'est jamais inventee ici.
 */
export function validerQuarantaine(d) {
  if (d.fixture === true) return { ok: false, motif: "fixture-interdite", approbation: "n/a" };
  if ((d.titre ?? "").trim() === "") return { ok: false, motif: "titre-manquant", approbation: "n/a" };
  if ((d.version ?? "").trim() === "") return { ok: false, motif: "version-manquante", approbation: "n/a" };
  if (d.classification !== "C4") return { ok: false, motif: "classification-non-c4", approbation: "n/a" };
  if ((d.provenance?.emetteur ?? "").trim() === "" || (d.provenance?.reference ?? "").trim() === "") {
    return { ok: false, motif: "provenance-incomplete", approbation: "n/a" };
  }
  if (!/^[0-9a-f]{8,128}$/i.test(d.hashContenu ?? "")) return { ok: false, motif: "hash-manquant", approbation: "n/a" };
  const approbationOk = (d.approuvePar ?? "").trim() !== "" && (d.approuveLe ?? "").trim() !== "";
  const revueOk = (d.revue?.relecteur ?? "").trim() !== "" && (d.revue?.revueLe ?? "").trim() !== "";
  if (!approbationOk || !revueOk) return { ok: true, motif: null, approbation: "en-attente" };
  return { ok: true, motif: null, approbation: "signee" };
}
