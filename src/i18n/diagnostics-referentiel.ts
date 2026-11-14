/** Référentiel de sélection explicite, sans diagnostic présélectionné. */
export interface DiagnosticFrequent {
  readonly code: string;
  readonly codeSystem: "ICD-10";
  readonly label: string;
}

export const DIAGNOSTICS_FREQUENTS: readonly DiagnosticFrequent[] = [
  { codeSystem: "ICD-10", code: "F32.0", label: "Épisode dépressif léger" },
  { codeSystem: "ICD-10", code: "F32.1", label: "Épisode dépressif moyen" },
  { codeSystem: "ICD-10", code: "F32.2", label: "Épisode dépressif sévère sans symptômes psychotiques" },
  { codeSystem: "ICD-10", code: "F33.1", label: "Trouble dépressif récurrent, épisode actuel moyen" },
  { codeSystem: "ICD-10", code: "F34.1", label: "Dysthymie" },
  { codeSystem: "ICD-10", code: "F41.1", label: "Trouble anxieux généralisé" },
  { codeSystem: "ICD-10", code: "F41.0", label: "Trouble panique" },
  { codeSystem: "ICD-10", code: "F41.2", label: "Trouble anxieux et dépressif mixte" },
  { codeSystem: "ICD-10", code: "F40.1", label: "Phobie sociale" },
  { codeSystem: "ICD-10", code: "F42.2", label: "Trouble obsessionnel-compulsif mixte" },
  { codeSystem: "ICD-10", code: "F43.1", label: "État de stress post-traumatique" },
  { codeSystem: "ICD-10", code: "F43.2", label: "Trouble de l’adaptation" },
  { codeSystem: "ICD-10", code: "F31.3", label: "Trouble bipolaire, épisode actuel dépressif léger ou moyen" },
  { codeSystem: "ICD-10", code: "F31.4", label: "Trouble bipolaire, épisode actuel dépressif sévère sans symptômes psychotiques" },
  { codeSystem: "ICD-10", code: "F20.0", label: "Schizophrénie paranoïde" },
  { codeSystem: "ICD-10", code: "F23.1", label: "Trouble psychotique aigu polymorphe" },
  { codeSystem: "ICD-10", code: "F25.0", label: "Trouble schizo-affectif, type bipolaire" },
  { codeSystem: "ICD-10", code: "F50.2", label: "Boulimie" },
  { codeSystem: "ICD-10", code: "F51.0", label: "Insomnie non organique" },
  { codeSystem: "ICD-10", code: "F60.3", label: "Trouble de la personnalité borderline" },
  { codeSystem: "ICD-10", code: "F90.0", label: "Trouble de l’activité et de l’attention" },
  { codeSystem: "ICD-10", code: "F84.0", label: "Autisme infantile" },
  { codeSystem: "ICD-10", code: "F10.2", label: "Syndrome de dépendance alcoolique" },
  { codeSystem: "ICD-10", code: "F19.2", label: "Syndrome de dépendance à plusieurs substances" },
  { codeSystem: "ICD-10", code: "F45.0", label: "Trouble somatisation" },
];
