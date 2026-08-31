/**
 * La chronologie du dossier — ce qui s'est passé, dans l'ordre.
 *
 * ⚠️ ELLE NE LIT RIEN TANT QU'ON NE L'OUVRE PAS. `app.list_patient_timeline`
 * écrit une trace `liste` dans `audit.log` AVANT de lire : ouvrir une fiche ne
 * doit pas produire une lecture que la praticienne n'a pas demandée (règle 6).
 * C'est la même raison qui garde `SectionDocumentsPatient` repliée, et elle
 * prime sur le confort d'un onglet préchargé.
 *
 * ⚠️ AUCUN CONTENU CLINIQUE N'ARRIVE ICI. La porte ne rend que des clés
 * fermées (`label_key`), des codes, des dates et des scores — jamais un SOAP,
 * jamais `raw_notes`, jamais un texte libre d'ordonnance. Ce composant ne doit
 * donc JAMAIS afficher `detail` en bloc (`JSON.stringify`, itération sur les
 * clés) : ce serait rouvrir en aveugle tout ce que la porte a pris soin de ne
 * pas envoyer, et le jour où un champ s'ajoute côté SQL il s'afficherait sans
 * que personne ne l'ait décidé. Chaque champ lu ici est nommé, un par un.
 *
 * ⚠️ PAGINATION KEYSET. Le curseur porte `(occurredAt, eventId)` — pas un
 * décalage. Pendant une consultation, des événements s'insèrent en tête ; un
 * `OFFSET` ferait alors sauter ou répéter une ligne à chaque page suivante.
 */

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Bouton, EtatVide, PastilleIcone, Squelette } from "@/components/ui";
import type { NomIcone } from "@/components/ui";
import { fr } from "@/i18n/fr";
import {
  listPatientTimeline,
  type TimelineCursor,
  type TimelineEvent,
  type TimelineLabelKey,
} from "@/services/patients";

import { heure, jourLong, moisLong } from "./format";

/** Le libellé français d'un type d'événement. La base n'écrit pas de phrase. */
const LIBELLES: Readonly<Record<TimelineLabelKey, string>> = {
  consultation_ouverte: fr.patients.chronologie.consultationOuverte,
  consultation_close: fr.patients.chronologie.consultationClose,
  note_signee: fr.patients.chronologie.noteSignee,
  diagnostic_pose: fr.patients.chronologie.diagnosticPose,
  diagnostic_resolu: fr.patients.chronologie.diagnosticResolu,
  prescription: fr.patients.chronologie.prescription,
  echelle: fr.patients.chronologie.echelle,
  rdv: fr.patients.chronologie.rdv,
  document: fr.patients.chronologie.document,
  traitement_commence: fr.patients.chronologie.traitementCommence,
  traitement_dose_modifiee: fr.patients.chronologie.traitementDoseModifiee,
  traitement_horaire_modifie: fr.patients.chronologie.traitementHoraireModifie,
  traitement_pause: fr.patients.chronologie.traitementPause,
  traitement_repris: fr.patients.chronologie.traitementRepris,
  traitement_arrete: fr.patients.chronologie.traitementArrete,
  traitement_renouvele: fr.patients.chronologie.traitementRenouvele,
};

/**
 * L'icône double le libellé, elle ne le remplace pas : le sens est porté par le
 * texte (§4 règle 4). On réutilise les icônes d'écran existantes plutôt que
 * d'en inventer — le vocabulaire visuel doit rester le même d'un écran à
 * l'autre.
 */
const ICONES: Readonly<Record<TimelineEvent["eventType"], NomIcone>> = {
  consultation: "suivi",
  note: "journalActivite",
  diagnostic: "patients",
  prescription: "traitements",
  echelle: "statistiques",
  rdv: "agenda",
  document: "documents",
  traitement: "traitements",
};

/**
 * Le détail d'un événement, CHAMP PAR CHAMP. Voir l'avertissement de l'en-tête :
 * jamais d'itération générique sur `detail`.
 */
