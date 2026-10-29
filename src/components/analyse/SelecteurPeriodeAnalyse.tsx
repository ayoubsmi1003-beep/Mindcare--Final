"use client";

/**
 * LE SÉLECTEUR DE PÉRIODE DE L'ÉCRAN STATISTIQUES.
 *
 * ⚠️ UN SEUL FILTRE POUR TOUTE LA PAGE. Aucun panneau n'a le sien : deux
 * commandes qui bornent le temps finiraient par se contredire, et plus personne
 * ne saurait quelle période décrit le chiffre lu. C'est aussi ce qui tient le
 * budget d'UN appel serveur (06-PERF-BUDGET §3).
 *
 * ⚠️ GROUPE RADIO, PAS UNE RANGÉE DE BOUTONS. Les six choix sont exclusifs :
 * `radiogroup` l'annonce, les flèches parcourent le groupe, Tab entre et sort.
 *
 * ⚠️ LA PÉRIODE COMPARÉE EST ÉCRITE SOUS LA PÉRIODE. « +12 % » sans « par
 * rapport à quoi » est un chiffre qui ne dit rien.
 *
 * ⚠️ LA BARRE EST LE SEUL ENDROIT QUI NE DÉFILE PAS. Elle est donc traitée
 * comme une pièce d'orfèvrerie, pas comme un formulaire : pastille d'icône,
 * segmenté à capsule mobile, et la fenêtre active résumée dans une capsule
 * chiffrée. Le verre est opaque ici (voir `.analyse-barre`) : elle couvre du
 * texte quand la page défile.
 */

import { useId, useRef } from "react";

import { Icone } from "@/components/ui/Icones";
import { analyse } from "@/i18n/analyse";
import { aujourdHuiCabinet, ajouterJours, estAvantOuEgal, nombreDeJours } from "@/services/finance-calendrier";

export type NomPeriodeAnalyse = "aujourdhui" | "sept" | "trente" | "quatre_vingt_dix" | "annee" | "personnalise";

export interface PeriodeAnalyse {
  readonly nom: NomPeriodeAnalyse;
  readonly du: string;
  readonly au: string;
}

const PRESETS: readonly Exclude<NomPeriodeAnalyse, "personnalise">[] = [
  "aujourdhui",
  "sept",
  "trente",
  "quatre_vingt_dix",
  "annee",
];

const OPTIONS: readonly NomPeriodeAnalyse[] = [...PRESETS, "personnalise"];

export function bornesAnalyse(
  nom: Exclude<NomPeriodeAnalyse, "personnalise">,
  aujourdHui: string,
): PeriodeAnalyse {
  switch (nom) {
    case "aujourdhui":
      return { nom, du: aujourdHui, au: aujourdHui };
    case "sept":
      return { nom, du: ajouterJours(aujourdHui, -6), au: aujourdHui };
    case "trente":
      return { nom, du: ajouterJours(aujourdHui, -29), au: aujourdHui };
    case "quatre_vingt_dix":
      return { nom, du: ajouterJours(aujourdHui, -89), au: aujourdHui };
    case "annee":
      return { nom, du: `${aujourdHui.slice(0, 4)}-01-01`, au: aujourdHui };
  }
}

export function periodeInitiale(): PeriodeAnalyse {
  return bornesAnalyse("trente", aujourdHuiCabinet());
}

/** La fenêtre précédente de MÊME DURÉE, immédiatement antérieure. */
export function fenetrePrecedente(du: string, au: string): { du: string; au: string } | null {
  if (!estAvantOuEgal(du, au)) return null;
  const jours = nombreDeJours(du, au);
  return { du: ajouterJours(du, -jours), au: ajouterJours(du, -1) };
}

/** « 30/09/2026 » — la forme courte, tabulaire, d'une borne de période. */
function jourCourt(iso: string): string {
  const [a, m, j] = iso.split("-");
  return a === undefined || m === undefined || j === undefined ? iso : `${j}/${m}/${a}`;
}

