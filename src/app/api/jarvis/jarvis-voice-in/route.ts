import { alexa as alexaCognitive } from "@/i18n/alexa";
import { isSameOriginRequest } from "@/server/auth/same-origin";
import { NOM_COOKIE } from "@/server/auth/session";
import { env } from "@/server/env";
import { lireCorpsVoix } from "@/server/voice/corps";
import { demanderVoixNative } from "@/server/voice/runtime";
import { sessionVoix, voixLocaleConfiguree } from "@/server/voice/session";
import { cookies } from "next/headers";
import { z } from "zod";

import { echec, identite, succes } from "../_commun";

const Schema = z
  .object({
    pcmBase64: z.string().min(4).max(1_280_000),
    sampleRate: z.literal(16_000),
    runId: z.string().uuid(),
    utteranceId: z.string().uuid(),
    langue: z.enum(["fr", "ar", "auto"]).optional(),
  })
  .strict();

function echecTranscription(cause: unknown): Response {
  const code = cause instanceof Error ? cause.message : "";
  if (code.startsWith("configuration:")) return echec("configuration", alexaCognitive.voixLocale);
  if (code === "silence" || code === "confiance") return echec("regle-metier", alexaCognitive.rienCompris);
  if (code === "volume") return echec("requete-invalide", alexaCognitive.audioTropLong);
  return echec("transcription-indisponible", alexaCognitive.transcriptionLocaleIndisponible);
}

/**
 * Local transcription only. The 16 kHz PCM16 captured by the renderer travels
 * to the same-origin Next server and then to the resident worker's stdin.
 * No provider key, no network, no fallback.
 */
export async function POST(req: Request): Promise<Response> {
  if (!isSameOriginRequest(req)) return new Response(null, { status: 403 });
  if ((await identite()) === null) return echec("non-authentifie", alexaCognitive.voixIndisponible);
  if (!voixLocaleConfiguree(env())) return echec("configuration", alexaCognitive.voixLocale);
  if (Number(req.headers.get("Content-Length") ?? 0) > 1_300_000) {
    return echec("requete-invalide", alexaCognitive.audioTropLong);
  }

  const brut: unknown = await lireCorpsVoix(req, 1_300_000);
  const v = Schema.safeParse(brut);
  if (!v.success) return echec("requete-invalide", alexaCognitive.formatAudioInvalide);

  // Keep the cookie read: an anonymous request must not reach worker admission.
  if (!(await cookies()).get(NOM_COOKIE)?.value) {
    return echec("non-authentifie", alexaCognitive.voixIndisponible);
  }
  const session = await sessionVoix();
  if (session === null) return echec("non-authentifie", alexaCognitive.voixIndisponible);

  try {
    const resultat = await demanderVoixNative(
      {
        id: crypto.randomUUID(),
        sessionId: session,
        runId: v.data.runId,
        utteranceId: v.data.utteranceId,
        action: "stt",
        pcmBase64: v.data.pcmBase64,
        sampleRate: 16_000,
        langue: v.data.langue ?? "fr",
      },
      req.signal,
    );
    const texte = resultat.texte?.trim() ?? "";
    if (texte === "") return echec("regle-metier", alexaCognitive.rienCompris);
    return succes({
      texte,
      runId: v.data.runId,
      utteranceId: v.data.utteranceId,
      model: resultat.model ?? "faster-whisper-small-int8",
    });
  } catch (cause) {
    return echecTranscription(cause);
  }
}
