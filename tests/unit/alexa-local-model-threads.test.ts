import { describe, expect, it } from "vitest";
import { localModelThreadCountFor } from "@/server/alexa/local-model";

describe("local MiniCPM thread budget", () => {
  it.each([[1, 1], [2, 1], [4, 1], [8, 4]])(
    "uses the measured single-thread budget on small CPUs (%i -> %i)",
    (available, expected) => {
      expect(localModelThreadCountFor(available)).toBe(expected);
    },
  );
});
