/**
 * L'état clinique — diagnostics et échelles.
 *
 * ⚠️ CE PANNEAU N'EST MONTÉ QUE SI `espace.clinique` N'EST PAS `null`. Ce
 * `null` vient de la base : la porte 047 le pose quand `can_see_clinical()`
 * rend faux. Ce n'est PAS un masquage de sécurité côté écran — les
 * sous-requêtes cliniques sont de toute façon filtrées par la RLS et ne
 * rendraient rien. C'est une décision de COMPOSITION : proposer à l'accueil
 * trois onglets structurellement vides serait une mauvaise interface, pas une
 * fuite.
 *
 * ⚠️ AUCUNE MENTION D'ALLERGIE, D'ANTÉCÉDENT PSYCHIATRIQUE OU MÉDICAL. Ces
 * colonnes n'existent nulle part dans le schéma. Afficher « Allergies : non
 * renseignées » prétendrait qu'un champ attend d'être rempli ; ne rien afficher
 * dit la vérité — le produit ne sait pas encore les enregistrer.
 */

import { Badge, Carte, EtatVide } from "@/components/ui";
import { fr } from "@/i18n/fr";
import type { Diagnostic, EchelleResume, PatientWorkspace } from "@/services/patients";

import { dateCivile, ecartLisible, jourLong } from "./format";

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

function LigneDiagnostic({ diagnostic }: { readonly diagnostic: Diagnostic }): React.JSX.Element {
  const debut = dateCivile(diagnostic.onsetDate);
  const fin = dateCivile(diagnostic.resolvedAt);

  return (
    <li className="flex min-w-0 flex-col gap-1 border-b border-rule py-3 last:border-b-0">
      <div className="flex min-w-0 flex-wrap items-baseline gap-2">
        <span className="min-w-0 break-words font-ui text-body font-medium text-ink-900">
          {diagnostic.label}
        </span>
        {/* Le code CIM-10 en annotation discrète : il sert au certificat et à
            la facturation, pas à la lecture clinique courante. */}
        {diagnostic.code === null ? null : (
          <span className="font-ui text-label tracking-label text-ink-500 tabular-nums">
            {diagnostic.codeSystem} {diagnostic.code}
          </span>
        )}
      </div>
      {debut === null && fin === null ? null : (
        <span className="font-ui text-label tracking-label text-ink-500">
          {debut === null ? null : `Depuis le ${debut}`}
          {debut !== null && fin !== null ? " · " : null}
          {fin === null ? null : `Résolu le ${fin}`}
        </span>
      )}
    </li>
  );
}

/**
 * ⚠️ `is_primary` EXISTE EN BASE, MAIS RIEN NE LIMITE SON NOMBRE. Aucune
 * contrainte n'impose au plus un diagnostic principal par patient (009). Le
 * titre « Diagnostic principal » ne s'affiche donc que s'il y en a, et il en
 * liste autant qu'il y en a — au lieu de prendre le premier venu et de le
 * présenter comme LE principal.
 */
