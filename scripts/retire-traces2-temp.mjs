import { readFileSync, writeFileSync } from "node:fs";

// 1 · supabase.ts
let s = readFileSync("src/services/db/supabase.ts", "utf8");
s = s.replace(
  'const abandonnerExterne = () => { console.info("[adapter] abort externe recu"); controleur.abort(); };',
  "const abandonnerExterne = () => controleur.abort();",
);
writeFileSync("src/services/db/supabase.ts", s);

// 2 · jarvis.ts
let j = readFileSync("src/services/jarvis.ts", "utf8");
j = j.replace(
  'const abandonnerExterne = () => { console.info("[jarvis] externe -> watchdog"); controleur.abort(); };',
  "const abandonnerExterne = () => controleur.abort();",
);
j = j
  .split("\n")
  .filter((l) => !l.includes("console.info(String.fromCharCode"))
  .join("\n");
writeFileSync("src/services/jarvis.ts", j);

// 3 · conversation.ts — retrait du bloc TEMP-PROBE entier
let c = readFileSync("src/services/conversation.ts", "utf8");
const debut = c.indexOf("// TEMP-PROBE");
if (debut >= 0) {
  const finBloc = c.indexOf("\n}", debut);
  c = c.slice(0, debut).trimEnd() + "\n" + c.slice(finBloc + 3);
}
writeFileSync("src/services/conversation.ts", c);
console.log("traces retirées");
