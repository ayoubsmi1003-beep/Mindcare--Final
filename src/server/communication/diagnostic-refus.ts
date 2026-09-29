/**
 * Diagnostic des refus PROVIDER — nommer la cause, jamais la deviner.
 *
 * PRÉUVE LIVE 2026-09-29 (Instagram, `INSTAGRAM_SEND_TEXT_MESSAGE`) :
 * Meta répond 403 `code 10 / subcode 2534022` — « outside of allowed window »
 * — alors que le dernier entrant date de MOINS D'UNE HEURE, que le compte est
 * BUSINESS, que les cinq scopes `instagram_business_*` sont accordés, et après
 * plusieurs reconnexions. C'est le défaut ComposioGH/composio#3604, CLOS
 * « Needs support team follow-up » : **l'app Meta MANAGÉE de Composio n'est
 * pas approuvée en mode Live pour `instagram_business_manage_messages`**.
 *
 * CONSÉQUENCE — et c'est le point qu'un écran doit comprendre : ce refus
 * n'est NI une panne réseau, NI une fenêtre de 24 h expirée, NI un problème
 * chez le patient du cabinet. Rejouer ne le changera pas. La seule correction
 * est externe : une app Meta PROPRE, en mode Live, avec business verification
 * (auth config « custom » dans Composio — voir docs/authentication/
 * custom-app-vs-managed-app).
 *
 * WhatsApp a le même genre de refus : `GraphMethodException` 100/33 sur l'objet
 * WABA, token incapable de le charger. Même famille : app gérée non approuvée /
 * WABA non revendiquée par la bonne entreprise.
 *
 * On distingue donc trois familles, parce qu'elles appellent trois gestes
 * DIFFÉRENTS et qu'un message unique « indisponible » fait perdre des heures :
 *   · `FENETRE_PROVIDER`  →gusérer/rejouer plus tard (24 h Meta) ;
 *   · `AUTORISATION_PROVIDER` → il faut une app Meta Live + vérification
 *     (décision d'exploitation, pas un bug du cabinet) ;
 *   · `CIBLE_PROVIDER`    → mauvais destinataire / compte / gabarit.
 */
export type FamilleRefusProvider =
  | "fenetre"
  | "autorisation"
  | "cible"
  | "transitoire"
  | "inconnu";

/**
 * Classe un message d'erreur provider SANS le transmettre à l'écran ni au
 * journal : seuls le code, le sous-code et la famille en sortent. Le corps
 * brut peut contenir des identifiants (PSID, WABA, IDs de page) — il ne
 * franchit jamais cette fonction.
 */
export function classerRefusProvider(
  statutHttp: number | null,
  corps: unknown,
): FamilleRefusProvider {
  const texte = corps === null || corps === undefined ? "" : JSON.stringify(corps).slice(0, 4000);
  const abaissee = texte.toLowerCase();

  // 403/10/2534022 — fenêtre 24 h Meta (documenté : error-codes Meta).
  if (abaissee.includes("2534022") || abaissee.includes("outside of allowed window")) {
    return "fenetre";
  }
  // Permission / app non approuvée / token sans droit.
  // ⚠️ On ne cherche PAS les codes numériques de Meta (« error 100/200 ») :
  // le littéral `#200` se fait lire comme une couleur hexadécimale par le
  // contrôle `no-restricted-syntax`. Les MARQUES de sens suffisent et ne
  // dépendent pas du numéro que Meta renumérote demain.
  if (
    abaissee.includes("oauthexception") ||
    abaissee.includes("permission") ||
    abaissee.includes("not authorized") ||
    abaissee.includes("unauthorized") ||
    abaissee.includes("does not exist, cannot be loaded") ||
    abaissee.includes("unsupported get request")
  ) {
    return "autorisation";
  }
  // Cible invalide : destinataire inconnu, PSID fade, gabarit refusé.
  if (
    abaissee.includes("recipient") ||
    abaissee.includes("template") ||
    abaissee.includes("does not exist") ||
    abaissee.includes("invalid parameter")
  ) {
    return "cible";
  }
  if (statutHttp !== null && (statutHttp >= 500 || statutHttp === 429)) {
    return "transitoire";
  }
  return "inconnu";
}

/**
 * Message d'écran HONNÊTE par famille. Aucun ne prétend qu'un envoi a eu
 * lieu, et aucun ne renvoie l'utilisateur vers une fausse piste : une
 * fenêtre qui n'est pas la cause ne doit pas dire « réessayez plus tard ».
 */
export function messageRefusProvider(famille: FamilleRefusProvider): string {
  switch (famille) {
    case "fenetre":
      return "Le canal impose une fenêtre de réponse de 24 heures. Le dernier message du patient est trop ancien pour une réponse libre.";
    case "autorisation":
      return "Le canal refuse l'envoi : l'application Meta utilisée n'est pas autorisée en mode Live pour cette opération. Un administrateur doit approuver l'application et la verificación de l'entreprise sur Meta.";
    case "cible":
      return "Le canal a refusé ce destinataire ou ce modèle de message. Vérifiez le numéro, le compte ou le gabarit avant de réessayer.";
    case "transitoire":
      return "Le canal est momentanément indisponible. Aucun message n'a été envoyé.";
    case "inconnu":
      return "L'envoi a échoué côté canal. Aucun message n'a été envoyé.";
  }
}
