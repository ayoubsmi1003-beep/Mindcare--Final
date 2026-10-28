import { expect, it } from 'vitest';
import { evaluateComparisonEvidence } from '../../scripts/lib/alexa-v8-comparison.mjs';

const previous = {
  subjective: 'La séance porte sur des échanges tendus au sein de la famille, surtout après un échange difficile. La personne rapporte un mieux depuis le dernier entretien.',
  plan: 'Il est convenu de prévoir une promenade courte, puis de noter ce qui facilite cette démarche et ce qui la freine, notamment la crainte de décevoir.',
};
const latest = {
  subjective: 'La séance porte sur des échanges tendus au sein de la famille, surtout durant les périodes moins structurées. La personne rapporte un mieux depuis le dernier entretien.',
  plan: 'Il est convenu de prévoir un repas partagé, puis de noter ce qui facilite cette démarche et ce qui la freine, notamment les imprévus de la semaine.',
};

it('requires visit-specific facts from both consultations and each changed plan', () => {
  const answer = 'Comparaison : du 5 oct. 2023 au 2 nov. 2025. La difficulté principale reste « des échanges tendus au sein de la famille ». Le contexte décrit passe de « après un échange difficile » à « durant les périodes moins structurées ». L’évolution rapportée reste semblable. Le suivi prévu passe de « prévoir une promenade courte » à « prévoir un repas partagé ».';
  expect(evaluateComparisonEvidence(answer, previous, latest)).toMatchObject({ passed: true, orderedComparison: true, distinctVisitFacts: true, changedPlanFacts: true });
});

it('accepts concise dated sections and keeps each recorded plan with its visit', () => {
  const oldVisit = {
    subjective: 'La personne décrit une tristesse liée à la perte d’un proche. La gêne est surtout présente lorsque plusieurs demandes arrivent en même temps.',
    plan: 'Il est convenu de prévoir une activité manuelle, puis de noter ce qui facilite cette démarche, notamment la fatigue en cours de journée.',
  };
  const recentVisit = {
    subjective: 'La personne décrit une tristesse liée à la perte d’un proche. La gêne est surtout présente en fin de journée. La personne rapporte un mieux depuis le dernier entretien.',
    plan: 'Il est convenu de prévoir une pause sans écran, puis de noter ce qui facilite cette démarche, notamment la difficulté à commencer.',
  };
  const answer = 'Comparaison : du 1 sept. 2022 au 15 juin 2026. La difficulté principale reste « une tristesse liée à la perte d’un proche ». Le contexte décrit passe de « lorsque plusieurs demandes arrivent en même temps » à « en fin de journée ». Lors de la consultation la plus récente, la personne rapporte « un mieux depuis le dernier entretien ». Le suivi prévu passe de « prévoir une activité manuelle » à « prévoir une pause sans écran ».';
  expect(evaluateComparisonEvidence(answer, oldVisit, recentVisit)).toMatchObject({
    passed: true, orderedComparison: true, distinctVisitFacts: true, changedPlanFacts: true,
    previousVisitFact: true, latestVisitFact: true, previousPlanFact: true, latestPlanFact: true,
  });
});

it('accepts the live French comparison wording when a transition is introduced with “change”', () => {
  const answer = 'Pour said doumer, du 5 oct. 2023 au 2 nov. 2025 : Difficulté : « des échanges tendus au sein de la famille ». La gêne change : après un échange difficile à la précédente ; durant les périodes moins structurées à la plus récente. L’évolution rapportée reste semblable. Le suivi change : « prévoir une promenade courte » puis « prévoir un repas partagé ».';
  expect(evaluateComparisonEvidence(answer, previous, latest)).toMatchObject({
    passed: true,
    orderedComparison: true,
    distinctVisitFacts: true,
    changedPlanFacts: true,
    previousVisitFact: true,
    latestVisitFact: true,
    previousPlanFact: true,
    latestPlanFact: true,
    evolutionFacts: true,
  });
});

