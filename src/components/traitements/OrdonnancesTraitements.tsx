"use client";

import { useEffect, useMemo, useState } from "react";

import { Badge, BlocErreur, Bouton, Carte, EtatVide, Icone, LienBouton, Squelette } from "@/components/ui";
import { dateCivile, jourLong } from "@/components/patients/format";
import { traitements as t } from "@/i18n/traitements";
import { listDrafts } from "@/services/document-drafts";
import { listPatientDocuments, type Document } from "@/services/documents";
import { listPatientRenewalLinks, type RenewalLink } from "@/services/medication-phase2";
import type { Treatment } from "@/services/patient-treatments";
import type { Draft } from "@/shared/documents/types";

import { PanneauRenouvellements } from "./PanneauRenouvellements";

function aujourdHuiAlger(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Algiers",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function dansQuatorzeJours(aujourdHui: string): string {
  const date = new Date(`${aujourdHui}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 14);
  return date.toISOString().slice(0, 10);
}

export function OrdonnancesTraitements({
  patientId,
  liste,
}: {
  readonly patientId: string;
  readonly liste: readonly Treatment[];
}): React.JSX.Element {
  const [documents, setDocuments] = useState<readonly Document[] | null>(null);
  const [drafts, setDrafts] = useState<readonly Draft[] | null>(null);
  const [liens, setLiens] = useState<readonly RenewalLink[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [erreurLiens, setErreurLiens] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let vivant = true;
    setErreur(null);
    setErreurLiens(null);
    void Promise.all([
      listPatientDocuments(patientId),
      listDrafts(patientId),
      listPatientRenewalLinks(patientId),
    ]).then(([docs, brouillons, liensRenouvellement]) => {
      if (!vivant) return;
      if (!docs.ok) {
        setErreur(docs.error.message);
        return;
      }
      if (!brouillons.ok) {
        setErreur(brouillons.error.message);
        return;
      }
      setDocuments(docs.data.filter((d) => d.docType === "ordonnance"));
      setDrafts(brouillons.data.filter((d) => d.kind === "ordonnance" && d.issuedDocumentId === null));
      if (!liensRenouvellement.ok) {
        setErreurLiens(liensRenouvellement.error.message);
        setLiens([]);
        return;
      }
      setLiens(liensRenouvellement.data);
    });
    return () => {
      vivant = false;
    };
  }, [patientId, version]);

  const revue = useMemo(() => {
    const aujourdHui = aujourdHuiAlger();
    const limite = dansQuatorzeJours(aujourdHui);
    return liste
      .filter((x) => x.status === "active" && x.endDate !== null && x.endDate <= limite)
      .slice()
      .sort((a, b) => (a.endDate ?? "").localeCompare(b.endDate ?? ""));
  }, [liste]);

  if (erreur !== null) return <BlocErreur message={erreur} />;
  if (documents === null || drafts === null) return <Squelette lignes={5} />;

  const vide = documents.length === 0 && drafts.length === 0;

  return (
    <section aria-labelledby="titre-ordonnances-traitements" className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-tuile-lavande text-violet-700">
              <Icone nom="documents" taille={20} />
            </span>
            <h2 id="titre-ordonnances-traitements" className="m-0 font-ui text-heading font-bold tracking-heading text-ink-900">
              {t.ordonnances.titre}
            </h2>
          </div>
          <p className="m-0 max-w-form font-ui text-label leading-relaxed text-ink-500">{t.ordonnances.aide}</p>
        </div>
        <LienBouton
          rang="principal"
          href={`/documents?patient=${encodeURIComponent(patientId)}&kind=ordonnance`}
        >
          {t.actions.nouvelleOrdonnance}
        </LienBouton>
      </div>

      {vide ? (
        <Carte niveau="secondaire">
          <EtatVide
            titre={t.ordonnances.vide}
            message={t.ordonnances.videAide}
            icone="documents"
            action={
              <LienBouton
                rang="principal"
                href={`/documents?patient=${encodeURIComponent(patientId)}&kind=ordonnance`}
              >
                {t.actions.nouvelleOrdonnance}
              </LienBouton>
            }
          />
        </Carte>
      ) : (
        <div className="grid grid-cols-1 gap-4 tablet:grid-cols-2">
          <Carte niveau="clinique">
            <div className="flex flex-col gap-3 p-5">
              <h3 className="m-0 font-ui text-heading font-bold tracking-heading text-ink-900">
                {t.ordonnances.brouillons}
              </h3>
              {drafts.length === 0 ? (
                <p className="m-0 font-ui text-body text-ink-500">{t.ordonnances.aucunBrouillon}</p>
              ) : (
                <ul className="m-0 flex list-none flex-col gap-2 p-0">
                  {drafts.map((draft) => (
                    <li key={draft.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-sunken px-3 py-2">
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <span className="font-ui text-body font-semibold text-ink-900">{t.ordonnances.brouillon}</span>
                        <span className="font-num text-label tabular-nums text-ink-500">
                          {dateCivile(draft.documentDate) ?? draft.documentDate} · v{draft.revision}
                        </span>
                      </div>
                      <LienBouton
                        rang="secondaire"
                        href={`/documents?patient=${encodeURIComponent(patientId)}&draft=${encodeURIComponent(draft.id)}`}
                      >
                        {t.ordonnances.reprendre}
                      </LienBouton>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Carte>

          <Carte niveau="clinique">
            <div className="flex flex-col gap-3 p-5">
              <h3 className="m-0 font-ui text-heading font-bold tracking-heading text-ink-900">
                {t.ordonnances.emises}
              </h3>
              {documents.length === 0 ? (
                <p className="m-0 font-ui text-body text-ink-500">{t.ordonnances.aucuneEmise}</p>
              ) : (
                <ul className="m-0 flex list-none flex-col gap-2 p-0">
                  {documents.map((document) => (
                    <li key={document.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-sunken px-3 py-2">
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <span className="font-num text-body font-semibold tabular-nums text-ink-900">{document.docNumber}</span>
                        <span className="font-ui text-label text-ink-500">
                          {jourLong(document.issuedAt) ?? t.commune.nonDisponible}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        {(liens ?? []).some((lien) => lien.newDocumentId === document.id) ? (
                          <Badge ton="information">{t.phase2.renouvellements.badge}</Badge>
                        ) : null}
                        <Badge ton={document.status === "voided" ? "attention" : "positif"}>
                          {document.status === "voided" ? t.ordonnances.annulee : t.ordonnances.emise}
                        </Badge>
                        <LienBouton
                          rang="discret"
                          href={`/documents?patient=${encodeURIComponent(patientId)}&document=${encodeURIComponent(document.id)}`}
                        >
                          {t.ordonnances.ouvrir}
                        </LienBouton>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Carte>
        </div>
      )}

      <Carte niveau="secondaire">
        <div className="flex flex-col gap-3 p-5">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div className="flex flex-col gap-1">
              <h3 className="m-0 font-ui text-heading font-bold tracking-heading text-ink-900">{t.ordonnances.revueTitre}</h3>
              <p className="m-0 max-w-form font-ui text-label leading-relaxed text-ink-500">{t.ordonnances.revueAide}</p>
            </div>
            <Badge ton={revue.some((x) => x.endDate !== null && x.endDate < aujourdHuiAlger()) ? "attention" : "neutre"}>
              {String(revue.length)}
            </Badge>
          </div>
          {revue.length === 0 ? (
            <p className="m-0 font-ui text-body text-ink-500">{t.ordonnances.revueVide}</p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {revue.map((traitement) => {
                const depassee = traitement.endDate !== null && traitement.endDate < aujourdHuiAlger();
                return (
                  <li key={traitement.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-card px-3 py-2">
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="break-words font-ui text-body font-semibold text-ink-900">
                        {traitement.medicationRaw || traitement.brandName || traitement.inn}
                      </span>
                      <span className="font-num text-label tabular-nums text-ink-500">
                        {t.ordonnances.finLe} {dateCivile(traitement.endDate) ?? t.commune.nonDisponible}
                      </span>
                    </div>
                    <Badge ton={depassee ? "attention" : "information"}>
                      {depassee ? t.ordonnances.depassee : t.ordonnances.proche}
                    </Badge>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="m-0 font-ui text-label text-ink-500">{t.ordonnances.pasDeRenouvellement}</p>
        </div>
      </Carte>

      <PanneauRenouvellements
        patientId={patientId}
        documents={documents}
        liens={liens ?? []}
        chargement={liens === null}
        erreur={erreurLiens}
        onChanged={() => setVersion((v) => v + 1)}
        onReessayer={() => setVersion((v) => v + 1)}
      />
    </section>
  );
}
