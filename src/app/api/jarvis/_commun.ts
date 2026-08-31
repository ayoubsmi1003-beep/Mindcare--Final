/**
 * Contexte partagé des cinq routes Jarvis — le portage des fonctions Deno.
 *
 * ═══ CE QUI DISPARAÎT PAR RAPPORT AUX EDGE FUNCTIONS ═══════════════════════
 *
 * 1. LA VÉRIFICATION DE JETON. Chaque fonction Deno construisait un client
 *    Supabase avec le `Authorization:` reçu, puis appelait `auth.getUser()`
 *    pour VÉRIFIER le JWT — un aller-retour réseau vers GoTrue par requête.
 *    Ici, l'identité vient du cookie `httpOnly` et de `auth.resolve_session`,
 *    une seule requête locale. C'est un chemin plus COURT qu'avant, pas plus
 *    long : le portage simplifie ce maillon au lieu de le compliquer.
 *
 * 2. LES EN-TÊTES CORS. Ces routes sont désormais servies par le MÊME serveur
 *    que l'interface : l'appel est same-origin, et `enTetesCors()` n'a plus
 *    d'objet. Ce n'est pas un relâchement — c'est la disparition du besoin. Le
 *    navigateur ne fait même pas de requête préalable. Il n'y a plus de liste
 *    d'origines à tenir à jour, donc plus de liste à se tromper.
 *
 * ═══ CE QUI NE CHANGE PAS ══════════════════════════════════════════════════
 *
 * L'ENVELOPPE, et il ne faut pas y toucher. Toutes ces routes répondent en
 * HTTP 200 avec `{ ok, data | error }`. La raison d'origine (le comportement de
 * `supabase-js` face à un non-2xx changeait d'une version à l'autre) a disparu,
 * mais `src/services/jarvis*.ts` lit cette forme, et la phase 5 s'interdit de
 * modifier les services. On conserve donc la convention telle quelle.
 */

import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { NOM_COOKIE, resoudreSession } from "@/server/auth/session";

/** Échec : HTTP 200, le corps porte le contrat. Voir l'en-tête. */
export function echec(code: string, message: string): NextResponse {
  return NextResponse.json({ ok: false, error: { code, message } }, { status: 200 });
}

/** Succès : même enveloppe. */
export function succes(data: unknown): NextResponse {
  return NextResponse.json({ ok: true, data }, { status: 200 });
}

/**
 * L'identité de l'appelant, ou `null`.
 *
 * ⚠️ POURQUOI CETTE VÉRIFICATION EST OBLIGATOIRE ICI, ET PAS SEULEMENT POLIE.
 * Ces routes n'écrivent parfois RIEN en base (`voice-in` transcrit et rend le
 * texte). La RLS n'a donc rien à arbitrer, et ne protège rien. Sans contrôle
 * d'identité, un appelant anonyme ferait transcrire ce qu'il veut AUX FRAIS DE
 * NOTRE CLÉ, et la seule trace serait une ligne d'audit sans acteur.
 *
 * Un point de sortie payant sans porte d'entrée est une porte ouverte — la
 * remarque vient de `jarvis-voice-in/index.ts` et reste vraie mot pour mot.
 */
export async function identite(): Promise<string | null> {
  const magasin = await cookies();
  const jeton = magasin.get(NOM_COOKIE)?.value;
  try {
    return await resoudreSession(jeton);
  } catch {
    return null;
  }
}
