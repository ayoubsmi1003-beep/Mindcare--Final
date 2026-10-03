import type { AlexaLanguage } from "@/shared/alexa/request-plan";

export const questionCopy = (language: AlexaLanguage) => language === "fr" ? {
  heading: (index: number) => `Question ${index}`,
  generalUnavailable: "La réponse générale est indisponible pour le moment. Réessayez votre question.",
  generalRestricted: "Précisez une question générale sans données personnelles. Pour une question clinique, indiquez le dossier ou la référence recherchée.",
  limit: "Posez au maximum trois questions indépendantes par message. Je peux les traiter dans l’ordre.",
} : {
  heading: (index: number) => `السؤال ${index}`,
  generalUnavailable: "الإجابة العامة غير متوفرة الآن. عاود السؤال من فضلك.",
  generalRestricted: "وضح سؤالا عاما دون معلومات شخصية. للسؤال السريري حدد الملف أو المرجع المطلوب.",
  limit: "اكتب ثلاثة أسئلة مستقلة كحد أقصى في الرسالة. نقدر نجاوب عليها بالترتيب.",
};
