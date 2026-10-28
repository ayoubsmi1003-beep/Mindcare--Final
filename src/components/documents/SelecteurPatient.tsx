"use client";

/**
 * Le choix du dossier — par `app.search_patients`, jamais autrement.
 *
 * ⚠️ LA PORTE, PAS LA TABLE (règle 6, ADR-019). `SELECT` direct sur
 * `app.patients` est révoqué à tout rôle authentifié depuis 017 : lire un
 * dossier sans laisser de trace n'est pas un manque de rigueur, c'est un
 * `permission denied`. `searchPatients` passe par la porte, qui journalise.
 *
 * ⚠️ ZÉRO RÉSULTAT N'EST PAS ZÉRO PATIENT. La RLS filtre AVANT de compter :
 * la file d'une consœur existe peut-être derrière la cloison. Le message dit
 * donc « visible dans votre périmètre », jamais « aucun dossier ».
 *
 * ⚠️ LA RECHERCHE NE PART PAS AU MONTAGE. Ouvrir l'écran ne doit produire
 * aucune lecture de dossiers que la praticienne n'a pas demandée — c'est la
 * même raison qui met la section Documents de la fiche patient en repli.
 */

import { useCallback, useId, useState } from "react";

import { ListeSuggestions, surligner } from "@/components/recherche/ListeSuggestions";
import { useRechercheInstantane } from "@/components/recherche/use-recherche-instantanee";
import { ChampRecherche } from "@/components/ui";
import { fr } from "@/i18n/fr";
import { recherche } from "@/i18n/recherche";
import { searchPatients, type PatientListItem } from "@/services/patients";

const RESULTATS_MAX = 25;

function chercherPatient(
  q: string,
  limit: number,
  offset: number,
): ReturnType<typeof searchPatients> {
  return searchPatients({ query: q, limit, offset });
}

export function SelecteurPatient({
  onChoisir,
}: {
  readonly onChoisir: (p: PatientListItem) => void;
}): React.JSX.Element {
  const [texte, setTexte] = useState("");
  const [actif, setActif] = useState(0);
  const idListe = useId();

  const { etat, chargerPlus } = useRechercheInstantane<PatientListItem>({
    requete: texte,
    chercher: chercherPatient,
    minimum: 2,
    taille: RESULTATS_MAX,
    cle: (p) => p.id,
  });

  const choisir = useCallback(
    (p: PatientListItem): void => {
      onChoisir(p);
      setTexte("");
      setActif(0);
    },
    [onChoisir],
  );

  const surTouche = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActif((index) => Math.min(index + 1, Math.max(etat.resultats.length - 1, 0)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActif((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      const choisi = etat.resultats[actif];
      if (choisi !== undefined) {
        event.preventDefault();
        choisir(choisi);
      }
    } else if (event.key === "Escape") {
      event.preventDefault();
      setTexte("");
    }
  };

  const actifId =
    etat.resultats.length > 0 ? `${idListe}-option-${actif}` : undefined;

  return (
    <section aria-label={fr.documents.selecteur.titre} className="flex flex-col gap-3">
      <div role="search">
        <ChampRecherche
          libelle={fr.documents.selecteur.rechercher}
          placeholder={fr.documents.selecteur.indication}
          valeur={texte}
          onChange={(valeur) => {
            setTexte(valeur);
            setActif(0);
          }}
          onKeyDown={surTouche}
          ariaExpanded={etat.resultats.length > 0}
          {...(etat.resultats.length > 0 ? { ariaControls: idListe } : {})}
          {...(actifId === undefined ? {} : { ariaActivedescendant: actifId })}
        />
      </div>

      {texte.trim().length === 1 ? (
        <p className="font-ui text-label text-ink-500">{recherche.minimum}</p>
      ) : null}

      {texte.trim().length >= 2 ? (
        <ListeSuggestions
          idListe={idListe}
          items={etat.resultats}
          actif={actif}
          onChoisir={choisir}
          rendre={(p) => (
            <span className="flex flex-wrap items-baseline justify-between gap-2">
              <span>
                {surligner(p.lastName, texte)} {surligner(p.firstName, texte)}
              </span>
              <span className="font-num text-label text-ink-500">{p.recordNumber}</span>
            </span>
          )}
          requete={texte}
          total={etat.total}
          chargement={etat.chargement}
          chargementPlus={etat.chargementPlus}
          erreur={etat.erreur}
          vide={fr.documents.selecteur.aucunResultat}
          onPlus={chargerPlus}
        />
      ) : null}
    </section>
  );
}
