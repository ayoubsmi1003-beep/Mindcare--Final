import { readFileSync, writeFileSync } from "node:fs";

let c = readFileSync("src/services/conversation.ts", "utf8");
const marque = "const abonnes = new Set<Abonne>();";
const hook = `

// TEMP-PROBE — retiré après diagnostic.
if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>)["__mc"] = {
    get etat() { return interne.etat; },
    get tours() { return interne.tours.length; },
    get nbAbonnes() { return abonnes.size; },
    interrompre,
  };
}`;
if (!c.includes("TEMP-PROBE")) c = c.replace(marque, marque + hook);
writeFileSync("src/services/conversation.ts", c);
console.log("hook posé");
