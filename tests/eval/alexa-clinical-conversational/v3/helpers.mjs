/**
 * C202 helpers. Same shape as C200 (v1) plus two tags on every turn, used only for the report:
 *   lang: "fr" French · "ar" Darija in Arabic script · "la" Darija in Latin letters · "mx" French and Darija mixed
 *   form: how the question is put (see FORMS below)
 * The tags never reach the application under test.
 */
export const LANGS = ["fr", "ar", "la", "mx"];
export const FORMS = ["direct", "conversational", "short", "informal", "wordorder", "typo", "implicit", "pronoun", "followup", "period", "otherpatient", "formal", "synonym"];

/** A case = one conversation on one disposable synthetic database. */
export function c(id, domain, db, page, turns, options = {}) {
  return { id, domain, db, page, turns, ...options };
}

/** One doctor utterance. `tag` = [lang, form]. */
export function t(say, expect, tag, turn = {}) {
  const [lang, form] = tag;
  return { say, expect, lang, form, ...turn };
}
