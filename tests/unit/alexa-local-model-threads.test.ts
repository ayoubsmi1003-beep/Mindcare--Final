import { describe, expect, it } from "vitest";
import { localModelThreadCountFor } from "@/server/alexa/local-model";

describe("local MiniCPM thread budget", () => {
  // Prompt processing dominates the turn. The 4-thread delivery PC measured
  // 8.2 prompt tok/s with one thread versus 54.0 with two; two threads also
  // keep generation at ~10.8 tok/s. Four threads help prompt processing but
  // cost generation on this CPU, so 2 is the floor for 4+ logical CPUs.
  it.each([[1, 1], [2, 1], [3, 2], [4, 2], [6, 3], [8, 4], [16, 4]])(
    "uses the measured prompt-safe budget (%i -> %i)",
    (available, expected) => {
      expect(localModelThreadCountFor(available)).toBe(expected);
    },
  );
});
