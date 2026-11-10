import { unknownNameRuns } from "./patient-question";

/**
 * Everyday agenda questions ("Combien de patients aujourd'hui ?", "J'ai du monde ce matin ?", "Qui a annulé cette semaine ?")
 * and the short follow-ups that only change the period ("Et demain ?"). Like patient-question.ts this reads the
 * concepts (what is asked, which period) and restates the question as the closed form the agenda gate answers.
 * It rewrites; the read, its period arithmetic and its permissions stay in the gates.
 */
const MONTHS = "janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre";
const MONTH_LABEL: Record<string, string> = { fevrier: "février", aout: "août", decembre: "décembre" };
const WEEKDAYS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];

/** Folds a text and keeps, for every folded character, where it came from in the original. */
function foldWithMap(text: string): { out: string; map: number[] } {
  let out = ""; const map: number[] = [];
  for (let index = 0; index < text.length; index++) {
    const folded = text[index]!.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[’‘ʼ]/gu, "'");
    for (const char of folded) { out += char; map.push(index); }
  }
  return { out, map };
}

const PERIOD_SOURCE = `(?:aujourd'hui|apres-demain|demain|avant-hier|hier)(?: (?:matin|apres-midi|soir))?|ce matin|cet apres-midi|cet aprem|ce soir|cette semaine|la semaine (?:derniere|prochaine|passee)|semaine (?:derniere|prochaine)|ma semaine|ma journee|ce mois(?:-ci)?|le mois (?:dernier|precedent)|cette annee|(?:le )?\\d{1,2}(?:er)? (?:${MONTHS})(?: \\d{4})?|(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)(?: prochain| dernier)?`;
const PERIOD = new RegExp(PERIOD_SOURCE, "u");
const WHOLE_FOLLOWUP = new RegExp(`^(?:(?:et|alors|mais|pour|maintenant)\\s+)*(?:pour\\s+)?(?:${PERIOD_SOURCE}|le lendemain|la veille|le jour d'apres|le jour d'avant)\\s*\\??$`, "u");

// ── dates ──
const toUtc = (day: string) => Date.parse(`${day}T00:00:00Z`);
const addDays = (day: string, n: number) => new Date(toUtc(day) + n * 86400000).toISOString().slice(0, 10);
const mondayOf = (day: string) => addDays(day, -((new Date(toUtc(day)).getUTCDay() + 6) % 7));
const monthName = (month: number) => { const name = MONTHS.split("|")[month - 1]!; return MONTH_LABEL[name] ?? name; };
/** "le 28 octobre 2026": an explicit day the date parser reads in any season. */
export function explicitDay(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  return `le ${date} ${monthName(month!)} ${year}`;
}
const explicitRange = (from: string, to: string) => {
  const [fy, fm, fd] = from.split("-").map(Number), [ty, tm, td] = to.split("-").map(Number);
  return `du ${fd} ${monthName(fm!)} ${fy} au ${td} ${monthName(tm!)} ${ty}`;
};
const cabinetDay = (asOf: string) => asOf.slice(0, 10);

/**
 * The period as the gates read it. Words the period parser already knows stay as they are; the others become explicit
 * days or ranges counted from the clock of the turn, in the cabinet's own calendar.
 */
