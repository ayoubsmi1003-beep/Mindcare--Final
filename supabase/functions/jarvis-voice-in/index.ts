/**
 * `jarvis-voice-in` — audio de la praticienne → texte. ADR-024, sens ENTRÉE.
 *
 * Le texte rendu alimente le MÊME panneau et les MÊMES outils que la frappe au
 * clavier (`SPRINT-V1.md` §V2.4). Cette fonction ne connaît aucun outil, ne lit
 * aucun dossier et n'écrit rien : elle transcrit, et rend le texte. Toute autre
 * responsabilité ici créerait l'architecture parallèle que D-10 a refusée pour
 * la transcription de séance.
 *
 * ⚠️ RÉPONSE TOUJOURS EN HTTP 200, le corps porte le contrat — même convention
 * que `jarvis-analyze-session`, pour la même raison (le comportement de
 * `supabase-js` face à un non-2xx a changé d'une version à l'autre).
 *
 * ═══ V-JARVIS-CORE · DEUX FORMES D'ENTRÉE, UNE SEULE SORTIE ═══
 *   1. BINAIRE BRUTE (historique) : `Content-Type: audio/…`, corps = octets.
 *   2. JSON ALTERNÉE : `{ "audioBase64": "…", "mimeType": "audio/webm" }`.
 *
 * POURQUOI LA 2ᵉ EXISTE : le transport navigateur passe par
 * `DbPort.invokeFunction` — JSON uniquement (ADR-020) — et une dictée webm/opus
 * de quelques secondes pèse des dizaines de kilo-octets : le détour base64 est
 * négligeable, alors qu'un second canal binaire dans le port serait un
 * agrandissement de contrat sans besoin réel. La forme binaire reste acceptée
 * telle quelle pour un futur client natif.
 *
 * LES GARDES SONT COMMUNS AUX DEUX FORMES : allowlist MIME identique,
 * plafond 10 Mio vérifié APRÈS décodage (un base64 mensonger ne contourne
 * rien), identité vérifiée avant tout.
 *
 * L'AUDIO NE TOUCHE JAMAIS LE DISQUE. Il arrive en corps de requête, vit en
 * `Uint8Array`, part dans le `fetch` de `_shared/external-call.ts`, et le
 * ramasse-miettes s'en charge. Aucun `Deno.writeFile`, aucun fichier
 * temporaire, aucun cache — ADR-009.
 */
import { createClient } from "npm:@supabase/supabase-js@2";

import { enTetesCors, reponsePrealable } from "../_shared/cors.ts";
import { stt } from "../_shared/external-call.ts";

/**
 * Plafond de taille — 10 Mio, soit largement plus qu'une commande parlée et
 * bien moins qu'un enregistrement de séance. Sans plafond, un corps de requête
 * énorme partirait chez Groq et serait facturé avant que quiconque s'en
 * aperçoive. Le refus est explicite, jamais une troncature silencieuse : un
 * audio coupé au milieu donnerait une transcription plausible et fausse.
 */
const MAX_OCTETS = 10 * 1024 * 1024;

/**
 * Allowlist de types MIME. Un `Content-Type` arbitraire serait relayé tel quel
 * au fournisseur ; on ne relaie que ce que la dictée produit réellement.
 */
const TYPES_ACCEPTES = new Set([
  "audio/webm",
  "audio/ogg",
  "audio/mpeg",
  "audio/mp4",
  "audio/wav",
  "audio/x-wav",
]);

/**
 * ⚠️ UN ÉCHEC DE TRANSCRIPTION DOIT SE NOMMER TRANSCRIPTION.
 *
 * DÉFAUT MESURÉ À L'ÉCRAN LE 2026-08-27. `stt()` rend `indisponible` pour toute
 * panne de fournisseur. Côté client, `classerCodeEdge` fait tomber ce code sur
 * `indisponible`, et l'écran affiche « Le service de données est momentanément
 * indisponible » — une phrase FAUSSE : la base allait parfaitement bien, c'est
 * Groq qui refusait. La praticienne cherchait une panne de base pendant que la
 * dictée échouait pour une raison sans rapport.
 *
 * On requalifie donc, ICI, où le domaine est connu. `configuration` et
 * `frontiere` traversent INCHANGÉS : ils ne disent pas « la transcription a
 * échoué » mais « la voix n'est pas activée sur ce déploiement », et
 * `jarvis-voix.ts` s'en sert pour découvrir les capacités.
 */
