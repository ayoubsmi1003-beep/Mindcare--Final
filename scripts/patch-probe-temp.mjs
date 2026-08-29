import { readFileSync, writeFileSync } from "node:fs";

let t = readFileSync("scripts/probe-stop-temp.mjs", "utf8");
const injection = `await page.evaluate(() => {
  const b = document.querySelector('button[aria-label="Arrêter la réponse"]');
  const r = b.getBoundingClientRect();
  const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
  window.__hit = el ? (el.tagName + '|' + (el.getAttribute('aria-label') || '') + '|' + String(el.className).slice(0, 70)) : 'rien';
});
console.log('HIT:', await page.evaluate(() => window.__hit));
await stop.click();`;
t = t.replace("await stop.click();", injection);
writeFileSync("scripts/probe-stop-temp.mjs", t);
console.log("patché");
