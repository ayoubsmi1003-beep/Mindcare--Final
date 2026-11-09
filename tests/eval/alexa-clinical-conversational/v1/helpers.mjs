/** Tiny builders so the case files read like the questions they hold. */

/**
 * @param {string} id        unique case id, C001…C200
 * @param {string} domain    patient | context | agenda | finance | book | variation
 * @param {"main"|"fixture"} db  which disposable synthetic database the case runs against
 * @param {object} page      { type: "global" } | { type: "patient", role } | { type: "consultation", role, which }
 * @param {object[]} turns   built with t()
 * @param {object} [options] { asOf: ISO instant the conversation is anchored to, intent: expected intent label }
 */
export function c(id, domain, db, page, turns, options = {}) {
  return { id, domain, db, page, turns, ...options };
}

/**
 * One doctor utterance and what it must produce.
 * @param {string} say     the utterance, with {ROLE} / {ROLE.first} / {ROLE.last} placeholders
 * @param {object} expect  oracle request, resolved by generate-oracles.mjs (never read by the assistant)
 * @param {object} [turn]  { page } to change screen before this turn
 */
export function t(say, expect, turn = {}) {
  return { say, expect, ...turn };
}
