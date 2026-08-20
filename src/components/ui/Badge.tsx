/**
 * Pastilles d'état.
 *
 * UN STATUT PORTE TOUJOURS UN TEXTE. Jamais la couleur seule (§4 règle 4) :
 * huit pour cent des hommes ne distinguent pas le rouge du vert, et la
 * praticienne peut lire cet écran sur un projecteur, un portable mal calibré,
 * ou une capture en noir et blanc versée à un dossier. La couleur accélère la
 * lecture, elle ne la porte pas.
 *
 * QUATRE TONS, ET PAS DE ROUGE. `neutre` pour l'état ordinaire — la majorité
 * des pastilles d'un agenda sain. `attention` pour ce qui appelle un geste.
 * `positif` pour ce qui est acquis. `information` pour ce qui est en cours.
 * `--critical` n'est pas proposé : il est réservé au disque critique et à la
 * perte de données (§4 règle 1), et un rendez-vous annulé n'en fait pas partie.
 */

export type TonBadge = "neutre" | "attention" | "positif" | "information";

const TONS: Readonly<Record<TonBadge, string>> = {
  neutre: "bg-sunken text-ink-700 border-rule",
  attention: "bg-attention-bg text-attention-ink border-attention",
  positif: "bg-positive-bg text-positive border-positive",
  // Le ton `information` prend le rôle INFO (azure), et non plus la marque :
  // un badge d'information teinté de la couleur d'action se lisait comme une
  // chose à faire. Le rôle existe pour trancher exactement ce genre de cas.
  information: "bg-info-50 text-info-600 border-info-100",
};

export function Badge({
  children,
  ton = "neutre",
}: {
  readonly children: React.ReactNode;
  readonly ton?: TonBadge;
}): React.JSX.Element {
  return (
    <span
      className={[
        // `whitespace-nowrap` : « Non présenté » sur deux lignes dans une
        // pastille se lit comme deux états.
        "inline-flex items-center whitespace-nowrap rounded-full border px-3 py-1",
        "font-ui text-label font-medium tracking-label",
        TONS[ton],
      ].join(" ")}
    >
      {children}
    </span>
  );
}

/**
 * Un chiffre et ce qu'il compte.
 *
 * Le chiffre d'abord, en chasse fixe et `tabular-nums` : deux compteurs
 * superposés doivent aligner leurs unités, sinon comparer demande un effort.
 * Le libellé reste en encre secondaire — on relit le chiffre bien plus souvent
 * que ce qu'il désigne.
 */
export function Chiffre({
  valeur,
  libelle,
  attention = false,
}: {
  readonly valeur: number;
  readonly libelle: string;
  readonly attention?: boolean;
}): React.JSX.Element {
  return (
    <span
      className={[
        "inline-flex items-baseline gap-2 rounded-full border px-4 py-2",
        attention ? "bg-attention-bg border-attention" : "bg-card border-rule",
      ].join(" ")}
    >
      <span
        className={[
          "font-num text-num font-medium tabular-nums",
          attention ? "text-attention-ink" : "text-ink-900",
        ].join(" ")}
      >
        {valeur}
      </span>
      <span className="font-ui text-label text-ink-500">{libelle}</span>
    </span>
  );
}
