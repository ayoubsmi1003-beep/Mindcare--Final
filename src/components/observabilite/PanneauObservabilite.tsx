/**
 * `PanneauObservabilite` — M09 reliquat LOT5 · inspection en lecture seule.
 *
 * ═══ CE QUE C'EST ═══
 * Trois sections (activité/durées, runs live, runs replay) lues par les
 * portes (`observabilite-lecture.ts`), jamais en direct. Read-only strict :
 * aucun bouton n'écrit, ne confirme, ne rejoue — l'observabilité n'est
 * jamais une source de vérité clinique, seulement une vitre.
 *
 * ═══ CE QUI NE S'AFFICHE JAMAIS ═══
 * Ni texte patient, ni args/résultats d'outils, ni extraits : les portes ne
 * les rendent pas, et ce panneau ne saurait pas les afficher. Les
 * identifiants de runs (UUID aléatoires de lignes de métriques, sans lien
 * patient, cloisonnés par la RLS) s'affichent tronqués (8 caractères,
 * complet en infobulle) ; le complet ne vit qu'en mémoire pour l'appel
 * de détail, jamais dans un log.
 */

"use client";

import { useCallback, useEffect, useState } from "react";

import { fr } from "@/i18n/fr";
import { m09 } from "@/i18n/m09";
import { court, formaterDate, formaterDuree } from "./formats";import {
  lireHistoriqueLive,
  lireHistoriqueReplay,
  lireStatsObservabilite,
  listerRunsLive,
  listerRunsReplay,
  type EnteteLive,
  type EnteteReplay,
  type HistoriqueLive,
  type HistoriqueReplay,
  type StatsObservabilite,
} from "@/services/observabilite-lecture";
import { BandeauHorsLigne, BlocErreur, Bouton, EtatVide, Squelette } from "@/components/ui";
import { LienBouton } from "@/components/ui/Bouton";
import { Carte } from "@/components/ui/Surfaces";

type EtatSection<T> =
  | { readonly phase: "chargement" }
  | { readonly phase: "erreur"; readonly message: string }
  | { readonly phase: "pret"; readonly donnees: T };

function useSection<T>(charger: () => Promise<T>): [EtatSection<T>, () => void] {
  const [etat, setEtat] = useState<EtatSection<T>>({ phase: "chargement" });
  const recharger = useCallback(() => {
    setEtat({ phase: "chargement" });
    void charger().then(
      (donnees) => setEtat({ phase: "pret", donnees }),
      (erreur: unknown) =>
        setEtat({
          phase: "erreur",
          message: erreur instanceof Error ? erreur.message : m09.observabilite.indisponible,
        }),
    );
  }, [charger]);
  useEffect(() => {
    recharger();
  }, [recharger]);
  return [etat, recharger];
}

function SectionStats(): React.JSX.Element {
  const charger = useCallback(async (): Promise<StatsObservabilite> => {
    const r = await lireStatsObservabilite(30);
    if (!r.ok) throw new Error(r.error.message);
    return r.data;
  }, []);
  const [etat, recharger] = useSection(charger);

  if (etat.phase === "chargement") return <Squelette lignes={3} />;
  if (etat.phase === "erreur")
    return (
      <BlocErreur
        message={etat.message}
        action={
          <Bouton rang="secondaire" onClick={recharger}>
            {fr.actions.reessayer}
          </Bouton>
        }
      />
    );
  const stats = etat.donnees;
  if (stats.live.runs === 0 && stats.replay.runs === 0)
    return <EtatVide message={m09.ecran.videStats} />;
  return (
    <dl className="grid grid-cols-2 gap-4 lg:grid-cols-3">
      <div>
        <dt className="font-ui text-label text-ink-500">{m09.ecran.runsLive}</dt>
        <dd className="font-ui text-heading font-semibold text-ink-900 tabular-nums">
          {String(stats.live.runs)}
        </dd>
      </div>
      <div>
        <dt className="font-ui text-label text-ink-500">
          {m09.ecran.colonneDuree} · {m09.ecran.p50}
        </dt>
        <dd className="font-ui text-heading font-semibold text-ink-900 tabular-nums">
          {formaterDuree(stats.live.p50Ms)}
        </dd>
      </div>
      <div>
        <dt className="font-ui text-label text-ink-500">
          {m09.ecran.colonneDuree} · {m09.ecran.p95}
        </dt>
        <dd className="font-ui text-heading font-semibold text-ink-900 tabular-nums">
          {formaterDuree(stats.live.p95Ms)}
        </dd>
      </div>
      <div>
        <dt className="font-ui text-label text-ink-500">{m09.ecran.runsReplay}</dt>
        <dd className="font-ui text-heading font-semibold text-ink-900 tabular-nums">
          {String(stats.replay.runs)}
        </dd>
      </div>
      <div>
        <dt className="font-ui text-label text-ink-500">{m09.ecran.colonnePass}</dt>
        <dd className="font-ui text-heading font-semibold text-ink-900 tabular-nums">
          {String(stats.replay.pass)}
        </dd>
      </div>
      <div>
        <dt className="font-ui text-label text-ink-500">{m09.ecran.colonneFail}</dt>
        <dd className="font-ui text-heading font-semibold text-ink-900 tabular-nums">
          {String(stats.replay.fail)}
        </dd>
      </div>
    </dl>
  );
}