function detailLisible(evenement: TimelineEvent): string | null {
  const d = evenement.detail;

  const texte = (cle: string): string | null => {
    const v = d[cle];
    return typeof v === "string" && v !== "" ? v : null;
  };
  const nombre = (cle: string): number | null => {
    const v = d[cle];
    return typeof v === "number" ? v : null;
  };

  switch (evenement.labelKey) {
    case "diagnostic_pose":
    case "diagnostic_resolu": {
      const label = texte("label");
      const code = texte("code");
      return label === null ? null : code === null ? label : `${label} · ${code}`;
    }
    case "echelle": {
      const nom = texte("scale_name");
      const score = nombre("score");
      if (nom === null) return null;
      return score === null ? nom : `${nom} · ${String(score)}`;
    }
    case "prescription": {
      const n = nombre("nombre_lignes");
      return n === null ? null : `${String(n)} ${fr.patients.traitements.lignes}`;
    }
    case "document": {
      const numero = texte("doc_number");
      return numero;
    }
    case "rdv": {
      const statut = texte("status");
      if (statut === null) return null;
      return fr.agenda.statuts[statut as keyof typeof fr.agenda.statuts] ?? null;
    }
    case "traitement_commence":
    case "traitement_dose_modifiee":
    case "traitement_horaire_modifie":
    case "traitement_pause":
    case "traitement_repris":
    case "traitement_arrete":
    case "traitement_renouvele": {
      const med = texte("medication_raw") ?? texte("brand_name");
      const prev = d["previous_values"] as Record<string, unknown> | null;
      const next = d["new_values"] as Record<string, unknown> | null;
      const prevDose = prev ? String((prev)["dose"] ?? "") : "";
      const nextDose = next ? String((next)["dose"] ?? "") : "";
      const reason = texte("reason");
      if (med === null) return reason;
      if (evenement.labelKey === "traitement_dose_modifiee" && prevDose && nextDose && prevDose !== nextDose) {
        return `${med} : ${prevDose} → ${nextDose}`;
      }
      return reason ? `${med} · ${reason}` : med;
    }
    // Une consultation et une note signée n'ont rien à ajouter : leur libellé
    // dit déjà tout ce que la porte accepte de dire.
    default:
      return null;
  }
}

function LigneEvenement({ evenement }: { readonly evenement: TimelineEvent }): React.JSX.Element {
  const detail = detailLisible(evenement);
  const jour = jourLong(evenement.occurredAt);
  const h = heure(evenement.occurredAt);

  return (
    <li className="flex gap-4 py-4">
      {/* Le filet de temps : une colonne fine, continue, qui relie les
          événements sans les encadrer chacun dans une carte. */}
      <div className="flex shrink-0 flex-col items-center gap-2">
        <PastilleIcone nom={ICONES[evenement.eventType]} ton="neutre" />
        <span aria-hidden="true" className="w-0 grow border-l border-rule" />
      </div>

      <div className="flex min-w-0 grow flex-col gap-1 pb-2">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
          {/* ⚠️ UNE CONSULTATION S'OUVRE, LE RESTE SE LIT. La porte rend `c.id`
              comme `event_id` pour ce type (048) : le lien est direct, sans
              lecture supplémentaire. Les autres événements n'ont pas d'écran
              propre — les rendre cliquables promettrait une destination qui
              n'existe pas. */}
          {evenement.eventType === "consultation" ? (
            <Link
              href={`/consultation/${evenement.eventId}`}
              aria-label={`${LIBELLES[evenement.labelKey]} — ${fr.patients.actions.ouvrirConsultation}`}
              className="rounded font-ui text-body font-medium text-ink-900 underline decoration-rule underline-offset-4 outline-none transition duration-instant ease-soft hover:decoration-action-600 focus-visible:outline focus-visible:outline-action-600 focus-visible:outline-offset"
            >
              {LIBELLES[evenement.labelKey]}
            </Link>
          ) : (
            <span className="font-ui text-body font-medium text-ink-900">
              {LIBELLES[evenement.labelKey]}
            </span>
          )}
          <span className="font-ui text-label tracking-label text-ink-500 tabular-nums">
            {jour ?? fr.etats.texteAbsent}
            {h === null ? null : ` · ${h}`}
          </span>
        </div>

        {detail === null ? null : (
          <span className="min-w-0 break-words font-ui text-body text-ink-700">{detail}</span>
        )}

        {evenement.practitionerName === null ? null : (
          <span className="font-ui text-label tracking-label text-ink-500">
            {evenement.practitionerName}
          </span>
        )}
      </div>
    </li>
  );
}

