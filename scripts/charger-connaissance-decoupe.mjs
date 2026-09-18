import { normaliserTexte } from "./charger-connaissance-socle.mjs";

export const LIMITE_PARAGRAPHE = 2000;
export function couperLong(texte) {
  if (texte.length <= LIMITE_PARAGRAPHE) return [texte];
  const phrases = texte.split(/(?<=[.!?;:\n])\s+/);
  const morceaux = [];
  let courant = "";
  for (const phrase of phrases) {
    const candidat = courant === "" ? phrase : `${courant} ${phrase}`;
    if (candidat.length <= LIMITE_PARAGRAPHE) courant = candidat;
    else {
      if (courant !== "") morceaux.push(courant);
      courant = phrase;
    }
  }
  if (courant !== "") morceaux.push(courant);
  return morceaux.length === 0 ? [texte] : morceaux;
}
export function sectionsDeMarkdown(md) {
  const sections = [];
  let titre = "General";
  let tampons = [];
  const vider = () => {
    if (tampons.length > 0) {
      const texte = normaliserTexte(tampons.join(" "));
      if (texte !== "") for (const m of couperLong(texte)) sections.push({ section: titre, texte: m });
      tampons = [];
    }
  };
  for (const ligne of md.split("\n")) {
    const t = ligne.trim();
    if (t.startsWith("#")) {
      vider();
      titre = t.replace(/^#+\s*/, "").trim() || "General";
      continue;
    }
    if (t === "") { vider(); continue; }
    tampons.push(t);
  }
  vider();
  return sections;
}
