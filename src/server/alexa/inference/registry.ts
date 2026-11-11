import { ALEXA_CONVERSATION_MODEL } from "../model-policy";
import { inferLocalCompletion, inferLocalText } from "../local-model";
import type { LocalCompletion, LocalMessage } from "../local-model-protocol";
import { noteTurnCode } from "../turn-trace";

/**
 * Which model serves which job. Only the local model is registered: a stronger model later means
 * adding a provider here and benchmarking it, without touching orchestration. Anything external
 * would still have to go through `egress/external-call.ts`.
 */
export const INFERENCE_TASKS = ["tool_selection", "general", "knowledge_selection", "knowledge_french", "narrative", "clinical_selection", "intent_choice"] as const;
export type InferenceTask = (typeof INFERENCE_TASKS)[number];
type LocalOptions = Parameters<typeof inferLocalText>[1];

export interface InferenceProvider {
  readonly id: string;
  readonly modelVersion: string;
  readonly local: boolean;
  text(messages: readonly LocalMessage[], options: LocalOptions): Promise<string>;
  completion(messages: readonly LocalMessage[], options: NonNullable<LocalOptions>): Promise<LocalCompletion>;
}

const localMiniCpm: InferenceProvider = {
  id: "local-minicpm", modelVersion: ALEXA_CONVERSATION_MODEL, local: true,
  text: (messages, options) => inferLocalText(messages, options),
  completion: (messages, options) => inferLocalCompletion(messages, options),
};

export const INFERENCE_PROVIDERS: Readonly<Record<string, InferenceProvider>> = { [localMiniCpm.id]: localMiniCpm };
export const TASK_PROVIDERS: Readonly<Record<InferenceTask, string>> = {
  tool_selection: localMiniCpm.id, general: localMiniCpm.id, knowledge_selection: localMiniCpm.id,
  knowledge_french: localMiniCpm.id, narrative: localMiniCpm.id, clinical_selection: localMiniCpm.id, intent_choice: localMiniCpm.id,
};
export function providerForTask(task: InferenceTask): InferenceProvider {
  const provider = INFERENCE_PROVIDERS[TASK_PROVIDERS[task]];
  if (!provider) throw new Error("InferenceProviderMissing");
  return provider;
}

async function measured<T>(task: InferenceTask, operation: () => Promise<T>): Promise<T> {
  const startedAt = Date.now();
  try { return await operation(); }
  finally { noteTurnCode("model", `${task}:${Math.round((Date.now() - startedAt) / 1000)}s`); }
}
export function inferTextForTask(task: InferenceTask, messages: readonly LocalMessage[], options?: LocalOptions): Promise<string> {
  return measured(task, () => providerForTask(task).text(messages, options));
}
export function inferCompletionForTask(task: InferenceTask, messages: readonly LocalMessage[], options: NonNullable<LocalOptions>): Promise<LocalCompletion> {
  return measured(task, () => providerForTask(task).completion(messages, options));
}
