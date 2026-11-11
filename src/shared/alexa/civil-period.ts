/**
 * The one period of the civil calendar a French sentence names ("hier", "la semaine dernière", "l'an passé", "en 2025",
 * "depuis le début du mois", "depuis janvier"), as a half-open range of the cabinet's days [from, to) in Africa/Algiers.
 * Weeks run Monday to Sunday; "depuis …" runs to the end of today. Null when the sentence names no such period, two of them
 * (a comparison is read elsewhere), or a dated day the explicit-date parsers own.
 */
const MONTHS = ["janvier", "fevrier", "mars", "avril", "mai", "juin", "juillet", "aout", "septembre", "octobre", "novembre", "decembre"];
const M = MONTHS.join("|");
const YEAR = "(?:19|20)\\d{2}";
// Whole words only: "mai" is not in "maintenant", "hier" is not in "fichier".
const PERIOD = new RegExp("(?<![\\p{L}\\d])(?:" + [
  `depuis (?:le )?debut (?:du mois|de ce mois|de la semaine|de cette semaine|de l'annee|de cette annee)`,
  `depuis (?:le (?:1er|premier|\\d{1,2}) )?(?:${M})(?: ${YEAR})?`,
  `(?:\\d{1,2}(?:er)? )?(?:${M})(?: ${YEAR})?`,
  `\\d{1,2}/\\d{1,2}(?:/\\d{2,4})?`,
  `avant-hier`, `apres-demain`, `aujourd'hui`, `hier`, `demain`,
  `(?:la )?semaine (?:derniere|passee|precedente|prochaine|en cours)`, `cette semaine`,
  `(?:le )?mois (?:dernier|passe|precedent|prochain|en cours|courant)`, `ce mois(?:-ci)?`,
  `(?:le )?trimestre (?:dernier|passe|precedent|en cours)`, `ce trimestre`,
  `l'an (?:dernier|passe)`, `(?:l')?annee (?:derniere|passee|precedente|en cours)`, `cette annee`,
  YEAR,
].join("|") + ")(?![\\p{L}\\d])", "gu");

const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[’‘]/gu, "'");
const day = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
const plus = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const stamp = (iso: string) => `${iso}T00:00:00+01:00`;

export function relativeFrenchPeriod(text: string, asOf: string | undefined): { from: string; to: string } | null {
  const today = asOf?.slice(0, 10) ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(today)) return null;
  const found = [...fold(text).matchAll(PERIOD)].map((match) => match[0]);
  if (found.length !== 1) return null;
  const phrase = found[0]!;
  const [y, m] = today.split("-").map(Number) as [number, number];
  const monday = plus(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7));
  const tomorrow = plus(today, 1);
  const range = (from: string, to: string) => ({ from: stamp(from), to: stamp(to) });
  const monthStart = (offset: number) => day(y, m + offset, 1);
  if (phrase.startsWith("depuis")) {
    if (/mois/u.test(phrase)) return range(monthStart(0), tomorrow);
    if (/semaine/u.test(phrase)) return range(monday, tomorrow);
    if (/annee/u.test(phrase)) return range(day(y, 1, 1), tomorrow);
    const parts = new RegExp(`(?:le (1er|premier|\\d{1,2}) )?(${M})(?: (${YEAR}))?`, "u").exec(phrase);
    if (!parts) return null;
    const month = MONTHS.indexOf(parts[2]!) + 1, date = parts[1] ? Number(parts[1].replace(/\D/gu, "") || 1) : 1;
    const year = parts[3] ? Number(parts[3]) : month > m ? y - 1 : y;
    const from = day(year, month, date);
    // "depuis le 31 février", or a start after today: no period rather than a wrong one.
    if (Number(from.slice(8, 10)) !== date || from > today) return null;
    return range(from, tomorrow);
  }
  switch (phrase) {
    case "avant-hier": return range(plus(today, -2), plus(today, -1));
    case "hier": return range(plus(today, -1), today);
    case "aujourd'hui": return range(today, tomorrow);
    case "demain": return range(tomorrow, plus(today, 2));
    case "apres-demain": return range(plus(today, 2), plus(today, 3));
  }
  if (/semaine/u.test(phrase)) {
    const shift = /derniere|passee|precedente/u.test(phrase) ? -7 : /prochaine/u.test(phrase) ? 7 : 0;
    return range(plus(monday, shift), plus(monday, shift + 7));
  }
  if (/trimestre/u.test(phrase)) {
    const first = m - ((m - 1) % 3) + (/dernier|passe|precedent/u.test(phrase) ? -3 : 0);
    return range(day(y, first, 1), day(y, first + 3, 1));
  }
  if (/mois/u.test(phrase)) {
    const shift = /dernier|passe|precedent/u.test(phrase) ? -1 : /prochain/u.test(phrase) ? 1 : 0;
    return range(monthStart(shift), monthStart(shift + 1));
  }
  if (/\ban\b|annee/u.test(phrase)) {
    const year = /dernier|derniere|passe|passee|precedente/u.test(phrase) ? y - 1 : y;
    return range(day(year, 1, 1), day(year + 1, 1, 1));
  }
  if (new RegExp(`^${YEAR}$`, "u").test(phrase)) return range(day(Number(phrase), 1, 1), day(Number(phrase) + 1, 1, 1));
  // A named month or a dated day: the explicit-date parsers read those.
  return null;
}