export function ListeDiagnostics({
  diagnostics,
}: {
  readonly diagnostics: readonly Diagnostic[];
}): React.JSX.Element {
  if (diagnostics.length === 0) {
    return <EtatVide message={fr.patients.vide.diagnostics} icone="statistiques" />;
  }

  const actifs = diagnostics.filter((d) => d.resolvedAt === null);
  const resolus = diagnostics.filter((d) => d.resolvedAt !== null);
  const principaux = actifs.filter((d) => d.isPrimary);
  const secondaires = actifs.filter((d) => !d.isPrimary);

  return (
    <div className="flex flex-col gap-6">
      {principaux.length === 0 ? null : (
        <section>
          <h3 className="mb-2 font-ui text-label font-medium tracking-label text-ink-500">
            {fr.patients.sections.diagnosticPrincipal}
          </h3>
          <ul className="m-0 list-none p-0">
            {principaux.map((d) => (
              <LigneDiagnostic key={d.id} diagnostic={d} />
            ))}
          </ul>
        </section>
      )}

      {secondaires.length === 0 ? null : (
        <section>
          <h3 className="mb-2 font-ui text-label font-medium tracking-label text-ink-500">
            {principaux.length === 0
              ? fr.patients.sections.diagnostics
              : fr.patients.sections.diagnosticsActifs}
          </h3>
          <ul className="m-0 list-none p-0">
            {secondaires.map((d) => (
              <LigneDiagnostic key={d.id} diagnostic={d} />
            ))}
          </ul>
        </section>
      )}

      {resolus.length === 0 ? null : (
        <section>
          <h3 className="mb-2 font-ui text-label font-medium tracking-label text-ink-500">
            {fr.patients.sections.diagnosticsResolus}
          </h3>
          <ul className="m-0 list-none p-0">
            {resolus.map((d) => (
              <LigneDiagnostic key={d.id} diagnostic={d} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Échelles
// ---------------------------------------------------------------------------

/**
 * ⚠️ PAS DE COURBE, PAS DE FLÈCHE, PAS DE « EN AMÉLIORATION ».
 *
 * Deux points ne font pas une tendance, et la porte n'en rend jamais plus de
 * deux par échelle. Quand il n'y a qu'une mesure, `precedent` et `delta` valent
 * `null` et on l'ÉCRIT — laisser un écart vide donnerait à croire qu'il vaut
 * zéro, ce qui serait un résultat clinique inventé.
 *
 * Le sens d'une variation dépend de l'échelle (baisse favorable sur un PHQ-9,
 * défavorable sur un MMSE) et `scales.scoring` ne porte pas cette direction :
 * on montre le nombre signé, la clinicienne interprète.
 */
export function ListeEchelles({
  echelles,
}: {
  readonly echelles: readonly EchelleResume[];
}): React.JSX.Element {
  if (echelles.length === 0) {
    return <EtatVide message={fr.patients.vide.echelles} icone="suivi" />;
  }

  return (
    <ul className="m-0 flex list-none flex-col gap-3 p-0">
      {echelles.map((e) => {
        const ecart = ecartLisible(e.delta);
        return (
          <li
            key={e.scaleCode}
            className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-6 gap-y-2 rounded-md border border-rule bg-card px-4 py-3"
          >
            <div className="flex min-w-0 flex-col gap-1">
              <span className="min-w-0 break-words font-ui text-body font-medium text-ink-900">
                {e.scaleName}
              </span>
              <span className="font-ui text-label tracking-label text-ink-500">
                {jourLong(e.dernier.date) ?? fr.etats.texteAbsent}
                {e.dernier.interpretation === null
                  ? null
                  : ` · ${e.dernier.interpretation}`}
              </span>
            </div>

            <div className="flex shrink-0 items-baseline gap-4">
              <span className="font-num text-num font-medium tabular-nums text-ink-900">
                {e.dernier.score === null ? fr.etats.texteAbsent : e.dernier.score}
              </span>
              {ecart === null || e.precedent === null ? (
                <span className="font-ui text-label tracking-label text-ink-500">
                  {fr.patients.echelle.mesureUnique}
                </span>
              ) : (
                <span className="font-ui text-label tracking-label text-ink-500 tabular-nums">
                  {fr.patients.echelle.evolution} {ecart}
                </span>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Le panneau complet, et son résumé pour la vue d'ensemble
// ---------------------------------------------------------------------------

export function PanneauClinique({
  clinique,
}: {
  readonly clinique: NonNullable<PatientWorkspace["clinique"]>;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-6">
      <Carte niveau="clinique">
        <h2 className="mb-4 font-ui text-heading font-semibold tracking-heading text-ink-900">
          {fr.patients.sections.diagnostics}
        </h2>
        <ListeDiagnostics diagnostics={clinique.diagnostics} />
      </Carte>

      <Carte niveau="clinique">
        <h2 className="mb-4 font-ui text-heading font-semibold tracking-heading text-ink-900">
          {fr.patients.sections.echelles}
        </h2>
        <ListeEchelles echelles={clinique.echelles} />
      </Carte>
    </div>
  );
}

/** Le condensé de la vue d'ensemble : ce qui tient en un coup d'œil. */
export function CarteContexteClinique({
  clinique,
}: {
  readonly clinique: NonNullable<PatientWorkspace["clinique"]>;
}): React.JSX.Element {
  const principaux = clinique.diagnostics.filter(
    (d) => d.isPrimary && d.resolvedAt === null,
  );
  const actifs = clinique.diagnostics.filter(
    (d) => !d.isPrimary && d.resolvedAt === null,
  );
  const derniereEchelle = clinique.echelles[0];
  const consultation = clinique.derniereConsultation;

  const rienAMontrer =
    clinique.diagnostics.length === 0 &&
    clinique.echelles.length === 0 &&
    consultation === null;

  return (
    <Carte niveau="clinique">
      <h2 className="mb-4 font-ui text-heading font-semibold tracking-heading text-ink-900">
        {fr.patients.sections.contexteClinique}
      </h2>

      {rienAMontrer ? (
        <p className="font-ui text-body text-ink-500">{fr.patients.vide.consultations}</p>
      ) : (
        <div className="flex flex-col gap-4">
          {principaux.length === 0 ? null : (
            <div className="flex min-w-0 flex-col gap-1">
              <span className="font-ui text-label font-medium tracking-label text-ink-500">
                {fr.patients.sections.diagnosticPrincipal}
              </span>
              {principaux.map((d) => (
                <span
                  key={d.id}
                  className="min-w-0 break-words font-ui text-body font-medium text-ink-900"
                >
                  {d.label}
                </span>
              ))}
            </div>
          )}

          {actifs.length === 0 ? null : (
            <div className="flex min-w-0 flex-col gap-2">
              <span className="font-ui text-label font-medium tracking-label text-ink-500">
                {fr.patients.sections.diagnosticsActifs}
              </span>
              <div className="flex flex-wrap gap-2">
                {actifs.map((d) => (
                  <Badge key={d.id}>{d.label}</Badge>
                ))}
              </div>
            </div>
          )}

          {derniereEchelle === undefined ? null : (
            <div className="flex min-w-0 flex-col gap-1">
              <span className="font-ui text-label font-medium tracking-label text-ink-500">
                {derniereEchelle.scaleName}
              </span>
              <span className="font-ui text-body text-ink-900 tabular-nums">
                {derniereEchelle.dernier.score ?? fr.etats.texteAbsent}
                {" · "}
                {jourLong(derniereEchelle.dernier.date) ?? fr.etats.texteAbsent}
              </span>
            </div>
          )}

          {consultation === null ? null : (
            <div className="flex min-w-0 flex-col gap-1">
              <span className="font-ui text-label font-medium tracking-label text-ink-500">
                {fr.patients.sections.derniereConsultation}
              </span>
              <span className="font-ui text-body text-ink-900">
                {jourLong(consultation.startedAt) ?? fr.etats.texteAbsent}
              </span>
            </div>
          )}
        </div>
      )}
    </Carte>
  );
}
