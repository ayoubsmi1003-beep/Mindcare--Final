#!/usr/bin/env node
/**
 * sonde-flux-modele.mjs — V-JARVIS-CORE §12/§14.
 * La VÉRITÉ D'EXÉCUTION du streaming : `supported_parameters` d'OpenRouter est
 * une déclaration ; seule une requête `stream:true` réelle fait foi. Cette
 * sonde envoie UNE requête minuscule au modèle cible et chronomètre :
 *   · time_to_first_delta
 *   · intervalles entre fragments
 *   · time_to_completion
 * Elle détecte aussi le TAMPONNAGE (tout arriver d'un bloc) — un faux
 * streaming se voit à l'instrument, il ne passe pas pour du vrai.
 *
 *   node scripts/sonde-flux-modele.mjs [slug]
 *
 * Clé lue dans `supabase/functions/.env` (OPENROUTER_API_KEY) et JAMAIS
 * imprimée. Aucune donnée patient : message de test fixe, sans objet.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SORTIE_LONGUE = process.argv.includes("--long");
const SLAGE_VISE = process.argv.find((a) => !a.startsWith("--") && a !== process.argv[0] && a !== process.argv[1])
  ?? "nvidia/nemotron-3.5-lightning:free";
const CONSIGNE = SORTIE_LONGUE
  ? "Rédige un paragraphe d'environ trois cents mots expliquant la différence entre une crise d'angoisse et une attaque de panique, en français."
  : "Réponds uniquement par le mot : prêt.";
const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envFonctions = readFileSync(path.join(racine, "supabase", "functions", ".env"), "utf8");
let clef = "";
for (const ligne of envFonctions.split(/\r?\n/)) {
  const m = /^OPENROUTER_API_KEY=(.*)$/.exec(ligne);
  if (m !== null) { clef = m[1].trim(); break; }
}
if (clef === "") { console.log("ROUGE | clé absente de supabase/functions/.env"); process.exit(1); }

const depart = Date.now();
const reponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${clef}`,
    "Content-Type": "application/json",
    "HTTP-Referer": "http://localhost",
    "X-Title": "MindCare-sonde",
  },
  body: JSON.stringify({
    model: SLAGE_VISE,
    messages: [{ role: "user", content: CONSIGNE }],
    max_tokens: 2000,
    stream: true,
    usage: { include: true },
  }),
});

console.log(`HTTP ${reponse.status} en ${Date.now() - depart} ms`);
if (!reponse.ok) {
  const corps = await reponse.text();
  console.log("corps:", corps.slice(0, 400).replace(/sk-[A-Za-z0-9_-]+/g, "<clé masquée>"));
  console.log("VERDICT : ROUGE");
  process.exit(1);
}

const lecteur = reponse.body.getReader();
const decodeur = new TextDecoder();
let tampon = "";
let fragments = 0;
let caracteres = 0;
let premierDeltaMs = null;
let dernierDeltaMs = null;
const intervalles = [];
let usageFinal = null;

while (true) {
  const { done, value } = await lecteur.read();
  if (done) break;
  tampon += decodeur.decode(value, { stream: true });
  const lignes = tampon.split("\n");
  tampon = lignes.pop() ?? "";
  for (const ligne of lignes) {
    const t = ligne.trim();
    if (!t.startsWith("data:")) continue;
    const donnees = t.slice(5).trim();
    if (donnees === "[DONE]") continue;
    try {
      const o = JSON.parse(donnees);
      const frag = o.choices?.[0]?.delta?.content;
      if (typeof frag === "string" && frag.length > 0) {
        fragments++;
        caracteres += frag.length;
        const maintenant = Date.now();
        if (premierDeltaMs === null) premierDeltaMs = maintenant - depart;
        else intervalles.push(maintenant - dernierDeltaMs);
        dernierDeltaMs = maintenant;
      }
      if (o.usage) usageFinal = o.usage;
    } catch { /* keep-alive */ }
  }
}

console.log(`fragments=${fragments} caracteres=${caracteres}`);
console.log(`time_to_first_delta=${premierDeltaMs ?? "—"} ms`);
if (intervalles.length > 0) {
  const trie = [...intervalles].sort((a, b) => a - b);
  console.log(`intervalles: n=${trie.length} mediane=${trie[Math.floor(trie.length / 2)]} max=${trie.at(-1)} ms`);
}
console.log(`time_to_completion=${dernierDeltaMs !== null ? dernierDeltaMs - depart : "—"} ms`);
console.log(`usage=${usageFinal ? JSON.stringify(usageFinal) : "non fourni"}`);

const reel = fragments >= 1 && premierDeltaMs !== null && dernierDeltaMs - premierDeltaMs >= 0;
const progresse = fragments > 1 ? intervalles.some((i) => i > 0) : true; // réponse courte = 1 fragment acceptable
if (!reel || !progresse) { console.log("VERDICT : ROUGE — streaming non prouvé"); process.exit(1); }
console.log(fragments === 1
  ? "NOTE | un seul fragment : réponse trop courte pour juger la progressivité — relancer sur sortie longue avant de conclure."
  : "VERDICT : VERT — deltas progressifs mesurés.");
