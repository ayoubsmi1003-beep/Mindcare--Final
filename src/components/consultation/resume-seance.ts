/**
 * Le résumé lisible d'une séance, partagé par la fiche patient, la chronologie
 * et l'historique de consultation.
 *
 * Deux niveaux, jamais mélangés :
 *   · une analyse enregistrée est une synthèse assistée — elle est affichée
 *     telle quelle, sans être réécrite ;
 *   · sans analyse, on compose un RÉSUMÉ FACTUEL à partir des seuls champs
 *     enregistrés (SOAP, plan). Aucune inférence, aucun fait ajouté.
 *
 * Le texte est toujours ramené à un paragraphe : les notes structurées en
 * listes ne doivent pas arriver telles quelles dans la carte.
 */

import type { AnalyseSeance } from "@/services/jarvis";
import type { Consultation } from "@/services/consultations";

export type SourceResumeSeance = "analyse" | "factuel" | "aucun";

export interface ResumeSeance {
  readonly texte: string;
  readonly source: SourceResumeSeance;
  readonly actions: readonly string[];
}

function propre(value: string | null | undefined): string {
  const lignes = (value ?? "")
    .replace(/\r\n?/gu, "\n")
    .split("\n")
    .map((ligne) => ligne.replace(/^[\s•·▪◦\-–—]+/u, "").trim())
    .filter((ligne) => ligne !== "");
  let texte = "";
  for (const ligne of lignes) {
    if (texte === "") {
      texte = ligne;
      continue;
    }
    texte += `${/[;.!?…]$/u.test(texte) ? " " : " ; "}${ligne}`;
  }
  return texte.replace(/\s{2,}/gu, " ").trim();
}

function phrase(value: string | null | undefined, max = 420): string {
  const text = propre(value);
  if (text === "") return "";
  const first = text.split(/(?<=[.!?…])\s+/u)[0] ?? text;
  const coupe = first.length <= max ? first : `${first.slice(0, max).replace(/[;,:\s]+$/u, "")}…`;
  return /[.!?…]$/u.test(coupe) ? coupe : `${coupe}.`;
}

function paragraphe(parts: readonly string[]): string {
  return parts.map(propre).filter((part) => part !== "").join(" ");
}

function minusculeInitiale(value: string): string {
  return value === "" ? value : value.charAt(0).toLocaleLowerCase("fr") + value.slice(1);
}

/** Compose les actions de la séance à partir du plan et des échelles. */
function actionsDe(analyse: AnalyseSeance | null, seance: Consultation | null): readonly string[] {
  const plan = analyse?.noteStructuree.plan ?? seance?.note?.soap.plan ?? "";
  const actions = propre(plan)
    .split(/[;.!?…]\s*/u)
    .map((entry) => propre(entry))
    .filter((entry) => entry !== "");
  return actions;
}

/**
 * Rend le paragraphe à afficher. `analyse` gagne toujours : c'est le texte
 * produit par le geste « Analyser la séance », et le remplacer par une
 * recomposition locale romprait la provenance.
 */
export function resumeDeSeance(
  analyse: AnalyseSeance | null,
  seance: Consultation | null,
): ResumeSeance {
  const analyseTexte = propre(analyse?.resume);
  if (analyseTexte !== "") {
    return {
      texte: analyseTexte,
      source: "analyse",
      actions: actionsDe(analyse, seance),
    };
  }

  const note = seance?.note ?? null;
  const subjective = note === null ? "" : phrase(note.soap.subjective);
  const objective = note === null ? "" : phrase(note.soap.objective);
  const assessment = note === null ? "" : phrase(note.soap.assessment);
  const plan = note === null ? "" : phrase(note.soap.plan);

  const parties: string[] = [];
  if (subjective !== "") parties.push(`La séance documente : ${minusculeInitiale(subjective)}`);
  if (objective !== "") parties.push(`L’examen retrouve : ${minusculeInitiale(objective)}`);
  if (assessment !== "") parties.push(`L’évaluation clinique retient : ${minusculeInitiale(assessment)}`);
  if (plan !== "") parties.push(`La conduite retenue est : ${minusculeInitiale(plan)}`);

  if (parties.length === 0 && analyse !== null) {
    const structuree = analyse.noteStructuree;
    if (propre(structuree.subjective) !== "") parties.push(`La séance documente : ${minusculeInitiale(phrase(structuree.subjective))}`);
    if (propre(structuree.objective) !== "") parties.push(`L’examen retrouve : ${minusculeInitiale(phrase(structuree.objective))}`);
    if (propre(structuree.assessment) !== "") parties.push(`L’évaluation clinique retient : ${minusculeInitiale(phrase(structuree.assessment))}`);
    if (propre(structuree.plan) !== "") parties.push(`La conduite retenue est : ${minusculeInitiale(phrase(structuree.plan))}`);
  }

  const texte = paragraphe(parties);
  return {
    texte,
    source: texte === "" ? "aucun" : "factuel",
    actions: actionsDe(analyse, seance),
  };
}
