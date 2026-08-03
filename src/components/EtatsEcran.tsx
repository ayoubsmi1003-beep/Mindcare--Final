/**
 * Les états partagés d'un écran — I11, et le gabarit d'erreur en trois temps.
 *
 * PURE PRÉSENTATION. Aucun appel à `src/services/*`, aucune décision. Ces trois
 * composants existent parce qu'I11 impose CINQ états à chaque écran et que les
 * réécrire par écran garantit qu'un jour l'un d'eux affichera « Une erreur est
 * survenue » — le vague exact qu'interdit la règle 8 du §4.
 *
 * Jetons uniquement (I10). `--attention` pour l'erreur, jamais `--critical` :
 * le rouge est un budget réservé au disque critique et à la perte de données
 * (§4 règle 1). Aucun verre : le verre décore le mobilier, pas la donnée
 * (§4 règle 2).
 */

import { fr } from "@/i18n/fr";

/**
 * Bandeau hors ligne. `role="status"` et non `role="alert"` : la perte de
 * réseau n'interrompt pas le travail (I20), elle informe.
 */
export function BandeauHorsLigne(): React.JSX.Element {
  return (
    <p
      role="status"
      style={{
        padding: "var(--s-3) var(--s-4)",
        borderRadius: "var(--r-md)",
        background: "var(--sunken)",
        color: "var(--ink-700)",
        fontSize: "var(--text-body-size)",
        lineHeight: "var(--text-body-leading)",
      }}
    >
      {fr.etats.horsLigne}
    </p>
  );
}

/**
 * Bloc d'erreur.
 *
 * `message` vient de `fr.erreurs.*` via `AppError` — jamais du message brut de
 * Postgres, qui porte régulièrement la valeur ayant déclenché l'erreur
 * (« Key (phone)=(0554…) »), c'est-à-dire une donnée identifiante à l'écran (I5).
 * Ces phrases sont déjà écrites en trois temps ; l'en-tête les annonce.
 */
export function BlocErreur({ message }: { readonly message: string }): React.JSX.Element {
  return (
    <div
      role="alert"
      style={{
        padding: "var(--s-3) var(--s-4)",
        borderRadius: "var(--r-md)",
        background: "var(--attention-bg)",
        color: "var(--ink-700)",
        fontSize: "var(--text-body-size)",
        lineHeight: "var(--text-body-leading)",
      }}
    >
      <strong
        style={{
          display: "block",
          color: "var(--attention)",
          fontSize: "var(--text-label-size)",
          lineHeight: "var(--text-label-leading)",
          letterSpacing: "var(--text-label-tracking)",
        }}
      >
        {fr.erreur.titre}
      </strong>
      {message}
    </div>
  );
}

/**
 * Un champ en lecture.
 *
 * Champ non renseigné : une PHRASE, jamais un tiret nu — un tiret se confond
 * avec une valeur, et sur un numéro de téléphone la confusion se paie au moment
 * où on cherche à joindre quelqu'un.
 */
export function Champ({
  libelle,
  valeur,
}: {
  readonly libelle: string;
  readonly valeur: string | null;
}): React.JSX.Element {
  const vide = valeur === null || valeur === "";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--s-1)" }}>
      <span
        style={{
          fontSize: "var(--text-label-size)",
          lineHeight: "var(--text-label-leading)",
          letterSpacing: "var(--text-label-tracking)",
          fontWeight: "var(--weight-medium)",
          color: "var(--ink-500)",
        }}
      >
        {libelle}
      </span>
      <span
        style={{
          fontSize: "var(--text-body-size)",
          lineHeight: "var(--text-body-leading)",
          color: vide ? "var(--ink-300)" : "var(--ink-900)",
          fontVariantNumeric: "tabular-nums",
          // Un nom long ou une note d'une ligne entière ne doit pas déborder ni
          // pousser la colonne voisine (I11, cinquième état).
          overflowWrap: "anywhere",
          whiteSpace: "pre-wrap",
        }}
      >
        {vide ? fr.etats.texteAbsent : valeur}
      </span>
    </div>
  );
}
