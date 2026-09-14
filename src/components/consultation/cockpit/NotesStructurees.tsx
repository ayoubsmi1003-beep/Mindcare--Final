"use client";

import { useState } from "react";

import { Bouton, ChampTexte, ChampZoneTexte } from "@/components/ui";
import { Icone } from "@/components/ui/Icones";
import { fr } from "@/i18n/fr";
import { CHAMPS_SOAP, type ChampSoap } from "@/services/consultations";

import { ajouterPiste } from "./modele-cockpit";

const CLE_FAVORIS = "mindcare.cockpit.favoris";
const LONGUEUR_MAX_FAVORI = 140;

type Favoris = Partial<Record<ChampSoap, readonly string[]>>;

/** La lettre et la teinte active de chaque rubrique — l'onglet actif se voit. */
const ONGLETS: Readonly<
  Record<ChampSoap, { lettre: string; actif: string; pastille: string }>
> = {
  subjective: {
    lettre: "S",
    actif: "border-azure-600 bg-azure-50 text-azure-700",
    pastille: "bg-azure-600",
  },
  objective: {
    lettre: "O",
    actif: "border-emeraude-600 bg-emeraude-50 text-emeraude-700",
    pastille: "bg-emeraude-600",
  },
  assessment: {
    lettre: "E",
    actif: "border-ambre-600 bg-ambre-50 text-ambre-700",
    pastille: "bg-ambre-600",
  },
  plan: {
    lettre: "C",
    actif: "border-violet-600 bg-violet-50 text-violet-700",
    pastille: "bg-violet-600",
  },
};

function lireFavoris(): Favoris {
  if (typeof window === "undefined") return {};
  try {
    const brut = window.localStorage.getItem(CLE_FAVORIS);
    if (brut === null) return {};
    const parsed: unknown = JSON.parse(brut);
    if (typeof parsed !== "object" || parsed === null) return {};
    const sortie: Record<string, readonly string[]> = {};
    for (const champ of CHAMPS_SOAP) {
      const v: unknown = (parsed as Record<string, unknown>)[champ];
      if (Array.isArray(v)) {
        sortie[champ] = v.filter((e): e is string => typeof e === "string").slice(0, 20);
      }
    }
    return sortie;
  } catch {
    return {};
  }
}

/**
 * La note clinique en éditeur à onglets — UNE rubrique visible à la fois.
 *
 * Quatre zones empilées forçaient un mur de textareas identiques ; en onglet,
 * la rubrique active a une vraie surface d'écriture (`lignes=5`) sans allonger
 * la page. Les pistes et `Mes formules` — désormais UNIQUES et liées à
 * l'onglet actif — insèrent via `onChanger`, donc via l'autosave existant :
 * aucune écriture propre. `action` porte l'état d'enregistrement et la
 * signature, à côté du titre qu'ils concernent.
 */