it('checks each consultation pair in its own section when multiple facts change', () => {
  const oldVisit = {
    subjective: 'La personne décrit des échanges tendus au sein de la famille. La gêne est surtout présente pendant les moments de solitude. La personne rapporte une reprise des difficultés depuis le dernier entretien.',
    plan: 'Il est convenu de prévoir un temps consacré à la musique, puis de noter ce qui facilite cette démarche.',
  };
  const recentVisit = {
    subjective: 'La personne décrit des échanges tendus au sein de la famille. La gêne est surtout présente lorsque plusieurs demandes arrivent en même temps. La personne rapporte un mieux depuis le dernier entretien.',
    plan: 'Il est convenu de prévoir un réveil à heure régulière, puis de noter ce qui facilite cette démarche.',
  };
  const answer = 'Comparaison : du 26 mai 2024 au 2 juil. 2025. La difficulté principale reste « des échanges tendus au sein de la famille ». Le contexte décrit passe de « pendant les moments de solitude » à « lorsque plusieurs demandes arrivent en même temps ». L’évolution rapportée passe de « une reprise des difficultés depuis le dernier entretien » à « un mieux depuis le dernier entretien ». Le suivi prévu passe de « prévoir un temps consacré à la musique » à « prévoir un réveil à heure régulière ».';
  expect(evaluateComparisonEvidence(answer, oldVisit, recentVisit)).toMatchObject({
    passed: true, distinctVisitFacts: true, changedPlanFacts: true,
    previousVisitFact: true, latestVisitFact: true,
    previousPlanFact: true, latestPlanFact: true,
  });
  const latestOnly = answer.replace('L’évolution rapportée passe de « une reprise des difficultés depuis le dernier entretien » à « un mieux depuis le dernier entretien ».', 'Le dernier entretien rapporte « un mieux depuis le dernier entretien ».');
  expect(evaluateComparisonEvidence(latestOnly, oldVisit, recentVisit)).toMatchObject({ passed: false, evolutionFacts: false });
});

it('recognizes a specific follow-up action when only its final activity word differs', () => {
  const oldVisit = {
    subjective: 'La personne décrit une baisse de l’élan et un retrait des activités habituelles.',
    plan: 'Le travail de séance a porté sur une activité courte et accessible. Il est convenu de prévoir une courte séance de rangement, puis de noter ce qui facilite cette démarche.',
  };
  const recentVisit = {
    subjective: 'La personne décrit une baisse de l’élan et un retrait des activités habituelles.',
    plan: 'Le travail de séance a porté sur une activité courte et accessible. Il est convenu de prévoir une activité choisie à l’extérieur, puis de noter ce qui facilite cette démarche.',
  };
  const answer = 'Comparaison : du 4 sept. 2025 au 8 avr. 2026. La difficulté principale reste « une baisse de l’élan et un retrait des activités habituelles ». Le suivi prévu passe de « prévoir une courte séance de rangement » à « prévoir une activité choisie à l’extérieur ».';
  expect(evaluateComparisonEvidence(answer, oldVisit, recentVisit)).toMatchObject({
    passed: true, changedPlanFacts: true, previousPlanFact: true, latestPlanFact: true,
  });
});

it('rejects repeated generic improvement text when the notes and plans differ', () => {
  const answer = 'À la consultation précédente : la personne rapporte un mieux depuis le dernier entretien. À la plus récente : la personne rapporte un mieux depuis le dernier entretien.';
  expect(evaluateComparisonEvidence(answer, previous, latest)).toMatchObject({ passed: false, distinctVisitFacts: false, changedPlanFacts: false });
});

it('rejects paired facts presented in the reverse chronological order', () => {
  const answer = 'Comparaison : du 2 nov. 2025 au 5 oct. 2023. Le contexte décrit passe de « durant les périodes moins structurées » à « après un échange difficile ». Le suivi prévu passe de « prévoir un repas partagé » à « prévoir une promenade courte ».';
  expect(evaluateComparisonEvidence(answer, previous, latest)).toMatchObject({ passed: false, distinctVisitFacts: false, changedPlanFacts: false });
});