export function SelecteurPeriodeAnalyse({
  periode,
  onChange,
  desactive = false,
}: {
  readonly periode: PeriodeAnalyse;
  readonly onChange: (p: PeriodeAnalyse) => void;
  readonly desactive?: boolean;
}): React.JSX.Element {
  const t = analyse.periodes;
  const LIBELLES: Record<NomPeriodeAnalyse, string> = {
    aujourdhui: t.aujourdhui,
    sept: t.sept,
    trente: t.trente,
    quatre_vingt_dix: t.quatreVingtDix,
    annee: t.annee,
    personnalise: t.personnalise,
  };
  const idGroupe = useId();
  const boutons = useRef<Array<HTMLButtonElement | null>>([]);

  const valide = estAvantOuEgal(periode.du, periode.au);
  const jours = valide ? nombreDeJours(periode.du, periode.au) : 0;
  const tropLongue = valide && jours > 366;
  const precedente = valide && !tropLongue ? fenetrePrecedente(periode.du, periode.au) : null;

  function choisir(nom: NomPeriodeAnalyse): void {
    if (nom === "personnalise") {
      onChange({ nom: "personnalise", du: periode.du, au: periode.au });
      return;
    }
    onChange(bornesAnalyse(nom, aujourdHuiCabinet()));
  }

  function auClavier(e: React.KeyboardEvent, index: number): void {
    const suivant =
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? (index + 1) % OPTIONS.length
        : e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? (index - 1 + OPTIONS.length) % OPTIONS.length
          : null;
    if (suivant === null) return;
    e.preventDefault();
    boutons.current[suivant]?.focus();
    const nom = OPTIONS[suivant];
    if (nom !== undefined) choisir(nom);
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex min-w-0 flex-wrap items-center gap-2.5">
        <span
          className="icone-lueur"
          data-teinte="emeraude"
          aria-hidden="true"
          title={t.legende}
        >
          <Icone nom="agenda" taille={20} />
        </span>

        {/* Le segmenté : une capsule creusée, l'option active posée dessus. */}
        <div
          role="radiogroup"
          aria-label={t.legende}
          aria-describedby={`${idGroupe}-bornes`}
          className="flex min-w-0 flex-wrap items-center gap-0.5 rounded-full border bord-verre verre-clair p-1 shadow-[inset_0_1px_2px_rgba(10,31,12,0.06),inset_0_1px_0_rgba(255,255,255,0.9)] backdrop-blur-md"
        >
          {OPTIONS.map((nom, i) => {
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
                tabIndex={actif ? 0 : -1}
                disabled={desactive}
                onClick={() => choisir(nom)}
                onKeyDown={(e) => auClavier(e, i)}
                className={[
                  "min-h-8 shrink-0 whitespace-nowrap rounded-full px-3.5 font-ui text-label",
                  "transition duration-quick ease-soft",
                  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action-600",
                  actif
                    ? "bg-action-600 font-semibold text-on-brand shadow-[0_1px_0_rgba(255,255,255,0.35)_inset,0_6px_14px_-8px_rgba(27,94,32,0.65)]"
                    : "text-ink-700 hover:bg-card hover:text-ink-900",
                  desactive ? "opacity-60" : "",
                ].join(" ")}
              >
                {LIBELLES[nom]}
              </button>
            );
          })}
        </div>

        {/* La fenêtre active, en chiffres — jamais un intervalle sous-entendu. */}
        {periode.nom === "personnalise" ? (
          <div className="flex min-h-10 items-center gap-2 rounded-full border bord-verre verre-clair-fort px-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.95)]">
            <label className="flex items-center gap-1.5">
              <span className="font-ui text-eyebrow uppercase tracking-eyebrow text-ink-500">{t.du}</span>
              <input
                type="date"
                value={periode.du}
                max={periode.au}
                disabled={desactive}
                onChange={(e) => onChange({ nom: "personnalise", du: e.target.value, au: periode.au })}
                className="h-7 w-[8.6rem] rounded-md border bord-verre verre-clair-fort px-1.5 font-num text-label tabular-nums text-ink-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action-600"
              />
            </label>
            <span aria-hidden="true" className="font-ui text-label text-ink-300">
              →
            </span>
            <label className="flex items-center gap-1.5">
              <span className="font-ui text-eyebrow uppercase tracking-eyebrow text-ink-500">{t.au}</span>
              <input
                type="date"
                value={periode.au}
                min={periode.du}
                disabled={desactive}
                onChange={(e) => onChange({ nom: "personnalise", du: periode.du, au: e.target.value })}
                className="h-7 w-[8.6rem] rounded-md border bord-verre verre-clair-fort px-1.5 font-num text-label tabular-nums text-ink-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action-600"
              />
            </label>
          </div>
        ) : (
          <span className="inline-flex min-h-10 items-center gap-2 rounded-full border bord-verre verre-clair-fort px-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.95)]">
            <span className="font-num text-label font-semibold tabular-nums text-ink-900">
              {valide ? `${jourCourt(periode.du)} → ${jourCourt(periode.au)}` : "—"}
            </span>
            {valide && !tropLongue ? (
              <span className="font-ui text-label text-ink-500">
                · {jours === 1 ? t.unJour : `${jours} ${t.jours}`}
              </span>
            ) : null}
          </span>
        )}

        {desactive ? (
          <span
            role="status"
            className="inline-flex items-center gap-1.5 font-ui text-label text-ink-500"
            aria-live="polite"
          >
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emeraude-600" aria-hidden="true" />
            {analyse.etats.chargement}
          </span>
        ) : null}
      </div>

      <p
        id={`${idGroupe}-bornes`}
        className="flex flex-wrap items-baseline gap-x-1.5 font-ui text-label text-ink-500"
      >
        {valide && !tropLongue ? (
          <>
            <span>
              {t.comparaison}{" "}
              <span className="font-num tabular-nums text-ink-700">
                {jourCourt(precedente?.du ?? "")} → {jourCourt(precedente?.au ?? "")}
              </span>
            </span>
            <span aria-hidden="true" className="text-ink-300">·</span>
            <span className="font-num tabular-nums">{jours === 1 ? t.unJour : `${jours} ${t.jours}`}</span>
          </>
        ) : (
          <span className="text-attention-ink">
            {valide ? t.plageTropLongue : t.plageInvalide}
          </span>
        )}
      </p>
    </div>
  );
}
