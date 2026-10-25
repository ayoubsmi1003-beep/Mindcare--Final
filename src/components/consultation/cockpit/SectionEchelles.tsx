"use client";

import { useCallback, useEffect, useState } from "react";

import { BlocErreur, Bouton, EtatVide, PanneauInfo } from "@/components/ui";
import { fr } from "@/i18n/fr";
import { frConsultationCockpit } from "@/i18n/consultation-cockpit";
import { dateCivile } from "@/components/patients/format";
import type { ChampSoap } from "@/services/consultations";
import type { EchelleResume } from "@/services/patients";
import {
  historiqueEchelles,
  listerEchelles,
  type AdministrationEchelle,
  type EchelleDisponible,
  type EchelleItem,
} from "@/services/scales";

import { FeuilleEchelle } from "./FeuilleEchelle";
import { phraseEchelleDatee, sensDelta, texteDelta } from "./modele-cockpit";

function jourCourt(iso: string): string {
  return dateCivile(iso.slice(0, 10)) ?? iso.slice(0, 10);
}

function nomCourt(scale: EchelleDisponible): string {
  if (scale.code === "PHQ9") return "PHQ-9";
  if (scale.code === "GAD7") return "GAD-7";
  return scale.nom;
}

function itemDeRisque(scale: EchelleDisponible | undefined): EchelleItem | undefined {
  return scale?.items.find((item) => item.risque === true);
}

function alertePositive(
  scale: EchelleDisponible | undefined,
  administration: AdministrationEchelle | undefined,
): EchelleItem | undefined {
  const risque = itemDeRisque(scale);
  if (risque === undefined || administration === undefined) return undefined;
  const valeur = administration.responses[risque.id];
  return typeof valeur === "number" && valeur > 0 ? risque : undefined;
}

function depuisHistorique(
  historique: readonly AdministrationEchelle[],
): EchelleResume[] {
  const parCode = new Map<string, AdministrationEchelle[]>();
  for (const administration of historique) {
    const liste = parCode.get(administration.scaleCode) ?? [];
    liste.push(administration);
    parCode.set(administration.scaleCode, liste);
  }
  const sortie: EchelleResume[] = [];
  for (const [scaleCode, liste] of parCode) {
    const premier = liste[0];
    if (premier === undefined || premier.total === null) continue;
    const precedent = liste[1];
    sortie.push({
      scaleCode,
      scaleName: premier.scaleName,
      dernier: {
        score: premier.total,
        date: premier.administeredAt,
        interpretation: premier.interpretation,
      },
      precedent:
        precedent !== undefined && precedent.total !== null
          ? { score: precedent.total, date: precedent.administeredAt }
          : null,
      delta:
        precedent !== undefined && precedent.total !== null
          ? premier.total - precedent.total
          : null,
    });
  }
  return sortie;
}

/**
 * Les échelles au dossier, dans la colonne de travail.
 *
 * Le référentiel est lu à l'ouverture (aucune donnée patient) et l'historique
 * une fois par séance, par la porte `get_scale_history` qui journalise la
 * lecture. Le score n'est jamais calculé ici : l'aperçu et l'enregistrement
 * passent par les portes 184, qui calculent et tracent.
 */
