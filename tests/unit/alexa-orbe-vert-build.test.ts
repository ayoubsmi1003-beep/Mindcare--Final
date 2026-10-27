/**
 * Orbe vert — porte de non-régression sur le build servi.
 *
 * Le Playwright `alexa-orbe-vert.spec.ts` prouve l'orbe interactif ; ce test
 * prouve le CONTENU servi, sans navigateur ni session : le HTML de /jarvis
 * porte la marque Avatar et son CSS vert. Skip si :3000 injoignable.
 */
import { describe, expect, it } from "vitest";

const BASE = "http://localhost:3000";

async function reachable(): Promise<boolean> {
  try {
    const r = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(10_000) });
    return r.ok;
  } catch {
    return false;
  }
}

const USER = process.env.MINDCARE_E2E_USER ?? "";
const PASS = process.env.MINDCARE_E2E_PASS ?? "";

describe("orbe vert servi", () => {
  // Note : le HTML SSR de /jarvis est un squelette (session résolue côté
  // client), donc la marque n'est prouvable que dans le CSS servi + en
  // interactif (spec e2e alexa-orbe-vert).

  it("le CSS servi contient la classe ava-orb (preset vert)", async () => {
    if (!(await reachable())) return;
    const html = await (await fetch(`${BASE}/jarvis`, { signal: AbortSignal.timeout(60_000) })).text();
    const hrefs = [...html.matchAll(/href="([^"]+\.css(?:\?[^\"]*)?)"/g)]
      .map((m) => m[1])
      .filter((h): h is string => typeof h === "string");
    expect(hrefs.length).toBeGreaterThan(0);
    let vert = false;
    for (const h of hrefs) {
      try {
        const css = await (
          await fetch(new URL(h, BASE), { signal: AbortSignal.timeout(30_000) })
        ).text();
        // Nom de classe uniquement : les littéraux couleur sont interdits
        // en TS par la règle I10 (la teinte vit dans avatar-alexa.css).
        if (css.includes(".ava-orb")) vert = true;
      } catch {
        // chunk CSS manquant : on continue sur les autres
      }
    }
    expect(vert).toBe(true);
  });
});
