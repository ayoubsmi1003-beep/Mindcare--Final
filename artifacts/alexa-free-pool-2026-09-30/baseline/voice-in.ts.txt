/**
 * `POST /api/jarvis/jarvis-voice-in` — audio de la praticienne vers texte.
 * ADR-024, sens ENTRÉE. Portage de `supabase/functions/jarvis-voice-in`.
 *
 * Cette route ne connaît aucun outil, ne lit aucun dossier et n'écrit rien :
 * elle transcrit, et rend le texte. Toute autre responsabilité ici créerait
 * l'architecture parallèle que D-10 a refusée pour la transcription de séance.
 *
 * L'AUDIO NE TOUCHE JAMAIS LE DISQUE. Il arrive en corps de requête, vit en
 * `Uint8Array`, part dans le `fetch` de la passerelle, et le ramasse-miettes
 * s'en charge. Aucun fichier temporaire, aucun cache — ADR-009.
 */

import type { NextResponse } from "next/server";

import { stt } from "@/server/egress/external-call";
import { env } from "@/server/env";

import { echec, identite, succes } from "../_commun";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
 * panne de fournisseur, et l'écran affichait alors « Le service de données est
 * momentanément indisponible » — une phrase FAUSSE : la base allait
 * parfaitement bien, c'est Groq qui refusait. La praticienne a cherché une
 * panne de base pendant que la dictée échouait pour une raison sans rapport.
 *
 * On requalifie donc ICI, où le domaine est connu. `configuration` et
 * `frontiere` traversent INCHANGÉS : ils ne disent pas « la transcription a
 * échoué » mais « la voix n'est pas activée sur ce déploiement », et
 * `jarvis-voix.ts` s'en sert pour découvrir les capacités.
 */
function codeEchecStt(code: string): string {
  return code === "indisponible" ? "transcription-indisponible" : code;
}

/**
 * Base64 → octets. `Buffer` plutôt que `atob` : sous Node, `atob` existe mais
 * passe par une chaîne binaire intermédiaire, ce qui double la mémoire d'une
 * dictée. `Buffer.from(..., "base64")` décode directement, et ignore les
 * caractères invalides — d'où le contrôle de longueur qui suit chez l'appelant.
 */
function decoderBase64(texte: string): Uint8Array | null {
  try {
    const b = Buffer.from(texte, "base64");
    return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  } catch {
    return null;
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  // ── L'IDENTITÉ EST VÉRIFIÉE, PAS SEULEMENT EXIGÉE ──
  // Rien ici ne touche la base : la RLS n'arbitre donc rien, et ne protège
  // rien. Voir `_commun.ts` — un point de sortie payant sans porte d'entrée
  // est une porte ouverte.
  const userId = await identite();
  if (userId === null) return echec("non-authentifie", "Voix indisponible.");

  // Interrupteur d'exploitation. Absence = activé, convention conservée.
  if (env().JARVIS_VOICE_ENABLED === "false") {
    return echec("configuration", "Voix indisponible.");
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
      return echec("requete-invalide", "Requête invalide.");
    }
    const o = corps as { audioBase64?: unknown; mimeType?: unknown };
    if (
      typeof o.audioBase64 !== "string" ||
      o.audioBase64.length === 0 ||
      typeof o.mimeType !== "string"
    ) {
      return echec("requete-invalide", "Requête invalide.");
    }
    typeMime = o.mimeType.split(";")[0]?.trim() ?? "";
    if (!TYPES_ACCEPTES.has(typeMime)) {
      return echec("requete-invalide", "Format audio non pris en charge.");
    }
    audio = decoderBase64(o.audioBase64);
    if (audio === null || audio.byteLength === 0) {
      return echec("requete-invalide", "Aucun son reçu.");
    }
  } else {
    typeMime = typeBrut;
    if (!TYPES_ACCEPTES.has(typeMime)) {
      return echec("requete-invalide", "Format audio non pris en charge.");
    }
    audio = new Uint8Array(await req.arrayBuffer());
    if (audio.byteLength === 0) {
      return echec("requete-invalide", "Aucun son reçu.");
    }
  }

  // Plafond vérifié APRÈS décodage : un base64 mensonger ne contourne rien.
  if (audio.byteLength > MAX_OCTETS) {
    return echec("requete-invalide", "Enregistrement trop long.");
  }

  // `sessionToken` est engendré ICI, jamais accepté de l'appelant. Le laisser
  // fournir cette valeur permettrait d'y placer un `patient_id` — exactement ce
  // que 028 interdit à cette colonne, et le contrôle serait impossible après
  // coup. Un uuid aléatoire par appel ne corrèle rien et ne désigne personne.
  const resultat = await stt({
    audio,
    mimeType: typeMime,
    sessionToken: crypto.randomUUID(),
  });

  if (!resultat.ok) {
    return echec(codeEchecStt(resultat.error.code), resultat.error.message);
  }

  const texte = resultat.data.trim();
  if (texte === "") {
    return echec("regle-metier", "Rien n'a été compris. Reformulez ou tapez votre demande.");
  }

  return succes({ texte });
}