function codeEchecStt(code: string): string {
  return code === "indisponible" ? "transcription-indisponible" : code;
}

function reponseEchec(req: Request, code: string, message: string): Response {
  return new Response(JSON.stringify({ ok: false, error: { code, message } }), {
    status: 200,
    headers: { "Content-Type": "application/json", ...enTetesCors(req) },
  });
}

function decoderBase64(texte: string): Uint8Array | null {
  try {
    const binaire = atob(texte);
    const octets = new Uint8Array(binaire.length);
    for (let i = 0; i < binaire.length; i++) octets[i] = binaire.charCodeAt(i);
    return octets;
  } catch {
    return null;
  }
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

  // ── L'IDENTITÉ EST VÉRIFIÉE, PAS SEULEMENT EXIGÉE. ──
  // `jarvis-analyze-session` peut se contenter de transmettre le JWT : tous ses
  // effets passent par des `rpc` que la RLS arbitre, donc un jeton invalide n'y
  // obtient rien. ICI, RIEN NE TOUCHE LA BASE — sans cette vérification, un
  // appelant anonyme ferait transcrire ce qu'il veut AUX FRAIS DE NOTRE CLÉ, et
  // la seule trace serait une ligne d'audit sans acteur. Un point de sortie
  // payant sans porte d'entrée est une porte ouverte.
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

  // ── Deux formes d'entrée, une seule sortie ──
  const typeBrut = (req.headers.get("Content-Type") ?? "").split(";")[0]?.trim() ?? "";
  let typeMime = "";
  let audio: Uint8Array | null = null;

  if (typeBrut === "application/json") {
    let corps: unknown;
    try {
      corps = await req.json();
    } catch {
      return reponseEchec(req, "requete-invalide", "Requête invalide.");
    }
    const o = corps as { audioBase64?: unknown; mimeType?: unknown };
    if (
      typeof o.audioBase64 !== "string" || o.audioBase64.length === 0 ||
      typeof o.mimeType !== "string"
    ) {
      return reponseEchec(req, "requete-invalide", "Requête invalide.");
    }
    typeMime = o.mimeType.split(";")[0]?.trim() ?? "";
    if (!TYPES_ACCEPTES.has(typeMime)) {
      return reponseEchec(req, "requete-invalide", "Format audio non pris en charge.");
    }
    audio = decoderBase64(o.audioBase64);
    if (audio === null || audio.byteLength === 0) {
      return reponseEchec(req, "requete-invalide", "Aucun son reçu.");
    }
  } else {
    typeMime = typeBrut;
    if (!TYPES_ACCEPTES.has(typeMime)) {
      return reponseEchec(req, "requete-invalide", "Format audio non pris en charge.");
    }
    audio = new Uint8Array(await req.arrayBuffer());
    if (audio.byteLength === 0) {
      return reponseEchec(req, "requete-invalide", "Aucun son reçu.");
    }
  }

  if (audio.byteLength > MAX_OCTETS) {
    return reponseEchec(req, "requete-invalide", "Enregistrement trop long.");
  }

  // `sessionToken` est généré ICI, jamais accepté de l'appelant. Le laisser
  // fournir cette valeur permettrait d'y placer un `patient_id` — exactement ce
  // que 028 interdit à cette colonne, et le contrôle serait impossible après
  // coup. Un uuid aléatoire par appel ne corrèle rien et ne désigne personne.
  const resultat = await stt({
    audio,
    mimeType: typeMime,
    sessionToken: crypto.randomUUID(),
  });

  if (!resultat.ok) {
    return reponseEchec(req, codeEchecStt(resultat.error.code), resultat.error.message);
  }

  const texte = resultat.data.trim();
  if (texte === "") {
    return reponseEchec(req, "regle-metier", "Rien n'a été compris. Reformulez ou tapez votre demande.");
  }

  return new Response(JSON.stringify({ ok: true, data: { texte } }), {
    status: 200,
    headers: { "Content-Type": "application/json", ...enTetesCors(req) },
  });
});
