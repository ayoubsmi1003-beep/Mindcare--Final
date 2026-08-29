import { readFileSync } from "node:fs";
const env = {};
for (const l of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = /^\s*([A-Za-z_]\w*)\s*=\s*(.*)$/.exec(l);
  if (m && m[2].trim() !== "") env[m[1]] = m[2].trim();
}
const base = env["NEXT_PUBLIC_SUPABASE_URL"].replace(/\/+$/, "");
const H = { "Content-Type": "application/json", apikey: env["NEXT_PUBLIC_SUPABASE_ANON_KEY"], Authorization: "", Accept: "text/event-stream" };

const login = await fetch(base + "/auth/v1/token?grant_type=password", {
  method: "POST", headers: { ...H, Authorization: "" },
  body: JSON.stringify({ email: "owner.dev@invalid.local", password: env["DOCTOR_ACCOUNT_PASSWORD"] }),
});
H.Authorization = "Bearer " + (await login.json()).access_token;
const baseHeaders = { "Content-Type": "application/json", apikey: env["NEXT_PUBLIC_SUPABASE_ANON_KEY"], Authorization: H.Authorization };
const prof = { ...baseHeaders, "Accept-Profile": "app", "Content-Profile": "app" };

for (let essai = 1; essai <= 3; essai += 1) {
  const sc = await fetch(base + "/rest/v1/rpc/start_jarvis_conversation", { method: "POST", headers: prof, body: "{}" });
  const texteConv = await sc.text();
  if (!sc.ok) {
    console.log("start_conv", sc.status, texteConv.slice(0, 140));
    continue;
  }
  const conv = JSON.parse(texteConv);

  const r = await fetch(base + "/functions/v1/jarvis-chat", {
    method: "POST", headers: H,
    body: JSON.stringify({
      message: "Cherche la patiente dont le nom contient Aissou",
      conversationId: conv,
      clientTurnId: crypto.randomUUID(),
      mode: "flux",
    }),
  });
  console.log(`status ${r.status} ${r.headers.get("content-type")} conv=${String(conv).slice(0, 8)}`);
  const lect = r.body.getReader();
  const dec = new TextDecoder();
  let tampon = ""; const evenements = []; let t0 = Date.now();
  for (;;) {
    const { done, value } = await lect.read();
    if (done) break;
    tampon += dec.decode(value, { stream: true });
    let i;
    while ((i = tampon.indexOf("\n\n")) >= 0) {
      const ev = tampon.slice(0, i); tampon = tampon.slice(i + 2);
      for (const ligne of ev.split("\n")) {
        if (!ligne.startsWith("data:")) continue;
        try {
          const j = JSON.parse(ligne.slice(5).trim());
          evenements.push(`${j.t}(${j.t === "erreur" ? j.code + ":" + j.message : j.t === "fin" ? JSON.stringify(j.payload).slice(0, 90) : typeof j.v === "string" ? j.v.length + "c" : ""}) @${Date.now() - t0}ms`);
        } catch { evenements.push("PARSE?" + ligne.slice(0, 60)); }
      }
    }
  }
  console.log(`— essai ${essai}:`, evenements.join(" · ").slice(0, 420));
}
