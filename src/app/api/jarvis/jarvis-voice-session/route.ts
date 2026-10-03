import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { z } from "zod";
import { alexa } from "@/i18n/alexa";
import { NOM_COOKIE } from "@/server/auth/session";
import { env } from "@/server/env";
import { lireCorpsVoix } from "@/server/voice/corps";
import { arreterVoixNative, preparerVoixNative } from "@/server/voice/runtime";
import { identite, echec, succes } from "../_commun";
const Schema = z.object({ action: z.enum(["prepare", "stop"]) }).strict();
export async function POST(request: Request): Promise<Response> {
  if (await identite() === null) return echec("non-authentifie", alexa.voixLocale);
  const input = Schema.safeParse(await lireCorpsVoix(request, 1024));
  if (!input.success) return echec("requete-invalide", alexa.voixLocale);
  const cookie = (await cookies()).get(NOM_COOKIE)?.value;
  if (!cookie) return echec("non-authentifie", alexa.voixLocale);
  const sessionId = createHash("sha256").update(cookie).digest("hex");
  if (input.data.action === "stop") { arreterVoixNative(sessionId); return succes({ stopped: true }); }
  if (env().JARVIS_VOICE_ENABLED === "false") return echec("configuration", alexa.voixLocale);
  try { await preparerVoixNative(sessionId, request.signal, true); return succes({ accepted: true }); }
  catch { return echec("configuration", alexa.voixLocale); }
}
