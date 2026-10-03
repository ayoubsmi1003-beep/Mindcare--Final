/** Clinical speech templates own every published factual assertion. */
const fr = {
  status: { active: "actif", paused: "en pause", stopped: "arrêté" },
  frequency: { daily: "une fois par jour", twice_daily: "deux fois par jour", three_daily: "trois fois par jour", weekly: "une fois par semaine", as_needed: "si besoin", unknown: "fréquence non renseignée" },
  units: { mg: "mg", g: "g", mcg: "mcg", ml: "ml", tablet: "comprimé(s)", drop: "goutte(s)", unknown: "unité non renseignée" },
  missingDose: "dose non renseignée",
  medication: (name: string, dose: string, status: string, frequency: string) => `Traitement enregistré : ${name}, ${dose}, ${status}, ${frequency}.`,
  consultation: (rank: number, notePresent: boolean, codes: readonly string[]) => `Consultation ${rank} : ${notePresent ? "note disponible" : "aucune note disponible"}.${codes.length ? ` Diagnostic(s) codé(s) enregistré(s) : ${codes.join(", ")}.` : ""} Aucun contenu clinique libre n’a été analysé.`,
};
const ar = {
  status: { active: "نشط", paused: "موقوف مؤقتا", stopped: "متوقف" },
  frequency: { daily: "مرة يوميا", twice_daily: "مرتين يوميا", three_daily: "ثلاث مرات يوميا", weekly: "مرة أسبوعيا", as_needed: "عند الحاجة", unknown: "التكرار غير مسجل" },
  units: { mg: "mg", g: "g", mcg: "mcg", ml: "ml", tablet: "قرص", drop: "قطرة", unknown: "الوحدة غير مسجلة" },
  missingDose: "الجرعة غير مسجلة",
  medication: (name: string, dose: string, status: string, frequency: string) => `العلاج المسجل: ${name}، ${dose}، ${status}، ${frequency}.`,
  consultation: (rank: number, notePresent: boolean, codes: readonly string[]) => `الاستشارة ${rank}: ${notePresent ? "ملاحظة متاحة" : "لا توجد ملاحظة متاحة"}.${codes.length ? ` رموز التشخيص المسجلة: ${codes.join("، ")}.` : ""} لم يُحلل المحتوى السريري الحر.`,
};
const darija = {
  ...ar,
  status: { active: "ما زال نشط", paused: "موقوف مؤقتا", stopped: "متوقف" },
  frequency: { ...ar.frequency, daily: "مرة في النهار", twice_daily: "مرتين في النهار", three_daily: "ثلاث مرات في النهار", weekly: "مرة في السمانة" },
  medication: (name: string, dose: string, status: string, frequency: string) => `العلاج اللي مسجل: ${name}، ${dose}، ${status}، ${frequency}.`,
  consultation: (rank: number, notePresent: boolean, codes: readonly string[]) => `الاستشارة ${rank}: ${notePresent ? "كاينة ملاحظة" : "ما كاش ملاحظة متاحة"}.${codes.length ? ` رموز التشخيص اللي مسجلة: ${codes.join("، ")}.` : ""} محتوى الملاحظة ما تحللش.`,
};
export const alexaClinical = { fr, ar, darija, mixed: darija } as const;
