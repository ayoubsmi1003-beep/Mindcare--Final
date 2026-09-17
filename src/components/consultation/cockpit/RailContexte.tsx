"use client";

import { useState } from "react";

import {
  BlocErreur,
  Bouton,
  EtatVide,
  PastilleIcone,
} from "@/components/ui";
import { Icone } from "@/components/ui/Icones";
import { PanneauHistorique } from "@/components/consultation/PanneauHistorique";
import { CourbeEchelles } from "@/components/consultation/cockpit/CourbeEchelles";
import { dateCivile } from "@/components/patients/format";
import { PanneauTraitements } from "@/components/patients/PanneauTraitements";
import { fr } from "@/i18n/fr";
import type { PatientWorkspace } from "@/services/patients";

function dateCourte(iso: string): string {
  return dateCivile(iso.slice(0, 10)) ?? iso.slice(0, 10);
}

function MiniChronologie({ dossier }: { readonly dossier: PatientWorkspace }): React.JSX.Element {
  const cockpit = fr.consultation.cockpit;
  const precedent = dossier.clinique?.derniereConsultation ?? null;
  const prochain = dossier.agenda.prochainRendezVous;

  return (
    <div className="flex items-start gap-2 rounded-2xl border border-rule bg-card px-4 py-3 shadow-carte">
      <div className="flex min-w-0 flex-1 flex-col items-center gap-1 text-center">
        <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-action-600" />
        <span className="font-ui text-label font-medium tabular-nums text-ink-900">
          {precedent === null ? cockpit.sansPrecedente : dateCourte(precedent.startedAt)}
        </span>
      </div>
      <span aria-hidden="true" className="mt-1 h-px min-w-6 flex-1 bg-rule" />
      <div className="flex min-w-0 flex-1 flex-col items-center gap-1 text-center">
        <span
          aria-hidden="true"
          className="h-2.5 w-2.5 rounded-full border-2 border-action-600 bg-card"
        />
        <span className="font-ui text-label font-semibold text-ink-900">{cockpit.aujourdhui}</span>
      </div>
      <span aria-hidden="true" className="mt-1 h-px min-w-6 flex-1 bg-rule" />
      <div className="flex min-w-0 flex-1 flex-col items-center gap-1 text-center">
        <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full border border-ink-300" />
        <span className="font-ui text-label font-medium tabular-nums text-ink-900">
          {prochain === null ? cockpit.sansProchain : dateCourte(prochain.startsAt)}
        </span>
      </div>
    </div>
  );
}

function AppercuTraitement({
  dossier,
  patientId,
  onRefresh,
}: {
  readonly dossier: PatientWorkspace;
  readonly patientId: string;
  readonly onRefresh: () => void;
}): React.JSX.Element {
  const cockpit = fr.consultation.cockpit;
  const [ouvert, setOuvert] = useState(false);
  const actif = dossier.traitementsV2?.actifs[0] ?? null;
  const total = dossier.traitementsV2?.totalActifs ?? 0;

  return (
    <div className="flex flex-col gap-3">
      {actif === null ? (
        <EtatVide message={cockpit.traitementVide} icone="traitements" />
      ) : (
        <div className="flex items-center gap-3">
          <PastilleIcone nom="traitements" ton="info" />
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate font-ui text-body font-semibold text-ink-900">
              {actif.brandName ?? actif.medicationRaw ?? actif.inn ?? ""}
            </span>
            <span className="font-ui text-label tabular-nums text-ink-500">
              {[actif.dose, actif.doseUnit].filter((m) => m !== null).join(" ")}
              {total > 1 ? ` · +${String(total - 1)}` : ""}
              {" · "}
              {dateCourte(actif.startDate)}
            </span>
          </div>
        </div>
      )}
      <div>
        <Bouton rang="discret" onClick={() => setOuvert((v) => !v)} deploye={ouvert}>
          {cockpit.traitementModifier}
        </Bouton>
      </div>
      {ouvert ? (
        <PanneauTraitements
          traitements={dossier.traitements}
          traitementsV2={dossier.traitementsV2}
          patientId={patientId}
          onRefresh={onRefresh}
        />
      ) : null}
    </div>
  );
}

function TitreRail({
  icone,
  teinte,
  titre,
  action,
}: {
  readonly icone: "horloge" | "traitements";
  readonly teinte: string;
  readonly titre: string;
  readonly action?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <span
          className={["inline-flex h-9 w-9 items-center justify-center rounded-xl border shadow-douce", teinte].join(" ")}
        >
          <Icone nom={icone} taille={20} />
        </span>
        <h2 className="font-ui text-heading font-bold text-ink-900">{titre}</h2>
      </div>
      {action ?? null}
    </div>
  );
}

