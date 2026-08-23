/**
 * La préparation & la clôture — LECTURE SEULE, sur LA JOURNÉE AFFICHÉE.
 *
 * ⚠️ Le board ne charge qu'une journée (un appel, PERF §3). Ce composant ne
 * fabrique donc JAMAIS une seconde journée : quand l'assistante regarde
 * aujourd'hui, elle lit la clôture du jour ; quand elle navigue sur demain
 * (`T` puis « suivant »), le même bloc devient la préparation de demain. Une
 * donnée absente s'affiche comme absente (I19), pas devinée.
 *
 * Les suggestions (replanifier une annulation) ouvrent le formulaire existant —
 * jamais un geste automatique (R4). AUCUN total financier : `day_revenue` rend
 * zéro ligne à l'assistante et ce bloc ne recompose pas un chiffre que la base
 * refuse d'afficher ; seulement des COMPTES.
 */

"use client";

import { fr } from "@/i18n/fr";

import { heure } from "@/components/AgendaPieces";
import { Bouton } from "@/components/ui/Bouton";
import type { PaiementAccueil, RdvAccueil } from "@/services/reception";

interface PreparationJourProps {
  readonly journee: readonly RdvAccueil[];
  readonly paiements: readonly PaiementAccueil[];
}

export function PreparationJour({
  journee,
  paiements,
}: PreparationJourProps): React.JSX.Element {
  const confirmes = journee.filter((rdv) => rdv.status === "confirmed");
  const premier = [...confirmes].sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
  const annules = journee.filter((rdv) => rdv.status === "cancelled");
  const paiementsRestants = paiements.filter((p) => p.collectedAt === null).length;

  return (
    <section aria-label={fr.reception.demain.titre} className="flex flex-col gap-2">
      <h3 className="font-ui text-heading font-semibold text-ink-900">
        {fr.reception.demain.titre}
      </h3>

      <p className="font-ui text-body text-ink-700">
        {confirmes.length > 0 ? (
          <>
            <span className="font-num font-medium tabular-nums">{confirmes.length}</span>{" "}
            {fr.reception.demain.rdvConfirmes}
            {premier !== undefined ? (
              <>
                {" · "}
                {fr.reception.demain.premierA}{" "}
                <span className="font-num tabular-nums">{heure(premier.startsAt)}</span>
              </>
            ) : null}
          </>
        ) : (
          <span className="text-ink-500">{fr.reception.frise.videJournee}</span>
        )}
      </p>

      <div className="rounded-md border border-rule bg-card px-3 py-2">
        <p className="font-ui text-label font-semibold uppercase tracking-label text-ink-500">
          {fr.reception.demain.cloture}
        </p>
        <p className="font-ui text-body text-ink-900">
          <span className="font-num font-medium tabular-nums">{paiementsRestants}</span>{" "}
          {fr.reception.demain.paiementsRestants}
        </p>
      </div>

      <div className="flex flex-col gap-1">
        <p className="font-ui text-label font-semibold uppercase tracking-label text-ink-500">
          {fr.reception.demain.annulesDuJour}
        </p>
        {annules.length === 0 ? (
          <p className="px-1 font-ui text-label text-ink-500">{fr.reception.demain.annulesVide}</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {annules.map((rdv) => (
              <li
                key={rdv.id}
                className="flex min-h-target items-center gap-3 rounded-md border border-rule bg-sunken px-3 py-2"
              >
                <span className="min-w-0 flex-auto truncate font-ui text-body text-ink-700">
                  {[rdv.lastName, rdv.firstName].filter(Boolean).join(" ") ||
                    fr.agenda.patientNonRattache}
                  {" · "}
                  {heure(rdv.startsAt) ?? fr.etats.texteAbsent}
                </span>
                {/* Suggestion → geste explicite dans le formulaire existant.
                    Jamais de recréation automatique (R4). */}
                <Bouton rang="discret" onClick={() => globalThis.location.assign("/agenda/nouveau")}>
                  {fr.reception.demain.replanifier}
                </Bouton>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
