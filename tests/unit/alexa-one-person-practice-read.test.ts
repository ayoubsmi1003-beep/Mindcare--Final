import { describe, expect, it } from "vitest";
import { scriptedAlexaRpc } from "../helpers/alexa-rpc";
import { agentExecutor } from "@/server/alexa/agent-tools";

// Development wordings, never C270/H270.
const asOf = "2026-11-05T12:00:00+01:00";
const input = { text: "", conversationId: "one-person", clientTurnId: "11111111-1111-4111-8111-111111111111", appContext: { patientId: null, page: "/jarvis" } };
const list = { total: 0, rows: [], totals: {}, complete: true, offset: 0 };
const run = async (text: string) => {
  const rpc = scriptedAlexaRpc(async (name) => {
    if (name === "query_alexa_records") return { ok: true as const, data: [list] };
    throw Error(name);
  });
  const result = await agentExecutor({ ...input, text }, { rpc }, { rpc: async () => { throw Error("no book"); } })(
    { id: "c", name: "query_consultations", args: { partIds: ["c"], mode: "list" } }, asOf, [], new AbortController().signal,
  );
  return { result, read: rpc.mock.calls.some(([name]) => name === "query_alexa_records") };
};

describe("a question about one person never reads the practice's whole list of consultations", () => {
  it("asks which patient when the person's name was not read", async () => {
    for (const text of ["Xo vi est-il déjà passé au cabinet ?", "Est-ce qu'elle est déjà venue en consultation ?"]) {
      const { result, read } = await run(text);
      expect(read, text).toBe(false);
      expect(result.status, text).toBe("needs_input");
    }
  });
  it("still lists the practice's consultations when the question is about the practice", async () => {
    const { result, read } = await run("Liste les consultations du cabinet.");
    expect(read).toBe(true);
    expect(result.status).not.toBe("needs_input");
  });
});
