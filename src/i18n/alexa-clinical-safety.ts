/** Absence of a row means "nothing recorded or visible", never "the patient has none". */
export const clinicalSafetyCopy = {
  source: "Dossier patient, données cliniques consignées",
  more: "D’autres éléments existent : consultez le dossier pour la liste complète.",
  empty: {
    allergies: "Aucune allergie consignée ou visible avec votre accès. Cela ne prouve pas l’absence d’allergie.",
    adverse_events: "Aucun effet indésirable consigné ou visible avec votre accès. Cela ne prouve pas leur absence.",
    adherence: "Aucune évaluation de l’observance consignée ou visible avec votre accès.",
    measurements: "Aucune mesure consignée ou visible avec votre accès.",
  },
  severityAllergy: { legere: "légère", moderee: "modérée", severe: "sévère", anaphylaxie: "anaphylaxie" },
  severityAdverse: { leger: "léger", modere: "modéré", severe: "sévère", grave: "grave" },
  adherence: { observant: "observant", partiel: "observance partielle", non_observant: "non observant", inconnu: "observance inconnue" },
  adherenceSource: { patient: "patient", entourage: "entourage", pharmacie: "pharmacie", observation_clinique: "observation clinique" },
  measureSource: { consultation: "consultation", laboratoire: "laboratoire", auto_declare: "auto-déclaré" },
  allergiesHeading: (count: number) => `Allergies consignées actives (${count}) :`,
  allergy: (substance: string, severity: string | null, reaction: string | null, date: string) =>
    `${substance}${severity ? `, ${severity}` : ""}${reaction ? `, réaction : ${reaction}` : ""} (consignée le ${date})`,
  allergiesClosed: (count: number) => `${count} allergie(s) consignée(s) ensuite résolue(s) ou réfutée(s).`,
  adverseHeading: (count: number) => `Effets indésirables consignés (${count}) :`,
  adverse: (symptom: string, severity: string, onset: string | null, resolved: string | null) =>
    `${symptom}, ${severity}${onset ? `, depuis le ${onset}` : ""}${resolved ? `, résolu le ${resolved}` : ", non résolu"}`,
  adherenceHeading: (count: number) => `Évaluations d’observance consignées (${count}) :`,
  adherenceRow: (start: string, end: string, status: string, source: string) => `du ${start} au ${end} : ${status} (source : ${source})`,
  measuresHeading: (count: number) => `Mesures consignées (${count}) :`,
  measure: (kind: string, value: string, unit: string, date: string, source: string) => `${kind} : ${value} ${unit} le ${date} (${source})`,
} as const;
