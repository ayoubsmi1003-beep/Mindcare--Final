/**
 * Le monogramme d'un patient.
 *
 * PAS DE PHOTO, ET CE N'EST PAS UN MANQUE. Une photographie de patient est une
 * donnée de santé identifiante au sens de la loi 18-07 : elle imposerait un
 * stockage, une durée de conservation, une purge et une politique d'accès
 * propres. Deux lettres suffisent à retrouver une ligne dans une liste, ce qui
 * est le seul service qu'on demande ici.
 *
 * UNE SEULE TEINTE, LA MARQUE. On pourrait dériver une couleur de l'identifiant
 * pour « égayer » la liste — c'est un réflexe de tableau de bord. Ici la
 * couleur porte un RÔLE (§ jetons de rôle) : un monogramme violet se lirait
 * comme une surface Jarvis, un ambre comme une alerte. Un patient n'est pas un
 * statut, il n'a donc pas de couleur propre.
 *
 * `aria-hidden` : le nom complet est TOUJOURS rendu à côté, en texte. Faire
 * lire « B A » par un lecteur d'écran avant le nom ajoute du bruit sans
 * information.
 */

export type TailleAvatar = "petite" | "normale" | "grande";

const TAILLES: Readonly<Record<TailleAvatar, string>> = {
  // `min-w-target` et non une largeur libre : la cible tactile est le plancher
  // d'accessibilité, et un avatar de liste est souvent dans une ligne cliquable.
  petite: "min-h-target min-w-target text-label",
  normale: "min-h-target-lg min-w-target-lg text-body",
  grande: "min-h-target-lg min-w-target-lg px-4 py-4 text-heading",
};

/**
 * Les initiales, calculées ici et nulle part ailleurs — trois écrans les
 * fabriquaient chacun à leur façon avant que cette pièce n'existe.
 *
 * `charAt(0)` et non `[0]` : sur une chaîne vide, l'index rend `undefined` et
 * `.toUpperCase()` jette. Un prénom vide ne peut pas exister en base
 * (`first_name` est NOT NULL), mais une chaîne d'espaces, si.
 */
function initiales(prenom: string, nom: string): string {
  const p = prenom.trim().charAt(0);
  const n = nom.trim().charAt(0);
  const deux = `${p}${n}`.toUpperCase();
  // Plutôt qu'un carré vide, qui se lit comme un défaut d'affichage.
  return deux === "" ? "?" : deux;
}

export function Avatar({
  prenom,
  nom,
  taille = "normale",
}: {
  readonly prenom: string;
  readonly nom: string;
  readonly taille?: TailleAvatar;
}): React.JSX.Element {
  return (
    <span
      aria-hidden="true"
      className={[
        "inline-flex shrink-0 items-center justify-center rounded-full",
        "bg-grad-avatar font-ui font-semibold text-brand-900 shadow-lift1",
        TAILLES[taille],
      ].join(" ")}
    >
      {initiales(prenom, nom)}
    </span>
  );
}
