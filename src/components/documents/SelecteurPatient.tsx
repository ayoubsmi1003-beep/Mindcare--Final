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

import { useCallback, useState } from "react";

import { Bouton, ChampTexte, EtatVide, Squelette } from "@/components/ui";
import { fr } from "@/i18n/fr";
import { searchPatients, type PatientListItem } from "@/services/patients";

const RESULTATS_MAX = 12;

export function SelecteurPatient({
  onChoisir,
}: {
  readonly onChoisir: (p: PatientListItem) => void;
}): React.JSX.Element {
  const [texte, setTexte] = useState("");
  const [resultats, setResultats] = useState<readonly PatientListItem[] | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | undefined>(undefined);

  const chercher = useCallback(async () => {
    const q = texte.trim();
    if (q === "") return;

    setEnCours(true);
    setErreur(undefined);
    const r = await searchPatients({ query: q, limit: RESULTATS_MAX });
    setEnCours(false);

    if (!r.ok) {
      setErreur(r.error.message);
      setResultats(null);
      return;
    }
    setResultats(r.data.rows);
  }, [texte]);

  return (
    <section aria-label={fr.documents.selecteur.titre} className="flex flex-col gap-3">
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void chercher();
        }}
      >
        <div className="flex-1">
          <ChampTexte
            libelle={fr.documents.selecteur.rechercher}
            indication={fr.documents.selecteur.indication}
            valeur={texte}
            onChange={setTexte}
          />
        </div>
        <Bouton rang="secondaire" type="submit" disabled={texte.trim() === ""}>
          {fr.documents.selecteur.lancerRecherche}
        </Bouton>
      </form>

      {erreur === undefined ? null : (
        <p role="alert" className="font-ui text-body text-critical">
          {erreur}
        </p>
      )}

      {enCours ? <Squelette lignes={3} /> : null}

      {!enCours && resultats !== null && resultats.length === 0 ? (
        <EtatVide message={fr.documents.selecteur.aucunResultat} />
      ) : null}

      {!enCours && resultats !== null && resultats.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {resultats.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => onChoisir(p)}
                className={[
                  "flex w-full items-baseline justify-between gap-3 rounded-md px-3 py-2",
                  "text-left font-ui text-body text-ink-900 transition-colors",
                  "duration-quick ease-out hover:bg-brand-50",
                  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
                  "focus-visible:outline-action-600",
                ].join(" ")}
              >
                <span>
                  {p.lastName} {p.firstName}
                </span>
                <span className="font-num text-label text-ink-500">{p.recordNumber}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
