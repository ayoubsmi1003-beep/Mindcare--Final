import { spawnSync } from "node:child_process";

const MAX_ATTENTES = 12; // 12 × 45 s ≈ 9 min
for (let i = 1; i <= MAX_ATTENTES; i += 1) {
  const r = spawnSync("node", ["-e", `
    const { readFileSync } = require("node:fs");
    const env = {};
    for (const l of readFileSync(".env","utf8").split(/\\r?\\n/)) {
      const m = /^\\s*([A-Za-z_]\\w*)\\s*=\\s*(.*)$/.exec(l);
      if (m && m[2].trim() !== "") env[m[1]] = m[2].trim();
    }
    const base = env["NEXT_PUBLIC_SUPABASE_URL"].replace(/\\/+$/, "");
    const H = { "Content-Type": "application/json", apikey: env["NEXT_PUBLIC_SUPABASE_ANON_KEY"] };
    (async () => {
      const lg = await fetch(base + "/auth/v1/token?grant_type=password", { method:"POST", headers:H, body: JSON.stringify({ email:"owner.dev@invalid.local", password: env["DOCTOR_ACCOUNT_PASSWORD"] }) });
      const j = await lg.json();
      const r = await fetch(base + "/functions/v1/jarvis-chat", { method:"POST",
        headers: { ...H, Authorization: "Bearer " + j.access_token },
        body: JSON.stringify({ message:"Bonjour", conversationId: crypto.randomUUID(), clientTurnId: crypto.randomUUID(), mode:"flux" }),
        signal: AbortSignal.timeout(60_000) });
      let deltas = 0; let finVrai = false;
      const lect = r.body.getReader(); const dec = new TextDecoder();
      let tampon = "";
      for (;;) { const { done, value } = await lect.read(); if (done) break;
        tampon += dec.decode(value, { stream: true }); let k;
        while ((k = tampon.indexOf("\\n\\n")) >= 0) { const ev = tampon.slice(0,k); tampon = tampon.slice(k+2);
          if (ev.includes('"t":"delta"')) deltas++; if (ev.includes('"t":"fin"')) finVrai = true; } }
      console.log(deltas > 3 && finVrai ? "VIVANT" : "MORT d=" + deltas);
    })().catch((e) => console.log("MORT", e.cause?.code ?? e.message));
  `], { encoding: "utf8" });
  const sortie = `${r.stdout ?? ""}`;
  if (sortie.includes("VIVANT")) {
    console.log(`fournisseur vivant après ${i} attente(s) — lancement instrument`);
    const s = spawnSync("node", ["scripts/mesure-jarvis-navigateur.mjs"], { stdio: "inherit" });
    process.exit(s.status ?? 1);
  }
  console.log(`tentative ${i}: ${sortie.trim() || "silence"} — attente 45 s`);
  await new Promise((res) => setTimeout(res, 45_000));
}
console.error("fournisseur toujours muet après", MAX_ATTENTES, "attentes");
process.exit(1);
