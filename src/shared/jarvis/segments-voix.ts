export interface SegmentVoix { readonly texte: string; readonly langue: "fr" | "ar" }

/** Keep punctuation with its preceding voice; never translate or remove clinical text. */
export function segmenterVoix(texte: string): readonly SegmentVoix[] {
  const segments: { texte: string; langue: "fr" | "ar" }[] = [];
  let courant: "fr" | "ar" | null = null;
  let tampon = "";
  for (const c of texte) {
    const langue = /\p{Script=Arabic}/u.test(c) && /\p{Letter}/u.test(c) ? "ar"
      : /\p{Script=Latin}/u.test(c) && /\p{Letter}/u.test(c) ? "fr" : null;
    if (langue !== null && courant !== null && langue !== courant) {
      segments.push({ texte: tampon, langue: courant }); tampon = "";
    }
    courant = langue ?? courant; tampon += c;
  }
  if (tampon !== "") segments.push({ texte: tampon, langue: courant ?? "fr" });
  return segments;
}
