/** Projects one synthetic campaign turn into a user-requested Q/A transcript row. */
export function createV8AnswerTranscriptRow({ caseId, turnIndex, prompt, observation } = {}) {
  if (typeof caseId !== "string" || !/^ADV-\d{3}$/u.test(caseId) ||
      !Number.isInteger(turnIndex) || turnIndex < 0 || typeof prompt !== "string" || !prompt.trim()) {
    throw new TypeError("Valid V8 transcript turn identity and question are required");
  }
  const answer = Array.isArray(observation?.events)
    ? observation.events.filter(event => event?.type === "sentence" && typeof event.text === "string")
      .map(event => event.text).join("\n")
    : "";
  return { caseId, turnNumber: turnIndex + 1, question: prompt, answer };
}
