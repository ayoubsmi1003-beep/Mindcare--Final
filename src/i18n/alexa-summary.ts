import type { AlexaLanguage } from "@/shared/alexa/request-plan";

export const alexaSummary = {
  dossier: "Dossier clinique",
  consultation: (date: string, notes: number) => `Consultation du ${date} · ${notes} note(s) SOAP enregistrée(s).`,
  structured: "Les informations enregistrées du dossier, les traitements et les cinq rubriques de notes disponibles. Chaque élément renvoie à sa source.",
  noteDetails: "Notes de consultation",
  // Spoken leads, never the SOAP headings: the doctor hears where a sentence comes from in plain words.
  noteAreas: { working: "dans vos notes de travail", subjective: "à l’entretien", objective: "à l’examen", assessment: "dans votre évaluation", plan: "pour la suite" },
  noteProvenance: (label: string, text: string, unsigned: boolean) => `${label}${unsigned ? " (note non signée)" : ""}, « ${text} »`,
  noteDetail: (date: string, text: string, open: boolean) => `${open ? "Pendant la consultation en cours" : `Lors de la consultation du ${date}`}, ${text}`,
  consultationNotes: (date: string, open: boolean, parts: readonly string[]) => `${open ? "Pendant la consultation en cours" : `Lors de la consultation du ${date}`}, ${parts.join(" ; ")}.`,
  noteLimits: "Certains passages longs ou contenant des instructions ne sont pas affichés ; ouvrez leurs sources pour consulter les notes complètes.",
  treatments: "Traitements et états",
  diagnoses: "Diagnostics enregistrés",
  recentDetails: "Notes et éléments récents",
  recent: "Parcours récent",
  recordedDiagnoses: (labels: string) => `Le suivi porte sur ${labels}.`,
  noDiagnoses: "Aucun diagnostic non résolu n’est renseigné dans les données disponibles.",
  recordedTreatments: (details: string) => `Côté traitements : ${details}.`,
  noTreatments: "Aucun traitement n’est renseigné dans les données disponibles.",
  recordedTreatment: (medication: string, dose: string, frequency: string, status: string) => `${medication} ${dose}, ${frequency} (${status})`,
  missingDose: "dose non renseignée",
  missingUnit: "unité non renseignée",
  missingFrequency: "fréquence non renseignée",
  doseWithSeparateUnit: (dose: string, unit: string) => `${dose} (unité enregistrée : ${unit})`,
  lastCompleted: (date: string, notes: number) => `La dernière consultation terminée date du ${date}${notes === 0 ? " et ne comporte pas encore de note" : ""}.`,
  lastExcerpt: (date: string, text: string, amendment: boolean, area?: string, unsigned = false) => `Lors de la dernière consultation, le ${date}, ${amendment ? "dans l’addendum" : area ?? "vous notiez"}${unsigned ? " (note non signée)" : ""}, « ${text} »`,
  noCompleted: "Aucune consultation terminée n’est disponible dans le contexte lu.",
  // Said only when something is missing; a complete reading needs no disclaimer.
  narrativeLimits: (returned: number, requested: number, partial: boolean, historyComplete: boolean) =>
    [partial ? `Je n’ai lu que ${returned} des ${requested} consultations demandées` : "", historyComplete ? "" : "l’historique des traitements est incomplet"].filter(Boolean).join(" et ").replace(/^l’/u, "L’").concat(partial || !historyComplete ? "." : ""),
} as const;

const arabicSummary = {
  dossier: "الملف السريري",
  consultation: (date: string, notes: number) => `استشارة بتاريخ ${date} · ${notes} ملاحظة SOAP مسجّلة.`,
  structured: "ملخص للبيانات المسجّلة مع مقطع محلي من آخر ملاحظة متاحة. الملاحظات والإضافات الكاملة متاحة من المصادر.",
  noteDetails: "ملاحظات الاستشارة",
  noteAreas: { working: "ملاحظات العمل", subjective: "ما يذكره المريض", objective: "الملاحظة الموضوعية", assessment: "التقييم", plan: "الخطة" },
  noteProvenance: (label: string, text: string, unsigned: boolean) => `${label}${unsigned ? " · غير موقّعة" : ""}: « ${text} »`,
  noteDetail: (date: string, text: string, open: boolean) => `${date}${open ? " · استشارة جارية" : " · استشارة مكتملة"} — ${text}`,
  consultationNotes: (date: string, open: boolean, parts: readonly string[]) => `${date}${open ? " · استشارة جارية" : " · استشارة مكتملة"} — ${parts.join("؛ ")}`,
  noteLimits: "بعض المقاطع الطويلة أو التي تحتوي على تعليمات لا تُعرض؛ افتحي المصادر لقراءة الملاحظات الكاملة.",
  treatments: "العلاج وحالاته",
  diagnoses: "التشخيصات المسجّلة",
  recentDetails: "الملاحظات والعناصر الأخيرة",
  recent: "التطور الأخير المسجّل",
  recordedDiagnoses: (labels: string) => `التشخيصات المسجّلة وغير المحلولة: ${labels}.`,
  noDiagnoses: "ما كاينش تشخيص غير محلول مسجّل في البيانات المتاحة.",
  recordedTreatments: (details: string) => `العلاجات المسجّلة: ${details}.`,
  noTreatments: "ما كاينش علاج مسجّل في البيانات المتاحة.",
  recordedTreatment: (medication: string, dose: string, frequency: string, status: string) => `${medication} (الجرعة: ${dose}؛ التكرار: ${frequency}؛ الحالة: ${status})`,
  missingDose: "الجرعة غير مسجّلة",
  missingUnit: "الوحدة غير مسجّلة",
  missingFrequency: "التكرار غير مسجّل",
  doseWithSeparateUnit: (dose: string, unit: string) => `${dose} (الوحدة المسجّلة: ${unit})`,
  lastCompleted: (date: string, notes: number) => `آخر استشارة مكتملة متاحة بتاريخ ${date}، مع ${notes} ملاحظة SOAP مسجّلة.`,
  lastExcerpt: (date: string, text: string, amendment: boolean, area?: string, unsigned = false) => `آخر استشارة مكتملة بتاريخ ${date}، ${amendment ? "مقطع من إضافة" : area ?? "مقطع من ملاحظة"}${unsigned ? " · غير موقّعة" : ""}: « ${text} »`,
  noCompleted: "ما كاينش استشارة مكتملة متاحة في السياق المقروء.",
  narrativeLimits: (returned: number, requested: number, partial: boolean, historyComplete: boolean) =>
    `لا يتم تفسير الملاحظات${partial ? `؛ تغطية الاستشارات جزئية (${returned} من ${requested} مطلوبة)` : ""}${historyComplete ? "" : "؛ تاريخ العلاجات غير كامل"}.`,
} as const;

/** The patient-page artifact stays French; dialogue follows the current turn. */
export function summaryDialogue(language: AlexaLanguage = "fr") { return language === "fr" ? alexaSummary : arabicSummary; }
