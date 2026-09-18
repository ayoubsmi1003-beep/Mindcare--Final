/**
 * `jarvis-egress-exfiltration.test.ts` - M05, batterie d'exfiltration, RED d'abord.
 *
 * NOTE D'ENCODAGE : fichier volontairement ASCII-only (francais sans accents).
 *
 * Tente d'exfiltrer par toutes les voies : identite, clinique, multi-patients,
 * canaux caches (metadonnees, query, erreurs, args d'outil), encodages (JSON
 * imbrique, echappe, unicode, espaces, concatene, base64). Chaque C1/C2 doit
 * donner BLOQUER a la frontiere reelle de classification ; les temoins C4
 * doivent rester AUTORISER (un pare-feu qui bloque tout ne prouve rien).
 */
import { describe, expect, it } from "vitest";

import { classerCharge } from "../../src/server/egress/classification";
import { KARIM, MAHMOUD } from "../fixtures/patients";

function bloque(charge: unknown): void {
  expect(classerCharge(charge, null).decision).toBe("BLOQUER");
}

function autorise(charge: unknown): void {
  expect(classerCharge(charge, null).decision).toBe("AUTORISER");
}

describe("M05 exfiltration - identite", () => {
  it("nom complet", () => bloque({ m: "Karim Djilali va mieux." }));
  it("prenom seul + contexte clinique", () => bloque({ m: "Karim consulte demain pour son angoisse." }));
  it("numero de dossier", () => bloque({ m: `dossier ${KARIM.numeroDossier}` }));
  it("UUID", () => bloque({ args: { patientId: KARIM.id } }));
  it("UUID sans tirets (forme normalisee reelle)", () =>
    bloque({ args: { patientId: "3f2504e04f8911d39a0c0305e82c3301" } }));
  it("telephone colle", () => bloque({ m: "tel 0551234567" }));
  it("telephone international espace", () => bloque({ m: "tel +213 551234567" }));
  it("courriel", () => bloque({ m: "contact nadia.belkacem@example.dz pour suivi" }));
  it("adresse par son nom de voie", () => bloque({ m: "12 rue Didouche Mourad, Alger" }));
  it("jeton stable", () => bloque({ m: "le cas {{PATIENT_001}} evolue bien" }));
});

describe("M05 exfiltration - clinique", () => {
  it("SOAP nomme", () =>
    bloque({
      m: "S: Karim dit dormir mal. O: tendu. A: anxiete. P: poursuivre sertraline.",
    }));
  it("resume + jeton", () =>
    bloque({ m: "Resume {{PATIENT_002}} : depression severe, arret de travail." }));
  it("traitement + nom", () =>
    bloque({ m: `${MAHMOUD.libelle} : sertraline 50 mg, 1/j pendant 30 jours.` }));
  it("deux patients compares", () =>
    bloque({ m: `Difference entre ${KARIM.libelle} et ${MAHMOUD.libelle} ?` }));
});

describe("M05 exfiltration - canaux caches", () => {
  it("metadonnees JSON", () => bloque({ metadata: { patient: "Karim Djilali" } }));
  it("query string", () => bloque({ url: "/api/x?name=Karim+Djilali" }));
  it("objet d'erreur", () => bloque({ error: { message: `echec pour ${KARIM.id}` } }));
  it("args d'outil", () =>
    bloque({ outil: "create_appointment", args: { patientId: KARIM.id, notesAdmin: "Karim" } }));
  it("en-tete applicative", () => bloque({ headers: { "x-patient": "Karim Djilali" } }));
  it("telemetrie deguisee", () => bloque({ event: "tour", patient: "Karim Djilali" }));
});

describe("M05 exfiltration - encodages", () => {
  it("JSON imbrique profond", () =>
    bloque({ a: { b: { c: { note: "Karim Djilali consulte." } } } }));
  it("chaine echappee", () =>
    bloque(JSON.stringify({ m: "Karim Djilali consulte." })));
  it("variante unicode pleine largeur", () =>
    bloque({ m: "Ｋａｒｉｍ Ｄｊｉｌａｌｉ consulte." }));
  it("espaces interlettres", () => bloque({ m: "K a r i m D j i l a l i consulte." }));
  it("telephone sans espaces", () => bloque({ m: "joint au 00213551234567" }));
  it("base64 du nom", () =>
    bloque({ m: `piece jointe ${Buffer.from("Karim Djilali", "utf8").toString("base64")}` }));
  it("tableau de fragments", () =>
    bloque({ fragments: ["Karim", " ", "Djilali", " consulte"] }));
});

describe("M05 exfiltration - temoins C4 non bloques", () => {
  it("connaissance", () => autorise({ m: "Explique-moi le trouble panique." }));
  it("agregat nu non declare bloque (pas de recu)", () =>
    bloque({ total: 45000, devise: "DZD" }));
  it("suivi nu sans personne", () => autorise({ m: "Et avant ?" }));
});
