import { readFileSync, writeFileSync } from "node:fs";

// supabase.ts — retire entrée + listener tracés
let s = readFileSync("src/services/db/supabase.ts", "utf8");
s = s.replace('    console.info("[TRACE-adapter] appel", name, "signal:", signal !== undefined);\n', "");
s = s.replace(
  `const abandonnerExterne = () => {
      console.info("[TRACE-adapter] externe recu");
      controleur.abort();
    };`,
  "const abandonnerExterne = () => controleur.abort();",
);
writeFileSync("src/services/db/supabase.ts", s);

// jarvis.ts
let j = readFileSync("src/services/jarvis.ts", "utf8");
j = j.replace(`  const abandonnerExterne = () => {
    console.info("[TRACE-jarvis] externe recu");
    controleur.abort();
  };`, "  const abandonnerExterne = () => controleur.abort();");
j = j.replace('  console.info("[TRACE-jarvis] attachement sur signal:", signal !== undefined);\n', "");
writeFileSync("src/services/jarvis.ts", j);

// conversation.ts
let c = readFileSync("src/services/conversation.ts", "utf8");
c = c.replace('  console.info("[TRACE-manager] interrompre, contrôleur:", controleurEnCours !== null);\n', "");
c = c.split("\n").filter((l) => !l.includes("TEMP") && !l.includes("__mc")).join("\n");
writeFileSync("src/services/conversation.ts", c);

for (const f of ["src/services/db/supabase.ts", "src/services/jarvis.ts", "src/services/conversation.ts"]) {
  if (readFileSync(f, "utf8").includes("TRACE")) console.log("RESTE:", f);
}
console.log("traces retirées");
