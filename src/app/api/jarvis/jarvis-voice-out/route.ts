import { alexa as alexaCognitive } from "@/i18n/alexa";
import { createHash, randomUUID } from "node:crypto";
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
 if (await identite() === null) return echec("non-authentifie", alexaCognitive.voixIndisponible);
 if (env().JARVIS_VOICE_ENABLED === "false") return echec("configuration", alexaCognitive.voixIndisponible);
 if (Number(req.headers.get("Content-Length") ?? 0) > 16_000) return echec("requete-invalide", alexaCognitive.texteInvalide);
 const brut: unknown = await lireCorpsVoix(req, 16_000);
 const v = Schema.safeParse(brut);
 if (!v.success) return echec("requete-invalide", alexaCognitive.texteInvalide);
 const segments = segmenterVoix(v.data.texte);
 if (segments.length > 32) return echec("requete-invalide", alexaCognitive.texteInvalide);
 const jeton = (await cookies()).get(NOM_COOKIE)?.value;
 if (!jeton) return echec("non-authentifie", alexaCognitive.voixIndisponible);
 try {
  const r = await demanderVoixNative({ ...v.data, segments: [...segments], action: "tts", id: randomUUID(), sessionId: createHash("sha256").update(jeton).digest("hex"), langue: segments[0]?.langue ?? "fr" }, req.signal);
  if (!r.audioBase64 || r.mimeType !== "audio/wav") return echec("synthese-indisponible", alexaCognitive.syntheseLocaleIndisponible);
  const audio = Buffer.from(r.audioBase64, "base64");
  return new Response(audio, { headers: { "Content-Type": "audio/wav", "Cache-Control": "no-store", "X-Alexa-Run-ID": r.runId, "X-Alexa-Utterance-ID": r.utteranceId } });
 } catch (cause) {
  const code = cause instanceof Error ? cause.message : "";
  return echec(code.startsWith("configuration:") ? "configuration" : "synthese-indisponible", alexaCognitive.syntheseLocaleIndisponible);
 }
}
