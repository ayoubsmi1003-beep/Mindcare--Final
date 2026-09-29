/**
 * Idempotence — clés stables `comm:<conversation>:<empreinte>`.
 *
 * Navigateur + serveur : FNV-1a pur, aucune dépendance Node. La clé ne porte
 * que l'identité de la conversation et l'empreinte du grain (contenu +
 * horodatage logique fourni par l'appelant) — jamais du texte patient.
 */

function fnv1a(texte: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < texte.length; i++) {
    h ^= texte.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export function cleIdempotence(conversationId: string, grain: string): string {
  return `comm:${conversationId}:${fnv1a(`${conversationId}:${grain}`)}`;
}
