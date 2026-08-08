"use client";

/**
 * Le tarif d'une séance, saisi en fin de consultation.
 *
 * ADR-010 : « le médecin saisit le prix manuellement en fin de séance ». Il n'y
 * a pas de barème, pas de calcul, pas de proposition — un champ et un bouton.
 *
 * ⚠️ COMPOSANT SÉPARÉ, PAS UN BLOC DE PLUS DANS L'ÉCRAN DE SÉANCE. `page.tsx`
 * fait déjà près de mille lignes ; y ajouter la finance mêlerait deux domaines
 * dans le fichier le plus relu du dépôt.
 *
 * ═══ CE QUE CE COMPOSANT NE DÉCIDE PAS ═════════════════════════════════════
 *
 * Il ne décide pas si le montant est modifiable. Il AFFICHE la décision :
 * `montantModifiable` (services/finance) dit ce qu'on montre, et
 * `app.set_consultation_price` (029 §2) dit ce que la base permet — sous verrou,
 * donc juste même quand deux onglets sont ouverts. C'est la porte qui a raison.
 * Un refus arrivant sur un champ que l'écran croyait ouvert est un cas NORMAL,
 * traité ici comme tel : le message de la base s'affiche, le champ se referme.
 *
 * Rien de rouge dans ce bloc. Le rouge est un budget : disque critique et perte
 * de données. Un tarif déjà encaissé n'est pas un incident, c'est un état.
 */

import { useCallback, useEffect, useState } from "react";

import { fr } from "@/i18n/fr";
import {
  formaterDzd,
  getConsultationPayment,
  montantModifiable,
  setConsultationPrice,
  type Paiement,
} from "@/services/finance";

import { BarreActions, Bouton, ChampTexte, PanneauInfo, Section, Squelette } from "./ui";

export function BlocTarif({
  consultationId,
}: {
  readonly consultationId: string;
}): React.JSX.Element {
  const [paiement, setPaiement] = useState<Paiement | null | undefined>(undefined);
  const [saisie, setSaisie] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const [confirmation, setConfirmation] = useState<string | undefined>(undefined);
  const [messageErreur, setMessageErreur] = useState<string | undefined>(undefined);

  const charger = useCallback(async () => {
    const result = await getConsultationPayment(consultationId);
    if (!result.ok) {
      // Le tarif ne se lit pas : on le dit, et on n'affiche PAS un champ vide
      // qui laisserait croire qu'aucun tarif n'est fixé. Un zéro faux sur un
      // écran d'argent est pire qu'une absence.
      setPaiement(null);
      setMessageErreur(result.error.message);
      return;
    }
    setPaiement(result.data);
    setSaisie(result.data === null ? "" : String(result.data.montantDzd));
  }, [consultationId]);

  useEffect(() => {
    void charger();
  }, [charger]);

  const fixer = useCallback(async () => {
    setMessageErreur(undefined);
    setConfirmation(undefined);

    const montant = Number.parseInt(saisie, 10);
    if (!Number.isFinite(montant) || montant < 0) {
      // Le refus lisible est ici ; la vraie barrière est le CHECK de 011, et la
      // porte 029 le redit. Trois endroits, la même règle — celui du bas décide.
      setMessageErreur(fr.finances.tarifIndication);
      return;
    }

    setEnvoi(true);
    const result = await setConsultationPrice(consultationId, montant);
    setEnvoi(false);

    if (!result.ok) {
      setMessageErreur(result.error.message);
      // On relit : la base vient peut-être de refuser parce qu'un autre onglet a
      // encaissé. L'écran doit montrer l'état réel, pas celui qu'il espérait.
      void charger();
      return;
    }

    if (result.data === null) {
      setMessageErreur(fr.finances.tarifSeanceIntrouvable);
      return;
    }

    setConfirmation(fr.feedback.tarifFixe);
    void charger();
  }, [charger, consultationId, saisie]);

  if (paiement === undefined) {
    return (
      <Section titre={fr.finances.tarifTitre}>
        <Squelette lignes={2} />
      </Section>
    );
  }

  const modifiable = montantModifiable(paiement);

  return (
    <Section titre={fr.finances.tarifTitre}>
      <div className="flex flex-col gap-4">
        {paiement === null ? null : (
          <p className="font-ui text-body text-ink-700">
            <span className="font-num text-num tabular-nums text-ink-900">
              {formaterDzd(paiement.montantDzd)}
            </span>
            <span className="ml-3 text-ink-500">
              {fr.finances.numeroRecu} {paiement.receiptNumber}
            </span>
          </p>
        )}

        {modifiable ? (
          <>
            <ChampTexte
              libelle={fr.finances.tarifMontant}
              valeur={saisie}
              onChange={setSaisie}
              type="number"
              indication={fr.finances.tarifIndication}
              disabled={envoi}
            />
            <BarreActions>
              <Bouton rang="principal" onClick={fixer} disabled={envoi}>
                {fr.actions.fixerLeTarif}
              </Bouton>
            </BarreActions>
          </>
        ) : (
          // Lecture seule, AVEC la raison écrite à l'écran. Un champ grisé sans
          // explication apprend à ne plus le regarder.
          <PanneauInfo titre={fr.finances.tarifDejaEncaisse}>
            {fr.finances.tarifDejaEncaisseIndication}
          </PanneauInfo>
        )}

        {confirmation === undefined ? null : (
          <PanneauInfo ton="positif">{confirmation}</PanneauInfo>
        )}

        {messageErreur === undefined ? null : (
          <PanneauInfo ton="attention">{messageErreur}</PanneauInfo>
        )}
      </div>
    </Section>
  );
}
