/**
 * La boîte de paiements et le tiroir d'encaissement.
 *
 * ═══ LA FRONTIÈRE QUI COMpte ══════════════════════════════════════════════
 * L'assistante ENCAISSE un tarif déjà fixé par la praticienne ; elle ne le
 * fixe ni ne le corrige. Ici c'est une ÉVIDENCE D'AFFICHAGE — le montant est
 * rendu en lecture seule sous l'étiquette « Montant à encaisser » — mais ce
 * n'est PAS la protection : la base refuse (`set_consultation_price` renvoie
 * NULL hors périmètre ; `trg_pay_guard` gèle les colonnes tarif sous le rôle
 * assistant). L'écran dit la règle, la base l'impose.
 *
 * JAMAIS D'OPTIMISME SUR L'ARGENT (05-UX §8, critère du lot) : pas de mise à
 * jour optimiste, aucun état ambigu. Le bouton confirme après 400 ms (anti-
 * clic réflexe, patron `CarteConfirmation`), l'appel part, et seul le succès
 * de `record_payment_collected` déplace la ligne vers « Encaissés ». Un échec
 * réseau laisse le paiement dans sa file avec un message et [Réessayer].
 */

"use client";

import { useEffect, useState } from "react";

import { fr } from "@/i18n/fr";

import { BlocErreur } from "@/components/ui/Etats";
import { Bouton } from "@/components/ui/Bouton";
import { heure } from "@/components/AgendaPieces";
import { formaterDzd, recordPaymentCollected } from "@/services/finance";
import type { PaiementAccueil } from "@/services/reception";

/** Anti-clic réflexe — même valeur que la CarteConfirmation (SPRINT-V1 §V2.5). */
const DELAI_ANTI_REFLEXE_MS = 400;

type Onglet = "dues" | "encaisses";

interface PaiementsZoneProps {
  readonly paiements: readonly PaiementAccueil[];
  readonly maintenant: Date;
  /**
   * Ouvre LE tiroir unique du cockpit (porté par l'orchestrateur) : zone
   * d'attention, cette file et le centre de notifications partagent le même
   * chemin d'encaissement — jamais deux tiroirs.
   */
  readonly onEncaisser: (paiement: PaiementAccueil) => void;
}

