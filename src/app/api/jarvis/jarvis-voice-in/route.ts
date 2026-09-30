import { alexa as alexaCognitive } from "@/i18n/alexa";
import { createHash, randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { z } from "zod";
import { NOM_COOKIE } from "@/server/auth/session";
import { demanderVoixNative } from "@/server/voice/runtime";
import { validerEntreeVoix } from "@/server/voice/protocole";
import { env } from "@/server/env";
import { lireCorpsVoix } from "@/server/voice/corps";
import { identite, echec, succes } from "../_commun";
const Schema = z.object({
 pcmBase64: z.string().min(4).max(1_280_000), sampleRate: z.literal(16000),
 runId: z.string().uuid(), utteranceId: z.string().uuid(), langue: z.enum(["fr", "ar", "auto"]).optional(),
}).strict();
export async function POST(req: Request): Promise<Response> {
 if (await identite() === null) return echec("non-authentifie", alexaCognitive.voixIndisponible);
 if (env().JARVIS_VOICE_ENABLED === "false") return echec("configuration", alexaCognitive.voixIndisponible);
 if (Number(req.headers.get("Content-Length") ?? 0) > 1_300_000) return echec("requete-invalide", alexaCognitive.audioTropLong);
 const brut: unknown = await lireCorpsVoix(req, 1_300_000);
 const v = Schema.safeParse(brut);
 if (!v.success) return echec("requete-invalide", alexaCognitive.formatAudioInvalide);
 const jeton = (await cookies()).get(NOM_COOKIE)?.value;
 if (!jeton) return echec("non-authentifie", alexaCognitive.voixIndisponible);
 const entree = validerEntreeVoix({ ...v.data, action: "stt", id: randomUUID(), sessionId: createHash("sha256").update(jeton).digest("hex") });
 if (!entree) return echec("requete-invalide", alexaCognitive.formatAudioInvalide);
 try {
  const r = await demanderVoixNative(entree, req.signal);
  return r.texte?.trim() ? succes({ texte: r.texte, runId: r.runId, utteranceId: r.utteranceId }) : echec("regle-metier", alexaCognitive.rienCompris);
 } catch (cause) {
  const code = cause instanceof Error ? cause.message : "";
  return echec(code.startsWith("configuration:") ? "configuration" : "transcription-indisponible", alexaCognitive.transcriptionLocaleIndisponible);
 }
}
