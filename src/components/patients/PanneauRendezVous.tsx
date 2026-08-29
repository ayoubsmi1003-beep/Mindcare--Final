/**
 * Les rendez-vous du dossier — une LECTURE, pas une prise de propriété.
 *
 * L'agenda reste propriétaire du rendez-vous : sa création, sa confirmation,
 * son annulation et ses transitions vivent dans ses portes (022, 024, 025) et
 * dans `trg_appt_transition`. Cet écran n'en lit qu'un résumé, et n'offre
 * aucune action qui modifierait un créneau — le geste appartient à l'agenda,
 * où il a le contexte des autres rendez-vous du jour.
 *
 * ⚠️ ACCESSIBLE À L'ACCUEIL. Contrairement au clinique, `app.appointments` a
 * des policies assistante (006) : ce panneau est légitime pour les trois rôles.
 * Ce qui n'y figure pas, en revanche, c'est le MOTIF : il vit dans
 * `app.appointment_reasons`, table séparée sans policy assistante, précisément
 * pour qu'il ne suive pas le rendez-vous (ADR-017). Ne pas l'y ramener.
 */

import { Badge, Carte, EtatVide } from "@/components/ui";
import { fr } from "@/i18n/fr";
import type { PatientWorkspace, RendezVousResume } from "@/services/patients";

import { jourEtHeure } from "./format";

function Rendezvous({
  rdv,
  titre,
}: {
  readonly rdv: RendezVousResume;
  readonly titre: string;
}): React.JSX.Element {
  return (
    <Carte niveau="primaire">
      <h2 className="mb-3 font-ui text-heading font-semibold tracking-heading text-ink-900">
        {titre}
      </h2>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <span className="font-ui text-body text-ink-900">
          {jourEtHeure(rdv.startsAt) ?? fr.etats.texteAbsent}
        </span>
        {/* Le statut porte un TEXTE — jamais la couleur seule. Le libellé vient
            du dictionnaire de l'agenda : un même statut ne doit pas se nommer
            de deux façons selon l'écran qui l'affiche. */}
        <Badge>{fr.agenda.statuts[rdv.status as keyof typeof fr.agenda.statuts] ?? rdv.status}</Badge>
      </div>
      {rdv.practitionerName === null ? null : (
        <p className="mt-2 font-ui text-label tracking-label text-ink-500">
          {rdv.practitionerName}
        </p>
      )}
    </Carte>
  );
}

export function PanneauRendezVous({
  agenda,
}: {
  readonly agenda: PatientWorkspace["agenda"];
}): React.JSX.Element {
  if (agenda.nombreRendezVous === 0) {
    return <EtatVide message={fr.patients.vide.rendezVous} icone="agenda" />;
  }

  return (
    <div className="flex flex-col gap-6">
      {agenda.prochainRendezVous === null ? (
        <EtatVide message={fr.patients.vide.rendezVousAVenir} />
      ) : (
        <Rendezvous
          rdv={agenda.prochainRendezVous}
          titre={fr.patients.sections.prochainRendezVous}
        />
      )}

      {agenda.dernierRendezVous === null ? null : (
        <Rendezvous
          rdv={agenda.dernierRendezVous}
          titre={fr.patients.sections.dernierRendezVous}
        />
      )}

      {/* La chronologie porte l'historique complet et daté : le répéter ici
          produirait deux listes à tenir cohérentes. */}
      <p className="font-ui text-body text-ink-500">
        {fr.patients.rendezVousTotal(agenda.nombreRendezVous)}
      </p>
    </div>
  );
}

/** Le condensé de la vue d'ensemble : la prochaine échéance et rien d'autre. */
export function CarteProchaineEcheance({
  agenda,
  documents,
}: {
  readonly agenda: PatientWorkspace["agenda"];
  readonly documents: PatientWorkspace["documents"];
}): React.JSX.Element {
  const prochain = jourEtHeure(agenda.prochainRendezVous?.startsAt ?? null);

  return (
    <Carte niveau="secondaire">
      <h2 className="mb-4 font-ui text-heading font-semibold tracking-heading text-ink-900">
        {fr.patients.sections.prochaineEcheance}
      </h2>

      <div className="flex flex-col gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="font-ui text-label font-medium tracking-label text-ink-500">
            {fr.patients.sections.prochainRendezVous}
          </span>
          <span
            className={[
              "font-ui text-body",
              prochain === null ? "text-ink-500" : "text-ink-900",
            ].join(" ")}
          >
            {prochain ?? fr.patients.vide.rendezVousAVenir}
          </span>
        </div>

        <div className="flex min-w-0 flex-col gap-1">
          <span className="font-ui text-label font-medium tracking-label text-ink-500">
            {fr.documents.titre}
          </span>
          <span className="font-ui text-body text-ink-900 tabular-nums">
            {fr.patients.documentsTotal(documents.nombre)}
          </span>
        </div>
      </div>
    </Carte>
  );
}
