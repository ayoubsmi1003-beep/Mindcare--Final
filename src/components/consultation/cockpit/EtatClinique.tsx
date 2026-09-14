"use client";

import { Icone } from "@/components/ui/Icones";
import { Bouton, EtatVide } from "@/components/ui";
import { fr } from "@/i18n/fr";
import type { ChampSoap } from "@/services/consultations";
import type { EchelleResume } from "@/services/patients";
import { dateCivile } from "@/components/patients/format";

import { sensDelta, texteDelta, type SensDelta } from "./modele-cockpit";

const ENCRE_SENS: Record<SensDelta, string> = {
  hausse: "text-azure-700",
  baisse: "text-azure-700",
  stable: "text-positive",
  aucune: "text-ink-500",
};

/**
 * Les cinq teintes de tuile, en rotation : la bande se lit comme UN état
 * clinique cohérent, pas comme des cartes sans rapport. Les teintes sont des
 * matériaux d'agrégat (`tuile-*`, opaques, encre `ink-900` par-dessus) —
 * jamais un sens clinique : la polarité d'une échelle est inconnue ici.
 */
const TUILES: readonly string[] = [
  "bg-tuile-menthe border-emeraude-100",
  "bg-tuile-azur border-azure-100",
  "bg-tuile-lavande border-violet-100",
  "bg-tuile-ambre border-ambre-100",
  "bg-tuile-corail border-corail-100",
];

function dateCourte(iso: string): string {
  return dateCivile(iso.slice(0, 10)) ?? iso.slice(0, 10);
}

function BadgeEchelle({ echelle }: { readonly echelle: EchelleResume }): React.JSX.Element {
  const sens = sensDelta(echelle);
  const cockpit = fr.consultation.cockpit;
  if (sens === "aucune") {
    return <span className="font-ui text-label text-ink-500">{cockpit.premiereMesure}</span>;
  }
  const mot =
    sens === "hausse" ? cockpit.hausse : sens === "baisse" ? cockpit.baisse : cockpit.stable;
  const fleche = sens === "hausse" ? "↑" : sens === "baisse" ? "↓" : "→";
  const valeur = texteDelta(echelle.delta);
  return (
    <span className={["font-ui text-label font-semibold tabular-nums", ENCRE_SENS[sens]].join(" ")}>
      <span aria-hidden="true">{fleche} </span>
      {valeur === null ? mot : `${valeur} ${mot}`}
    </span>
  );
}

/**
 * L'état clinique — UNE bande, des tuiles teintées, des valeurs qui dominent.
 *
 * Seules les échelles RÉELLES du dossier alimentent la bande ; les diagnostics
 * vivent dans la colonne patient, pas ici — deux affichages du même fait
 * forceraient la praticienne à vérifier qu'ils disent la même chose.
 * `Inscrire` recopie une phrase factuelle en Objectif via `onInserer`
 * (donc via `saveNote`) : aucune persistance nouvelle, l'écriture reste du texte.
 */
export function EtatClinique({
  echelles,
  modifiable,
  onInserer,
}: {
  readonly echelles: readonly EchelleResume[];
  readonly modifiable: boolean;
  readonly onInserer: (champ: ChampSoap, texte: string) => void;
}): React.JSX.Element {
  const cockpit = fr.consultation.cockpit;

  if (echelles.length === 0) {
    return (
      <section
        aria-label={cockpit.etatTitre}
        className="flex flex-col gap-4 rounded-2xl border border-rule bg-card p-5 shadow-carte"
      >
        <div className="flex items-center gap-3">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-azure-100 bg-tuile-azur text-azure-700 shadow-douce">
            <Icone nom="suivi" taille={20} />
          </span>
          <h2 className="font-ui text-heading font-bold text-ink-900">{cockpit.etatTitre}</h2>
        </div>
        <EtatVide message={cockpit.etatVide} icone="suivi" />
      </section>
    );
  }

  function phraseEchelle(echelle: EchelleResume): string {
    const score = echelle.dernier.score === null ? "" : ` ${String(echelle.dernier.score)}`;
    const lecture =
      echelle.dernier.interpretation === null ? "" : ` (${echelle.dernier.interpretation})`;
    return `${echelle.scaleName} :${score}${lecture}`;
  }

  return (
    <section
      aria-label={cockpit.etatTitre}
      className="flex flex-col gap-4 rounded-2xl border border-rule bg-card p-5 shadow-carte"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-azure-100 bg-tuile-azur text-azure-700 shadow-douce">
            <Icone nom="suivi" taille={20} />
          </span>
          <h2 className="font-ui text-heading font-bold text-ink-900">{cockpit.etatTitre}</h2>
        </div>
        <p className="font-ui text-label tabular-nums text-ink-500">
          {cockpit.echellesTitre} · {String(echelles.length)}
        </p>
      </div>

      <ul className="m-0 grid list-none grid-cols-tuiles-cliniques gap-3 p-0">
        {echelles.map((e, i) => (
          <li
            key={e.scaleCode}
            className={[
              "flex min-w-0 flex-col gap-1 rounded-xl border p-3 shadow-douce",
              "transition duration-quick ease-out",
              TUILES[i % TUILES.length] ?? "bg-tuile-neutre border-rule",
            ].join(" ")}
          >
            <span className="truncate font-ui text-label font-semibold uppercase tracking-label text-ink-500">
              {e.scaleName}
            </span>
            <span className="font-ui text-chiffre font-extrabold tabular-nums tracking-chiffre text-ink-900">
              {e.dernier.score === null ? "–" : String(e.dernier.score)}
            </span>
            <BadgeEchelle echelle={e} />
            <span className="truncate font-ui text-label tabular-nums text-ink-500">
              {[e.dernier.interpretation ?? fr.etats.texteAbsent, dateCourte(e.dernier.date)]
                .filter((m) => m !== "")
                .join(" · ")}
            </span>
            {modifiable ? (
              <span className="mt-1">
                <Bouton
                  rang="discret"
                  onClick={() => onInserer("objective", phraseEchelle(e))}
                  aria-label={`${cockpit.inserer} — ${e.scaleName}`}
                >
                  {cockpit.inserer}
                </Bouton>
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