/**
 * Le rail de contexte — l'intelligence, pas un second tableau de bord.
 *
 * Ordre : dernière séance (inline, URL inchangée) → courbe des échelles
 * (preuve réelle) → traitement → Jarvis (secondaire, passé en slot). Les
 * sections vides ou inaccessibles n'apparaissent pas : un rail qui empile
 * des cartes vides apprend à ne plus être regardé. Le dossier ne se lit que
 * sur geste explicite (`onCharger`, porte auditée) ou quand les onglets
 * l'ont déjà chargé — jamais au montage, pour que le budget d'ouverture
 * (e2e O5) ne bouge pas. Pas de carte « Prochain RDV » ici : la chronologie
 * ci-dessus et la colonne patient le portent déjà.
 */
export function RailContexte({
  ouvert,
  onBasculer,
  dossier,
  erreurDossier,
  onCharger,
  onReessayer,
  patientId,
  consultationActuelleId,
  jarvis,
}: {
  readonly ouvert: boolean;
  readonly onBasculer: () => void;
  readonly dossier: PatientWorkspace | null | undefined;
  readonly erreurDossier: string | undefined;
  readonly onCharger: () => void;
  readonly onReessayer: () => void;
  readonly patientId: string | null;
  readonly consultationActuelleId: string;
  readonly jarvis: React.ReactNode;
}): React.JSX.Element {
  const cockpit = fr.consultation.cockpit;

  return (
    <aside aria-label={cockpit.railTitre} className="flex w-full flex-col gap-4">
      <div>
        <Bouton rang="discret" onClick={onBasculer} deploye={ouvert}>
          {ouvert ? cockpit.railReplier : cockpit.railDeplier}
        </Bouton>
      </div>
      {ouvert ? (
        <div className="flex flex-col gap-4">
          {erreurDossier !== undefined ? (
            <BlocErreur
              message={erreurDossier}
              action={<Bouton onClick={onReessayer}>{fr.actions.reessayer}</Bouton>}
            />
          ) : dossier === undefined ? (
            // UN SEUL GESTE DE CHARGEMENT : le CTA vit dans la colonne patient
            // (état partagé) — le rail dit l'attente au lieu de la dupliquer.
            // Aucune lecture ne part d'ici (O5) : `onCharger` n'est plus appelé
            // depuis ce rail.
            <div className="flex flex-col gap-3 rounded-2xl border border-rule bg-card p-5 shadow-carte">
              <p className="font-ui text-body text-ink-500">{cockpit.railAttente}</p>
            </div>
          ) : dossier === null ? (
            <EtatVide message={cockpit.contexteInaccessible} icone="patients" />
          ) : (
            <>
              <MiniChronologie dossier={dossier} />

              {patientId === null ? null : (
                <div className="flex flex-col gap-4 rounded-2xl border border-rule bg-card p-5 shadow-carte">
                  <TitreRail
                    icone="horloge"
                    teinte="border-azure-100 bg-tuile-azur text-azure-700"
                    titre={cockpit.derniereTitre}
                    action={
                      dossier.clinique?.derniereConsultation === null ||
                      dossier.clinique?.derniereConsultation === undefined ? null : (
                        <span className="font-ui text-label tabular-nums text-ink-500">
                          {dateCourte(dossier.clinique.derniereConsultation.startedAt)}
                        </span>
                      )
                    }
                  />
                  <PanneauHistorique
                    patientId={patientId}
                    consultationActuelleId={consultationActuelleId}
                  />
                </div>
              )}

              {/* Ordre = priorité de lecture en séance : dernière séance, puis
                  traitement (ce qui agit), puis courbe (la preuve longi-
                  tudinale), jamais l'inverse. Pas de repli : chaque carte
                  porte déjà son propre contenant, les imbriquer serait deux
                  cartes l'une dans l'autre. */}
              <div className="flex flex-col gap-4 rounded-2xl border border-rule bg-card p-5 shadow-carte">
                <TitreRail
                  icone="traitements"
                  teinte="border-emeraude-100 bg-tuile-menthe text-emeraude-700"
                  titre={cockpit.traitementTitre}
                />
                {patientId === null ? (
                  <EtatVide message={cockpit.contexteInaccessible} icone="traitements" />
                ) : (
                  <AppercuTraitement
                    dossier={dossier}
                    patientId={patientId}
                    onRefresh={onReessayer}
                  />
                )}
              </div>

              <CourbeEchelles echelles={dossier.clinique?.echelles ?? []} />
            </>
          )}
          {jarvis}
          {/* Bumper : l'orbe flottant ne doit jamais recouvrir le dernier
              contenu du rail — même patron que la barre de consultation. */}
          <div aria-hidden="true" className="h-16" />
        </div>
      ) : null}
    </aside>
  );
}
