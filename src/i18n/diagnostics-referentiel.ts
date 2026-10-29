/**
 * Aide à la saisie diagnostique — un référentiel court, pas une bibliothèque.
 *
 * Ces libellés sont des EXEMPLES fréquents en pratique psychiatrique adulte.
 * Ils ne sont ni exhaustifs ni prescriptifs : la praticienne reste libre de
 * saisir un autre libellé ou de ne pas coder. Le code est proposé pour éviter
 * les fautes de frappe, jamais pour poser un diagnostic à sa place.
 */
export interface DiagnosticFrequent {
  readonly code: string;
  readonly label: string;
}

export const DIAGNOSTICS_FREQUENTS: readonly DiagnosticFrequent[] = [
  { code: "F32.0", label: "Épisode dépressif léger" },
  { code: "F32.1", label: "Épisode dépressif moyen" },
  { code: "F32.2", label: "Épisode dépressif sévère sans symptômes psychotiques" },
  { code: "F33.1", label: "Trouble dépressif récurrent, épisode actuel moyen" },
  { code: "F34.1", label: "Dysthymie" },
  { code: "F41.1", label: "Trouble anxieux généralisé" },
  { code: "F41.0", label: "Trouble panique" },
  { code: "F41.2", label: "Trouble anxieux et dépressif mixte" },
  { code: "F40.1", label: "Phobie sociale" },
  { code: "F42.2", label: "Trouble obsessionnel-compulsif mixte" },
  { code: "F43.1", label: "État de stress post-traumatique" },
  { code: "F43.2", label: "Trouble de l’adaptation" },
  { code: "F31.3", label: "Trouble bipolaire, épisode actuel dépressif léger ou moyen" },
  { code: "F31.4", label: "Trouble bipolaire, épisode actuel dépressif sévère sans symptômes psychotiques" },
  { code: "F20.0", label: "Schizophrénie paranoïde" },
  { code: "F23.1", label: "Trouble psychotique aigu polymorphe" },
  { code: "F25.0", label: "Trouble schizo-affectif, type bipolaire" },
  { code: "F50.2", label: "Boulimie" },
  { code: "F51.0", label: "Insomnie non organique" },
  { code: "F60.3", label: "Trouble de la personnalité borderline" },
  { code: "F90.0", label: "Trouble de l’activité et de l’attention" },
  { code: "F84.0", label: "Autisme infantile" },
  { code: "F10.2", label: "Syndrome de dépendance alcoolique" },
  { code: "F19.2", label: "Syndrome de dépendance à plusieurs substances" },
  { code: "F45.0", label: "Trouble somatisation" },
];
