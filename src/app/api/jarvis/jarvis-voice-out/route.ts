import {serverAdmittedSpeech} from "@/server/alexa/speech-admission";
import { alexa as alexaCognitive } from "@/i18n/alexa";
import { isSameOriginRequest } from "@/server/auth/same-origin";
import { cookies } from "next/headers";
import { z } from "zod";
import { NOM_COOKIE } from "@/server/auth/session";
import { synthetiserGemini } from "@/server/alexa/gemini-voice";
import { classerCharge } from "@/server/egress/classification";
import { env } from "@/server/env";
import { segmenterVoix } from "@/shared/jarvis/segments-voix";
import { lireCorpsVoix } from "@/server/voice/corps";
import { identite, echec } from "../_commun";
const Schema = z.object({ texte: z.string().min(1).max(2000), runId: z.string().uuid(), utteranceId: z.string().uuid() }).strict();
export async function POST(req: Request): Promise<Response> {
 if(!isSameOriginRequest(req))return new Response(null,{status:403});
 const actor=await identite();
 if (actor === null) return echec("non-authentifie", alexaCognitive.voixIndisponible);
 if (env().JARVIS_VOICE_ENABLED === "false") return echec("configuration", alexaCognitive.voixIndisponible);
 if (Number(req.headers.get("Content-Length") ?? 0) > 16_000) return echec("requete-invalide", alexaCognitive.texteInvalide);
 const brut: unknown = await lireCorpsVoix(req, 16_000);
 const v = Schema.safeParse(brut);
 if (!v.success) return echec("requete-invalide", alexaCognitive.texteInvalide);
 const verdict = classerCharge(v.data.texte, null);
 if (verdict.classe !== "C4" || verdict.decision !== "AUTORISER") return echec("frontiere", alexaCognitive.voixIndisponible);
 const admitted=await serverAdmittedSpeech(actor,v.data.texte);
 if(!admitted)return echec("frontiere",alexaCognitive.voixIndisponible);
 const segments = segmenterVoix(v.data.texte);
 if (segments.length > 32) return echec("requete-invalide", alexaCognitive.texteInvalide);
 const jeton = (await cookies()).get(NOM_COOKIE)?.value;
 if (!jeton) return echec("non-authentifie", alexaCognitive.voixIndisponible);
  // Delivery TTS: gemini-3.8-flash-tts ONLY, on Alexa's final reply text.
  // The gateway returns a complete WAV so playback and
  // every client decoder stay unchanged. No ElevenLabs/native fallback.
  try {
   const audio = await synthetiserGemini(v.data.texte, req.signal);
   if (!audio.length) return echec("synthese-indisponible", alexaCognitive.syntheseLocaleIndisponible);
   return new Response(new Uint8Array(audio), { headers: { "X-Alexa-Voice-Provider":"gemini", "Content-Type": "audio/wav", "Cache-Control": "no-store", "X-Alexa-Run-ID": v.data.runId, "X-Alexa-Utterance-ID": v.data.utteranceId } });
  } catch (cause) {
   const code = cause instanceof Error ? cause.message : "";
   return echec(code.startsWith("configuration:") || code === "AlexaVoiceKey" ? "configuration" : "synthese-indisponible", alexaCognitive.syntheseLocaleIndisponible);
  }
}
