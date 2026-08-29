#!/usr/bin/env node
/**
 * sonde-variantes-nemotron.mjs — V-JARVIS-CORE §12/§14.
 * Départage par mesure de trois questions :
 *   Q1 · le fournisseur envoie-t-il PLUSIEURS lectures réseau (progressivité
 *        réelle) ou un seul bloc ? — compteur de `read()` bruts.
 *   Q2 · `reasoning:{exclude:true}` / `{effort:"low"}` sont-ils acceptés,
 *        réduisent-ils la latence avant premier contenu ?
 *   Q3 · le plafond 2000 tokens tronque-t-il ? (completion==max ⇒ oui)
 *
 *   node scripts/sonde-variantes-nemotron.mjs
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODELE = "nvidia/nemotron-3.5-lightning:free";
const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let clef = "";
for (const ligne of readFileSync(path.join(racine, "supabase", "functions", ".env"), "utf8").split(/\r?\n/)) {
  const m = /^OPENROUTER_API_KEY=(.*)$/.exec(ligne);
  if (m !== null) { clef = m[1].trim(); break; }
}

async function variante(nom, extra) {
  const depart = Date.now();
  let lectures = 0;
  let fragments = 0;
  let caracteres = 0;
  let premierMs = null;
  let dernierMs = null;
  let usage = null;
  try {
    const reponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${clef}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost",
        "X-Title": "MindCare-sonde",
      },
      body: JSON.stringify({
        model: MODELE,
        messages: [{ role: "user", content: "Explique en français, en environ deux cents mots, ce qu'est un rituel d'ancrage en thérapie cognitivo-comportementale." }],
        max_tokens: 4000,
        stream: true,
        usage: { include: true },
        ...extra,
      }),
    });
    if (!reponse.ok) {
      console.log(`${nom} | HTTP ${reponse.status} | ${(await reponse.text()).slice(0, 160)}`);
      return;
    }
    const lecteur = reponse.body.getReader();
    const decodeur = new TextDecoder();
    let tampon = "";
    while (true) {
      const { done, value } = await lecteur.read();
      if (done) break;
      lectures++;
      tampon += decodeur.decode(value, { stream: true });
      const lignes = tampon.split("\n");
      tampon = lignes.pop() ?? "";
      for (const ligne of lignes) {
        const t = ligne.trim();
        if (!t.startsWith("data:") || t.slice(5).trim() === "[DONE]") continue;
        try {
          const o = JSON.parse(t.slice(5).trim());
          const frag = o.choices?.[0]?.delta?.content;
          if (typeof frag === "string" && frag.length > 0) {
            fragments++; caracteres += frag.length;
            const n = Date.now() - depart;
            if (premierMs === null) premierMs = n;
            dernierMs = n;
          }
          if (o.usage) usage = o.usage;
        } catch { /* keep-alive */ }
      }
    }
    const raz = usage?.completion_tokens_details?.reasoning_tokens ?? "?";
    const tronque = usage?.completion_tokens >= 4000 ? " OUI(max atteint)" : " non";
    console.log(
      `${nom} | lecturesRéseau=${lectures} fragments=${fragments} car=${caracteres}` +
      ` | 1erContenu=${premierMs ?? "—"}ms fin=${dernierMs - depart}ms` +
      ` | reasoning=${raz}${tronque}`,
    );
  } catch (e) {
    console.log(`${nom} | ERREUR ${e.cause?.code ?? e.message}`);
  }
}

await variante("A·base                ", {});
await variante("B·exclude             ", { reasoning: { exclude: true } });
await variante("C·effort_low          ", { reasoning: { effort: "low" } });