export function NotesStructurees({
  soap,
  onChanger,
  refs,
  micro,
  modifiable,
  libelles,
  action,
}: {
  readonly soap: Record<ChampSoap, string>;
  readonly onChanger: (champ: ChampSoap, v: string) => void;
  readonly refs: Readonly<Record<ChampSoap, React.RefObject<HTMLTextAreaElement | null>>>;
  readonly micro: (champ: ChampSoap) => React.ReactNode;
  readonly modifiable: boolean;
  readonly libelles: Readonly<Record<ChampSoap, { titre: string; indication: string }>>;
  readonly action?: React.ReactNode;
}): React.JSX.Element {
  const cockpit = fr.consultation.cockpit;
  const [actif, setActif] = useState<ChampSoap>("subjective");
  const [favoris, setFavoris] = useState<Favoris>(lireFavoris);
  const [saisieFavori, setSaisieFavori] = useState("");

  function memoriser(): void {
    const propre = saisieFavori.trim().slice(0, LONGUEUR_MAX_FAVORI);
    if (propre === "") return;
    const suivants = [...(favoris[actif] ?? []), propre];
    const etat: Favoris = { ...favoris, [actif]: suivants };
    setFavoris(etat);
    try {
      window.localStorage.setItem(CLE_FAVORIS, JSON.stringify(etat));
    } catch {
      // Stockage indisponible : les favoris vivent en mémoire de session.
    }
    setSaisieFavori("");
  }

  function retirer(texte: string): void {
    const suivants = (favoris[actif] ?? []).filter((f) => f !== texte);
    const etat: Favoris = { ...favoris, [actif]: suivants };
    setFavoris(etat);
    try {
      window.localStorage.setItem(CLE_FAVORIS, JSON.stringify(etat));
    } catch {
      // Stockage indisponible : voir `memoriser`.
    }
  }

  return (
    <section
      aria-label={cockpit.notesTitre}
      className="flex flex-col gap-4 rounded-2xl border border-rule bg-card p-5 shadow-carte"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-action-100 bg-tuile-menthe text-emeraude-700 shadow-douce">
            <Icone nom="documents" taille={20} />
          </span>
          <h2 className="font-ui text-heading font-bold text-ink-900">{cockpit.notesTitre}</h2>
        </div>
        {action ?? null}
      </div>

      <div role="tablist" aria-label={cockpit.notesTitre} className="flex flex-wrap gap-2">
        {CHAMPS_SOAP.map((champ) => {
          const onglet = ONGLETS[champ];
          const estActif = champ === actif;
          const rempli = soap[champ].trim() !== "";
          return (
            <button
              key={champ}
              type="button"
              role="tab"
              aria-selected={estActif}
              onClick={() => {
                setActif(champ);
                setSaisieFavori("");
              }}
              className={[
                "inline-flex min-h-target items-center gap-2 rounded-xl border px-3 py-2",
                "font-ui text-body font-semibold",
                "transition duration-quick ease-out",
                "outline-none focus-visible:outline focus-visible:outline-action-600 focus-visible:outline-offset",
                estActif
                  ? onglet.actif
                  : "border-rule bg-card text-ink-500 hover:border-ink-300 hover:text-ink-900",
              ].join(" ")}
            >
              <span
                aria-hidden="true"
                className={[
                  "inline-flex h-5 w-5 items-center justify-center rounded-md font-ui text-label font-bold",
                  estActif ? "bg-card text-ink-900 shadow-lift1" : `${onglet.pastille} text-on-brand`,
                ].join(" ")}
              >
                {onglet.lettre}
              </span>
              {libelles[champ].titre}
              <span aria-hidden="true" className="font-ui text-label">
                {rempli ? "✓" : ""}
              </span>
            </button>
          );
        })}
      </div>

      {/*
        Toutes les zones restent montées (`hidden`, pas de démontage) : les
        `ref` de dictée doivent survivre au changement d'onglet, et un test
        comme une dictée en vol écrivent dans une référence qui ne doit jamais
        devenir nulle — même motif que la séance montée de la page.
      */}
      {CHAMPS_SOAP.map((champ) => (
        <div
          key={champ}
          hidden={champ !== actif}
          {...(champ === actif ? { role: "tabpanel" } : {})}
          className="flex-col gap-3"
        >
          <ChampZoneTexte
            libelle={libelles[champ].titre}
            indication={libelles[champ].indication}
            valeur={soap[champ]}
            onChange={(v) => onChanger(champ, v)}
            zoneRef={refs[champ]}
            lignes={5}
            clinique
            action={modifiable && champ === actif ? micro(champ) : undefined}
          />
        </div>
      ))}
      <div className="flex flex-col gap-3">
        {modifiable ? (
          <div className="flex flex-wrap gap-2">
            {cockpit.pistes[actif].map((piste) => (
              <Bouton
                key={piste}
                rang="discret"
                onClick={() => onChanger(actif, ajouterPiste(soap[actif], piste))}
              >
                {piste}
              </Bouton>
            ))}
            {(favoris[actif] ?? []).map((f) => (
              <span key={f} className="inline-flex items-center gap-1">
                <Bouton rang="discret" onClick={() => onChanger(actif, ajouterPiste(soap[actif], f))}>
                  {f}
                </Bouton>
                <Bouton
                  rang="discret"
                  onClick={() => retirer(f)}
                  aria-label={`${cockpit.favoriRetirer} — ${f}`}
                >
                  ×
                </Bouton>
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {modifiable ? (
        <div className="flex flex-wrap items-end gap-2 border-t border-rule pt-4">
          <span className="min-w-40 flex-1">
            <ChampTexte
              libelle={`${cockpit.favorisTitre} — ${libelles[actif].titre}`}
              valeur={saisieFavori}
              onChange={setSaisieFavori}
            />
          </span>
          <Bouton rang="discret" onClick={memoriser}>
            {cockpit.favoriMemoriser}
          </Bouton>
        </div>
      ) : null}
    </section>
  );
}
