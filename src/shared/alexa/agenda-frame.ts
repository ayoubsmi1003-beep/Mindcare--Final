import { unknownNameRuns } from "./patient-question";
import { namedFrenchPeriod } from "./request-contract";

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

const WEEKDAY_SOURCE = "lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche";
const PERIOD_SOURCE = `(?:entre|du) (?:${WEEKDAY_SOURCE}) (?:et|au) (?:${WEEKDAY_SOURCE})|(?:aujourd'hui|apres-demain|demain|avant-hier|hier)(?: (?:matin|apres-midi|soir))?|ce matin|cet apres-midi|cet aprem|ce soir|cette semaine|la semaine (?:derniere|prochaine|passee)|semaine (?:derniere|prochaine)|ma semaine|ma journee|ce mois(?:-ci)?|le mois (?:dernier|precedent)|cette annee|(?:le )?\\d{1,2}(?:er)? (?:${MONTHS})(?: \\d{4})?|(?:${WEEKDAY_SOURCE})(?: prochain| dernier)?(?: (?:matin|apres-midi|soir))?`;
const PERIOD = new RegExp(PERIOD_SOURCE, "u");
const WHOLE_FOLLOWUP = new RegExp(`^(?:(?:et|alors|mais|pour|maintenant)\\s+)*(?:(?:la )?(?:meme (?:question|chose)|pareil|idem)\\s+)?(?:pour\\s+)?(?:${PERIOD_SOURCE}|le lendemain|la veille|le jour d'apres|le jour d'avant)\\s*[?.!]?$`, "u");

