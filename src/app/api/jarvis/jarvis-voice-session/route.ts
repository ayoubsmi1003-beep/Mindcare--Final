import { admitGeminiVoice } from "@/server/egress/external-call";
import { isSameOriginRequest } from "@/server/auth/same-origin";
import { cookies } from "next/headers";
import { z } from "zod";
import { alexa } from "@/i18n/alexa";
import { NOM_COOKIE } from "@/server/auth/session";
import { env } from "@/server/env";
import { lireCorpsVoix } from "@/server/voice/corps";
import { identite, echec, succes } from "../_commun";
const Schema = z.object({ action: z.enum(["prepare", "stop"]) }).strict();
export async function POST(request: Request): Promise<Response> {
 if(!isSameOriginRequest(request))return new Response(null,{status:403});
  if (await identite() === null) return echec("non-authentifie", alexa.voixLocale);
  const input = Schema.safeParse(await lireCorpsVoix(request, 1024));
  if (!input.success) return echec("requete-invalide", alexa.voixLocale);
  const cookie = (await cookies()).get(NOM_COOKIE)?.value;
  if (!cookie) return echec("non-authentifie", alexa.voixLocale);
  if (input.data.action === "stop") return succes({ stopped: true });
  if (env().JARVIS_VOICE_ENABLED === "false") return echec("configuration", alexa.voixLocale);
  // Delivery voice uses Gemini through the authenticated local API. Capture
  // must not depend on a native speech worker or local model installation.
  if (!(env().GEMINI_API_KEY || env().GOOGLE_API_KEY)?.trim()) return echec("configuration", alexa.voixLocale);
  try{await admitGeminiVoice(request.signal);}catch{return echec("frontiere",alexa.voixLocale);}
  return succes({ accepted: true, provider:"gemini" });
}
