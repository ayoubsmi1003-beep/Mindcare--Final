import { describe, expect, it } from "vitest";
import { parsePatientMention } from "@/shared/alexa/patient-mention";

describe("Alexa patient identity grammar stays local and explicit", () => {
  // Dropping contracted/elided introducers or capturing request modifiers
  // would lose the requested identity before the audited resolver receives it.
  it.each([
    ["traitement du belkacem mohamed", "belkacem mohamed"],
    ["note du consultations du consultation passée du nadia belkacem", "nadia belkacem"],
    ["notes de la consultation passée de Nadia Belkacem", "Nadia Belkacem"],
    ["notes de la patiente Nadia Belkacem", "Nadia Belkacem"],
    ["traitement de la Nadia Belkacem", "Nadia Belkacem"],
    ["notes d'Inès Haddad", "Inès Haddad"],
    ["notes d’Inès Haddad", "Inès Haddad"],
    ["notes de l'Inès Haddad", "Inès Haddad"],
    ["notes de l’Inès Haddad", "Inès Haddad"],
    ["notes des consultations passées de Nadia Belkacem", "Nadia Belkacem"],
    ["traitement du patient Lithium", "Lithium"],
    ["traitement de «Nadia Belkacem»", "Nadia Belkacem"],
    ["Explique le traitement selon le livre de Stahl pour Nadia Belkacem", "Nadia Belkacem"],
    ["notes de Nadia Belkacem d'après la dernière consultation", "Nadia Belkacem"],
    ["traitement du Jean D'Angelo", "Jean D'Angelo"],
    ["traitement Jean D’Angelo", "Jean D’Angelo"],
    ["traitement du patient D'Angelo", "D'Angelo"],
    ["notes de «Jean D'Angelo»", "Jean D'Angelo"],
    ["traitement du Nadia", "Nadia"],
    ["notes de la consultation passée d'Inès", "Inès"],
    ["Quels sont les symptômes de Nadia Test ?", "Nadia Test"],
    ["Quels sont les symptômes du patient Nadia ?", "Nadia"],
    ["Quels sont les symptômes de «Nadia» ?", "Nadia"],
    ["traitement du Parkinson", "Parkinson"],
  ])("extracts only the stated patient name: %s", (text, name) => {
    expect(parsePatientMention(text)).toEqual({ status: "named", name });
  });

  // Promoting grammar, an unquoted drug, or an explicitly introduced book
  // author to an identity would wrongly change a general/local-context request.
  it.each([
    "notes de la consultation passée",
    "notes des consultations passées",
    "traitement du patient",
    "notes de l'ancienne consultation",
    "traitement du trouble bipolaire",
    "traitement de la dépression",
    "traitement de l'anxiété",
    "traitement d'une dépression",
    "notes de la dernière consultation du 21 mai",
    "traitement du lithium",
    "traitement d'escitalopram",
    "Quelle est la posologie de l'escitalopram ?",
    "Explique le traitement selon le livre de Stahl",
    "Explique le traitement selon les livres de Taylor",
    "diagnostic selon le DSM",
    "Quels sont les symptômes du diabète ?",
    "Quelle est la définition du diabète ?",
    "Quelle est la taille du Soleil ?",
    "Quels sont les symptômes de diabète ?",
    "Quelle est la définition de diabète ?",
    "Quelle est la taille de Soleil ?",
    "Quels sont les symptômes du Parkinson ?",
    "Quels sont les symptômes de pneumonie ?",
    "Quel est le diagnostic de pneumonie ?",
    "Explique les symptômes du Parkinson",
    "Explique le diagnostic de pneumonie",
    "Quels sont les symptômes du Parkinson et de pneumonie ?",
  ])("does not treat grammar or clinical/knowledge topics as a patient: %s", text => {
    expect(parsePatientMention(text)).toEqual({ status: "none" });
  });

  // Consuming later introducers or selecting one of several identities would
  // bypass the local ambiguity choice that the resolver/orchestrator preserves.
  it.each([
    "traitement du Nadia Belkacem et du Karim Haddad",
    "notes d'Inès Haddad et de Nadia Belkacem",
    "notes de la Nadia Belkacem pour Karim Haddad",
    "traitement de «Nadia Belkacem» pour Karim Haddad",
    "Quels sont les symptômes de Nadia Belkacem et de Karim Haddad ?",
  ])("keeps multiple explicit identities ambiguous: %s", text => {
    expect(parsePatientMention(text)).toEqual({ status: "ambiguous" });
  });
});
