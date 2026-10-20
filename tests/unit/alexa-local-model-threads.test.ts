import { describe, expect, it } from "vitest";
import { localModelThreadCountFor } from "@/server/alexa/local-model";

describe("local MiniCPM thread budget", () => {
  it.each([[1, 1], [2, 2], [4, 4], [8, 4]])(
    "uses no more than available CPU slots and caps at four (%i -> %i)",
    (available, expected) => {
      expect(localModelThreadCountFor(available)).toBe(expected);
    },
  );
});
