/**
 * Le tiroir de déplacement — la réédition rapide d'un RDV existant.
 *
 * ⚠️ IL NE FAIT QU'APPELER LA PORTE EXISTANTE `update_appointment` (022) via
 * le service `appointments.ts` : allowlist stricte (`starts_at`,
 * `duration_minutes`), refus du déclencheur sur un RDV terminé ou annulé,
 * trace d'audit automatique. Aucune logique métier ici — l'aperçu avant/après
 * est de la présentation, pas une validation : c'est la base qui refuse, et
 * son message lisible remonte tel quel.
 *
 * Le déplacement n'est PAS optimiste : un RDV mal déplacé fabrique des
 * attentes fantômes. L'écran attend la confirmation de la porte, puis
 * recharge le board (post-mutation).
 */

"use client";

import { useState } from "react";

import { fr } from "@/i18n/fr";

import { plage, versIso, versSaisieLocale } from "@/components/AgendaPieces";
import { BlocErreur } from "@/components/ui/Etats";
import { BarreActions, Bouton } from "@/components/ui/Bouton";
import { ChampTexte } from "@/components/ui/Champs";
import { updateAppointment } from "@/services/appointments";
import type { RdvAccueil } from "@/services/reception";

interface TiroirDeplacementProps {
  readonly rdv: RdvAccueil;
  readonly onFerme: () => void;
  readonly onSuccess: () => void;
}

export function TiroirDeplacement({
  rdv,
  onFerme,
  onSuccess,
}: TiroirDeplacementProps): React.JSX.Element {
  const [debutLocal, setDebutLocal] = useState<string>(() => versSaisieLocale(rdv.startsAt));
  const [duree, setDuree] = useState<string>(() => {
    const minutes = Math.round((Date.parse(rdv.endsAt) - Date.parse(rdv.startsAt)) / 60000);
    return String(Number.isFinite(minutes) && minutes > 0 ? minutes : 30);
  });
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | undefined>(undefined);

  async function enregistrer(): Promise<void> {
    if (envoi) return;
    const debutIso = versIso(debutLocal);
    const dureeMinutes = Number.parseInt(duree, 10);
    if (debutIso === null || Number.isNaN(dureeMinutes)) {
      setErreur(fr.erreurs["regle-metier"]);
      return;
    }

    setErreur(undefined);
    setEnvoi(true);
    // Pas d'optimisme : la porte confirme, puis le board se recharge.
    const result = await updateAppointment(rdv.id, {
      startsAt: debutIso,
      durationMinutes: dureeMinutes,
    });
    setEnvoi(false);

    if (!result.ok) {
      setErreur(result.error.message);
      return;
    }
    if (!result.data) {
      setErreur(fr.agenda.introuvable);
      return;
    }
    onSuccess();
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-brand-600 bg-card p-4 shadow-lift2">
      <h4 className="font-ui text-heading font-semibold text-ink-900">
        {fr.reception.deplacement.titre}
      </h4>

      <p className="font-ui text-label text-ink-500">
        {fr.reception.deplacement.apercuAvant} ·{" "}
        {plage(rdv.startsAt, rdv.endsAt) ?? fr.etats.texteAbsent}
      </p>

      {erreur !== undefined ? <BlocErreur message={erreur} /> : null}

      <ChampTexte
        libelle={`${fr.agenda.date} · ${fr.agenda.heure}`}
        type="datetime-local"
        valeur={debutLocal}
        onChange={setDebutLocal}
      />
      <ChampTexte
        libelle={fr.reception.deplacement.duree}
        type="number"
        valeur={duree}
        onChange={setDuree}
      />

      <BarreActions>
        <Bouton rang="principal" onClick={() => void enregistrer()} disabled={envoi}>
          {fr.reception.deplacement.enregistrer}
        </Bouton>
        <Bouton
          rang="discret"
          onClick={() => {
            setDebutLocal(versSaisieLocale(rdv.startsAt));
            onFerme();
          }}
          disabled={envoi}
        >
          {fr.actions.annuler}
        </Bouton>
      </BarreActions>
    </div>
  );
}
