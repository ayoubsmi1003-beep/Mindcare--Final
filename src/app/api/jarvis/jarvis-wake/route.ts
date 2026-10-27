import { alexa } from "@/i18n/alexa";
import { isSameOriginRequest } from "@/server/auth/same-origin";
import { env } from "@/server/env";
import { lireCorpsVoix } from "@/server/voice/corps";
import { sessionVoix, voixLocaleConfiguree } from "@/server/voice/session";
import { arreterReveil, demanderReveil, preparerReveil } from "@/server/voice/wake-runtime";
import { z } from "zod";

import { echec, identite, succes } from "../_commun";

const Schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start") }).strict(),
  z.object({ action: z.literal("audio"), pcmBase64: z.string().min(4).max(128_000) }).strict(),
  z.object({ action: z.literal("reset") }).strict(),
  z.object({ action: z.literal("ping") }).strict(),
  z.object({ action: z.literal("stop") }).strict(),
]);

/**
 * Wake-word boundary. The renderer sends bounded 16 kHz PCM chunks; the
 * server answers only `{ detected }`. No transcript crosses this route.
 */
export async function POST(request: Request): Promise<Response> {
  if (!isSameOriginRequest(request)) return new Response(null, { status: 403 });
  if ((await identite()) === null) return echec("non-authentifie", alexa.voixLocale);
  if (!voixLocaleConfiguree(env())) return echec("configuration", alexa.voixLocale);

  const input = Schema.safeParse(await lireCorpsVoix(request, 300_000));
  if (!input.success) return echec("requete-invalide", alexa.voixLocale);

  const session = await sessionVoix();
  if (session === null) return echec("non-authentifie", alexa.voixLocale);

  try {
    if (input.data.action === "stop") {
      arreterReveil(session);
      return succes({ stopped: true });
    }
    if (input.data.action === "start") {
      await preparerReveil(session, request.signal);
      return succes({ ready: true, engine: "vosk-fr-FR-small" });
    }
    if (input.data.action === "ping") {
      await demanderReveil(session, "ping", undefined, request.signal);
      // Le ping ne porte aucun audio et ne rend aucun texte : juste la preuve
      // que le worker résident répond encore.
      return succes({ pong: true });
    }
    const resultat = await demanderReveil(
      session,
      input.data.action,
      input.data.action === "audio" ? input.data.pcmBase64 : undefined,
      request.signal,
    );
    return succes({ detected: resultat.detected });
  } catch {
    return echec("configuration", alexa.voixLocale);
  }
}
