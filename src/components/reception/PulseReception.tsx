/**
 * PulseReception — la rangée de synthèse du poste d'accueil.
 *
 * Quatre nombres, une seule surface, une seule ligne de lecture. La version
 * précédente empilait quatre tuiles pastel de 160 px pour afficher quatre
 * zéros : le regard lisait le vide au centre de chaque tuile, pas le chiffre.
 * Ici la valeur est le premier élément lu (28 px, tabulaire), le libellé est
 * une ligne de 12 px, et la couleur ne sert qu'à signaler un compteur non nul.
 *
 * Aucune donnée n'est calculée ici : les quatre valeurs viennent du board
 * (`app.reception_board`). La tuile « Créneaux libres » qui affichait 11 h × 7 j
 * a été retirée — ce n'était pas une disponibilité, c'était la taille du cadre.
 */
"use client";

import { fr } from "@/i18n/fr";
import { Icone, type NomIcone } from "@/components/ui/Icones";

interface Props {
  readonly attente: number;
  readonly retards: number;
  readonly aEncaisser: number;
  readonly demandes: number;
  readonly onFocusAttente?: () => void;
  readonly onFocusEncaisser?: () => void;
  readonly onFocusDemandes?: () => void;
}

type Ton = "info" | "attention" | "action" | "ai";

const TONS: Readonly<Record<Ton, { readonly icone: string; readonly point: string }>> = {
  info: { icone: "text-info-600", point: "bg-info-600" },
  attention: { icone: "text-attention-ink", point: "bg-attention" },
  action: { icone: "text-brand-700", point: "bg-brand-600" },
  ai: { icone: "text-ai-600", point: "bg-ai-600" },
};

function Statistique({
  valeur,
  libelle,
  icone,
  ton,
  onClick,
}: {
  readonly valeur: number;
  readonly libelle: string;
  readonly icone: NomIcone;
  readonly ton: Ton;
  readonly onClick?: (() => void) | undefined;
}): React.JSX.Element {
  const actif = valeur > 0;
  const contenu = (
    <>
      <span className="flex min-w-0 items-center gap-1.5 font-ui text-label font-medium text-ink-500">
        <Icone nom={icone} taille={16} className={actif ? TONS[ton].icone : "text-ink-300"} />
        <span className="truncate">{libelle}</span>
      </span>
      <span className="flex items-baseline gap-2">
        <span
          className={[
            "font-num text-chiffre font-semibold tabular-nums",
            actif ? "text-ink-900" : "text-ink-500",
          ].join(" ")}
        >
          {valeur}
        </span>
        {actif ? (
          <span
            aria-hidden="true"
            className={["h-1.5 w-1.5 shrink-0 rounded-full", TONS[ton].point].join(" ")}
          />
        ) : null}
      </span>
    </>
  );

  const classes = [
    "flex min-h-20 flex-col justify-between gap-2 bg-card px-4 py-3 text-left",
    onClick
      ? "cursor-pointer transition duration-quick ease-out hover:bg-muted focus-visible:outline focus-visible:outline-action-600 focus-visible:outline-offset-2"
      : "",
  ].join(" ");

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={classes}>
        {contenu}
      </button>
    );
  }
  return <div className={classes}>{contenu}</div>;
}

export function PulseReception({
  attente,
  retards,
  aEncaisser,
  demandes,
  onFocusAttente,
  onFocusEncaisser,
  onFocusDemandes,
}: Props): React.JSX.Element {
  return (
    <section
      aria-label={fr.reception.titre}
      className="shrink-0 overflow-hidden rounded-xl border border-rule bg-rule shadow-douce"
    >
      {/* `gap-px` sur un fond `bg-rule` : les filets sont des gouttières, pas
          des bordures. En RTL, rien ne se décale — aucune propriété physique. */}
      <div className="grid grid-cols-2 gap-px tablet:grid-cols-4">
        <Statistique
          valeur={attente}
          libelle={fr.reception.pulse.salleAttente}
          icone="patients"
          ton="info"
          onClick={onFocusAttente}
        />
        <Statistique
          valeur={retards}
          libelle={fr.reception.pulse.retards}
          icone="horloge"
          ton="attention"
        />
        <Statistique
          valeur={aEncaisser}
          libelle={fr.reception.pulse.aEncaisser}
          icone="finances"
          ton="action"
          onClick={onFocusEncaisser}
        />
        <Statistique
          valeur={demandes}
          libelle={fr.reception.pulse.demandes}
          icone="agenda"
          ton="ai"
          onClick={onFocusDemandes}
        />
      </div>
    </section>
  );
}
