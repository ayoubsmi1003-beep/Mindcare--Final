import { describe, expect, it, vi } from "vitest";
import { readApplication } from "@/server/alexa/application-reads";
import { frenchRequestAdmission } from "@/shared/alexa/request-contract";

const row = (index: number, unread = false) => ({ id: `11111111-1111-4111-8111-${String(index).padStart(12, "0")}`, sender_name: "Assistante", corps: `Message ${index}`, cree_le: "2026-11-01T09:00:00Z", non_lu: unread });
const read = (rows: unknown[]) => readApplication("call", "internal_messages", vi.fn(async () => rows), new AbortController().signal);

describe("internal messages read", () => {
  it("lists messages and counts unread ones from the gate's flag", async () => {
    const result = await read([row(1, true), row(2)]);
    expect(result.status).toBe("ok");expect(result.complete).toBe(true);
    expect(result.text).toContain("2 message(s) interne(s), dont 1 non lu(s)");
    expect(result.text).toContain("2026-11-01, Assistante (non lu) : Message 1");
  });
  it("is honest about an empty list", async () => {
    const result = await read([]);
    expect(result.status).toBe("empty");expect(result.text).toContain("Aucun message");
  });
  it("says when older messages exist", async () => {
    const result = await read(Array.from({ length: 21 }, (_, index) => row(index + 1)));
    expect(result.status).toBe("partial");expect(result.complete).toBe(false);
    expect(result.text).toContain("les plus récents");expect(result.text).not.toContain("Message 21");
  });
});

describe("routing", () => {
  it("reads", () => expect(frenchRequestAdmission("Montre mes messages internes.", false)).toMatchObject({ tools: ["query_app"], applicationView: "internal_messages" }));
  it("never turns sending into reading", () => expect(frenchRequestAdmission("Envoie un message interne à l'assistante.", false).applicationView).not.toBe("internal_messages"));
});
