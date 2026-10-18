import { alexa as alexaCognitive } from "@/i18n/alexa";
import { admitGeminiVoice } from "@/server/egress/external-call";
import { isSameOriginRequest } from "@/server/auth/same-origin";
import { cookies } from "next/headers";
import { z } from "zod";
import { NOM_COOKIE } from "@/server/auth/session";
import { envelopperWav, transcrireGemini } from "@/server/alexa/gemini-voice";
import { env } from "@/server/env";
import { lireCorpsVoix } from "@/server/voice/corps";
import { identite, echec, succes } from "../_commun";
const Schema = z.object({
 pcmBase64: z.string().min(4).max(1_280_000), sampleRate: z.literal(16000),
 runId: z.string().uuid(), utteranceId: z.string().uuid(), langue: z.enum(["fr", "ar", "auto"]).optional(),
}).strict();
export async function POST(req: Request): Promise<Response> {
 if(!isSameOriginRequest(req))return new Response(null,{status:403});
 if (await identite() === null) return echec("non-authentifie", alexaCognitive.voixIndisponible);
 if (env().JARVIS_VOICE_ENABLED === "false") return echec("configuration", alexaCognitive.voixIndisponible);
 if (Number(req.headers.get("Content-Length") ?? 0) > 1_300_000) return echec("requete-invalide", alexaCognitive.audioTropLong);
 const brut: unknown = await lireCorpsVoix(req, 1_300_000);
 const v = Schema.safeParse(brut);
 if (!v.success) return echec("requete-invalide", alexaCognitive.formatAudioInvalide);
  const jeton = (await cookies()).get(NOM_COOKIE)?.value;
  if (!jeton) return echec("non-authentifie", alexaCognitive.voixIndisponible);
  // Delivery STT: gemini-3.5-transcribe ONLY. The 16 kHz PCM16 payload is
  // wrapped in a WAV container (no transcoding) for the inline-audio call.
  // No native-worker or third-party STT fallback exists on this path.
  try {
   await admitGeminiVoice(req.signal);
   const pcm = Buffer.from(v.data.pcmBase64, "base64");
   const wavBase64 = envelopperWav(pcm, 16000).toString("base64");
   const texte = await transcrireGemini(wavBase64, v.data.langue ?? "auto", req.signal);
   return texte.trim() ? succes({ texte, runId: v.data.runId, utteranceId: v.data.utteranceId }) : echec("regle-metier", alexaCognitive.rienCompris);
  } catch (cause) {
   const code = cause instanceof Error ? cause.message : "";
   return echec(code.startsWith("configuration:") || code === "AlexaVoiceKey" ? "configuration" : "transcription-indisponible", alexaCognitive.transcriptionLocaleIndisponible);
  }
}
