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
 *
 * ═══ V-JARVIS-CORE · CORS ═══ Cette fonction était déployée SANS en-têtes
 * CORS ni gestion OPTIONS : jamais appelable du navigateur (défaut latent,
 * trouvé à l'audit V-JARVIS-CORE — le front voix n'existait pas encore).
 * Le rétrofit applique `enTetesCors`/`reponsePrealable` à TOUTES les réponses,
 * échecs compris, comme partout ailleurs.
 */
import { createClient } from "npm:@supabase/supabase-js@2";

import { enTetesCors, reponsePrealable } from "../_shared/cors.ts";
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

/**
 * Même raison qu'en entrée (voir `codeEchecStt` dans `jarvis-voice-in`) : une
 * panne de synthèse annonçait « le service de données est indisponible ». Ici
 * la nuance compte doublement — la RÉPONSE, elle, existe et reste affichée ;
 * seule sa lecture à voix haute a échoué. Le dire évite de faire recommencer
 * une demande qui a parfaitement abouti.
 */
function codeEchecTts(code: string): string {
  return code === "indisponible" ? "synthese-indisponible" : code;
}

function reponseEchec(req: Request, code: string, message: string): Response {
  return new Response(JSON.stringify({ ok: false, error: { code, message } }), {
    status: 200,
    headers: { "Content-Type": "application/json", ...enTetesCors(req) },
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
  const prealable = reponsePrealable(req);
  if (prealable !== null) return prealable;

  if (req.method !== "POST") {
    return reponseEchec(req, "methode-invalide", "Méthode non supportée.");
  }

  const authorization = req.headers.get("Authorization");
  if (authorization === null) {
    return reponseEchec(req, "non-authentifie", "Voix indisponible.");
  }

  // Même raison qu'en entrée : cette fonction ne touche pas la base, donc la
  // RLS ne peut pas servir de porte. Sans vérification du jeton, notre clé
  // ElevenLabs serait utilisable par n'importe qui.
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (supabaseUrl === undefined || supabaseAnonKey === undefined) {
    return reponseEchec(req, "configuration", "Voix indisponible.");
  }

  const client = createClient(supabaseUrl, supabaseAnonKey, {
    db: { schema: "app" },
    global: { headers: { Authorization: authorization } },
  });

  const { data: utilisateur, error: erreurAuth } = await client.auth.getUser();
  if (erreurAuth !== null || utilisateur?.user === null) {
    return reponseEchec(req, "non-authentifie", "Voix indisponible.");
  }

  // Interrupteur d'exploitation — V-JARVIS-CORE. Absence = activé.
  if (Deno.env.get("JARVIS_VOICE_ENABLED") === "false") {
    return reponseEchec(req, "configuration", "Voix indisponible.");
  }

  let corps: unknown;
  try {
    corps = await req.json();
  } catch {
    return reponseEchec(req, "requete-invalide", "Requête invalide.");
  }
  if (!estCorpsValide(corps)) {
    return reponseEchec(req, "requete-invalide", "Requête invalide.");
  }

  const texte = corps.texte.trim();
  if (texte.length > MAX_CARACTERES) {
    return reponseEchec(req, "requete-invalide", "Texte trop long pour être lu à voix haute.");
  }

  const voix = resoudreVoix();
  if (voix === null) {
    return reponseEchec(req, "configuration", "Voix indisponible.");
  }

  const resultat = await tts({ text: texte, voiceId: voix, sessionToken: crypto.randomUUID() });
  if (!resultat.ok) {
    return reponseEchec(req, codeEchecTts(resultat.error.code), resultat.error.message);
  }

  // L'audio part en binaire, sans détour par base64 : la conversion doublerait
  // la taille en mémoire pour aucun gain. `no-store` interdit toute mise en
  // cache intermédiaire d'un flux qui prononce un nom de patiente.
  return new Response(resultat.data.audio, {
    status: 200,
    headers: {
      "Content-Type": resultat.data.mimeType,
      "Cache-Control": "no-store",
      ...enTetesCors(req),
    },
  });
});
