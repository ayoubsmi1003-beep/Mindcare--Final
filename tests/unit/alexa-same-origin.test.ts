import { expect, it } from "vitest";
import { isSameOriginRequest } from "@/server/auth/same-origin";
it("accepts the browser host when Next reconstructs its internal bind host", () => {
  expect(isSameOriginRequest(new Request("http://localhost:3000/api/alexa/turn", { headers: { Host: "127.0.0.1:3000", Origin: "http://127.0.0.1:3000" } }))).toBe(true);
});
it.each(["https://attacker.test", "http://127.0.0.1:3001", "https://127.0.0.1:3000", "null", "http://127.0.0.1:3000/path"])("rejects a different or malformed origin: %s", origin => {
  expect(isSameOriginRequest(new Request("http://localhost:3000/api/alexa/turn", { headers: { Host: "127.0.0.1:3000", Origin: origin } }))).toBe(false);
});
it("does not trust forwarded host to admit another site", () => {
  expect(isSameOriginRequest(new Request("http://localhost:3000/api/alexa/turn", { headers: { Host: "127.0.0.1:3000", "x-forwarded-host": "attacker.test", Origin: "http://attacker.test" } }))).toBe(false);
});
