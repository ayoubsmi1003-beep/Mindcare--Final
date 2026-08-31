/**
 * `POST /api/jarvis/jarvis-voice-out` — texte vers voix. ADR-024, sens SORTIE.
 * Portage de `supabase/functions/jarvis-voice-out`.
 *
 * ⚠️ CETTE ROUTE NE REND PAS L'ENVELOPPE JSON EN CAS DE SUCCÈS : elle rend des
 * OCTETS AUDIO. C'est la seule des cinq dans ce cas, et c'est voulu — passer
 * l'audio en base64 doublerait sa taille en mémoire pour aucun gain. Les
 * ÉCHECS, eux, gardent l'enveloppe : le client distingue les deux par le
 * `Content-Type`, exactement comme du temps des Edge Functions.
 */

import { NextResponse } from "next/server";

import { tts } from "@/server/egress/external-call";
import { env } from "@/server/env";

import { echec, identite } from "../_commun";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Plafond de caractères. Sans lui, une réponse longue de Jarvis coûte sans
 * prévenir. 2 000 correspond à une réponse parlée d'environ deux minutes —
 * au-delà, on ne lit plus une réponse à voix haute, on récite un document.
 */
const MAX_CARACTERES = 2_000;

/**
 * Voix française par défaut. `ELEVENLABS_VOICE_ID` prime : le choix de la voix
 * est un réglage d'exploitation, pas une constante de code. Aucune valeur de
 * repli inventée : si la variable est absente, on refuse plutôt que de parler
 * avec une voix arbitraire facturée au hasard.
 */
function resoudreVoix(): string | null {
  const voix = env().ELEVENLABS_VOICE_ID;
  return voix === undefined || voix === "" ? null : voix;
}

/**
 * Même raison qu'en entrée : une panne de synthèse annonçait « le service de
 * données est indisponible ». Ici la nuance compte doublement — la RÉPONSE,
 * elle, existe et reste affichée ; seule sa lecture à voix haute a échoué. Le
 * dire évite de faire recommencer une demande qui a parfaitement abouti.
 */
function codeEchecTts(code: string): string {
  return code === "indisponible" ? "synthese-indisponible" : code;
}

function estCorpsValide(valeur: unknown): valeur is { readonly texte: string } {
  return (
    typeof valeur === "object" &&
    valeur !== null &&
    typeof (valeur as { texte?: unknown }).texte === "string" &&
    (valeur as { texte: string }).texte.trim().length > 0
  );
}

export async function POST(req: Request): Promise<Response> {
  // Même raison qu'en entrée : cette route ne touche pas la base, donc la RLS
  // ne peut pas servir de porte. Sans vérification d'identité, notre clé
  // ElevenLabs serait utilisable par n'importe qui.
  const userId = await identite();
  if (userId === null) return echec("non-authentifie", "Voix indisponible.");

  if (env().JARVIS_VOICE_ENABLED === "false") {
    return echec("configuration", "Voix indisponible.");
  }

  let corps: unknown;
  try {
    corps = await req.json();
  } catch {
    return echec("requete-invalide", "Requête invalide.");
  }
  if (!estCorpsValide(corps)) {
    return echec("requete-invalide", "Requête invalide.");
  }

  const texte = corps.texte.trim();
  if (texte.length > MAX_CARACTERES) {
    return echec("requete-invalide", "Texte trop long pour être lu à voix haute.");
  }

  const voix = resoudreVoix();
  if (voix === null) return echec("configuration", "Voix indisponible.");

  const resultat = await tts({ text: texte, voiceId: voix, sessionToken: crypto.randomUUID() });
  if (!resultat.ok) {
    return echec(codeEchecTts(resultat.error.code), resultat.error.message);
  }

  // L'audio part en binaire, sans détour par base64. `no-store` interdit toute
  // mise en cache intermédiaire d'un flux qui prononce un nom de patiente.
  const octets = resultat.data.audio;
  const corpsBinaire = new Uint8Array(octets.byteLength);
  corpsBinaire.set(octets);

  return new NextResponse(corpsBinaire, {
    status: 200,
    headers: {
      "Content-Type": resultat.data.mimeType,
      "Cache-Control": "no-store",
    },
  });
}