function DetailLive({ runId }: { readonly runId: string }): React.JSX.Element {
  const charger = useCallback(async (): Promise<HistoriqueLive> => {
    const r = await lireHistoriqueLive(runId);
    if (!r.ok) throw new Error(r.error.message);
    return r.data;
  }, [runId]);
  const [etat, recharger] = useSection(charger);

  if (etat.phase === "chargement") return <Squelette lignes={4} />;
  if (etat.phase === "erreur")
    return (
      <BlocErreur
        message={etat.message}
        action={
          <Bouton rang="secondaire" onClick={recharger}>
            {fr.actions.reessayer}
          </Bouton>
        }
      />
    );
  const hist = etat.donnees;
  return (
    <div className="flex flex-col gap-4">
      <table className="w-full border-collapse font-ui text-body">
        <caption className="sr-only">{m09.ecran.sectionLive}</caption>
        <thead>
          <tr className="text-left text-label text-ink-500">
            <th scope="col" className="py-1 pr-4 font-medium">
              Capacité
            </th>
            <th scope="col" className="py-1 pr-4 font-medium">
              {m09.ecran.colonneDuree}
            </th>
            <th scope="col" className="py-1 font-medium">
              {m09.ecran.colonneIssue}
            </th>
          </tr>
        </thead>
        <tbody>
          {hist.appels.map((appel, i) => (
            <tr key={`${appel.capacite}-${String(i)}`} className="border-t border-rule">
              <td className="py-1 pr-4 text-ink-900">{appel.capacite}</td>
              <td className="py-1 pr-4 text-ink-700 tabular-nums">{formaterDuree(appel.ms)}</td>
              <td className="py-1 text-ink-700">
                {appel.ok ? "—" : (appel.code ?? m09.ecran.colonneFail)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {hist.preuves.length === 0 ? null : (
        <ul className="flex list-none flex-col gap-1 p-0 font-ui text-body text-ink-700">
          {hist.preuves.map((preuve) => (
            <li key={`${preuve.titre}-${preuve.version}`}>
              {preuve.titre}
              {preuve.section === null ? "" : ` · ${preuve.section}`} · v{preuve.version}
            </li>
          ))}
        </ul>
      )}
      {hist.run.approvalFp === null ? (
        <p className="font-ui text-body text-ink-500">{m09.ecran.sansApprobation}</p>
      ) : (
        <p className="font-ui text-body text-ink-700">
          {m09.ecran.approbation} · {hist.run.issue ?? "—"} ·{" "}
          <span title={hist.run.approvalFp}>{court(hist.run.approvalFp)}</span>
        </p>
      )}
    </div>
  );
}

function SectionLive(): React.JSX.Element {
  const charger = useCallback(async (): Promise<readonly EnteteLive[]> => {
    const r = await listerRunsLive(20);
    if (!r.ok) throw new Error(r.error.message);
    return r.data;
  }, []);
  const [etat, recharger] = useSection(charger);
  const [detail, setDetail] = useState<string | null>(null);

  if (etat.phase === "chargement") return <Squelette lignes={4} />;
  if (etat.phase === "erreur")
    return (
      <BlocErreur
        message={etat.message}
        action={
          <Bouton rang="secondaire" onClick={recharger}>
            {fr.actions.reessayer}
          </Bouton>
        }
      />
    );
  if (etat.donnees.length === 0) return <EtatVide message={m09.ecran.videLive} />;
  return (
    <ul className="flex list-none flex-col gap-2 p-0">
      {etat.donnees.map((run) => {
        const ouvert = detail === run.runId;
        return (
          <li key={run.runId} className="rounded-xl border border-rule p-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-ui text-body">
              <span title={run.runId} className="font-medium text-ink-900 tabular-nums">
                {court(run.runId)}
              </span>
              <span className="text-ink-700">{formaterDate(run.createdAt)}</span>
              <span className="text-ink-700">{run.chemin}</span>
              <span className="text-ink-700 tabular-nums">{formaterDuree(run.dureeMs)}</span>
              <span className="text-ink-700">
                {m09.ecran.colonneIssue} : {run.issue ?? "—"}
              </span>
              <Bouton rang="discret" onClick={() => setDetail(ouvert ? null : run.runId)}>
                {ouvert ? m09.ecran.masquerDetail : m09.ecran.voirDetail}
              </Bouton>
            </div>
            {ouvert ? (
              <div className="mt-3 border-t border-rule pt-3">
                <DetailLive runId={run.runId} />
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function DetailReplay({ runId }: { readonly runId: string }): React.JSX.Element {
  const charger = useCallback(async (): Promise<HistoriqueReplay> => {
    const r = await lireHistoriqueReplay(runId);
    if (!r.ok) throw new Error(r.error.message);
    return r.data;
  }, [runId]);
  const [etat, recharger] = useSection(charger);

  if (etat.phase === "chargement") return <Squelette lignes={3} />;
  if (etat.phase === "erreur")
    return (
      <BlocErreur
        message={etat.message}
        action={
          <Bouton rang="secondaire" onClick={recharger}>
            {fr.actions.reessayer}
          </Bouton>
        }
      />
    );
  return (
    <ul className="flex list-none flex-col gap-1 p-0 font-ui text-body text-ink-700">
      {etat.donnees.cas.map((cas) => (
        <li key={`${cas.famille}-${cas.id}`}>
          {cas.famille} · {cas.id} · {cas.verdict}
        </li>
      ))}
    </ul>
  );
}

function SectionReplay(): React.JSX.Element {
  const charger = useCallback(async (): Promise<readonly EnteteReplay[]> => {
    const r = await listerRunsReplay(20);
    if (!r.ok) throw new Error(r.error.message);
    return r.data;
  }, []);
  const [etat, recharger] = useSection(charger);
  const [detail, setDetail] = useState<string | null>(null);

  if (etat.phase === "chargement") return <Squelette lignes={4} />;
  if (etat.phase === "erreur")
    return (
      <BlocErreur
        message={etat.message}
        action={
          <Bouton rang="secondaire" onClick={recharger}>
            {fr.actions.reessayer}
          </Bouton>
        }
      />
    );
  if (etat.donnees.length === 0) return <EtatVide message={m09.ecran.videReplay} />;
  return (
    <ul className="flex list-none flex-col gap-2 p-0">
      {etat.donnees.map((run) => {
        const ouvert = detail === run.runId;
        return (
          <li key={run.runId} className="rounded-xl border border-rule p-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-ui text-body">
              <span title={run.runId} className="font-medium text-ink-900 tabular-nums">
                {court(run.runId)}
              </span>
              <span className="text-ink-700">{formaterDate(run.createdAt)}</span>
              <span className="text-ink-700">
                {m09.ecran.colonneVerdict} : {run.verdict}
              </span>
              <span className="text-ink-700 tabular-nums">
                {run.passCount} / {run.failCount}
              </span>
              <Bouton rang="discret" onClick={() => setDetail(ouvert ? null : run.runId)}>
                {ouvert ? m09.ecran.masquerDetail : m09.ecran.voirDetail}
              </Bouton>
            </div>
            {ouvert ? (
              <div className="mt-3 border-t border-rule pt-3">
                <DetailReplay runId={run.runId} />
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export function PanneauObservabilite({ horsLigne }: { readonly horsLigne: boolean }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-6">
      {horsLigne ? <BandeauHorsLigne /> : null}
      <Carte niveau="primaire">
        <div className="flex flex-col gap-4 p-6">
          <h2 className="font-ui text-heading font-semibold text-ink-900">{m09.ecran.sectionStats}</h2>
          <SectionStats />
        </div>
      </Carte>
      <Carte niveau="primaire">
        <div className="flex flex-col gap-4 p-6">
          <h2 className="font-ui text-heading font-semibold text-ink-900">{m09.ecran.sectionLive}</h2>
          <SectionLive />
        </div>
      </Carte>
      <Carte niveau="primaire">
        <div className="flex flex-col gap-4 p-6">
          <h2 className="font-ui text-heading font-semibold text-ink-900">{m09.ecran.sectionReplay}</h2>
          <SectionReplay />
        </div>
      </Carte>
      <p className="font-ui text-body text-ink-500">
        <LienBouton href="/tableauDeBord" rang="secondaire">
          {m09.ecran.retourTableau}
        </LienBouton>
      </p>
    </div>
  );
}
