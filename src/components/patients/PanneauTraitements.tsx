/**
 * Les traitements — UN HISTORIQUE DE PRESCRIPTIONS, PAS UN ÉTAT MÉDICAMENTEUX.
 *
 * ⚠️ LE MOT « ACTIF » N'APPARAÎT NULLE PART ICI, ET C'EST LA CONTRAINTE
 * CENTRALE DE CE FICHIER.
 *
 * `app.prescription_lines` (009) n'a ni `stopped_at`, ni statut, ni date de
 * fin autre que `duration_days` — une durée PRESCRITE, qui ne dit pas si la
 * patiente a pris le traitement, l'a arrêté, ou si la praticienne l'a
 * renouvelé hors système. L'ordonnance est d'ailleurs MANUSCRITE au mois 1
 * (`is_handwritten` vaut `true` par défaut) : la base enregistre qu'une
 * ordonnance a été rédigée, pas ce que la patiente prend aujourd'hui.
 *
 * Écrire « Traitement en cours : Sertraline 50 mg » serait donc une AFFIRMATION
 * CLINIQUE que rien ne soutient — et elle serait lue pendant une consultation,
 * au moment de décider d'une posologie. On écrit « Dernière prescription », qui
 * est exactement ce que la base sait.
 *
 * Le module Traitements, plus tard, portera le vrai cycle de vie. Patients
 * n'en montre que le CONTEXTE, et n'en prend pas la propriété.
 */

import { Badge, Carte, EtatVide } from "@/components/ui";
import { fr } from "@/i18n/fr";
import type { PatientWorkspace, PrescriptionResume } from "@/services/patients";

import { jourLong } from "./format";

function LignePosologie({
  ligne,
}: {
  readonly ligne: PrescriptionResume["lignes"][number];
}): React.JSX.Element {
  // Fréquence et durée arrivent en nombres nus : sans unité, « 2 · 30 » ne
  // veut rien dire. Les segments absents disparaissent au lieu de laisser des
  // séparateurs orphelins.
  const details = [
    ligne.dose,
    ligne.frequencyPerDay === null
      ? null
      : `${String(ligne.frequencyPerDay)} ${fr.patients.traitements.parJour}`,
    ligne.durationDays === null
      ? null
      : `${fr.patients.traitements.duree} ${String(ligne.durationDays)} ${fr.patients.traitements.jours}`,
  ].filter((d): d is string => d !== null && d !== "");

  return (
    <li className="flex min-w-0 flex-col gap-1 border-b border-rule py-3 last:border-b-0">
      <div className="flex min-w-0 flex-wrap items-baseline gap-2">
        <span className="min-w-0 break-words font-ui text-body font-medium text-ink-900">
          {/* `designation` est la DCI du référentiel, ou le texte libre saisi
              quand la molécule n'y figure pas. Les deux sont légitimes. */}
          {ligne.designation ?? fr.etats.texteAbsent}
        </span>
        {ligne.brandName === null ? null : (
          <span className="font-ui text-label tracking-label text-ink-500">
            {ligne.brandName}
          </span>
        )}
      </div>

      {details.length === 0 ? null : (
        <span className="font-ui text-label tracking-label text-ink-500">
          {details.join(" · ")}
        </span>
      )}

      {ligne.instructions === null || ligne.instructions === "" ? null : (
        <span className="min-w-0 break-words font-ui text-notes text-ink-700">
          {ligne.instructions}
        </span>
      )}
    </li>
  );
}

function BlocPrescription({
  prescription,
}: {
  readonly prescription: PrescriptionResume;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <span className="font-ui text-body text-ink-700">
          {jourLong(prescription.prescribedAt) ?? fr.etats.texteAbsent}
          {prescription.practitionerName === null
            ? null
            : ` · ${prescription.practitionerName}`}
        </span>
        {/* Une information de FORME, pas de statut : elle dit où se trouve
            l'original, ce qui compte quand la patiente la réclame. */}
        {prescription.isHandwritten ? (
          <Badge>{fr.patients.traitements.manuscrite}</Badge>
        ) : null}
      </div>

      {prescription.lignes.length === 0 ? (
        <p className="font-ui text-body text-ink-500">{fr.patients.vide.prescriptions}</p>
      ) : (
        <ul className="m-0 list-none p-0">
          {prescription.lignes.map((l) => (
            <LignePosologie key={l.id} ligne={l} />
          ))}
        </ul>
      )}
    </div>
  );
}

export function PanneauTraitements({
  traitements,
}: {
  readonly traitements: NonNullable<PatientWorkspace["traitements"]>;
}): React.JSX.Element {
  const derniere = traitements.dernierePrescription;

  if (derniere === null) {
    return <EtatVide message={fr.patients.vide.prescriptions} />;
  }

  // Combien d'autres existent, sans les charger. La porte agrégée rend la
  // DERNIÈRE prescription et le COMPTE : afficher un historique complet
  // demanderait une porte de plus, donc une trace d'audit de plus, pour une
  // information que la chronologie porte déjà.
  const autres = traitements.nombrePrescriptions - 1;

  return (
    <div className="flex flex-col gap-6">
      <Carte niveau="clinique">
        <h2 className="mb-4 font-ui text-heading font-semibold tracking-heading text-ink-900">
          {fr.patients.sections.dernierePrescription}
        </h2>
        <BlocPrescription prescription={derniere} />
      </Carte>

      {autres <= 0 ? null : (
        <p className="font-ui text-body text-ink-500">
          {fr.patients.traitements.autresPrescriptions(autres)}
        </p>
      )}
    </div>
  );
}
