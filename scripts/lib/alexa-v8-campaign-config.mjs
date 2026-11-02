/** Runs one V8 campaign operation with the approved vector retrieval gate on. */
export async function withV8KnowledgeVectorEnabled(operation) {
  if (typeof operation !== "function") throw new TypeError("V8 campaign operation is required");
  const previous = process.env["KNOWLEDGE_VECTOR"];
  process.env["KNOWLEDGE_VECTOR"] = "1";
  try {
    return await operation();
  } finally {
    if (previous === undefined) delete process.env["KNOWLEDGE_VECTOR"];
    else process.env["KNOWLEDGE_VECTOR"] = previous;
  }
}
