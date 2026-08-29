import { readFileSync, writeFileSync } from "node:fs";

let s = readFileSync("src/services/db/supabase.ts", "utf8");
s = s.replace(
  "const abandonnerExterne = () => controleur.abort();",
  'const abandonnerExterne = () => { console.info("[adapter] abort externe recu"); controleur.abort(); };',
);
writeFileSync("src/services/db/supabase.ts", s);

let j = readFileSync("src/services/jarvis.ts", "utf8");
j = j.replace(
  "const abandonnerExterne = () => controleur.abort();",
  'const abandonnerExterne = () => { console.info("[jarvis] externe -> watchdog"); controleur.abort(); };',
);
writeFileSync("src/services/jarvis.ts", j);
console.log("traces chaîne posées");
