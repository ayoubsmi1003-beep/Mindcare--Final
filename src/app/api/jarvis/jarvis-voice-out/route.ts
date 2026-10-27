import { randomUUID } from "node:crypto";

import { alexa as alexaCognitive } from "@/i18n/alexa";
import { serverAdmittedSpeech } from "@/server/alexa/speech-admission";
import { isSameOriginRequest } from "@/server/auth/same-origin";
import { env } from "@/server/env";
import { lireCorpsVoix } from "@/server/voice/corps";
import { demanderVoixNative } from "@/server/voice/runtime";
import { sessionVoix, voixLocaleConfiguree } from "@/server/voice/session";
import { segmenterVoix } from "@/shared/jarvis/segments-voix";
import { z } from "zod";

import { echec, identite } from "../_commun";

const Schema = z
  .object({
    texte: z.string().min(1).max(2000),
    runId: z.string().uuid(),
    utteranceId: z.string().uuid(),
  })
  .strict();

function echecSynthese(cause: unknown): Response {
  const code = cause instanceof Error ? cause.message : "";
  if (code.startsWith("configuration:")) {
    return echec("configuration", alexaCognitive.voixLocale);
  }
  if (code === "volume") return echec("requete-invalide", alexaCognitive.texteInvalide);
  return echec("synthese-indisponible", alexaCognitive.syntheseLocaleIndisponible);
}

/** Local Kokoro synthesis of an authenticated, server-admitted Alexa answer. */
export async function POST(req: Request): Promise<Response> {
  if (!isSameOriginRequest(req)) return new Response(null, { status: 403 });
  const actor = await identite();
  if (actor === null) return echec("non-authentifie", alexaCognitive.voixIndisponible);
  if (!voixLocaleConfiguree(env())) return echec("configuration", alexaCognitive.voixLocale);
  if (Number(req.headers.get("Content-Length") ?? 0) > 16_000) {
    return echec("requete-invalide", alexaCognitive.texteInvalide);
  }

  const brut: unknown = await lireCorpsVoix(req, 16_000);
  const v = Schema.safeParse(brut);
  if (!v.success) return echec("requete-invalide", alexaCognitive.texteInvalide);

  const admitted = await serverAdmittedSpeech(actor, v.data.texte);
  if (!admitted) return echec("frontiere", alexaCognitive.voixIndisponible);

  const segments = segmenterVoix(v.data.texte);
  if (segments.length === 0 || segments.length > 32 || segments.some((segment) => segment.langue === "ar")) {
    return echec("synthese-indisponible", alexaCognitive.syntheseLocaleIndisponible);
  }
  const sessionId = await sessionVoix();
  if (sessionId === null) return echec("non-authentifie", alexaCognitive.voixIndisponible);

  try {
    const resultat = await demanderVoixNative(
      {
        id: randomUUID(),
        sessionId,
        runId: v.data.runId,
        utteranceId: v.data.utteranceId,
        action: "tts",
        texte: v.data.texte,
        langue: "fr",
        segments: segments.map((segment) => ({ texte: segment.texte, langue: segment.langue })),
      },
      req.signal,
    );
    if (!resultat.audioBase64) throw new Error("format");
    const audio = Buffer.from(resultat.audioBase64, "base64");
    if (
      audio.length < 44 ||
      audio.length > 6_000_000 ||
      audio.toString("ascii", 0, 4) !== "RIFF" ||
      audio.toString("ascii", 8, 12) !== "WAVE"
    ) {
      throw new Error("format");
    }
    return new Response(new Uint8Array(audio), {
      headers: {
        "X-Alexa-Voice-Provider": "local",
        "X-Alexa-Voice-Model": resultat.model ?? "kokoro-82m-v1.0-ff_siwis",
        "X-Alexa-Sample-Rate": String(resultat.sampleRate ?? 24_000),
        "Content-Type": "audio/wav",
        "Cache-Control": "no-store",
        "X-Alexa-Run-ID": v.data.runId,
        "X-Alexa-Utterance-ID": v.data.utteranceId,
      },
    });
  } catch (cause) {
    return echecSynthese(cause);
  }
}
