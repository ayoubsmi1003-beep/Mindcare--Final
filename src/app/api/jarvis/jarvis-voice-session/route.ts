import { isSameOriginRequest } from "@/server/auth/same-origin";
import { alexa } from "@/i18n/alexa";
import { env } from "@/server/env";
import { lireCorpsVoix } from "@/server/voice/corps";
import { arreterVoixNative, preparerVoixNative, statutVoixNative } from "@/server/voice/runtime";
import { sessionVoix, voixLocaleConfiguree } from "@/server/voice/session";
import { z } from "zod";

import { echec, identite, succes } from "../_commun";

const Schema = z.object({ action: z.enum(["prepare", "stop", "status"]) }).strict();

/**
 * Capture lifecycle and real local readiness. `status` never starts a model;
 * `prepare` waits for the worker's health handshake before returning ready.
 */
export async function POST(request: Request): Promise<Response> {
  if (!isSameOriginRequest(request)) return new Response(null, { status: 403 });
  if ((await identite()) === null) return echec("non-authentifie", alexa.voixLocale);

  const input = Schema.safeParse(await lireCorpsVoix(request, 1024));
  if (!input.success) return echec("requete-invalide", alexa.voixLocale);

  const session = await sessionVoix();
  if (session === null) return echec("non-authentifie", alexa.voixLocale);

  if (input.data.action === "status") {
    try {
      return succes(statutVoixNative());
    } catch {
      return echec("configuration", alexa.voixLocale);
    }
  }

  if (input.data.action === "stop") {
    arreterVoixNative(session);
    return succes({ stopped: true });
  }

  if (!voixLocaleConfiguree(env())) return echec("configuration", alexa.voixLocale);

  try {
    await preparerVoixNative(session, request.signal, true);
    return succes({ ...statutVoixNative(), accepted: true, provider: "local" });
  } catch (cause) {
    const code = cause instanceof Error ? cause.message : "";
    return echec(
      code.startsWith("configuration:") ? "configuration" : "indisponible",
      alexa.voixLocale,
    );
  }
}
