import { readFileSync, writeFileSync } from "node:fs";

// Retire les traces temporaires posées pour le diagnostic Stop.
let c = readFileSync("src/services/conversation.ts", "utf8");
c = c
  .split("\n")
  .filter((l) => !l.includes("STOP demande, controleur present") && !l.includes("TEMP-DEBUG"))
  .join("\n");
writeFileSync("src/services/conversation.ts", c);

let j = readFileSync("src/services/jarvis.ts", "utf8");
j = j
  .split("\n")
  .filter(
    (l) =>
      !l.includes("[jarvis.flux] sortie exception") &&
      !l.includes("[jarvis.flux] signal externe abandonne"),
  )
  .join("\n");
writeFileSync("src/services/jarvis.ts", j);
console.log("traces retirees");
