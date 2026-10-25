/**
 * L'état clinique — diagnostics et échelles.
 *
 * L'historique des échelles est lu à l'ouverture de CET onglet, par la porte
 * `get_scale_history` qui journalise. Le workspace ne porte que deux lignes par
 * échelle : les afficher comme si elles étaient l'histoire complète rendait le
 * delta ambigu et masquait l'item de risque. Ici, la dernière et la précédente
 * viennent de la même source autoritaire, avec leur heure.
 */

"use client";

import { useEffect, useState } from "react";

import { Badge, Carte, EtatVide, PastilleIcone } from "@/components/ui";
import { fr } from "@/i18n/fr";
import {
  historiqueEchelles,
  listerEchelles,
  type AdministrationEchelle,
  type EchelleDisponible,
} from "@/services/scales";
import type { Diagnostic, EchelleResume, PatientWorkspace } from "@/services/patients";

import { dateCivile, ecartLisible, jourEtHeure } from "./format";

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

function LigneDiagnostic({ diagnostic }: { readonly diagnostic: Diagnostic }): React.JSX.Element {
  const debut = dateCivile(diagnostic.onsetDate);
  const fin = dateCivile(diagnostic.resolvedAt);
  const actif = diagnostic.resolvedAt === null;

  return (
    <li className="flex min-w-0 flex-col gap-1 border-b border-rule py-3 last:border-b-0">
      <div className="flex min-w-0 flex-wrap items-baseline gap-2">
        <span className="min-w-0 break-words font-ui text-body font-semibold text-ink-900">
          {diagnostic.label}
        </span>
        {diagnostic.isPrimary ? <Badge ton="information">{fr.patients.sections.diagnosticPrincipal}</Badge> : null}
        <Badge ton={actif ? "positif" : "neutre"}>{actif ? "Actif" : "Résolu"}</Badge>
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

export function ListeDiagnostics({ diagnostics }: { readonly diagnostics: readonly Diagnostic[] }): React.JSX.Element {
  if (diagnostics.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-xl bg-sunken px-4 py-3">
        <PastilleIcone nom="statistiques" ton="neutre" />
        <p className="m-0 font-ui text-body text-ink-700">Aucun diagnostic n’est consigné dans ce dossier.</p>
      </div>
    );
  }

  const actifs = diagnostics.filter((diagnostic) => diagnostic.resolvedAt === null);
  const resolus = diagnostics.filter((diagnostic) => diagnostic.resolvedAt !== null);
  const principaux = actifs.filter((diagnostic) => diagnostic.isPrimary);
  const secondaires = actifs.filter((diagnostic) => !diagnostic.isPrimary);

  return (
    <div className="flex flex-col gap-5">
      {principaux.length === 0 ? null : (
        <section>
          <h3 className="mb-2 font-ui text-label font-semibold tracking-label text-ink-500">
            {fr.patients.sections.diagnosticPrincipal}
          </h3>
          <ul className="m-0 list-none p-0">
            {principaux.map((diagnostic) => <LigneDiagnostic key={diagnostic.id} diagnostic={diagnostic} />)}
          </ul>
        </section>
      )}
      {secondaires.length === 0 ? null : (
        <section>
          <h3 className="mb-2 font-ui text-label font-semibold tracking-label text-ink-500">
            {principaux.length === 0 ? fr.patients.sections.diagnostics : fr.patients.sections.diagnosticsActifs}
          </h3>
          <ul className="m-0 list-none p-0">
            {secondaires.map((diagnostic) => <LigneDiagnostic key={diagnostic.id} diagnostic={diagnostic} />)}
          </ul>
        </section>
      )}
      {resolus.length === 0 ? null : (
        <section>
          <h3 className="mb-2 font-ui text-label font-semibold tracking-label text-ink-500">
            {fr.patients.sections.diagnosticsResolus}
          </h3>
          <ul className="m-0 list-none p-0">
            {resolus.map((diagnostic) => <LigneDiagnostic key={diagnostic.id} diagnostic={diagnostic} />)}
          </ul>
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Échelles
// ---------------------------------------------------------------------------

interface EchelleLigne {
  readonly scaleCode: string;
  readonly scaleName: string;
  readonly latest: AdministrationEchelle;
  readonly previous: AdministrationEchelle | null;
  readonly definition: EchelleDisponible | undefined;
}

function lignesDepuisHistorique(
  historique: readonly AdministrationEchelle[],
  definitions: readonly EchelleDisponible[],
): EchelleLigne[] {
  const byCode = new Map<string, AdministrationEchelle[]>();
  for (const administration of [...historique].sort((a, b) => b.administeredAt.localeCompare(a.administeredAt) || b.id.localeCompare(a.id))) {
    const list = byCode.get(administration.scaleCode) ?? [];
    list.push(administration);
    byCode.set(administration.scaleCode, list);
  }
  const definitionByCode = new Map(definitions.map((definition) => [definition.code, definition]));
  return [...byCode.entries()].flatMap(([scaleCode, list]) => {
    const latest = list[0];
    if (latest === undefined) return [];
    return [{
      scaleCode,
      scaleName: latest.scaleName,
      latest,
      previous: list[1] ?? null,
      definition: definitionByCode.get(scaleCode),
    }];
  });
}

function risqueDe(ligne: EchelleLigne): { readonly texte: string; readonly message: string } | null {
  const definition = ligne.definition;
  if (definition === undefined) return null;
  for (const item of definition.items) {
    if (item.risque !== true) continue;
    const value = ligne.latest.responses[item.id];
    if (typeof value === "number" && value > 0) {
      return { texte: item.texte, message: item.alerte ?? `Réponse positive à « ${item.texte} » — à explorer cliniquement.` };
    }
  }
  return null;
}

function LigneEchelle({ ligne }: { readonly ligne: EchelleLigne }): React.JSX.Element {
  const score = ligne.latest.total;
  const max = ligne.definition?.scoring.max ?? null;
  const precedent = ligne.previous?.total ?? null;
  const delta = score === null || precedent === null ? null : score - precedent;
  const risk = risqueDe(ligne);
  return (
    <li className="flex flex-col gap-2 border-b border-rule py-4 first:pt-0 last:border-b-0 last:pb-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="min-w-0 break-words font-ui text-body font-semibold text-ink-900">{ligne.scaleName}</span>
        <span className="font-ui text-label tabular-nums text-ink-500">
          {jourEtHeure(ligne.latest.administeredAt) ?? fr.etats.texteAbsent}
        </span>
      </div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-ui text-chiffre font-extrabold tabular-nums tracking-chiffre text-ink-900">
          {score === null ? fr.etats.texteAbsent : String(score)}
          {max === null ? null : <span className="font-ui text-label font-medium text-ink-500">/{String(max)}</span>}
        </span>
        {ligne.latest.interpretation === null ? null : (
          <span className="font-ui text-body font-medium text-ink-700">{ligne.latest.interpretation}</span>
        )}
        {delta === null ? (
          <span className="font-ui text-label text-ink-500">
            {ligne.previous === null ? fr.patients.echelle.mesureUnique : "Mesure précédente non chiffrée"}
          </span>
        ) : (
          <span className="font-ui text-label tabular-nums text-ink-700">
            Écart {ecartLisible(delta)} par rapport au {jourEtHeure(ligne.previous?.administeredAt ?? null) ?? "résultat précédent"}
          </span>
        )}
      </div>
      {risk === null ? null : (
        <div className="flex flex-col gap-1 rounded-xl border border-attention bg-attention-bg px-3 py-2">
          <span className="font-ui text-label font-semibold text-attention-ink">Item de risque positif</span>
          <span className="font-ui text-label text-ink-700">{risk.message}</span>
        </div>
      )}
    </li>
  );
}

export function ListeEchelles({
  echelles,
  historique,
  definitions,
  erreurHistorique,
}: {
  readonly echelles: readonly EchelleResume[];
  readonly historique: readonly AdministrationEchelle[] | null;
  readonly definitions: readonly EchelleDisponible[];
  readonly erreurHistorique: string | undefined;
}): React.JSX.Element {
  if (historique === null && echelles.length === 0) {
    return <EtatVide message={fr.patients.vide.echelles} icone="suivi" />;
  }
  const lignes = historique === null ? [] : lignesDepuisHistorique(historique, definitions);

  return (
    <div className="flex flex-col gap-3">
      {erreurHistorique === undefined ? null : (
        <p className="m-0 font-ui text-label text-attention-ink">
          Impossible de vérifier l’historique complet des échelles pour le moment ; les deux dernières valeurs du dossier restent affichées.
        </p>
      )}
      {historique === null ? (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {echelles.map((echelle) => (
            <li key={echelle.scaleCode} className="flex flex-wrap items-baseline justify-between gap-3 rounded-xl bg-sunken px-4 py-3">
              <div className="flex flex-col gap-1">
                <span className="font-ui text-body font-semibold text-ink-900">{echelle.scaleName}</span>
                <span className="font-ui text-label text-ink-500">{jourEtHeure(echelle.dernier.date) ?? fr.etats.texteAbsent} · {echelle.dernier.interpretation ?? fr.etats.texteAbsent}</span>
              </div>
              <span className="font-ui text-chiffre font-extrabold tabular-nums text-ink-900">{echelle.dernier.score ?? fr.etats.texteAbsent}</span>
            </li>
          ))}
        </ul>
      ) : lignes.length === 0 ? (
        <EtatVide message={fr.patients.vide.echelles} icone="suivi" />
      ) : (
        <ul className="m-0 flex list-none flex-col p-0">
          {lignes.map((ligne) => <LigneEchelle key={ligne.scaleCode} ligne={ligne} />)}
        </ul>
      )}

      {historique === null || historique.length === 0 ? null : (
        <details className="border-t border-rule pt-3">
          <summary className="cursor-pointer font-ui text-label font-medium text-ink-500">Historique complet</summary>
          <ul className="m-0 mt-3 flex list-none flex-col divide-y divide-rule p-0">
            {[...historique].sort((a, b) => b.administeredAt.localeCompare(a.administeredAt)).map((item) => (
              <li key={item.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2">
                <span className="font-ui text-label font-medium text-ink-900">{item.scaleName}</span>
                <span className="font-ui text-label tabular-nums text-ink-500">
                  {jourEtHeure(item.administeredAt) ?? fr.etats.texteAbsent}
                  {" · "}
                  {item.total === null ? fr.etats.texteAbsent : String(item.total)}
                  {item.interpretation === null ? "" : ` · ${item.interpretation}`}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Le panneau complet
// ---------------------------------------------------------------------------

export function EchellesPatient({
  clinique,
  patientId,
}: {
  readonly clinique: NonNullable<PatientWorkspace["clinique"]>;
  readonly patientId: string;
}): React.JSX.Element {
  const [definitions, setDefinitions] = useState<readonly EchelleDisponible[]>([]);
  const [historique, setHistorique] = useState<readonly AdministrationEchelle[] | null>(null);
  const [erreurHistorique, setErreurHistorique] = useState<string | undefined>(undefined);

  useEffect(() => {
    let active = true;
    void Promise.all([listerEchelles(), historiqueEchelles(patientId)]).then(([definitionsResult, historyResult]) => {
      if (!active) return;
      if (definitionsResult.ok) setDefinitions(definitionsResult.data);
      if (historyResult.ok) {
        setHistorique(historyResult.data);
        setErreurHistorique(undefined);
      } else {
        setHistorique([]);
        setErreurHistorique(historyResult.error.message);
      }
    });
    return () => { active = false; };
  }, [patientId]);

  return (
    <ListeEchelles
      echelles={clinique.echelles}
      historique={historique}
      definitions={definitions}
      erreurHistorique={erreurHistorique}
    />
  );
}

export function PanneauClinique({
  clinique,
  patientId,
}: {
  readonly clinique: NonNullable<PatientWorkspace["clinique"]>;
  readonly patientId: string;
}): React.JSX.Element {
  return (
    <div className="grid gap-5 desktop:grid-cols-clinique">
      <Carte niveau="clinique">
        <div className="flex flex-col gap-4 p-5">
          <h2 className="m-0 font-ui text-heading font-semibold tracking-heading text-ink-900">
            {fr.patients.sections.diagnostics}
          </h2>
          <ListeDiagnostics diagnostics={clinique.diagnostics} />
        </div>
      </Carte>
      <Carte niveau="clinique">
        <div className="flex flex-col gap-4 p-5">
          <h2 className="m-0 font-ui text-heading font-semibold tracking-heading text-ink-900">
            {fr.patients.sections.echelles}
          </h2>
          <EchellesPatient clinique={clinique} patientId={patientId} />
        </div>
      </Carte>
    </div>
  );
}

/** Le condensé de la vue d'ensemble : ce qui tient en un coup d'œil. */
export function CarteContexteClinique({ clinique }: { readonly clinique: NonNullable<PatientWorkspace["clinique"]> }): React.JSX.Element {
  const principaux = clinique.diagnostics.filter((diagnostic) => diagnostic.isPrimary && diagnostic.resolvedAt === null);
  const actifs = clinique.diagnostics.filter((diagnostic) => !diagnostic.isPrimary && diagnostic.resolvedAt === null);
  const derniereEchelle = clinique.echelles[0];
  const rienAMontrer = clinique.diagnostics.length === 0 && clinique.echelles.length === 0 && clinique.derniereConsultation === null;

  return (
    <Carte niveau="clinique">
      <div className="flex flex-col gap-4 p-5">
        <h2 className="m-0 font-ui text-heading font-semibold tracking-heading text-ink-900">
          {fr.patients.sections.contexteClinique}
        </h2>
        {rienAMontrer ? (
          <p className="m-0 font-ui text-body text-ink-500">{fr.patients.vide.consultations}</p>
        ) : (
          <div className="flex flex-col gap-4">
            {principaux.length === 0 ? null : (
              <div className="flex min-w-0 flex-col gap-1">
                <span className="font-ui text-label font-medium tracking-label text-ink-500">{fr.patients.sections.diagnosticPrincipal}</span>
                {principaux.map((diagnostic) => (
                  <span key={diagnostic.id} className="min-w-0 break-words font-ui text-body font-medium text-ink-900">{diagnostic.label}</span>
                ))}
              </div>
            )}
            {actifs.length === 0 ? null : (
              <div className="flex min-w-0 flex-col gap-2">
                <span className="font-ui text-label font-medium tracking-label text-ink-500">{fr.patients.sections.diagnosticsActifs}</span>
                <div className="flex flex-wrap gap-2">
                  {actifs.map((diagnostic) => <Badge key={diagnostic.id}>{diagnostic.label}</Badge>)}
                </div>
              </div>
            )}
            {derniereEchelle === undefined ? null : (
              <div className="flex min-w-0 flex-col gap-1">
                <span className="font-ui text-label font-medium tracking-label text-ink-500">{derniereEchelle.scaleName}</span>
                <span className="font-ui text-body text-ink-900 tabular-nums">
                  {derniereEchelle.dernier.score ?? fr.etats.texteAbsent} · {jourEtHeure(derniereEchelle.dernier.date) ?? fr.etats.texteAbsent}
                </span>
              </div>
            )}
            {clinique.derniereConsultation === null ? null : (
              <div className="flex min-w-0 flex-col gap-1">
                <span className="font-ui text-label font-medium tracking-label text-ink-500">{fr.patients.sections.derniereConsultation}</span>
                <span className="font-ui text-body text-ink-900">{jourEtHeure(clinique.derniereConsultation.startedAt) ?? fr.etats.texteAbsent}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </Carte>
  );
}
