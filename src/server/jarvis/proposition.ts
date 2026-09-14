/**
 * `proposition.ts` — LA LECTURE DE L'ENVELOPPE DU MODÈLE, EN PUR.
 *
 * Sortie de `route.ts` pour la même raison que `routing.ts` : une frontière
 * qu'on ne peut pas exécuter dans un test est une frontière qu'on ne peut pas
 * prouver — et Next interdit en outre tout export non-route depuis un
 * `route.ts` (erreur `OmitWithTag` au typecheck). Zéro dépendance, mêmes
 * règles mot pour mot.
 *
 * Le modèle doit rendre `{"type":"texte",…}` ou `{"type":"outil",…}`. Tout le
 * reste est une réponse malformée, et une réponse malformée n'est jamais
 * « rattrapée » en devinant l'intention : on rend une erreur. Deviner, ici,
 * reviendrait à exécuter ce que le modèle n'a pas su demander proprement.
 *
 * Seule exception : l'enveloppe NUE `{type:<nom>}` (qwen, mesuré 3/3 le
 * 2026-09-03), où le modèle NOMME l'outil — pas une intention à deviner, un
 * nom à lire. Seuls les cinq noms décrits sont rabattus ; le reste de
 * l'objet devient `args`, revalidé ensuite DEUX fois (Zod côté client,
 * allowlist 033/063 en base). Trois barrières après celle-ci.
 */

/**
 * Les cinq noms que le modèle peut employer en `type` nu — recopie exacte de
 * `DESCRIPTION_OUTILS` (`prompt.ts`) et d'`OUTILS_GELES` (`jarvis-tools.ts`,
 * verrouillé à cinq par `AssertionCinq`). Trois listes pour cinq noms, et
 * c'est assumé : un sixième outil exige déjà une revue aux deux autres
 * endroits, qui refuseront ce qu'on oublierait ici.
 */
const OUTILS_NOMMES: ReadonlySet<string> = new Set([
  "analyze_session",
  "search_patients",
  "get_agenda",
  "create_appointment",
  "set_consultation_price",
]);

export type PropositionLue =
  | { readonly type: "texte"; readonly reponse: string }
  | { readonly type: "outil"; readonly nom: string; readonly args: unknown };

export function lireProposition(brut: string): PropositionLue | null {
  // ── Nettoyage DÉTERMINISTE, jamais une devinette d'intention ──
  // Mesuré avec les modèles à raisonnement de la famille nemotron : la
  // réflexion interne peut se déverser en balises <think>…</think> et le JSON
  // peut être encadré de clôtures markdown PARTOUT, pas seulement aux extrêmes.
  // On retire ces deux habillages connus, puis on tente le parse ; si le reste
  // n'est pas l'enveloppe attendue, c'est une erreur — comme toujours ici.
  const sansReflexion = brut.replace(/<think>[\s\S]*?<\/think>/gi, "");
  const sansClotures = sansReflexion.replace(/```(?:json)?/gi, "");

  let candidat = sansClotures.trim();
  let valeur: unknown;
  try {
    valeur = JSON.parse(candidat);
  } catch {
    // Dernier ressource de FORME : l'objet compris entre la première et la
    // dernière accolade. Si ça ne parse pas davantage, on abandonne —
    // reconstruire l'intention du modèle n'existe pas dans ce fichier.
    const debut = candidat.indexOf("{");
    const fin = candidat.lastIndexOf("}");
    if (debut < 0 || fin <= debut) return null;
    candidat = candidat.slice(debut, fin + 1);
    try {
      valeur = JSON.parse(candidat);
    } catch {
      return null;
    }
  }
  if (typeof valeur !== "object" || valeur === null) return null;

  const o = valeur as Record<string, unknown>;
  if (o["type"] === "texte" && typeof o["reponse"] === "string") {
    return { type: "texte", reponse: o["reponse"] };
  }
  if (o["type"] === "outil" && typeof o["nom"] === "string") {
    // `args` n'est PAS validé ici : la validation stricte (Zod) vit côté
    // client, dans `jarvis-tools.ts`, avec les cinq schémas. La dupliquer ici
    // créerait deux vérités qui divergeraient au premier changement.
    return { type: "outil", nom: o["nom"], args: o["args"] ?? {} };
  }
  if (typeof o["type"] === "string" && OUTILS_NOMMES.has(o["type"])) {
    const reste: Record<string, unknown> = { ...o };
    delete reste["type"];
    // Mélange des deux conventions (`{type:<outil>, args:{…}}`, mesuré en
    // boucle live) : un unique `args` objet se désemballe d'un niveau, sinon
    // la clé `args` fait échouer `strictObject` et brûle un tour. Un `args`
    // non-objet reste `null` : on ne devine pas le contenu, seulement
    // l'emballage — et l'emballage est déterminé par les deux conventions
    // que le modèle a sous les yeux.
    const cles = Object.keys(reste);
    if (cles.length === 1 && cles[0] === "args") {
      const dedans = reste["args"];
      if (typeof dedans !== "object" || dedans === null || Array.isArray(dedans)) {
        return null;
      }
      return { type: "outil", nom: o["type"], args: dedans };
    }
    return { type: "outil", nom: o["type"], args: reste };
  }
  return null;
}
