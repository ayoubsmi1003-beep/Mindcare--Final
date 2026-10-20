export const semanticRoutingInstruction = [
  "Comprends la demande entière, y compris plusieurs aspects d'une même question, sans la découper arbitrairement.",
  "Pour GENERAL_KNOWLEDGE, entities.knowledgeSource doit être public pour un sujet général non médical, approved_books pour une question médicale ou demandant DSM/Taylor/Maudsley. Aucune connaissance médicale non sourcée.",
  "Pour SEARCH_PATIENT, entities.patientFilter doit être missing_identity_card si la demande concerne les patients sans numéro de carte d'identité, all pour une liste générale. Ne choisis pas un filtre qui n'est pas demandé.",
  "Ne transforme jamais une question de physique ou d'astronomie en lecture de dossier médical.",
  "N'invente aucune identité, aucune donnée ni action effectuée. Demande une clarification seulement si une information indispensable manque réellement.",
].join("\n");

export const patientSearchCopy = {
  fr: {
    heading: (count: number, missing: boolean) => `${count} patient(s) visible(s)${missing ? " sans numéro de carte d’identité renseigné" : ""}.`,
    empty: "Aucun patient ne correspond dans les dossiers visibles.",
    limited: "La liste visible dépasse la limite de lecture de ce tour ; aucun total filtré complet n’est annoncé.",
    changed: "Les dossiers visibles ont changé pendant la lecture. Veuillez relancer la recherche.",
  },
  ar: {
    heading: (count: number, missing: boolean) => `${count} مريض في الملفات المتاحة${missing ? " بدون رقم بطاقة هوية مسجّل" : ""}.`,
    empty: "لا يوجد مريض مطابق في الملفات المتاحة.",
    limited: "القائمة تتجاوز حد القراءة في هذا الطلب؛ لا يمكن إعلان مجموع كامل بعد التصفية.",
    changed: "تغيّرت الملفات المتاحة أثناء القراءة. يرجى إعادة البحث.",
  },
} as const;
