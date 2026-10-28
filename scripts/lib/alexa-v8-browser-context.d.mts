export function resolveV8ScenarioPath(
  scenarioId: string,
  preconditions: { version: number; cases: Record<string, { kind: string; source: string }> },
  snapshot: { currentDocument?: Record<string, unknown> | null } | null,
  origin: string,
): string;
export function resolveV8AssistantInteraction(
  scenarioId: string,
  preconditions: { version: number; cases: Record<string, { kind: string; source: string }> },
  snapshot: { currentDocument?: Record<string, unknown> | null } | null,
): { openPanel: boolean; inputSelector: string };
export function assertV8ScenarioAppContext(
  scenarioId: string,
  preconditions: { version: number; cases: Record<string, { kind: string; source: string }> },
  snapshot: { currentDocument?: Record<string, unknown> | null } | null,
  appContext: Record<string, unknown> | null | undefined,
): void;
export function findV8StaticAssetFailures(
  responses: readonly { url: string; status: number }[],
  origin: string,
): { path: string; status: number }[];
