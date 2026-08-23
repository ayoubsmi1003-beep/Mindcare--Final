/**
 * Patients similaires — le garde-fou qui protège sans obstruer.
 *
 * ⚠️ DES RAISONS, JAMAIS UN SCORE. La porte (051) rend un `score` brut qui
 * sert à CLASSER les candidats ; ce composant ne l'affiche jamais. Un
 * pourcentage de ressemblance entre deux êtres humains n'a pas de sens pour
 * qui n'en connaît pas la mécanique — trois libellés factuels, si :
 * « Nom proche », « Même téléphone », « Naissance identique ».
 *
 * ⚠️ LA CORRESPONDANCE FORTE NE BLOQUE RIEN ELLE-MÊME. Elle explique, propose
 * d'ouvrir le dossier existant, et c'est le formulaire qui exige alors la case
 * « Créer malgré tout ». Le refus dur reste en base (050/052, SQLSTATE 23505) ;
 * ici il n'y a que du conseil — c'est ce qui rend ce panneau supportable.
 *
 * « Ouvrir le dossier » reste CALME même sur une correspondance forte : ouvrir
 * l'existant est LE geste sûr, jamais un avertissement.
 */

import {
  Avatar,
  Badge,
  Icone,
  LienBouton,
  PanneauInfo,
} from "@/components/ui";
import { fr } from "@/i18n/fr";
import { doublonFort, type CandidatSimilaire } from "@/services/patients";

export function PanneauSimilaires({
  candidats,
  verification,
  actif,
}: {
  readonly candidats: readonly CandidatSimilaire[];
  readonly verification: boolean;
  /** Faux tant que la saisie n'a pas atteint le seuil de recherche. */
  readonly actif: boolean;
}): React.JSX.Element {
  const forte = candidats.some(doublonFort);

  return (
    <section
      aria-live="polite"
      className="flex flex-col gap-4 rounded-lg border border-rule bg-card px-5 py-5"
    >
      <h2 className="flex items-center gap-2 font-ui text-heading font-semibold tracking-heading text-ink-900">
        <Icone nom="recherche" taille={20} className="text-action-600" />
        {fr.patients.similaires.titre}
      </h2>

      {verification ? (
        <p className="font-ui text-label tracking-label text-ink-500">
          {fr.patients.similaires.verification}
        </p>
      ) : !actif ? null : candidats.length === 0 ? (
        <p className="font-ui text-body text-ink-500">
          {fr.patients.similaires.aucun}
        </p>
      ) : (
        <>
          {forte ? (
            <PanneauInfo titre={fr.patients.similaires.forteTitre} ton="attention">
              {fr.patients.similaires.forteCorps}
            </PanneauInfo>
          ) : null}

          <ul className="m-0 flex list-none flex-col divide-y divide-rule p-0">
            {candidats.map((candidat) => (
              <SimilaireLigne key={candidat.id} candidat={candidat} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function SimilaireLigne({
  candidat,
}: {
  readonly candidat: CandidatSimilaire;
}): React.JSX.Element {
  return (
    <li className="flex items-start justify-between gap-3 py-3">
      <div className="flex min-w-0 items-start gap-3">
        <Avatar prenom={candidat.firstName} nom={candidat.lastName} taille="petite" />
        <div className="min-w-0">
          <p className="truncate font-ui text-body font-medium text-ink-900">
            {candidat.lastName.toUpperCase()} {candidat.firstName}
          </p>
          <p className="truncate font-ui text-label tracking-label tabular-nums text-ink-500">
            #{candidat.recordNumber}
            {candidat.birthDate === null ? "" : ` · ${candidat.birthDate}`} ·{" "}
            {candidat.phone}
          </p>
          <div className="mt-1 flex flex-wrap gap-1">
            {candidat.raisonNom ? (
              <Badge ton="neutre">{fr.patients.similaires.raisonNom}</Badge>
            ) : null}
            {candidat.raisonTelephone ? (
              <Badge ton="information">{fr.patients.similaires.raisonTelephone}</Badge>
            ) : null}
            {candidat.raisonNaissance ? (
              <Badge ton="information">{fr.patients.similaires.raisonNaissance}</Badge>
            ) : null}
          </div>
        </div>
      </div>
      <LienBouton href={`/patients/${candidat.id}`} rang="discret">
        {fr.patients.similaires.ouvrir}
      </LienBouton>
    </li>
  );
}
