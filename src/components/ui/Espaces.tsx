/**
 * Les espaces de travail — la disposition d'un écran qui dure des heures.
 *
 * POURQUOI CES PIÈCES SONT DE L'INFRASTRUCTURE ET PAS DU DÉCOR. L'écran de
 * consultation n'est pas un formulaire de plus : c'est le plan de travail
 * clinique, et il va accueillir la transcription, l'analyse de séance, les
 * ordonnances, les documents et Jarvis au fil des jalons. Si chacun de ces
 * modules arrive avec sa propre mise en page, la page est à redécouper à chaque
 * fois — et une page redécoupée est une page qu'il faut réapprendre.
 *
 * `EspaceTravail` fixe la disposition UNE fois. `SectionPliable` est la forme
 * que prend CHAQUE module. Un module futur s'ajoute alors par composition, sans
 * toucher à ce fichier ni à l'écran qui l'accueille.
 *
 * LA COLONNE DE CONTEXTE DU §3, ENFIN POSÉE. Le jeton `--grid-context-width`
 * (340px) existe depuis T1.2 et n'avait aucun consommateur : `AppShell` rend
 * délibérément deux colonnes et non trois, parce qu'aucun écran n'avait de
 * contenu à y mettre — et qu'un panneau vide avec un bouton « Masquer le
 * contexte » qui ne replie rien apprend surtout que les commandes de cette
 * interface ne font pas ce qu'elles disent. La consultation lui donne enfin son
 * contenu.
 *
 * Classes Tailwind, jamais de style en ligne : le survol, le focus et la
 * transition n'existent pas en style en ligne, et le dépôt n'admet qu'une seule
 * feuille CSS (préflight 6 ter). Toute classe employée ici est adossée à un
 * jeton (I10).
 */

"use client";

import { useId, useState, type ReactNode } from "react";

/**
 * Deux colonnes : le travail, et son contexte.
 *
 * L'ORDRE DU DOM EST L'ORDRE DE LECTURE, et c'est la colonne de travail qui
 * vient en premier. Sous la rupture `tablet`, le contexte passe DESSOUS —
 * jamais au-dessus : sur un écran étroit, faire descendre la rédaction sous un
 * panneau d'appoint mettrait l'essentiel hors de vue au chargement.
 *
 * Le contexte n'est pas `position: sticky`. Un panneau qui suit le défilement
 * pendant qu'on rédige capte le regard à chaque ligne, et cet écran s'utilise
 * six à huit heures par jour.
 */
export function EspaceTravail({
  travail,
  contexte,
}: {
  readonly travail: ReactNode;
  /** Absent tant qu'un écran n'a rien à y mettre — pas de colonne vide. */
  readonly contexte?: ReactNode;
}): React.JSX.Element {
  if (contexte === undefined) {
    return <div className="flex flex-col gap-10">{travail}</div>;
  }

  return (
    <div className="flex flex-col gap-10 tablet:flex-row tablet:items-start">
      {/* `min-w-0` : sans lui, un mot long dans une note SOAP empêche la
          colonne de rétrécir et pousse le contexte hors de l'écran. */}
      <div className="flex min-w-0 flex-1 flex-col gap-10">{travail}</div>
      <div className="flex w-full flex-col gap-6 tablet:max-w-context">{contexte}</div>
    </div>
  );
}

/**
 * Une section titrée que l'on peut replier.
 *
 * C'EST LA FORME DE CHAQUE MODULE DE L'ESPACE DE TRAVAIL. Fil de séance, aide à
 * la décision, antécédents, ordonnances, documents : tous prennent cette forme,
 * ce qui rend leur arrivée ADDITIVE. Sans elle, chaque module négocierait sa
 * propre entête et son propre état vide, et l'écran finirait avec quatre façons
 * de dire « il n'y a rien ici ».
 *
 * REPLIÉE PAR DÉFAUT OU NON, C'EST L'APPELANT QUI TRANCHE — et il tranche selon
 * ce que la praticienne regarde en rédigeant, pas selon l'ordre d'implémentation.
 *
 * `aria-expanded` et `aria-controls` plutôt qu'un `<details>` natif : le style
 * du marqueur `summary` demanderait une valeur arbitraire, que le lint refuse
 * (I10), et un état contrôlé se teste.
 */
export function SectionPliable({
  titre,
  /** Un mot sur l'état de la section — un compte, un horodatage. Jamais un compteur inventé. */
  annotation,
  action,
  replieParDefaut = false,
  children,
}: {
  readonly titre: string;
  readonly annotation?: string;
  readonly action?: ReactNode;
  readonly replieParDefaut?: boolean;
  readonly children: ReactNode;
}): React.JSX.Element {
  const [replie, setReplie] = useState(replieParDefaut);
  const idCorps = useId();

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-rule bg-card p-6 shadow-lift1">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          aria-expanded={!replie}
          aria-controls={idCorps}
          onClick={() => setReplie((v) => !v)}
          className={[
            "flex min-h-target items-center gap-3 rounded-md text-left",
            "cursor-pointer select-none bg-transparent",
            "transition duration-quick ease-soft",
            "outline-none focus-visible:outline focus-visible:outline-action-600 focus-visible:outline-offset",
          ].join(" ")}
        >
          {/* Un chevron dessiné en bordure : aucun jeu d'icônes n'existe dans
              ce dépôt, et en inventer un ici poserait un vocabulaire visuel
              entier au détour d'une section repliable. La rotation est une
              transformation, pas un déplacement de la cible. */}
          <span
            aria-hidden="true"
            className={[
              "inline-block h-2 w-2 shrink-0 border-b-2 border-r-2 border-ink-500",
              "transition duration-quick ease-soft",
              replie ? "-rotate-45" : "rotate-45",
            ].join(" ")}
          />
          <span className="font-ui text-heading font-semibold text-ink-900">{titre}</span>
          {annotation === undefined ? null : (
            <span className="font-ui text-label text-ink-500">{annotation}</span>
          )}
        </button>
        {action}
      </div>

      {/* Le contenu est RETIRÉ du DOM quand la section est repliée, pas masqué
          en CSS. Un champ de saisie caché reste focalisable au clavier, et une
          note clinique masquée reste lisible dans les outils de développement. */}
      {replie ? null : <div id={idCorps}>{children}</div>}
    </section>
  );
}