export function SectionEchelles({
  echelles,
  patientId,
  consultationId,
  seanceClose,
  modifiable,
  onInserer,
  onEchelleEnregistree,
}: {
  readonly echelles: readonly EchelleResume[];
  readonly patientId: string | null;
  readonly consultationId: string;
  readonly seanceClose: boolean;
  readonly modifiable: boolean;
  readonly onInserer: (champ: ChampSoap, texte: string) => void;
  readonly onEchelleEnregistree: (administration: AdministrationEchelle) => void;
}): React.JSX.Element {
  const textes = frConsultationCockpit.echelles;
  const cockpit = fr.consultation.cockpit;

  const [disponibles, setDisponibles] = useState<
    readonly EchelleDisponible[] | null | undefined
  >(undefined);
  const [erreurDispo, setErreurDispo] = useState<string | undefined>(undefined);
  const [historique, setHistorique] = useState<
    readonly AdministrationEchelle[] | null | undefined
  >(undefined);
  const [erreurHisto, setErreurHisto] = useState<string | undefined>(undefined);
  const [ouverte, setOuverte] = useState<EchelleDisponible | null>(null);
  const [confirmation, setConfirmation] = useState<string | undefined>(undefined);

  const chargerDispo = useCallback((): void => {
    setDisponibles(undefined);
    setErreurDispo(undefined);
    void listerEchelles().then((resultat) => {
      if (resultat.ok) {
        setDisponibles(resultat.data);
      } else {
        setErreurDispo(resultat.error.message);
        setDisponibles(null);
      }
    });
  }, []);

  const chargerHistorique = useCallback((): void => {
    if (patientId === null) {
      setHistorique([]);
      return;
    }
    setHistorique(undefined);
    setErreurHisto(undefined);
    void historiqueEchelles(patientId).then((resultat) => {
      if (resultat.ok) {
        setHistorique(resultat.data);
      } else {
        setErreurHisto(resultat.error.message);
        setHistorique(null);
      }
    });
  }, [patientId]);

  useEffect(() => {
    chargerDispo();
    chargerHistorique();
  }, [chargerDispo, chargerHistorique]);

  const resultats = echelles.length > 0 ? echelles : depuisHistorique(historique ?? []);
  const definitions = new Map((disponibles ?? []).map((scale) => [scale.code, scale]));
  const peutCompleter = !seanceClose && patientId !== null;

  function enregistrer(administration: AdministrationEchelle): void {
    setOuverte(null);
    setConfirmation(textes.enregistree);
    setHistorique((courant) =>
      courant === null || courant === undefined
        ? [administration]
        : [administration, ...courant],
    );
    onEchelleEnregistree(administration);
  }

  return (
    <section
      id="section-echelles"
      aria-label={textes.titre}
      className="flex scroll-mt-28 flex-col gap-4 rounded-2xl border border-rule bg-card p-5 shadow-douce"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="text-balance font-ui text-title font-bold text-ink-900">{textes.titre}</h2>
          <p className="m-0 font-ui text-label text-ink-500">{textes.sousTitre}</p>
        </div>
        <p className="m-0 shrink-0 font-ui text-label font-semibold tabular-nums text-ink-500">
          {frConsultationCockpit.resultats(resultats.length)}
        </p>
      </div>

      {confirmation === undefined ? null : (
        <PanneauInfo ton="positif">{confirmation}</PanneauInfo>
      )}

      {disponibles === undefined ? (
        <p className="m-0 font-ui text-label text-ink-500">{fr.etats.chargement}</p>
      ) : disponibles === null ? (
        <BlocErreur
          message={erreurDispo ?? textes.referentielIndisponible}
          action={<Bouton onClick={chargerDispo}>{fr.actions.reessayer}</Bouton>}
        />
      ) : disponibles.length === 0 ? (
        <p className="m-0 font-ui text-label text-ink-700">{textes.activation}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {peutCompleter ? (
            <div className="flex flex-wrap items-center gap-2">
              {disponibles.map((scale) => (
                <Bouton
                  key={scale.code}
                  rang="secondaire"
                  taille="compact"
                  etiquette={`${textes.completer} ${scale.nom}`}
                  onClick={() => {
                    setConfirmation(undefined);
                    setOuverte(scale);
                  }}
                >
                  {`${textes.completer} ${nomCourt(scale)}`}
                </Bouton>
              ))}
            </div>
          ) : (
            <p className="m-0 font-ui text-label text-ink-700">
              {seanceClose ? textes.consultationClosee : textes.sansDossier}
            </p>
          )}
        </div>
      )}

      {resultats.length === 0 ? (
        <EtatVide message={textes.vide} icone="suivi" />
      ) : (
        <ul className="m-0 flex list-none flex-col divide-y divide-rule p-0">
          {resultats.map((echelle) => {
            const sens = sensDelta(echelle);
            const delta = texteDelta(echelle.delta);
            const jour = jourCourt(echelle.dernier.date);
            const definition = definitions.get(echelle.scaleCode);
            const administration = (historique ?? []).find(
              (item) => item.scaleCode === echelle.scaleCode,
            );
            const enCours = administration?.consultationId === consultationId;
            const risque = alertePositive(definition, administration);
            return (
              <li key={echelle.scaleCode} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <p className="m-0 min-w-0 font-ui text-body font-semibold text-ink-900">
                    {echelle.scaleName}
                  </p>
                  <p className="m-0 shrink-0 font-ui text-label tabular-nums text-ink-500">
                    {enCours ? textes.seanceEnCours : textes.dernierResultat} · {jour}
                  </p>
                </div>

                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="font-ui text-chiffre font-extrabold tabular-nums tracking-chiffre text-ink-900">
                    {echelle.dernier.score === null ? fr.etats.texteAbsent : String(echelle.dernier.score)}
                  </span>
                  {echelle.dernier.interpretation === null ? null : (
                    <span className="font-ui text-body font-medium text-ink-700">
                      {echelle.dernier.interpretation}
                    </span>
                  )}
                  <span className="font-ui text-label font-medium tabular-nums text-ink-700">
                    {sens === "aucune" ? (
                      cockpit.premiereMesure
                    ) : (
                      <>
                        <span aria-hidden="true">
                          {sens === "hausse" ? "↑" : sens === "baisse" ? "↓" : "→"}{" "}
                        </span>
                        {delta === null ? null : `${delta} `}
                        {sens === "hausse" ? cockpit.hausse : sens === "baisse" ? cockpit.baisse : cockpit.stable}
                      </>
                    )}
                  </span>
                </div>

                {risque === undefined ? null : (
                  <div className="flex flex-col gap-1">
                    <span className="font-ui text-label font-semibold text-attention-ink">
                      {textes.alertePositive}
                    </span>
                    <p className="m-0 font-ui text-label text-ink-700">
                      {risque.alerte ?? risque.texte}
                    </p>
                    {modifiable ? (
                      <div>
                        <Bouton
                          rang="discret"
                          taille="compact"
                          onClick={() =>
                            onInserer(
                              "assessment",
                              `${echelle.scaleName} (${jour}) : ${risque.alerte ?? risque.texte}`,
                            )
                          }
                        >
                          {textes.inscrireAlerte}
                        </Bouton>
                      </div>
                    ) : null}
                  </div>
                )}

                {modifiable ? (
                  <div>
                    <Bouton
                      rang="discret"
                      taille="compact"
                      etiquette={`${textes.inscrire} — ${echelle.scaleName}`}
                      onClick={() => onInserer("objective", phraseEchelleDatee(echelle, jour))}
                    >
                      {textes.inscrire}
                    </Bouton>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {erreurHisto === undefined ? null : (
        <div className="flex flex-wrap items-center gap-2">
          <p className="m-0 font-ui text-label text-attention-ink">
            {erreurHisto || textes.historiqueIndisponible}
          </p>
          <Bouton rang="discret" taille="compact" onClick={chargerHistorique}>
            {fr.actions.reessayer}
          </Bouton>
        </div>
      )}

      {historique === undefined || historique === null || historique.length === 0 ? null : (
        <details className="border-t border-rule pt-3">
          <summary className="cursor-pointer font-ui text-label font-medium text-ink-500">
            {textes.historiqueTitre}
          </summary>
          <ul className="mt-3 flex list-none flex-col divide-y divide-rule p-0">
            {historique.map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2"
              >
                <span className="min-w-0 font-ui text-label font-medium text-ink-900">
                  {item.scaleName}
                  {item.consultationId === consultationId ? ` · ${textes.seanceEnCours}` : ""}
                </span>
                <span className="font-ui text-label tabular-nums text-ink-500">
                  {jourCourt(item.administeredAt)}
                  {" · "}
                  {item.total === null ? fr.etats.texteAbsent : String(item.total)}
                  {item.interpretation === null ? "" : ` · ${item.interpretation}`}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {ouverte !== null && patientId !== null ? (
        <FeuilleEchelle
          key={ouverte.code}
          scale={ouverte}
          patientId={patientId}
          consultationId={consultationId}
          onFermer={() => setOuverte(null)}
          onEnregistre={enregistrer}
        />
      ) : null}
    </section>
  );
}
