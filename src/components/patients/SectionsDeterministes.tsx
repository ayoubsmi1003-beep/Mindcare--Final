/**
 * Sections DÉTERMINISTES de la vue 360 — zéro IA.
 *
 * · SectionDepuisDerniere : diff factuel depuis la dernière séance/RDV,
 *   calculé depuis les SEULES données du workspace. Une donnée absente n'est
 *   pas « stable », elle est muette.
 * · ListeSignaux : reprise LITTÉRALE des signaux du résumé (préfixe
 *   « À vérifier — » imposé par la passerelle) ; plafond 5 + compte honnête.
 * · PointDeSituation : le repli quand l'IA est indisponible — des données
 *   directes, JAMAIS appelées « résumé ».
 */

import { Badge } from "@/components/ui";
import { Icone } from "@/components/ui";
import { fr } from "@/i18n/fr";
import { dateCivile, jourEtHeure } from "@/components/patients/format";
import type { PatientWorkspace } from "@/services/patients";

// ─────────────────────────────────────────────────────────────────────────────

export function SectionDepuisDerniere({
  espace,
}: {
  readonly espace: PatientWorkspace;
}): React.JSX.Element {
  const ref = referenceDernierContact(espace);
    const faits: { texte: string; date: string }[] = [];
  if (ref !== null) {
    const px = espace.traitements?.dernierePrescription ?? null;
    if (px !== null && px.prescribedAt > ref) {
      faits.push({ texte: fr.patients.sections.dernierePrescription, date: px.prescribedAt });
    }
    if (espace.documents.dernierEmisLe !== null && espace.documents.dernierEmisLe > ref) {
      faits.push({ texte: fr.patients.chronologie.document, date: espace.documents.dernierEmisLe });
    }
    for (const e of espace.clinique?.echelles ?? []) {
      if (e.dernier.date > ref) {
        faits.push({
          texte:
            e.scaleName +
            // Tiret cadratin PROPRE. Il a longtemps ete "â€”" ici :
            // un tiret UTF-8 relu en Latin-1, donc affiche tel quel a l ecran,
            // au milieu du nom d une echelle clinique.
            " — " +
            fr.patients.echelle.dernierScore +
            (e.dernier.score === null ? "" : " " + String(e.dernier.score)),
          date: e.dernier.date,
        });
      }
    }
  }
return (
    <section className="flex flex-col gap-2">
      <h3 className="font-ui text-label tracking-label text-ink-500">
        {fr.patients.depuis.titre}
      </h3>
      {ref === null ? (
        <p className="font-ui text-body text-ink-700">{fr.patients.depuis.sansReference}</p>
      ) : faits.length === 0 ? (
        <p className="font-ui text-body text-ink-700">
          {fr.patients.depuis.rien} {dateCivile(ref.slice(0, 10))}.
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {faits.map((f, i) => (
            <li key={i} className="font-ui text-body text-ink-900">
              <Icone nom="documents" taille={20} className="mr-2 inline align-text-bottom text-action-600" />
              {f.texte}
              <span className="ml-2 font-ui text-label tracking-label tabular-nums text-ink-500">
                {dateCivile(f.date.slice(0, 10))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function referenceDernierContact(espace: PatientWorkspace): string | null {
  const dates = [
    espace.clinique?.derniereConsultation?.startedAt ?? null,
    espace.agenda.dernierRendezVous?.startsAt ?? null,
  ].filter((d): d is string => d !== null);
  if (dates.length === 0) return null;
  return dates.sort().at(-1) ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────

export function ListeSignaux({
  espace,
}: {
  readonly espace: PatientWorkspace;
}): React.JSX.Element {
  // Les points à vérifier ont changé de place entre les deux formes : section
  // `a_discuter` en schéma 1, fondus dans `etat_actuel` en schéma 2 (069).
  // On lit la forme réellement reçue plutôt que de supposer laquelle est là —
  // les anciens résumés restent affichés tant qu'ils n'ont pas été régénérés.
  const contenu = espace.resume?.contenu;
  const items =
    contenu === undefined
      ? []
      : contenu.schema === 2
        ? contenu.etatActuel
        : contenu.aDiscuter;
  // Le total complet vient de la génération ; côté lecture seule, le plafond
  // affiché est honnête : on ne prétend jamais tout montrer sans le savoir.
  const affiches = items.slice(0, 5);

  return (
    <section id="signaux" className="flex flex-col gap-2">
      <h3 className="font-ui text-label tracking-label text-ink-500">
        {fr.patients.signaux.titre}
      </h3>
      {affiches.length === 0 ? (
        <p className="font-ui text-body text-ink-500">{fr.patients.signaux.vide}</p>
      ) : (
        <>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {affiches.map((item, i) => (
              <li key={i} className="font-ui text-body text-ink-900">
                <span className="text-attention">{fr.patients.signaux.prefixe}</span>
                {item.texte.startsWith(fr.patients.signaux.prefixe)
                  ? item.texte.slice(fr.patients.signaux.prefixe.length)
                  : item.texte}
              </li>
            ))}
          </ul>
          {items.length > affiches.length ? (
            <p className="font-ui text-label tracking-label text-ink-500">
              {fr.patients.signaux.autres(items.length - affiches.length)}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export function PointDeSituation({
  espace,
}: {
  readonly espace: PatientWorkspace;
}): React.JSX.Element {
  const px = espace.traitements?.dernierePrescription ?? null;
  const prochain = espace.agenda.prochainRendezVous;

  return (
    <section
      aria-label={fr.patients.resume.pointSituationTitre}
      className="flex flex-col gap-3 rounded-lg border border-rule bg-card px-6 py-5 shadow-lift1"
    >
      <div>
        <h2 className="font-ui text-heading font-semibold tracking-heading text-ink-900">
          {fr.patients.resume.pointSituationTitre}
        </h2>
        <p className="mt-0.5 font-ui text-label tracking-label text-ink-500">
          {fr.patients.resume.pointSituationSousTitre}
        </p>
      </div>

      <dl className="m-0 grid grid-cols-fiche gap-x-8 gap-y-4">
        <div>
          <dt className="font-ui text-label font-medium tracking-label text-ink-500">
            {fr.patients.sections.derniereConsultation}
          </dt>
          <dd className="font-ui text-body tabular-nums text-ink-900">
            {espace.clinique?.derniereConsultation !== null &&
            espace.clinique?.derniereConsultation != null
              ? jourEtHeure(espace.clinique.derniereConsultation.startedAt)
              : "—"}
          </dd>
        </div>

        <div>
          <dt className="font-ui text-label font-medium tracking-label text-ink-500">
            {fr.patients.sections.dernierePrescription}
          </dt>
          <dd className="font-ui text-body tabular-nums text-ink-900">
            {px === null
              ? "—"
              : `${String(px.lignes.length)} · ${jourEtHeure(px.prescribedAt)}`}
          </dd>
        </div>

        <div>
          <dt className="font-ui text-label font-medium tracking-label text-ink-500">
            {fr.patients.sections.prochainRendezVous}
          </dt>
          <dd className="font-ui text-body tabular-nums text-ink-900">
            {prochain === null ? "—" : jourEtHeure(prochain.startsAt)}
          </dd>
        </div>

        <div>
          <dt className="font-ui text-label font-medium tracking-label text-ink-500">
            {fr.patients.sections.echelles}
          </dt>
          <dd className="font-ui text-body tabular-nums text-ink-900">
            {(espace.clinique?.echelles ?? []).length === 0
              ? "—"
              : (espace.clinique?.echelles ?? [])
                  .map((e) => `${e.scaleName} ${String(e.dernier.score ?? "")}`.trim())
                  .join(" · ")}
          </dd>
        </div>
      </dl>
    </section>
  );
}
