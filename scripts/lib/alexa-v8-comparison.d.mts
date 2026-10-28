export interface ComparisonEvidence {
  passed: boolean;
  orderedComparison: boolean;
  distinctVisitFacts: boolean;
  changedPlanFacts: boolean;
  evolutionFacts: boolean;
  previousVisitFact?: boolean;
  latestVisitFact?: boolean;
  previousPlanFact?: boolean;
  latestPlanFact?: boolean;
}
export function evaluateComparisonEvidence(answer: string, previous: Record<string, unknown>, latest: Record<string, unknown>): ComparisonEvidence;
