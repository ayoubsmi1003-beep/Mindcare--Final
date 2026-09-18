/**
 * Bandeau « Aujourd'hui » — pourquoi ce dossier est pertinent MAINTENANT.
 *
 * ⚠️ 100 % DONNÉES. Les chips viennent de `espace.rendezVousDuJour` (porte
 * 053, bornes Africa/Algiers) ; une liste vide dit « aucun RDV aujourd'hui »
 * et, si la base en connaît un, la prochaine échéance. Le chip Résumé reflète
 * l'état réel (à jour / modifié depuis / absent). Rien d'inventé, jamais.
 */

import { Badge } from "@/components/ui";
import { Icone } from "@/components/ui";
import { SiriOrb } from "@/components/ui/siri-orb";
import { fr } from "@/i18n/fr";
import { heure } from "@/components/patients/format";
import type { PatientWorkspace, RendezVousResume } from "@/services/patients";

function libelleRdv(r: RendezVousResume): string {
  const kind =
    r.kind !== null &&
    typeof r.kind === "string" &&
    r.kind in fr.agenda.types
      ? fr.agenda.types[r.kind as keyof typeof fr.agenda.types]
      : null;
  const statut = fr.agenda.statuts[r.status as keyof typeof fr.agenda.statuts];
  return [
    heure(r.startsAt),
    kind,
    typeof statut === "string" ? statut : r.status,
  ]
    .filter((x) => x !== null && x !== "")
    .join(" · ");
}

export function BandeauAujourdhui({
  espace,
}: {
  readonly espace: PatientWorkspace;
}): React.JSX.Element {
  const rdvs = espace.rendezVousDuJour;
  const prochain = espace.agenda.prochainRendezVous;

  // Chip résumé — trois états lisibles, calculés par la BASE (`a_jour`).
  const resumeChip =
    espace.resume === null ? (
      <span className="inline-flex items-center gap-1.5 font-ui text-label tracking-label text-ink-500">
        <span aria-hidden className="inline-flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded-full">
          <SiriOrb
            size="20px"
            animationDuration={18}
          />
        </span>
        {fr.patients.resume.videTitre}
      </span>
    ) : espace.resume.aJour ? (
      <span className="inline-flex items-center gap-1.5 font-ui text-label tracking-label text-positive">
        <Icone nom="suivi" taille={20} />
        {fr.patients.resume.aJour}
      </span>
    ) : (
      <span className="inline-flex items-center gap-1.5 font-ui text-label tracking-label text-attention-ink">
        <span aria-hidden className="inline-flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded-full">
          <SiriOrb
            size="20px"
            animationDuration={18}
          />
        </span>
        {fr.patients.resume.modifieDepuis}
      </span>
    );

  return (
    <section
      aria-label={fr.patients.aujourdhui.titre}
      className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-rule bg-sunken px-4 py-3"
    >
      <span className="font-ui text-label tracking-label text-ink-500">
        {fr.patients.aujourdhui.titre}
      </span>

      {rdvs.length === 0 ? (
        <span className="font-ui text-body text-ink-700">
          {fr.patients.aujourdhui.aucun}
          {prochain !== null && (
            <>
              {" · "}
              {fr.patients.aujourdhui.prochain}{" "}
              {libelleRdv(prochain)}
            </>
          )}
        </span>
      ) : (
        rdvs.map((r) => (
          <Badge key={r.id} ton={r.status === "arrived" || r.status === "in_session" ? "positif" : "information"}>
            {libelleRdv(r)}
          </Badge>
        ))
      )}

      <span aria-hidden className="hidden grow tablet:block" />

      {resumeChip}
    </section>
  );
}
