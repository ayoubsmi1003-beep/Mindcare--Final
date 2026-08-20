/**
 * Le sélecteur de période — la seule commande qui gouverne tout l'écran.
 *
 * ⚠️ UN SEUL FILTRE POUR TOUTE LA PAGE. Pas de filtre par graphique, pas de
 * second sélecteur dans une section : deux commandes qui bornent le temps
 * finiraient par se contredire, et personne ne saurait quelle période décrit le
 * chiffre qu'il lit. C'est aussi ce qui permet de tenir le budget d'UN SEUL
 * appel réseau (`06-PERF-BUDGET.md` §2) — une porte, une période.
 *
 * ⚠️ GROUPE RADIO, PAS UNE RANGÉE DE BOUTONS. Les cinq choix sont EXCLUSIFS :
 * `role="radiogroup"` l'annonce au lecteur d'écran, et les flèches du clavier
 * parcourent le groupe pendant que Tab entre et sort — le comportement qu'un
 * utilisateur au clavier attend d'un choix unique. Cinq `<button>` sans groupe
 * obligeraient à tabuler cinq fois pour traverser une seule commande.
 */

"use client";

import { useId, useRef } from "react";

import { Bouton } from "@/components/ui";
import { fr } from "@/i18n/fr";
import {
  aujourdHuiCabinet,
  bornesDePeriode,
  nombreDeJours,
  periodeEstValide,
  type NomPeriode,
  type Periode,
} from "@/services/finance-periode";

const PRESETS: readonly Exclude<NomPeriode, "personnalise">[] = [
  "jour",
  "semaine",
  "mois",
  "annee",
];

export function SelecteurPeriode({
  periode,
  onChange,
  desactive = false,
}: {
  readonly periode: Periode;
  readonly onChange: (p: Periode) => void;
  readonly desactive?: boolean;
}): React.JSX.Element {
  const t = fr.finances.periodes;
  const idGroupe = useId();
  const boutons = useRef<Array<HTMLButtonElement | null>>([]);

  const options: readonly NomPeriode[] = [...PRESETS, "personnalise"];

  /**
   * Flèches = déplacer DANS le groupe, et le déplacement SÉLECTIONNE.
   * C'est le comportement standard d'un groupe radio : le focus et la sélection
   * ne se dissocient pas, sinon l'utilisateur au clavier croit avoir choisi
   * alors qu'il n'a fait que survoler.
   */
  function auClavier(e: React.KeyboardEvent, index: number): void {
    const suivant =
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? (index + 1) % options.length
        : e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? (index - 1 + options.length) % options.length
          : null;
    if (suivant === null) return;
    e.preventDefault();
    boutons.current[suivant]?.focus();
    choisir(options[suivant] as NomPeriode);
  }

  function choisir(nom: NomPeriode): void {
    if (nom === "personnalise") {
      // On garde les bornes courantes : passer en « Personnalisé » ne doit rien
      // changer à l'écran tant que l'utilisatrice n'a pas saisi de dates. Un
      // changement de chiffres au simple clic sur l'onglet serait une surprise.
      onChange({ nom: "personnalise", du: periode.du, au: periode.au });
      return;
    }
    onChange(bornesDePeriode(nom, aujourdHuiCabinet()));
  }

  const jours = nombreDeJours(periode.du, periode.au);
  const valide = periodeEstValide(periode.du, periode.au);

  return (
    <div className="flex flex-col gap-3">
      <div
        role="radiogroup"
        aria-label={t.legende}
        className="flex flex-wrap gap-2"
      >
        {options.map((nom, i) => {
          const actif = periode.nom === nom;
          return (
            <button
              key={nom}
              ref={(el) => {
                boutons.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={actif}
              // Un seul arrêt de tabulation pour tout le groupe : c'est l'option
              // ACTIVE qui le porte. Les flèches font le reste.
              tabIndex={actif ? 0 : -1}
              disabled={desactive}
              onClick={() => choisir(nom)}
              onKeyDown={(e) => auClavier(e, i)}
              className={[
                "min-h-target rounded-md border px-4 font-ui text-body",
                "transition duration-quick ease-soft",
                actif
                  ? "border-action-600 bg-action-600 text-on-brand"
                  : "border-rule bg-card text-ink-700 hover:border-action-500",
                desactive ? "opacity-disabled" : "",
              ].join(" ")}
            >
              {t[nom]}
            </button>
          );
        })}
      </div>

      {periode.nom === "personnalise" ? (
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="font-ui text-label text-ink-500">{t.du}</span>
            <input
              type="date"
              value={periode.du}
              max={periode.au}
              disabled={desactive}
              onChange={(e) =>
                onChange({ nom: "personnalise", du: e.target.value, au: periode.au })
              }
              className="min-h-target rounded-md border border-rule bg-card px-3 font-num text-body tabular-nums text-ink-900"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-ui text-label text-ink-500">{t.au}</span>
            <input
              type="date"
              value={periode.au}
              min={periode.du}
              disabled={desactive}
              onChange={(e) =>
                onChange({ nom: "personnalise", du: periode.du, au: e.target.value })
              }
              className="min-h-target rounded-md border border-rule bg-card px-3 font-num text-body tabular-nums text-ink-900"
            />
          </label>
          <Bouton
            onClick={() => onChange({ ...periode })}
            disabled={desactive || !valide}
          >
            {t.appliquer}
          </Bouton>
        </div>
      ) : null}

      {/* La période affichée, EN TOUTES LETTRES. Elle n'est pas décorative :
          sans elle, « ↑ 12 % » ne dit pas sur quoi. Le nombre de jours est écrit
          parce que c'est LUI qui définit la fenêtre de comparaison. */}
      {valide ? (
        <p className="font-ui text-label text-ink-500">
          <span className="font-num tabular-nums">{periode.du}</span> →{" "}
          <span className="font-num tabular-nums">{periode.au}</span> ·{" "}
          {jours === 1 ? t.unJour : `${jours} ${t.jours}`}
        </p>
      ) : (
        <p className="font-ui text-label text-attention-ink">{t.plageInvalide}</p>
      )}
    </div>
  );
}