export function PaiementsZone({
  paiements,
  maintenant,
  onEncaisser,
}: PaiementsZoneProps): React.JSX.Element {
  const [onglet, setOnglet] = useState<Onglet>("dues");

  const debutJour = new Date(maintenant);
  debutJour.setHours(0, 0, 0, 0);

  const dues = paiements.filter((p) => p.collectedAt === null);
  const encaissesAujourdhui = paiements.filter(
    (p) =>
      p.collectedAt !== null && Date.parse(p.collectedAt) >= debutJour.getTime(),
  );

  return (
    <section aria-label={fr.reception.paiements.titre} className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <h3 className="font-ui text-heading font-semibold text-ink-900">
          {fr.reception.paiements.titre}
        </h3>
        <div className="ml-auto inline-flex gap-1 rounded-md border border-rule bg-sunken p-1">
          <BoutonOnglet actif={onglet === "dues"} onClick={() => setOnglet("dues")}>
            {fr.reception.paiements.ongletDues} ({dues.length})
          </BoutonOnglet>
          <BoutonOnglet
            actif={onglet === "encaisses"}
            onClick={() => setOnglet("encaisses")}
          >
            {fr.reception.paiements.ongletEncaisses} ({encaissesAujourdhui.length})
          </BoutonOnglet>
        </div>
      </div>

      {onglet === "dues" ? (
        dues.length === 0 ? (
          <EtatFile message={fr.reception.paiements.videDues} />
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {dues.map((paiement) => (
              <li key={paiement.paymentId}>
                <div className="flex min-h-target items-center gap-3 rounded-md border border-rule bg-card px-3 py-2">
                  <span className="min-w-0 flex-auto truncate font-ui text-body font-medium text-ink-900">
                    {identite(paiement)}
                  </span>
                  <span className="hidden truncate font-num text-label tabular-nums text-ink-500 desktop:inline">
                    {fr.reception.paiements.recu} {paiement.receiptNumber}
                  </span>
                  <span className="font-num text-num font-medium tabular-nums text-ink-900">
                    {formaterDzd(paiement.amountDzd)}
                  </span>
                  <Bouton rang="principal" onClick={() => onEncaisser(paiement)}>
                    {fr.reception.paiements.encaisser}
                  </Bouton>
                </div>
              </li>
            ))}
          </ul>
        )
      ) : encaissesAujourdhui.length === 0 ? (
        <EtatFile message={fr.reception.paiements.videEncaisses} />
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {encaissesAujourdhui.map((paiement) => (
            <li key={paiement.paymentId}>
              <div className="flex min-h-target items-center gap-3 rounded-md border border-positive bg-positive-bg px-3 py-2">
                <span className="min-w-0 flex-auto truncate font-ui text-body text-ink-700">
                  {identite(paiement)}
                </span>
                <span className="font-num text-label tabular-nums text-ink-500">
                  {heure(paiement.collectedAt ?? "") ?? fr.etats.texteAbsent}
                </span>
                <span className="font-num text-num font-medium tabular-nums text-ink-900">
                  {formaterDzd(paiement.amountDzd)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function identite(paiement: PaiementAccueil): string {
  if (paiement.lastName === null && paiement.firstName === null)
    return fr.agenda.patientNonRattache;
  return [paiement.lastName, paiement.firstName].filter(Boolean).join(" ");
}

/**
 * Le tiroir. Trois vérités y sont affichées : QUI, COMBIEN, COMMENT.
 * Le montant n'est pas un champ : c'est une lecture. La méthode est une
 * étiquette fixe — l'enum `app.payment_method` ne porte qu'`Espèces`
 * (ADR-010) et aucune méthode n'est inventée (règle 8).
 *
 * EXPORTÉ : la zone d'attention et le centre de notifications ouvrent le MÊME
 * tiroir — un seul chemin d'encaissement dans le cockpit, jamais deux.
 */
export function TiroirEncaissement({
  paiement,
  onFermer,
  apresMutation,
}: {
  readonly paiement: PaiementAccueil;
  readonly onFermer: () => void;
  readonly apresMutation: () => void;
}): React.JSX.Element {
  const [delaiEcoule, setDelaiEcoule] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | undefined>(undefined);
  const [succes, setSucces] = useState(false);

  useEffect(() => {
    setDelaiEcoule(false);
    const minuteur = setTimeout(() => setDelaiEcoule(true), DELAI_ANTI_REFLEXE_MS);
    return () => clearTimeout(minuteur);
  }, [paiement.paymentId]);

  async function encaisser(): Promise<void> {
    if (envoi || succes) return;
    setErreur(undefined);
    setEnvoi(true);
    // ⚠️ PAS DE MISE À JOUR OPTIMISTE ICI. L'argent change d'état quand la
    // base confirme, jamais avant.
    const result = await recordPaymentCollected(paiement.paymentId);
    setEnvoi(false);

    if (!result.ok) {
      setErreur(result.error.message);
      return;
    }
    if (result.data === null) {
      // Introuvable OU hors périmètre OU déjà encaissé hors fenêtre : même
      // réponse, sans distinguer (ADR-003). La file se rafraîchit pour montrer
      // la vérité réelle plutôt que d'affirmer un succès non vérifié.
      apresMutation();
      return;
    }
    setSucces(true);
    apresMutation();
  }

  const confirmable = delaiEcoule && !envoi && !succes;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-brand-600 bg-card p-4 shadow-lift2">
      <h4 className="font-ui text-heading font-semibold text-ink-900">
        {fr.reception.paiements.confirmerTitre}
      </h4>

      {succes ? (
        <p role="status" className="rounded-md border border-positive bg-positive-bg px-4 py-3 font-ui text-body text-positive">
          {fr.reception.feedback.paiementEncaisse}
        </p>
      ) : null}

      {erreur !== undefined ? (
        <BlocErreur
          message={erreur}
          action={
            <Bouton rang="principal" onClick={() => void encaisser()} disabled={envoi}>
              {fr.actions.reessayer}
            </Bouton>
          }
        />
      ) : null}

      <dl className="m-0 grid gap-2">
        <Ligne libelle={fr.reception.paiements.patiente} valeur={identite(paiement)} />
        <Ligne libelle={fr.reception.paiements.recu} valeur={paiement.receiptNumber} />
        <Ligne libelle={fr.reception.paiements.montantAEncaisser} valeur={formaterDzd(paiement.amountDzd)} forte />
        <Ligne libelle={fr.reception.paiements.methode} valeur={fr.reception.paiements.methodeEspeces} />
        <Ligne libelle={fr.reception.paiements.praticienne} valeur={paiement.practitionerName ?? fr.etats.texteAbsent} />
      </dl>

      {!succes ? (
        <div className="flex justify-end gap-2">
          <Bouton rang="discret" onClick={onFermer} disabled={envoi}>
            {fr.actions.annuler}
          </Bouton>
          {/* `aria-disabled` annonce l'indisponibilité momentanée au lecteur
              d'écran au lieu de sauter le bouton (patron CarteConfirmation). */}
          <Bouton
            rang="principal"
            onClick={() => void encaisser()}
            disabled={!confirmable}
            aria-disabled={!confirmable}
          >
            {confirmable ? fr.actions.confirmer : fr.jarvis.carte.patienter}
          </Bouton>
        </div>
      ) : null}
    </div>
  );
}

function Ligne({
  libelle,
  valeur,
  forte = false,
}: {
  readonly libelle: string;
  readonly valeur: string;
  readonly forte?: boolean;
}): React.JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="font-ui text-label text-ink-500">{libelle}</dt>
      <dd
        className={[
          "m-0 text-right",
          forte ? "font-num text-title font-semibold tabular-nums text-ink-900" : "font-ui text-body text-ink-900",
        ].join(" ")}
      >
        {valeur}
      </dd>
    </div>
  );
}

function EtatFile({ message }: { readonly message: string }): React.JSX.Element {
  return (
    <p className="rounded-md border border-rule bg-sunken px-4 py-3 font-ui text-body text-ink-500">
      {message}
    </p>
  );
}

function BoutonOnglet({
  actif,
  onClick,
  children,
}: {
  readonly actif: boolean;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={actif}
      className={[
        "min-h-target cursor-pointer rounded-sm px-3 py-1 font-ui text-label outline-none transition duration-instant ease-out",
        "focus-visible:outline focus-visible:outline-action-600 focus-visible:outline-offset",
        actif
          ? "bg-brand-600 font-semibold text-paper"
          : "bg-transparent font-regular text-ink-700 hover:bg-card",
      ].join(" ")}
    >
      {children}
    </button>
  );
}
