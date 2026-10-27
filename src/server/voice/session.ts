import { createHash } from "node:crypto";
import { cookies } from "next/headers";

import { NOM_COOKIE } from "@/server/auth/session";

/**
 * The worker scope is derived from the httpOnly session cookie. The renderer
 * never chooses it; a client-selected scope could address another caller's
 * resident process.
 */
export function empreinteSessionVoix(jeton: string): string {
  return createHash("sha256").update("mindcare:voice:").update(jeton).digest("hex");
}

export async function sessionVoix(): Promise<string | null> {
  const jeton = (await cookies()).get(NOM_COOKIE)?.value;
  if (!jeton) return null;
  return empreinteSessionVoix(jeton);
}

/** The local native worker is the only permitted speech path. */
export function voixLocaleConfiguree(environnement: {
  readonly ALEXA_LOCAL_VOICE?: string | undefined;
  readonly JARVIS_VOICE_ENABLED?: string | undefined;
}): boolean {
  return (
    environnement.JARVIS_VOICE_ENABLED !== "false" &&
    environnement.ALEXA_LOCAL_VOICE !== "false"
  );
}
