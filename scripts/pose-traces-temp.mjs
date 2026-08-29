import { readFileSync, writeFileSync } from "node:fs";

let c = readFileSync("src/services/conversation.ts", "utf8");
c = c.replace(
  "export function interrompre(): void {",
  'export function interrompre(): void {\n  console.info("[conversation] STOP demande, controleur present:", controleurEnCours !== null);',
);
writeFileSync("src/services/conversation.ts", c);

let j = readFileSync("src/services/jarvis.ts", "utf8");
j = j.replace(
  "    // Interruption utilisateur : SUCCÈS partiel, jamais une erreur.\n    if (signal?.aborted) {\n      return ok({ chemin, texte, proposition, conversationId, persiste: false, interrompu: true });\n    }\n    if (cause instanceof ErreurPasserelle) {",
  '    console.info("[jarvis.flux] sortie exception:", cause instanceof Error ? cause.name : String(cause));\n    console.info("[jarvis.flux] signal externe abandonne:", signal?.aborted === true);\n    // Interruption utilisateur : SUCCÈS partiel, jamais une erreur.\n    if (signal?.aborted) {\n      return ok({ chemin, texte, proposition, conversationId, persiste: false, interrompu: true });\n    }\n    if (cause instanceof ErreurPasserelle) {',
);
writeFileSync("src/services/jarvis.ts", j);
console.log("traces posees");