export function canonicalPeriod(folded: string, asOf: string): string | null {
  const today = cabinetDay(asOf);
  const keep = (value: string) => value.replace(/apres-midi/gu, "après-midi").replace(/ ?aprem\b/gu, " après-midi");
  const dayPart = / (matin|apres-midi|soir)$/u.exec(folded)?.[1];
  const withPart = (day: string) => `${explicitDay(day)}${dayPart ? ` ${dayPart === "apres-midi" ? "après-midi" : dayPart}` : ""}`;
  if (/^apres-demain/u.test(folded)) return withPart(addDays(today, 2));
  if (/^avant-hier/u.test(folded)) return withPart(addDays(today, -2));
  if (/^(?:la )?semaine (?:derniere|passee)$/u.test(folded)) { const monday = addDays(mondayOf(today), -7); return explicitRange(monday, addDays(monday, 6)); }
  if (/^(?:la )?semaine prochaine$/u.test(folded)) { const monday = addDays(mondayOf(today), 7); return explicitRange(monday, addDays(monday, 6)); }
  if (/^le mois (?:dernier|precedent)$/u.test(folded)) {
    const [year, month] = today.split("-").map(Number); const previous = month === 1 ? [year! - 1, 12] : [year!, month! - 1];
    const last = new Date(Date.UTC(previous[0]!, previous[1], 0)).getUTCDate();
    return explicitRange(`${previous[0]}-${String(previous[1]).padStart(2, "0")}-01`, `${previous[0]}-${String(previous[1]).padStart(2, "0")}-${last}`);
  }
  const weekday = /^(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)(?: (prochain|dernier))?$/u.exec(folded);
  if (weekday) {
    const target = WEEKDAYS.indexOf(weekday[1]!), current = new Date(toUtc(today)).getUTCDay();
    const back = weekday[2] === "dernier"; let delta = back ? -((current - target + 7) % 7 || 7) : (target - current + 7) % 7 || 7;
    if (!weekday[2] && target === current) delta = 0;
    return explicitDay(addDays(today, delta));
  }
  if (folded === "ma semaine") return "cette semaine";
  if (folded === "ma journee") return "aujourd'hui";
  if (/^(?:cet apres-midi|cet aprem)$/u.test(folded)) return "aujourd'hui après-midi";
  if (folded === "ce matin") return "aujourd'hui matin";
  if (/^(?:aujourd'hui|demain|hier|ce matin|cet apres-midi|cet aprem|ce soir|cette semaine|ce mois(?:-ci)?|cette annee)/u.test(folded) || /^\d|^le \d/u.test(folded)) return keep(folded.replace(/^(\d)/u, "le $1"));
  return null;
}

// ── concepts ──
const COUNT_PEOPLE = /\bcombien (?:de|d')\s*(?:patients?|monde|personnes?|consultations?|visites?|seances?|rendez-vous|rdv)\b/u;
const COUNT_ANY = /\bcombien\b|\bnombre (?:de|d')\s*(?:patients?|monde|personnes?|consultations?|visites?|seances?|rendez-vous|rdv)\b/u;
const WHO = /\bqui (?:ai-je|avons-nous|a-t-on|est attendu|sont attendus|attends-je|vient|viennent|vais-je (?:voir|recevoir)|vois-je|reste|restent|avais-je|est (?:mon|le|ma) (?:premier|dernier|prochain)|etait (?:mon|le) (?:premier|dernier))\b/u;
const HAVE_PEOPLE = /\b(?:j'ai|ai-je|on a|avons-nous|nous avons)\s+(?:du monde|des patients|beaucoup de patients|des consultations|des rendez-vous|des rdv|de la visite|du monde)\b/u;
const CANCELLED = /\bqui (?:a|ont)\s+(?:annule|reporte|decale)\w*\b|\b(?:annulations?|rendez-vous annules)\b/u;
const OVERVIEW = /\b(?:apercu|a quoi ressemble|les rendez-vous|les rdv|planning|ma journee|ma semaine|mon agenda|l'agenda|mes rendez-vous|mes rdv|le programme|mon programme)\b/u;
const NEXT = /\b(?:prochain|prochaine)\s+(?:patient|rendez-vous|rdv|consultation)\b|\bqui est le prochain\b|\ba quelle heure est (?:mon|le|ma) prochain\w*\b/u;
const FIRSTLAST = /\b(?:premier|premiere|dernier|derniere)\s+(?:patient|patiente|rendez-vous|rdv|consultation)\b|\ba quelle heure commence ma journee\b/u;
const FREE = /\b(?:suis-je libre|libre|disponible|creneaux? (?:libre|disponible))\b/u;
const BARE_PEOPLE = /^(?:les )?patients?\s*(?:attendus?\s*)?$/u;
// Words that make it a question about the clinic's population or about one person, not about the agenda.
const NOT_AGENDA = /\b(?:son|sa|ses|leur|leurs|actifs?|inactifs?|archives?|inscrits?|nouveaux?|suivis?|enregistres?|au total|dossiers?|mineurs?|adultes?|differents?|impayes?|recettes?|paiements?|encaisse\w*|pay(?:e|ee|es|ees|er)s?|il|elle|lui|ce patient|cette patiente|ce malade|son dossier|traitement\w*|medicament\w*)\b/u;
const AGENDA_WORDS = /\b(?:ressemble|quoi|ont|eu|lieu|ete|realisees|faites|terminees|passee|combien|de|d|patients?|monde|personnes?|consultations?|visites?|seances?|rendez-vous|rdv|qui|ai-je|avons-nous|a-t-on|est|sont|attendus?|vient|viennent|vais-je|voir|recevoir|vois-je|reste|restent|avais-je|etait|mon|ma|mes|le|la|les|l|un|une|j|ai|on|a|nous|avons|des|du|ou|et|annule\w*|reporte\w*|decale\w*|apercu|planning|journee|semaine|agenda|programme|premier|premiere|dernier|derniere|prochain|prochaine|heure|quelle|commence|libre|disponible|suis-je|donne|donne-moi|montre|montre-moi|affiche|dis|dis-moi|beaucoup|exactement|aujourd'hui|demain|hier|matin|soir|apres-midi|ce|cet|cette|cabinet|moi|me|quels|quel|quelles|y|il|en|dans|pour|sur|jour|jours|encore|deja|aussi|alors|bien|merci|stp|svp|plait|s'il|te|vous|tu|peux|pouvez|pourriez|pourrais|voudrais|indiquer|m'indiquer|nombre|chargee?|charge)\b/gu;

export type AgendaIntent = "count" | "list" | "cancelled" | "next" | "first" | "last" | "free" | "pastcount";

/** What the question asks of the agenda. Null when it is not clearly an agenda question. */
export function classifyAgendaQuestion(text: string): { intent: AgendaIntent; period: string | null } | null {
  const { out } = foldWithMap(text);
  const found = [...out.matchAll(new RegExp(PERIOD_SOURCE, "gu"))].map(match => match[0]);
  // "À quelle heure commence ma journée demain ?": the day named wins over "ma journée".
  const period = found.find(value => !/^ma (?:journee|semaine)$/u.test(value)) ?? found[0] ?? null;
  if (NOT_AGENDA.test(out) && !CANCELLED.test(out)) return null;
  if (CANCELLED.test(out) && period) return { intent: "cancelled", period };
  if (NEXT.test(out)) return { intent: "next", period: null };
  if (!period) return null;
  if (FREE.test(out)) return { intent: "free", period };
  if (/\b(?:premier|premiere)\b/u.test(out) && FIRSTLAST.test(out) || /\ba quelle heure commence ma journee\b/u.test(out)) return { intent: "first", period };
  if (/\b(?:dernier|derniere)\b/u.test(out) && FIRSTLAST.test(out)) return { intent: "last", period };
  if (/\bconsultations?|seances?\b/u.test(out) && /\b(?:hier|avant-hier|la semaine (?:derniere|passee)|semaine (?:derniere|passee)|le mois (?:dernier|precedent)|ont eu lieu|ete (?:realisees|faites|terminees))\b/u.test(out) && /\bcombien\b/u.test(out)) return { intent: "pastcount", period };
  if (COUNT_PEOPLE.test(out) || (COUNT_ANY.test(out) && /\b(?:patients?|monde|rendez-vous|rdv)\b/u.test(out)) || /\bj'ai combien\b/u.test(out) || (HAVE_PEOPLE.test(out) && /\bcombien\b/u.test(out))) return { intent: "count", period };
  if (WHO.test(out) || OVERVIEW.test(out) || BARE_PEOPLE.test(out.replace(period, "").replace(/[?.!]/gu, "").trim())) return { intent: "list", period };
  if (HAVE_PEOPLE.test(out)) return { intent: "count", period };
  if (/\bai-je\b[^?]*\b(?:rendez-vous|rdv|patients?)\b/u.test(out)) return { intent: "count", period };
  return null;
}

/** The closed agenda question for this utterance, or null when unsure. Asked-back names or pronouns leave it to the older route. */
export function agendaQuestionFrame(text: string, asOf: string): string | null {
  const question = classifyAgendaQuestion(text);
  if (!question) return null;
  const { out } = foldWithMap(text);
  // Anything left once the agenda vocabulary is removed would be a name, a topic or a second request.
  const rest = out.replace(PERIOD, " ").replace(AGENDA_WORDS, " ").replace(/[^\p{L}\s]/gu, " ").replace(/\s+/gu, " ").trim();
  if (rest && unknownNameRuns(rest).length) return null;
  // A second request in the same sentence is not answered by the agenda alone.
  if (/\b(?:et|puis|ainsi que|aussi)\b[^?]*\b(?:quel(?:le|s|les)?|combien|qui|comment|pourquoi)\b/u.test(out.replace(/^(?:et|puis)\s+/u, ""))) return null;
  const period = question.period ? canonicalPeriod(question.period, asOf) : null;
  if (question.period && !period) return null;
  switch (question.intent) {
    case "count": return `Combien de rendez-vous ${period} ?`;
    case "list": case "last": case "free": return `Quels sont les rendez-vous ${period} ?`;
    case "cancelled": return `Quels sont les rendez-vous annulés ${period} ?`;
    // The period reader refuses "premier" beside a day other than today; the day's list holds the first row as well.
    case "first": return period === "aujourd'hui" ? `Quel est le premier rendez-vous ${period} ?` : `Quels sont les rendez-vous ${period} ?`;
    case "pastcount": return `Combien de consultations terminées ${period} ?`;
    case "next": return "Quel est le prochain rendez-vous du cabinet ?";
  }
}

/**
 * "Et demain ?", "Et cette semaine ?", "Pour hier ?": the previous question again, with only its period replaced.
 * Returns null when the text is not such a follow-up or the previous request holds no single period to replace.
 */
export function periodFollowup(text: string, previousRequest: string | undefined, previousDay: string | undefined, asOf: string): string | null {
  if (!previousRequest) return null;
  const { out } = foldWithMap(text.trim());
  const bare = out.replace(/\s+/gu, " ").trim();
  if (/^(?:et )?combien\s*\??$/u.test(bare)) {
    const before = classifyAgendaQuestion(previousRequest);
    const when = before?.period ? canonicalPeriod(before.period, asOf) : null;
    return before && when ? `Combien de rendez-vous ${when} ?` : null;
  }
  if (!WHOLE_FOLLOWUP.test(bare)) return null;
  let periodText = PERIOD.exec(bare)?.[0] ?? null;
  const relative = /le lendemain|le jour d'apres|la veille|le jour d'avant/u.exec(bare)?.[0];
  if (relative) {
    if (!previousDay) return null;
    const next = /lendemain|apres/u.test(relative);
    periodText = null;
    const replacement = explicitDay(addDays(previousDay, next ? 1 : -1));
    return replacePeriod(previousRequest, replacement);
  }
  if (!periodText) return null;
  const replacement = canonicalPeriod(periodText, asOf);
  return replacement ? replacePeriod(previousRequest, replacement) : null;
}

function replacePeriod(request: string, replacement: string): string | null {
  const { out, map } = foldWithMap(request);
  const global = new RegExp(PERIOD_SOURCE, "gu");
  const matches = [...out.matchAll(global)];
  // A day part ("demain après-midi") is one period; two separate periods are ambiguous.
  if (matches.length !== 1) return null;
  const match = matches[0]!, start = map[match.index]!, end = (map[match.index + match[0].length - 1] ?? request.length - 1) + 1;
  // "recettes de ce mois" -> "recettes du 1 septembre au 30 septembre": no doubled "de du".
  const before = /\bde\s+$/u.test(request.slice(0, start)) && /^du\s/u.test(replacement) ? request.slice(0, start).replace(/\bde\s+$/u, "") : request.slice(0, start);
  return `${before}${replacement}${request.slice(end)}`;
}

/**
 * The same instant written in the clinic's own calendar (Africa/Algiers, UTC+1 all year): every "today", "yesterday", "this month" the frames
 * and the gates derive from the leading date of this stamp is then the clinic's day, not the UTC one (a one-hour error every night).
 */
export function algiersTimestamp(instant: Date): string {
  const part = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Algiers", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
    .formatToParts(instant).map((piece) => [piece.type, piece.value]));
  return `${part["year"]}-${part["month"]}-${part["day"]}T${part["hour"]}:${part["minute"]}:${part["second"]}+01:00`;
}
