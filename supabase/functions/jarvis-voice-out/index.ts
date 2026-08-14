/**
 * `jarvis-voice-out` — texte de Jarvis → audio. ADR-024, sens SORTIE.
 *
 * ⚠️ CE QUI SORT ICI PEUT NOMMER UNE PATIENTE, et c'est voulu : « Karim
 * Belkacem, jeudi 15 h » n'a d'intérêt que prononcé en entier. Le
 * pseudonymiser rendrait « P1, jeudi 15 h » — la fonctionnalité disparaîtrait
 * sans que le risque change de nature. ADR-024 tranche : ce franchissement est
 * légitime UNIQUEMENT sur base synthétique, et `garderVoix()` dans
 * `_shared/external-call.ts` vérifie cette condition en interrogeant
 * `app.is_cloud_dev()` avant chaque appel. Le jour de la bascule au cabinet, la
 * synthèse cloud s'arrête d'elle-même.
 *
 * L'audio produit remonte au navigateur et n'est écrit nulle part.
 */
import { createClient } from "npm:@supabase/supabase-js@2";

import { tts } from "../_shared/external-call.ts";

/**
 * Plafond de caractères. La synthèse est facturée au caractère : sans plafond,
 * une réponse longue de Jarvis coûte sans prévenir. 2 000 correspond à une
 * réponse parlée d'environ deux minutes — au-delà, on ne lit plus une réponse à
 * voix haute, on récite un document.
 */
const MAX_CARACTERES = 2_000;

/**
 * Voix française par défaut. `ELEVENLABS_VOICE_ID` prime : le choix de la voix
 * est un réglage d'exploitation, pas une constante de code — même raisonnement
 * que `OPENROUTER_MODEL`. Aucune valeur de repli inventée : si la variable est
 * absente ET qu'aucune voix n'est passée, on refuse plutôt que de parler avec
 * une voix arbitraire facturée au hasard.
 */
function resoudreVoix(): string | null {
  const voix = Deno.env.get("ELEVENLABS_VOICE_ID");
  return voix === undefined || voix === "" ? null : voix;
}

function reponseEchec(code: string, message: string): Response {
  return new Response(JSON.stringify({ ok: false, error: { code, message } }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function estCorpsValide(valeur: unknown): valeur is { readonly texte: string } {
  return (
    typeof valeur === "object" && valeur !== null &&
    typeof (valeur as { texte?: unknown }).texte === "string" &&
    (valeur as { texte: string }).texte.trim().length > 0
  );
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return reponseEchec("methode-invalide", "Méthode non supportée.");
  }

  const authorization = req.headers.get("Authorization");
  if (authorization === null) {
    return reponseEchec("non-authentifie", "Voix indisponible.");
  }

  // Même raison qu'en entrée : cette fonction ne touche pas la base, donc la
  // RLS ne peut pas servir de porte. Sans vérification du jeton, notre clé
  // ElevenLabs serait utilisable par n'importe qui.
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (supabaseUrl === undefined || supabaseAnonKey === undefined) {
    return reponseEchec("configuration", "Voix indisponible.");
  }

  const client = createClient(supabaseUrl, supabaseAnonKey, {
    db: { schema: "app" },
    global: { headers: { Authorization: authorization } },
  });

  const { data: utilisateur, error: erreurAuth } = await client.auth.getUser();
  if (erreurAuth !== null || utilisateur?.user === null) {
    return reponseEchec("non-authentifie", "Voix indisponible.");
  }

  let corps: unknown;
  try {
    corps = await req.json();
  } catch {
    return reponseEchec("requete-invalide", "Requête invalide.");
  }
  if (!estCorpsValide(corps)) {
    return reponseEchec("requete-invalide", "Requête invalide.");
  }

  const texte = corps.texte.trim();
  if (texte.length > MAX_CARACTERES) {
    return reponseEchec("requete-invalide", "Texte trop long pour être lu à voix haute.");
  }

  const voix = resoudreVoix();
  if (voix === null) {
    return reponseEchec("configuration", "Voix indisponible.");
  }

  const resultat = await tts({ text: texte, voiceId: voix, sessionToken: crypto.randomUUID() });
  if (!resultat.ok) {
    return reponseEchec(resultat.error.code, resultat.error.message);
  }

  // L'audio part en binaire, sans détour par base64 : la conversion doublerait
  // la taille en mémoire pour aucun gain. `no-store` interdit toute mise en
  // cache intermédiaire d'un flux qui prononce un nom de patiente.
  return new Response(resultat.data.audio, {
    status: 200,
    headers: {
      "Content-Type": resultat.data.mimeType,
      "Cache-Control": "no-store",
    },
  });
});
