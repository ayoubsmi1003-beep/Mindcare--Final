import type { AlexaLanguage } from "@/shared/alexa/request-plan";

export const alexaSummary = {
  dossier: "Dossier clinique",
  consultation: (date: string, notes: number) => `Consultation du ${date} · ${notes} note(s) SOAP enregistrée(s).`,
  structured: "Les informations enregistrées du dossier, les traitements et les cinq rubriques de notes disponibles. Chaque élément renvoie à sa source.",
  noteDetails: "Notes de consultation",
  noteAreas: { working: "Notes de travail", subjective: "Subjectif", objective: "Objectif", assessment: "Évaluation", plan: "Plan" },
  noteProvenance: (label: string, text: string, unsigned: boolean) => `${label}${unsigned ? " · non signé" : ""} : « ${text} »`,
  noteDetail: (date: string, text: string, open: boolean) => `${date}${open ? " · consultation en cours" : " · consultation terminée"} — ${text}`,
  noteLimits: "Certains passages longs ou contenant des instructions ne sont pas affichés ; ouvrez leurs sources pour consulter les notes complètes.",
  treatments: "Traitements et états",
  diagnoses: "Diagnostics enregistrés",
  recentDetails: "Notes et éléments récents",
  recent: "Parcours récent",
  recordedDiagnoses: (labels: string) => `Les diagnostics non résolus enregistrés sont : ${labels}.`,
  noDiagnoses: "Aucun diagnostic non résolu n’est renseigné dans les données disponibles.",
  recordedTreatments: (details: string) => `Les traitements enregistrés sont : ${details}.`,
  noTreatments: "Aucun traitement n’est renseigné dans les données disponibles.",
  recordedTreatment: (medication: string, dose: string, frequency: string, status: string) => `${medication} (dose : ${dose} ; fréquence : ${frequency} ; état : ${status})`,
  missingDose: "dose non renseignée",
  missingUnit: "unité non renseignée",
  missingFrequency: "fréquence non renseignée",
  doseWithSeparateUnit: (dose: string, unit: string) => `${dose} (unité enregistrée : ${unit})`,
  lastCompleted: (date: string, notes: number) => `La dernière consultation terminée disponible date du ${date}, avec ${notes} note(s) SOAP enregistrée(s).`,
  lastExcerpt: (date: string, text: string, amendment: boolean, area?: string, unsigned = false) => `Dernière consultation terminée du ${date}, ${amendment ? "extrait d’addendum" : area ?? "extrait de note"}${unsigned ? " · non signé" : ""} : « ${text} »`,
  noCompleted: "Aucune consultation terminée n’est disponible dans le contexte lu.",
  narrativeLimits: (returned: number, requested: number, partial: boolean, historyComplete: boolean) =>
    `Les notes ne sont pas interprétées${partial ? ` ; la couverture des consultations est partielle (${returned} sur ${requested} demandées)` : ""}${historyComplete ? "" : " ; l’historique des traitements est incomplet"}.`,
} as const;

const arabicSummary = {
  dossier: "الملف السريري",
  consultation: (date: string, notes: number) => `استشارة بتاريخ ${date} · ${notes} ملاحظة SOAP مسجّلة.`,
  structured: "ملخص للبيانات المسجّلة مع مقطع محلي من آخر ملاحظة متاحة. الملاحظات والإضافات الكاملة متاحة من المصادر.",
  noteDetails: "ملاحظات الاستشارة",
  noteAreas: { working: "ملاحظات العمل", subjective: "ما يذكره المريض", objective: "الملاحظة الموضوعية", assessment: "التقييم", plan: "الخطة" },
  noteProvenance: (label: string, text: string, unsigned: boolean) => `${label}${unsigned ? " · غير موقّعة" : ""}: « ${text} »`,
  noteDetail: (date: string, text: string, open: boolean) => `${date}${open ? " · استشارة جارية" : " · استشارة مكتملة"} — ${text}`,
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
