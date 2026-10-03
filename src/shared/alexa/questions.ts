/** Only explicit clause boundaries are split; a topic joined by "et" stays whole. */
export function splitAlexaQuestions(text: string): readonly string[] | null {
  const parts: string[] = [];
  let part = "", quote: string | null = null;
  const append = () => { if (part.trim()) parts.push(part.trim()); part = ""; };
  const french = /^[ \t]+et(?:\s+aussi)?\s+(?=(?:quel(?:le)?s?\b|comment\b|pourquoi\b|combien\b|r[eé]sum|montre\b|donne\b|explique\b|compare\b|(?:son|sa|ses|le|la|les)\s+(?:diagnosti|traitement|notes?|scores?|derni[eè]re)))/iu;
  const arabic = /^[ \t]+و\s*(?=(?:واش|وش|ما\s+(?:هو|هي)|شحال|لخص|قارن|اشرح|عطيني))/u;
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (quote) { part += char; if (char === quote) quote = null; continue; }
    if (char === '"' || char === "«" || char === "“") { quote = char === "«" ? "»" : char === "“" ? "”" : char; part += char; continue; }
    const connector = french.exec(text.slice(index)) ?? arabic.exec(text.slice(index));
    if (connector && part.trim()) { append(); index += connector[0].length - 1; }
    else if (char === ";" || char === "؛" || char === "\n" || char === "?" || char === "؟") { if (char === "?" || char === "؟") part += char; append(); }
    else part += char;
    if (parts.length > 3) return null;
  }
  append();
  // An anaphoric clause needs its preceding clinical/public subject. Keep the
  // complete request together instead of sending an unresolved pronoun away.
  if (parts.slice(1).some(part => /^(?:et\s+)?(?:comment\s+(?:cela|ca|ceci|la\s+traiter|le\s+traiter)|pourquoi\s*(?:[?؟!.]|$)|how\s+(?:does\s+it|can\s+(?:it|this|that))|why\s*(?:[?؟!.]|$)|كيف\s+\S*\s*(?:هذا|ذلك)|لماذا\s*(?:[?؟!.]|$))/iu.test(part.normalize("NFKD").replace(/\p{M}/gu, "")))) return [text.trim()];
  return parts.length > 3 ? null : parts.length ? parts : [text];
}
