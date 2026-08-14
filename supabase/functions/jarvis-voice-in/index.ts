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
 * L'AUDIO NE TOUCHE JAMAIS LE DISQUE. Il arrive en corps de requête, vit en
 * `Uint8Array`, part dans le `fetch` de `_shared/external-call.ts`, et le
 * ramasse-miettes s'en charge. Aucun `Deno.writeFile`, aucun fichier
 * temporaire, aucun cache — ADR-009.
 */
import { createClient } from "npm:@supabase/supabase-js@2";

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

function reponseEchec(code: string, message: string): Response {
  return new Response(JSON.stringify({ ok: false, error: { code, message } }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return reponseEchec("methode-invalide", "Méthode non supportée.");
  }

  const authorization = req.headers.get("Authorization");
  if (authorization === null) {
    return reponseEchec("non-authentifie", "Voix indisponible.");
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

  const typeMime = (req.headers.get("Content-Type") ?? "").split(";")[0]?.trim() ?? "";
  if (!TYPES_ACCEPTES.has(typeMime)) {
    return reponseEchec("requete-invalide", "Format audio non pris en charge.");
  }

  const audio = new Uint8Array(await req.arrayBuffer());
  if (audio.byteLength === 0) {
    return reponseEchec("requete-invalide", "Aucun son reçu.");
  }
  if (audio.byteLength > MAX_OCTETS) {
    return reponseEchec("requete-invalide", "Enregistrement trop long.");
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
    return reponseEchec(resultat.error.code, resultat.error.message);
  }

  const texte = resultat.data.trim();
  if (texte === "") {
    return reponseEchec("regle-metier", "Rien n'a été compris. Reformulez ou tapez votre demande.");
  }

  return new Response(JSON.stringify({ ok: true, data: { texte } }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
