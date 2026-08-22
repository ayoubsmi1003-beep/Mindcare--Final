"use client";

/**
 * Le bloc « Documents » de la fiche patient — REPLIÉ, et qui ne lit QU'À
 * L'OUVERTURE.
 *
 * ═══ DEUX RAISONS, PAS UNE ═════════════════════════════════════════════════
 *
 * 1. LE BUDGET. `06-PERF-BUDGET.md` accorde 2 appels à la fiche patient.
 *    Charger l'historique documentaire au montage en ajouterait un troisième à
 *    chaque ouverture de dossier, pour une information que la praticienne ne
 *    demande pas la plupart du temps.
 *
 * 2. LA RÈGLE 6, et c'est la plus importante des deux.
 *    `list_patient_documents` écrit une trace `liste` dans `audit.log` AVANT de
 *    lire. Charger au montage produirait donc une trace « elle a consulté les
 *    documents de ce dossier » pour quelqu'un qui a seulement ouvert la fiche.
 *    Un journal d'accès qui enregistre des lectures qui n'ont pas eu lieu ne
 *    protège plus personne — il devient du bruit qu'on cesse de lire.
 *
 * ⚠️ LE MÉCANISME TIENT À UN DÉTAIL DE `SectionPliable` : elle RETIRE ses
 * enfants du DOM quand elle est repliée, elle ne les masque pas en CSS. Ce
 * composant est donc monté exactement au moment de l'ouverture, et son effet de
 * montage est le bon endroit pour lire. Si `SectionPliable` passait un jour à
 * un masquage CSS, la lecture repartirait au montage de la fiche et la
 * garantie ci-dessus tomberait SANS QUE RIEN NE LE SIGNALE.
 */

import { useEffect, useState } from "react";

import { BlocErreur, EtatVide, LienBouton, Squelette } from "@/components/ui";
import { SectionPliable } from "@/components/ui";
import { fr } from "@/i18n/fr";
import { listPatientDocuments, type Document } from "@/services/documents";

import { ListeDocuments } from "./ListeDocuments";

export function SectionDocumentsPatient({
  patientId,
}: {
  readonly patientId: string;
}): React.JSX.Element {
  return (
    <SectionPliable
      titre={fr.documents.titre}
      replieParDefaut
      action={
        <LienBouton rang="secondaire" href={`/documents?patient=${patientId}`}>
          {fr.documents.emission.ouvrir}
        </LienBouton>
      }
    >
      <CorpsDocuments patientId={patientId} />
    </SectionPliable>
  );
}

function CorpsDocuments({ patientId }: { readonly patientId: string }): React.JSX.Element {
  const [documents, setDocuments] = useState<readonly Document[] | null>(null);
  const [erreur, setErreur] = useState<string | undefined>(undefined);

  useEffect(() => {
    let abandonne = false;
    void listPatientDocuments(patientId).then((r) => {
      if (abandonne) return;
      if (!r.ok) {
        setErreur(r.error.message);
        return;
      }
      setDocuments(r.data);
    });
    return () => {
      abandonne = true;
    };
  }, [patientId]);

  if (erreur !== undefined) return <BlocErreur message={erreur} />;
  if (documents === null) return <Squelette lignes={3} />;
  if (documents.length === 0) {
    return (
      <EtatVide
        message={fr.documents.vide.phrase}
        action={
          <LienBouton rang="principal" href={`/documents?patient=${patientId}`}>
            {fr.documents.vide.action}
          </LienBouton>
        }
      />
    );
  }

  // L'ouverture d'un document se fait sur /documents, pas ici : la fiche n'a
  // pas de place pour une feuille A5, et `get_document` écrirait une seconde
  // trace pour une lecture que la praticienne n'a pas demandée depuis cet écran.
  return (
    <ListeDocuments
      documents={documents}
      documentOuvert={null}
      onOuvrir={(id) => {
        window.location.href = `/documents?patient=${patientId}&document=${id}`;
      }}
    />
  );
}
