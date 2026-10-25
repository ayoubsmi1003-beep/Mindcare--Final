import {serverAdmittedSpeech} from "@/server/alexa/speech-admission";
import { createHash, randomUUID } from "node:crypto";
import { alexa as alexaCognitive } from "@/i18n/alexa";
import { isSameOriginRequest } from "@/server/auth/same-origin";
import { cookies } from "next/headers";
import { z } from "zod";
import { NOM_COOKIE } from "@/server/auth/session";
import { demanderVoixNative } from "@/server/voice/runtime";
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
 if (env().ALEXA_LOCAL_VOICE !== "true") return echec("configuration", alexaCognitive.syntheseLocaleIndisponible);
 if (Number(req.headers.get("Content-Length") ?? 0) > 16_000) return echec("requete-invalide", alexaCognitive.texteInvalide);
 const brut: unknown = await lireCorpsVoix(req, 16_000);
 const v = Schema.safeParse(brut);
 if (!v.success) return echec("requete-invalide", alexaCognitive.texteInvalide);
 const admitted=await serverAdmittedSpeech(actor,v.data.texte);
 if(!admitted)return echec("frontiere",alexaCognitive.voixIndisponible);
 const segments = segmenterVoix(v.data.texte);
 if (segments.length > 32) return echec("requete-invalide", alexaCognitive.texteInvalide);
 const jeton = (await cookies()).get(NOM_COOKIE)?.value;
 if (!jeton) return echec("non-authentifie", alexaCognitive.voixIndisponible);
  // Voice output is local Piper only. The existing server admission still
  // binds speech to an authorized answer; patient names never cross an egress boundary.
  try {
   const audio = await demanderVoixNative({
    action: "tts", id: randomUUID(), sessionId: createHash("sha256").update(actor).digest("hex"),
    runId: v.data.runId, utteranceId: v.data.utteranceId, texte: v.data.texte,
    langue: segments[0]?.langue ?? "fr", segments: [...segments],
   }, req.signal);
   const wav = Buffer.from(audio.audioBase64 ?? "", "base64");
   if (audio.mimeType !== "audio/wav" || wav.length < 44 || wav.length > 6_000_000
    || wav.subarray(0,4).toString("ascii") !== "RIFF" || wav.subarray(8,12).toString("ascii") !== "WAVE")
    return echec("synthese-indisponible", alexaCognitive.syntheseLocaleIndisponible);
   return new Response(new Uint8Array(wav), { headers: { "X-Alexa-Voice-Provider":"piper", "Content-Type": "audio/wav", "Cache-Control": "no-store", "X-Alexa-Run-ID": v.data.runId, "X-Alexa-Utterance-ID": v.data.utteranceId } });
  } catch (cause) {
   const code = cause instanceof Error ? cause.message : "";
   return echec(code.startsWith("configuration:") || code.startsWith("LocalModel") ? "configuration" : "synthese-indisponible", alexaCognitive.syntheseLocaleIndisponible);
  }
}
