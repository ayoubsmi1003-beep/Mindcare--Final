function fold(value) {
  return String(value ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/gu, ' ');
}

function sentences(note) {
  return String(note?.subjective ?? note?.rawNotes ?? '').split(/(?<=[.!?])\s+/u).map(value => value.trim()).filter(Boolean);
}

function extractDifficulty(note) {
  const sentence = sentences(note).find(value => /^(?:la personne décrit|le patient décrit|la patiente décrit|la séance porte sur)\b/iu.test(value));
  if (!sentence) return null;
  const main = sentence.split(/,\s*(?:surtout|notamment|en particulier)\s+/iu)[0];
  return main.replace(/^(?:la personne décrit|le patient décrit|la patiente décrit|la séance porte sur)\s+/iu, '').replace(/[.!?]+$/u, '').trim() || null;
}

function extractContext(note) {
  for (const sentence of sentences(note)) {
    const inline = sentence.match(/,\s*(?:surtout|notamment|en particulier)\s+([^.!?]+)/iu)?.[1];
    if (inline) return inline.trim();
    const explicit = sentence.match(/(?:la gêne|la difficulté|les difficultés)\s+(?:est|sont)\s+(?:surtout\s+)?(?:présente?s?)\s+([^.!?]+)/iu)?.[1];
    if (explicit) return explicit.trim();
  }
  return null;
}

function extractOutcome(note) {
  for (const sentence of sentences(note)) {
    if (!/\b(?:mieux|amélior|aggrav|reprise des difficultés|retour des difficultés|recrudescence|stable|stabilisé|peu de changement|aucun changement)\b/iu.test(sentence)) continue;
    const reported = sentence.match(/^(?:la personne|le patient|la patiente)\s+(?:rapporte|indique|décrit)\s+(.+)$/iu)?.[1];
    if (reported) return reported.replace(/[.!?]+$/u, '').trim();
    const labeled = sentence.match(/^(?:évolution|résultat|bilan)\s*:\s*(.+)$/iu)?.[1];
    if (labeled) return labeled.replace(/[.!?]+$/u, '').trim();
  }
  return null;
}

function extractFollowUp(note) {
  return String(note?.plan ?? '').match(/\b(?:prévoir|proposer|poursuivre|maintenir|reprendre|arrêter|suspendre|noter)\b[^,.;!?]*/iu)?.[0]?.trim() ?? null;
}

function comparePair(answer, previousValue, latestValue, unchangedPattern) {
  const text = fold(answer), previous = fold(previousValue), latest = fold(latestValue);
  if (!previous && !latest) return { required: false, passed: true, previousAnchor: false, latestAnchor: false };
  if (previous && latest && previous === latest) {
    const found = text.includes(previous) || Boolean(unchangedPattern?.test(text));
    return { required: true, passed: found, previousAnchor: found, latestAnchor: found };
  }
  if (previous && latest) {
    const previousAt = text.indexOf(previous);
    const latestAt = previousAt < 0 ? -1 : text.indexOf(latest, previousAt + previous.length);
    return { required: true, passed: previousAt >= 0 && latestAt > previousAt, previousAnchor: previousAt >= 0, latestAnchor: latestAt > previousAt };
  }
  const only = previous || latest, at = only ? text.indexOf(only) : -1;
  return { required: true, passed: at >= 0, previousAnchor: !!previous && at >= 0, latestAnchor: !!latest && at >= 0 };
}

export function evaluateComparisonEvidence(answer, previous, latest) {
  const difficultyFacts = comparePair(answer, extractDifficulty(previous), extractDifficulty(latest), /difficult[ée]s?.{0,45}\b(?:reste|demeure|semblable|identique|stable)\b/u);
  const contextFacts = comparePair(answer, extractContext(previous), extractContext(latest), /contexte.{0,45}\b(?:reste|demeure|semblable|identique|stable)\b/u);
  const outcomeFacts = comparePair(answer, extractOutcome(previous), extractOutcome(latest), /[ée]volution.{0,45}\b(?:reste|demeure|semblable|identique|stable|inchang[ée]e?)\b/u);
  const visitChecks = [difficultyFacts, contextFacts, outcomeFacts].filter(fact => fact.required);
  const visitFactsPassed = visitChecks.length > 0 && visitChecks.every(fact => fact.passed);
  const planFacts = comparePair(answer, extractFollowUp(previous), extractFollowUp(latest));
  const text = fold(answer);
  const previousLabel = text.search(/\b(?:a la consultation precedente|a la precedente)\b/u);
  const latestLabel = text.search(/\b(?:a la consultation la plus recente|a la plus recente)\b/u);
  const explicitlyOrderedVisits = previousLabel >= 0 && latestLabel > previousLabel;
  const explicitComparison = /\b(?:passe de|change|evolue de|reste la meme|reste semblable|reste identique|demeure la meme|demeure semblable|dans les deux consultations|aux deux consultations)\b/u.test(text);
  const orderedComparison = explicitlyOrderedVisits || explicitComparison;
  return {
    passed: visitFactsPassed && planFacts.passed && orderedComparison,
    orderedComparison,
    distinctVisitFacts: visitFactsPassed,
    changedPlanFacts: planFacts.passed,
    previousVisitFact: visitChecks.some(fact => fact.previousAnchor),
    latestVisitFact: visitChecks.some(fact => fact.latestAnchor),
    previousPlanFact: planFacts.previousAnchor,
    latestPlanFact: planFacts.latestAnchor,
    evolutionFacts: outcomeFacts.passed,
  };
}