const DAY_SOURCE = `aujourd'hui|apres-demain|demain|avant-hier|hier|${WEEKDAY_SOURCE}`;
const PART_OF: Record<string, string> = { matinee: "matin", matin: "matin", soiree: "soir", soir: "soir" };
/** "la matinée de jeudi", "demain dans la soirée" -> "jeudi matin", "demain soir": the one form the period list reads. */
function dayParts(folded: string): string {
  const part = (word: string) => PART_OF[word] ?? "apres-midi";
  return folded
    // "Le premier patient de la journée", "dans la journée": today, unless another day follows ("la journée de jeudi").
    .replace(/\b(?:de |dans )?la journee\b(?!\s+(?:de|d'))/gu, "aujourd'hui")
    .replace(new RegExp(`\\b(?:(?:ma|la|cette|dans la|en)\\s+|l')?(matinee|apres-midi|aprem|soiree)\\s+(?:de |d')(${DAY_SOURCE})\\b`, "gu"), (_, word: string, day: string) => `${day} ${part(word)}`)
    .replace(new RegExp(`\\b(${DAY_SOURCE})\\s+(?:dans la |dans l'|en )(matinee|apres-midi|aprem|soiree)\\b`, "gu"), (_, day: string, word: string) => `${day} ${part(word)}`);
}
// "Il y a", "il reste", "y a-t-il": an impersonal « il », not the patient of a previous turn.
const IMPERSONAL = /\b(?:il (?:y a(?:vait|ura)?|(?:me |nous )?rest(?:e|ait)|faut)|(?:y a|reste)-t-il)\b/gu;

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
 * A period the list above does not know ("en septembre", "depuis le début du mois", "le 5 novembre"), read by the shared civil
 * reader of the patient and finance frames and written as the explicit day or range the gate reads. Its bounds are cabinet days.
 */
function civilPeriod(text: string, asOf: string): string | null {
  const period = namedFrenchPeriod(text, asOf);
  if (!period) return null;
  const from = period.from.slice(0, 10), last = addDays(period.to.slice(0, 10), -1);
  // A month without its year is read as the last one past; in an agenda, "en novembre" said in October may be the coming one.
  if (!/\b(?:19|20)\d{2}\b/u.test(text) && toUtc(cabinetDay(asOf)) - toUtc(from) > 183 * 86400000) return null;
  return last <= from ? explicitDay(from) : explicitRange(from, last);
}
// The words of such a period, so they are not taken for a name once it is read.
const CIVIL_WORDS = new RegExp(`\\b(?:${MONTHS}|(?:19|20)\\d{2}|\\d{1,2}(?:er)?|depuis|debut|fin|mois|semaine|annee|tout|toute|entier|ensemble|sur|en|au|du|jusqu'au|jusqu'a|de|d)\\b`, "gu");

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
    const last = new Date(Date.UTC(previous[0]!, previous[1]!, 0)).getUTCDate();
    return explicitRange(`${previous[0]}-${String(previous[1]).padStart(2, "0")}-01`, `${previous[0]}-${String(previous[1]).padStart(2, "0")}-${last}`);
  }
  const weekdayDate = (name: string, which?: string) => {
    const target = WEEKDAYS.indexOf(name), current = new Date(toUtc(today)).getUTCDay();
    let delta = which === "dernier" ? -((current - target + 7) % 7 || 7) : (target - current + 7) % 7 || 7;
    if (!which && target === current) delta = 0;
    return addDays(today, delta);
  };
  const between = new RegExp(`^(?:entre|du) (${WEEKDAY_SOURCE}) (?:et|au) (${WEEKDAY_SOURCE})$`, "u").exec(folded);
  if (between) {
    // The second day is the first one on or after the first: "entre jeudi et lundi" runs over the weekend.
    const from = weekdayDate(between[1]!), to = addDays(from, (WEEKDAYS.indexOf(between[2]!) - WEEKDAYS.indexOf(between[1]!) + 7) % 7);
    return explicitRange(from, to);
  }
  const weekday = new RegExp(`^(${WEEKDAY_SOURCE})(?: (prochain|dernier))?(?: (?:matin|apres-midi|soir))?$`, "u").exec(folded);
  if (weekday) return withPart(weekdayDate(weekday[1]!, weekday[2]));
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
const WHO = /\bqui (?:ai-je|avons-nous|a-t-on|est attendu|sont attendus|attends-je|vient|viennent|vais-je (?:voir|recevoir)|vois-je|reste|restent|avais-je|est (?:mon|le|ma) (?:premier|dernier|prochain)|etait (?:mon|le) (?:premier|dernier)|(?:est|etait|sont|etaient) (?:prevus?|prevues?|attendus?|au programme))\b/u;
const HAVE_PEOPLE = /\b(?:j'ai|ai-je|on a|avons-nous|nous avons)\s+(?:du monde|des patients|beaucoup de patients|des consultations|des rendez-vous|des rdv|de la visite|du monde)\b/u;
const CANCELLED = /\bqui (?:a|ont|avait|avaient)\s+(?:annule|reporte|decale)\w*\b|\b(?:annulations?|rendez-vous annules|desistements?|desiste\w*|decommande\w*)\b|\b(?:ete|sont|etaient|est|etait)\s+(?:annulee?s?|reportee?s?)\b|\bannulee?s\b/u;
// A patient who did not come: the gate's "non honoré" status. "Poser un lapin" is the everyday French for it.
const ABSENT = /\b(?:absents?|absentes?|absences?|lapins?|no[- ]show|non (?:honore|excuse|venu)\w*|pas (?:venu|venue|venus|venues)\b|(?:ne|n') ?(?:s'est|se sont|est|sont) pas (?:presente|presentee|presentes|presentees|venu|venue|venus|venues))/u;
const AGENDA_ITSELF = /\b(?:rendez-vous|rdv|absen\w*|annul\w*|lapins?|programme|prevu\w*|planning|agenda|presente\w*|venu\w*|honore\w*|excuse\w*)\b/u;
const ABSENT_WORDS = /\b(?:annul\w*|desist\w*|decommande\w*|absent\w*|absences?|lapins?|venu\w*|presente\w*|honore\w*|excuse\w*|pose\w*|ne|n|s|se|pas|non|show|no)\b/gu;
const OVERVIEW = /\b(?:apercu|a quoi ressemble|les rendez-vous|quels (?:rendez-vous|rdv)|les rdv|planning|ma journee|ma semaine|mon agenda|l'agenda|mes rendez-vous|mes rdv|le programme|mon programme|au programme|quelque chose de prevu)\b/u;
const NEXT = /\b(?:prochain|prochaine)\s+(?:patient|rendez-vous|rdv|consultation)\b|\bqui est le prochain\b|\ba quelle heure est (?:mon|le|ma) prochain\w*\b/u;
const FIRSTLAST = /\b(?:premier|premiere|dernier|derniere)\s+(?:patient|patiente|rendez-vous|rdv|consultation)\b|\ba quelle heure commence ma journee\b/u;
const FREE = /\b(?:suis-je libre|libre|disponible|creneaux? (?:libre|disponible)|trous?|creux)\b/u;
// "Je finis à quelle heure ?", "À quelle heure je commence demain ?": the day's last or first appointment.
const CLOCK = /\b(?:a )?quelle heure\b/u, ENDS = /\b(?:termine|finis|finit|fini)\b/u, STARTS = /\b(?:commence|debute|demarre)\b/u;
const BARE_PEOPLE = /^(?:les )?patients?\s*(?:attendus?\s*)?$/u;
// Words that make it a question about the clinic's population or about one person, not about the agenda.
// "Combien de personnes différentes ont consulté" counts people seen: the activity statistics, not the appointments.
const NOT_AGENDA = /\b(?:consulte|consultes|consultee|consultees|au moins une fois|son|sa|ses|leur|leurs|actifs?|inactifs?|archives?|inscrits?|nouveaux?|suivis?|enregistres?|au total|dossiers?|mineurs?|adultes?|differents?|impayes?|recettes?|paiements?|encaisse\w*|pay(?:e|ee|es|ees|er)s?|il|elle|lui|ce patient|cette patiente|ce malade|son dossier|traitement\w*|medicament\w*)\b/u;
const AGENDA_WORDS = /\b(?:ressemble|quoi|ont|eu|lieu|ete|realisees|faites|terminees|passee|combien|de|d|patients?|monde|personnes?|consultations?|visites?|seances?|rendez-vous|rdv|qui|ai-je|avons-nous|a-t-on|est|sont|attendus?|vient|viennent|vais-je|voir|recevoir|vois-je|reste|restent|avais-je|etait|mon|ma|mes|le|la|les|l|un|une|j|ai|on|a|nous|avons|des|du|ou|et|annule\w*|reporte\w*|decale\w*|apercu|planning|journee|semaine|agenda|programme|premier|premiere|dernier|derniere|prochain|prochaine|heure|quelle|commence|libre|disponible|suis-je|donne|donne-moi|montre|montre-moi|affiche|dis|dis-moi|beaucoup|exactement|aujourd'hui|demain|hier|matin|soir|apres-midi|ce|cet|cette|cabinet|moi|me|quels|quel|quelles|y|il|en|dans|pour|sur|jour|jours|encore|deja|aussi|alors|bien|merci|stp|svp|plait|s'il|te|vous|tu|peux|pouvez|pourriez|pourrais|voudrais|indiquer|m'indiquer|nombre|chargee?|charge|quelque|chose|prevus?|prevues?|programme|etaient|arrive|arrivent|arriver|arrivera|arriveront|debute|debutent|termine|terminent|je|finis|finit|fini|commence|demarre|trous?|creux|dans|confirm\w*|attente|par|sans|jamais|pas|n|lesquels|lesquelles|lequel|laquelle)\b/gu;

/**
 * The confirmation state a count or a list is restricted to, in the words the agenda status reader takes ("confirmés",
 * "à confirmer"), or null. "Pas encore confirmés" are the requested ones. Read so that no frame ever drops it silently.
 */
export function agendaStatusOf(text: string): "confirmés" | "à confirmer" | null {
  const out = foldWithMap(text).out;
  if (/\b(?:(?:pas|non|jamais)\s+(?:encore\s+)?confirm\w*|a confirmer|en attente de confirmation|sans confirmation)\b/u.test(out)) return "à confirmer";
  if (/\bconfirm(?:e|es|ee|ees)\b/u.test(out)) return "confirmés";
  return null;
}

export type AgendaIntent = "count" | "list" | "cancelled" | "cancelledcount" | "absent" | "absentcount" | "next" | "first" | "last" | "free" | "pastcount";

/** What the question asks of the agenda. Null when it is not clearly an agenda question. `otherPeriod`: one read by the civil reader. */
export function classifyAgendaQuestion(text: string, otherPeriod?: string | null): { intent: AgendaIntent; period: string | null } | null {
  const out = dayParts(foldWithMap(text).out);
  const found = [...out.matchAll(new RegExp(PERIOD_SOURCE, "gu"))].map(match => match[0]);
  // "À quelle heure commence ma journée demain ?": the day named wins over "ma journée".
  const period = found.find(value => !/^ma (?:journee|semaine)$/u.test(value)) ?? found[0] ?? otherPeriod ?? null;
  const absent = ABSENT.test(out);
  // "Qui a manqué son rendez-vous hier ?" asks the agenda; "il", "elle" or a record still make it one person's question.
  const personal = out.replace(IMPERSONAL, " ");
  if (NOT_AGENDA.test(absent ? personal.replace(/\ba (?:son|leur|leurs|ses) (?:rendez-vous|rdv)\b/gu, " ") : personal) && !CANCELLED.test(out)) return null;
  const counted = /\bcombien\b|\bnombre (?:de|d')/u.test(out);
  if (absent && period) return { intent: counted ? "absentcount" : "absent", period };
  if (CANCELLED.test(out) && period) return { intent: counted ? "cancelledcount" : "cancelled", period };
  if (NEXT.test(out)) return { intent: "next", period: null };
  if (!period) return null;
  if (FREE.test(out)) return { intent: "free", period };
  if (/\b(?:premier|premiere)\b/u.test(out) && FIRSTLAST.test(out) || /\ba quelle heure commence ma journee\b/u.test(out)) return { intent: "first", period };
  if (/\b(?:dernier|derniere)\b/u.test(out) && FIRSTLAST.test(out)) return { intent: "last", period };
  if (CLOCK.test(out) && ENDS.test(out)) return { intent: "last", period };
  if (CLOCK.test(out) && STARTS.test(out)) return { intent: "first", period };
  if (/\bconsultations?|seances?\b/u.test(out) && /\b(?:hier|avant-hier|la semaine (?:derniere|passee)|semaine (?:derniere|passee)|le mois (?:dernier|precedent)|ont eu lieu|ete (?:realisees|faites|terminees))\b/u.test(out) && /\bcombien\b/u.test(out)) return { intent: "pastcount", period };
  if (COUNT_PEOPLE.test(out) || (COUNT_ANY.test(out) && /\b(?:patients?|monde|rendez-vous|rdv)\b/u.test(out)) || /\bj'ai combien\b/u.test(out) || (HAVE_PEOPLE.test(out) && /\bcombien\b/u.test(out))) return { intent: "count", period };
  if (WHO.test(out) || OVERVIEW.test(out) || BARE_PEOPLE.test(out.replace(period, "").replace(/[?.!]/gu, "").trim())) return { intent: "list", period };
  if (HAVE_PEOPLE.test(out)) return { intent: "count", period };
  if (/\bai-je\b[^?]*\b(?:rendez-vous|rdv|patients?)\b/u.test(out)) return { intent: "count", period };
  return null;
}

/** The closed agenda question for this utterance, or null when unsure. Asked-back names or pronouns leave it to the older route. */
export function agendaQuestionFrame(text: string, asOf: string): string | null {
  const out = dayParts(foldWithMap(text).out);
  // A command ("Confirme les rendez-vous de demain", "Décommande…") is never rewritten into a read that could look carried out.
  if (/^(?:alexa\W+)?(?:confirm|annul|decommand|valid|decal|report|deplac|supprim|ajout|cre|marqu|pointe|enregistr)(?:e|ez|er)\b/u.test(out)) return null;
  // Nor one asked in the infinitive anywhere ("Il faut décaler…", "Je veux annuler…"); "à confirmer" is a status, not a command.
  if (/(?<!\ba )\b(?:confirm|annul|decommand|valid|decal|report|deplac|supprim|ajout|marqu|pointe|enregistr|reprogramm)er\b/u.test(out)) return null;
  // Over a month or a range, "consultations", "séances" or "patients vus" are the activity and money frames' figures: only
  // appointments, absences or cancellations named as such are the agenda's.
  const civil = PERIOD.test(out) || !AGENDA_ITSELF.test(out) || /\b(?:regl\w*|pay\w*|encaiss\w*|factur\w*)\b/u.test(out) ? null : civilPeriod(text, asOf);
  const question = classifyAgendaQuestion(text, civil);
  if (!question) return null;
  // Over a month or longer, the patients seen or received are the activity statistics, not the appointments booked.
  if ((question.intent === "count" || question.intent === "list") && /\b(?:mois|annee|trimestre)\b|^du\b/u.test(question.period ?? "")
    && !/\b(?:rendez-vous|rdv|agenda|planning|programme|prevu\w*|programme\w*|planifie\w*|attendu\w*|inscrit\w*|a venir)\b/u.test(out)) return null;
  // Anything left once the agenda vocabulary is removed would be a name, a topic or a second request.
  const status = question.intent.startsWith("absent") || question.intent.startsWith("cancelled");
  const rest = out.replace(PERIOD, " ").replace(civil ? CIVIL_WORDS : /$^/u, " ").replace(status ? ABSENT_WORDS : /$^/u, " ").replace(AGENDA_WORDS, " ").replace(/[^\p{L}\s]/gu, " ").replace(/\s+/gu, " ").trim();
  if (rest && unknownNameRuns(rest).length) return null;
  // A second request in the same sentence is not answered by the agenda alone.
  if (/\b(?:et|puis|ainsi que|aussi)\b[^?]*\b(?:quel(?:le|s|les)?|combien|qui|comment|pourquoi)\b/u.test(out.replace(/^(?:et|puis)\s+/u, ""))) return null;
  const period = civil && question.period === civil ? civil : question.period ? canonicalPeriod(question.period, asOf) : null;
  if (question.period && !period) return null;
  return renderAgendaQuestion(question.intent, period, agendaStatusOf(text));
}

/** The closed agenda question for an intent and a canonical period (null only for "next"). A status only restricts a count or a list. */
export function renderAgendaQuestion(intent: AgendaIntent, period: string | null, status: "confirmés" | "à confirmer" | null = null): string | null {
  if (intent !== "next" && !period) return null;
  if (status) return intent === "count" ? `Combien de rendez-vous ${status} ${period} ?` : intent === "list" ? `Quels sont les rendez-vous ${status} ${period} ?` : null;
  switch (intent) {
    case "count": return `Combien de rendez-vous ${period} ?`;
    case "list": case "last": case "free": return `Quels sont les rendez-vous ${period} ?`;
    case "cancelled": return `Quels sont les rendez-vous annulés ${period} ?`;
    case "cancelledcount": return `Combien de rendez-vous annulés ${period} ?`;
    case "absent": return `Quels sont les rendez-vous non honorés ${period} ?`;
    case "absentcount": return `Combien de rendez-vous non honorés ${period} ?`;
    // The period reader refuses "premier" beside a day other than today; the day's list holds the first row as well.
    case "first": return period === "aujourd'hui" ? `Quel est le premier rendez-vous ${period} ?` : `Quels sont les rendez-vous ${period} ?`;
    case "pastcount": return `Combien de consultations terminées ${period} ?`;
    case "next": return "Quel est le prochain rendez-vous du cabinet ?";
  }
}

/** The one period a sentence names, in the form the gates read, or null (none, or two). */
export function agendaPeriodOf(text: string, asOf: string): string | null {
  const out = dayParts(foldWithMap(text).out);
  const found = [...out.matchAll(new RegExp(PERIOD_SOURCE, "gu"))].map(match => match[0]).filter(value => !/^ma (?:journee|semaine)$/u.test(value));
  return found.length === 1 ? canonicalPeriod(found[0]!, asOf) : found.length === 0 ? civilPeriod(text, asOf) : null;
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
  // "Remonte d'une semaine", "la semaine d'après": the previous period moved by seven days.
  const shift = /\b(?:remonte\w*|recule\w*|reviens|retourne)\b[^?]*\bsemaine\b|\b(?:une semaine (?:plus tot|avant)|la semaine (?:d'avant|precedente))\b/u.test(bare) ? -7
    : /\b(?:avance\w*)\b[^?]*\bsemaine\b|\b(?:une semaine (?:plus tard|apres)|la semaine (?:d'apres|suivante))\b/u.test(bare) ? 7 : 0;
  if (shift && bare.split(" ").length <= 8) {
    const bounds = previousBounds(previousRequest, asOf);
    return bounds ? replacePeriod(previousRequest, bounds.from === bounds.to ? explicitDay(addDays(bounds.from, shift)) : explicitRange(addDays(bounds.from, shift), addDays(bounds.to, shift))) : null;
  }
  // "Et le dernier de ce jour-là ?", "Combien ce mois-là ?": the previous period, named again.
  const that = /\b(?:ce jour[- ]la|le meme jour|du meme jour|cette semaine[- ]la|ce mois[- ]la|le meme mois|du meme mois)\b/u.exec(bare);
  if (that) {
    const bounds = previousBounds(previousRequest, asOf);
    if (!bounds) return null;
    const named = bounds.from === bounds.to ? explicitDay(bounds.from) : explicitRange(bounds.from, bounds.to);
    // "Et le dernier ce jour-là ?": the ordinal alone names the first or the last appointment.
    const ordinal = /^(?:(?:et|alors)\s+)?(?:le|la)\s+(premier|premiere|dernier|derniere)\b/u.exec(bare)?.[1];
    if (ordinal && bare.split(" ").length <= 8) return renderAgendaQuestion(ordinal.startsWith("premier") ? "first" : "last", named);
    return agendaQuestionFrame(bare.replace(that[0], named).replace(/^(?:et|alors)\s+/u, ""), asOf);
  }
  // "Et le dernier ?" right after a question on the agenda: the first or last appointment of its period.
  const ordinalOnly = /^(?:(?:et|alors)\s+)?(?:(?:lequel|laquelle|qui)\s+(?:est|etait)\s+)?(?:le|la)\s+(premier|premiere|dernier|derniere)(?:\s+(?:rendez-vous|rdv|patient|patiente))?\s*[?.!]?$/u.exec(bare)?.[1];
  if (ordinalOnly && /\b(?:rendez-vous|rdv|planning|agenda|creneaux?)\b/u.test(foldWithMap(previousRequest).out)) {
    const bounds = previousBounds(previousRequest, asOf);
    return bounds ? renderAgendaQuestion(ordinalOnly.startsWith("premier") ? "first" : "last", bounds.from === bounds.to ? explicitDay(bounds.from) : explicitRange(bounds.from, bounds.to)) : null;
  }
  // "Et en août ?": a month the period list does not hold, read by the civil reader.
  const month = new RegExp(`^(?:(?:et|alors|mais|pour)\\s+)*(?:(?:en|pour)\\s+)?(?:le mois d'|le mois de |au mois d'|au mois de )?(${MONTHS})(?: \\d{4})?\\s*[?.!]?$`, "u").exec(bare);
  if (month) { const civil = civilPeriod(`en ${month[1]}`, asOf); return civil ? replacePeriod(previousRequest, civil) : null; }
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

const EXPLICIT_DAY = `(\\d{1,2})(?:er)? (${MONTHS}) (\\d{4})`;
const EXPLICIT_RANGE_SOURCE = `du \\d{1,2}(?:er)? (?:${MONTHS}) \\d{4} au \\d{1,2}(?:er)? (?:${MONTHS}) \\d{4}`;
const isoOf = (date: string, month: string, year: string) => `${year}-${String(MONTHS.split("|").indexOf(month) + 1).padStart(2, "0")}-${date.padStart(2, "0")}`;
/** The first and last cabinet days of the one period a previous closed question names, or null. */
function previousBounds(request: string, asOf: string): { from: string; to: string } | null {
  // The one period the request names, as the period reader writes it ("pour jeudi" -> "le 29 octobre 2026"); else its own words.
  const out = foldWithMap(agendaPeriodOf(request, asOf) ?? request).out, today = cabinetDay(asOf);
  const range = new RegExp(`du ${EXPLICIT_DAY} au ${EXPLICIT_DAY}`, "u").exec(out);
  if (range) return { from: isoOf(range[1]!, range[2]!, range[3]!), to: isoOf(range[4]!, range[5]!, range[6]!) };
  const days = [...out.matchAll(new RegExp(EXPLICIT_DAY, "gu"))];
  if (days.length === 1) { const day = isoOf(days[0]![1]!, days[0]![2]!, days[0]![3]!); return { from: day, to: day }; }
  if (days.length) return null;
  const word = /\b(apres-demain|avant-hier|aujourd'hui|demain|hier|cette semaine)\b/u.exec(out)?.[1];
  if (word === "cette semaine") { const monday = mondayOf(today); return { from: monday, to: addDays(monday, 6) }; }
  const offset = { "apres-demain": 2, "avant-hier": -2, "aujourd'hui": 0, demain: 1, hier: -1 }[word ?? ""];
  return offset === undefined ? null : { from: addDays(today, offset), to: addDays(today, offset) };
}

/** The one period a previous closed question names, written explicitly ("le 25 octobre 2026", "du … au …"), or null. */
export function previousAgendaPeriod(request: string | undefined, asOf: string): string | null {
  const bounds = request ? previousBounds(request, asOf) : null;
  return bounds ? (bounds.from === bounds.to ? explicitDay(bounds.from) : explicitRange(bounds.from, bounds.to)) : null;
}

function replacePeriod(request: string, replacement: string): string | null {
  const { out, map } = foldWithMap(request);
  // An explicit range ("du 1 août 2026 au 31 août 2026") is one period, not two days.
  const global = new RegExp(`${EXPLICIT_RANGE_SOURCE}|${PERIOD_SOURCE}`, "gu");
  const matches = [...out.matchAll(global)];
  // A day part ("demain après-midi") is one period; two separate periods are ambiguous.
  if (matches.length !== 1) return null;
  const match = matches[0]!, start = map[match.index!]!, end = (map[match.index! + match[0].length - 1] ?? request.length - 1) + 1;
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
