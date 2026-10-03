/** Closed JSON envelope scanner. Only complete objects can reach the validator. */
export class SentenceStream {
  private text = "";
  private offset = 0;
  private phase: "prefix" | "first" | "next" | "object" | "separator" | "tail" | "done" = "prefix";
  private start = 0;
  private depth = 0;
  private quoted = false;
  private escaped = false;
  private objects = 0;

  *push(chunk: string): Generator<unknown> {
    if (typeof chunk !== "string" || this.text.length + chunk.length > 40_000) throw new Error("InvalidAlexaStream");
    this.text += chunk;
    while (this.offset < this.text.length) {
      const char = this.text[this.offset]!;
      if (this.phase === "prefix") {
        if (char === "[") {
          if (!/^\s*\{\s*"sentences"\s*:\s*\[$/u.test(this.text.slice(0, this.offset + 1))) throw new Error("InvalidAlexaStream");
          this.phase = "first";
        }
        this.offset++;
      } else if (this.phase === "first" || this.phase === "next") {
        if (/\s/u.test(char)) { this.offset++; continue; }
        if (char === "]" && this.phase === "first") { this.phase = "tail"; this.offset++; continue; }
        if (char !== "{" || ++this.objects > 12) throw new Error("InvalidAlexaStream");
        this.start = this.offset;
        this.depth = 1;
        this.quoted = false;
        this.escaped = false;
        this.phase = "object";
        this.offset++;
      } else if (this.phase === "object") {
        if (this.quoted) {
          if (this.escaped) this.escaped = false;
          else if (char === "\\") this.escaped = true;
          else if (char === '"') this.quoted = false;
        } else if (char === '"') this.quoted = true;
        else if (char === "{") this.depth++;
        else if (char === "}") this.depth--;
        this.offset++;
        if (this.depth === 0) {
          const value: unknown = JSON.parse(this.text.slice(this.start, this.offset));
          this.phase = "separator";
          yield value;
        }
      } else {
        if (/\s/u.test(char)) { this.offset++; continue; }
        if (this.phase === "separator" && char === ",") this.phase = "next";
        else if (this.phase === "separator" && char === "]") this.phase = "tail";
        else if (this.phase === "tail" && char === "}") this.phase = "done";
        else throw new Error("InvalidAlexaStream");
        this.offset++;
      }
    }
  }

  finish(): unknown {
    if (this.phase !== "done") throw new Error("InvalidAlexaStream");
    return JSON.parse(this.text) as unknown;
  }
}