export function ChronologiePatient({
  patientId,
}: {
  readonly patientId: string;
}): React.JSX.Element {
  const [evenements, setEvenements] = useState<readonly TimelineEvent[]>([]);
  const [curseur, setCurseur] = useState<TimelineCursor | null>(null);
  const [fini, setFini] = useState(false);
  const [chargement, setChargement] = useState(true);
  const [messageErreur, setMessageErreur] = useState<string | undefined>(undefined);

  useEffect(() => {
    let annule = false;

    // Premier chargement seulement : les pages suivantes passent par
    // `chargerPlus`, qui ne remonte pas ici.
    setChargement(true);
    void listPatientTimeline(patientId, null).then((result) => {
      if (annule) return;
      setChargement(false);
      if (!result.ok) {
        setMessageErreur(result.error.message);
        return;
      }
      setEvenements(result.data.evenements);
      setCurseur(result.data.curseurSuivant);
      setFini(result.data.curseurSuivant === null);
    });

    return () => {
      annule = true;
    };
  }, [patientId]);

  function chargerPlus(): void {
    if (curseur === null || chargement) return;
    setChargement(true);
    void listPatientTimeline(patientId, curseur).then((result) => {
      setChargement(false);
      if (!result.ok) {
        setMessageErreur(result.error.message);
        return;
      }
      // Concaténation : le keyset garantit qu'aucun événement déjà affiché ne
      // revient, même si de nouveaux se sont insérés entre-temps.
      setEvenements((precedents) => [...precedents, ...result.data.evenements]);
      setCurseur(result.data.curseurSuivant);
      setFini(result.data.curseurSuivant === null);
    });
  }

  if (chargement && evenements.length === 0) {
    return <Squelette lignes={6} />;
  }

  if (messageErreur !== undefined && evenements.length === 0) {
    return <EtatVide message={messageErreur} />;
  }

  if (evenements.length === 0) {
    return <EtatVide message={fr.patients.vide.chronologie} icone="suivi" />;
  }

  // Intertitres par mois : un flux de cinquante lignes sans repère temporel
  // oblige à lire chaque date pour se situer.
  let moisCourant: string | null = null;

  return (
    <div className="flex flex-col gap-4">
      <ul className="m-0 list-none p-0">
        {evenements.map((e) => {
          const mois = moisLong(e.occurredAt);
          const nouveauMois = mois !== null && mois !== moisCourant;
          if (nouveauMois) moisCourant = mois;

          return (
            <li key={`${e.eventId}-${e.labelKey}`} className="list-none">
              {nouveauMois ? (
                <h3 className="mt-4 border-b border-rule pb-2 font-ui text-label font-medium tracking-label text-ink-500 first:mt-0">
                  {mois}
                </h3>
              ) : null}
              <ul className="m-0 list-none p-0">
                <LigneEvenement evenement={e} />
              </ul>
            </li>
          );
        })}
      </ul>

      {messageErreur !== undefined ? (
        <p role="alert" className="font-ui text-body text-attention-ink">
          {messageErreur}
        </p>
      ) : null}

      {fini ? (
        // Une fin explicite, pas un bouton inerte : le dossier a un début, et
        // le dire évite de chercher s'il manque quelque chose.
        <p className="py-2 font-ui text-label tracking-label text-ink-500">
          {fr.patients.vide.chronologieFin}
        </p>
      ) : (
        <Bouton rang="secondaire" onClick={chargerPlus} disabled={chargement}>
          {chargement ? fr.etats.chargement : fr.patients.actions.chargerPlus}
        </Bouton>
      )}
    </div>
  );
}
