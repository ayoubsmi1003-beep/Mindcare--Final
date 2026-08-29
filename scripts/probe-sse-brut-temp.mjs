import { readFileSync } from "node:fs";
const env = {};
for (const l of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = /^\s*([A-Za-z_]\w*)\s*=\s*(.*)$/.exec(l);
  if (m && m[2].trim() !== "") env[m[1]] = m[2].trim();
}
const base = env["NEXT_PUBLIC_SUPABASE_URL"].replace(/\/+$/, "");
const lg = await fetch(base + "/auth/v1/token?grant_type=password", {
  method: "POST",
  headers: { "Content-Type": "application/json", apikey: env["NEXT_PUBLIC_SUPABASE_ANON_KEY"] },
  body: JSON.stringify({ email: "owner.dev@invalid.local", password: env["DOCTOR_ACCOUNT_PASSWORD"] }),
});
const { access_token } = await lg.json();

// Conversation réelle
const sc = await fetch(base + "/rest/v1/rpc/start_jarvis_conversation", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    apikey: env["NEXT_PUBLIC_SUPABASE_ANON_KEY"],
    Authorization: "Bearer " + access_token,
    "Accept-Profile": "app",
    "Content-Profile": "app",
  },
  body: "{}",
});
const conv = Array.isArray(await sc.json().then((j) => j)) ? (await Promise.resolve())[0] : null;
// relire proprement
const sc2 = await fetch(base + "/rest/v1/rpc/start_jarvis_conversation", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    apikey: env["NEXT_PUBLIC_SUPABASE_ANON_KEY"],
    Authorization: "Bearer " + access_token,
    "Accept-Profile": "app",
    "Content-Profile": "app",
  },
  body: "{}",
});
const texteConv = await sc2.text();
const conversationId = JSON.parse(texteConv);

const r = await fetch(base + "/functions/v1/jarvis-chat", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    apikey: env["NEXT_PUBLIC_SUPABASE_ANON_KEY"],
    Authorization: "Bearer " + access_token,
  },
  body: JSON.stringify({
    message: "Bonjour",
    conversationId,
    clientTurnId: crypto.randomUUID(),
    mode: "flux",
  }),
});
console.log("status", r.status, r.headers.get("content-type"));
const lect = r.body.getReader();
const dec = new TextDecoder();
let total = 0;
for (;;) {
  const { done, value } = await lect.read();
  if (done) break;
  total += 1;
  if (total <= 6) console.log(JSON.stringify(dec.decode(value)).slice(0, 300));
}
console.log("chunks:", total);
