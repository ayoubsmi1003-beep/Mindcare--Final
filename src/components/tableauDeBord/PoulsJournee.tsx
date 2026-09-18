"use client";

/**
 * LE POULS DE LA JOURNÉE — V8 « Aurora ».
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * D'OÙ VIENNENT CES CHIFFRES, ET POURQUOI IL N'Y EN A PAS D'AUTRES
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ⚠️ ZÉRO APPEL SERVEUR. Tout ce que ce fichier affiche est DÉJÀ dans l'objet
 * `TableauDeBord` rendu par `app.dashboard_today` (059) : la journée créneau
 * par créneau, la salle d'attente, la caisse, les nouveaux dossiers du mois.
 * Le budget de l'écran — un seul appel réseau, contrôle nommé du checkpoint V4
 * — est donc tenu par construction, pas par vigilance.
 *
 * ⚠️ LA CHARGE HORAIRE ET LA RÉPARTITION PAR STATUT SONT DES REGROUPEMENTS,
 * PAS DES CALCULS MÉTIER. Compter combien de créneaux d'une liste déjà chargée
 * commencent à 9 h, ou combien portent le statut `completed`, n'invente aucune
 * donnée : c'est la même liste, lue autrement. La distinction compte — une
 * MOYENNE, un TAUX D'OCCUPATION ou une ÉVOLUTION « vs hier » exigeraient
 * respectivement une durée de référence, une capacité et une seconde journée,
 * dont aucune n'existe dans le contrat de lecture. Ils ne sont donc pas là.
 *
 * ⚠️ PAS DE COURBE DE TENDANCE SUR CES TUILES. `Tuile` accepte une série et
 * n'en reçoit aucune ici : `dashboard_today` ne rend qu'UNE journée. Une
 * étincelle demanderait une série historique, et la fabriquer pour meubler la
 * tuile serait exactement la donnée fictive que la règle 8 interdit. La place
 * reste vide plutôt que remplie de faux.
 */

import { Anneau, FriseHeures, type CreneauFrise, type PartAnneau } from "@/components/ui/Graphes";
import { Tuile, TuileVedette } from "@/components/ui/Tuile";
import { fr } from "@/i18n/fr";
import type { CaisseDuJour, CreneauDuJour } from "@/services/dashboard";
import { formaterDzd } from "@/services/finance-cash";

import { heureCabinet } from "./heures";

/* ═══════════════════════════════════════════════════════════════════════════
 * LES QUATRE TUILES
 * ═══════════════════════════════════════════════════════════════════════════ */

export function TuilesJournee({
  journee,
  attenteNombre,
  nouveauxPatientsMois,
  encaisse,
}: {
  readonly journee: readonly CreneauDuJour[];
  readonly attenteNombre: number;
  readonly nouveauxPatientsMois: number;
  readonly encaisse: CaisseDuJour | null;
}): React.JSX.Element {
  const t = fr.tableauDeBord.v8;

  const terminees = journee.filter(
    (c) => c.status === "completed" || c.status === "no_show",
  ).length;

  const attenteTexte =
    attenteNombre === 0
      ? t.poulsPersonne
      : attenteNombre === 1
        ? t.poulsUnPatient
        : t.poulsPatients.replace("{n}", String(attenteNombre));

  const nouveauxTexte =
    nouveauxPatientsMois === 0
      ? t.poulsAucunDossier
      : nouveauxPatientsMois === 1
        ? t.poulsUnDossier
        : t.poulsDossiers.replace("{n}", String(nouveauxPatientsMois));

  return (
    <div className="grid grid-cols-un items-stretch gap-4 tablet:grid-cols-deux desktop:grid-cols-quatre">
      <Tuile
        ton="menthe"
        icone="agenda"
        etiquette={t.poulsSeances}
        aide={t.poulsSeancesAide}
        valeur={String(journee.length)}
        sousLigne={t.poulsTermineesSur.replace("{n}", String(terminees))}
      />
      <Tuile
        ton="azur"
        icone="patients"
        etiquette={t.poulsAttente}
        aide={t.poulsAttenteAide}
        valeur={String(attenteNombre)}
        sousLigne={attenteTexte}
      />
      <Tuile
        ton="lavande"
        icone="patients"
        etiquette={t.poulsNouveaux}
        aide={t.poulsNouveauxAide}
        valeur={String(nouveauxPatientsMois)}
        sousLigne={nouveauxTexte}
      />
      {/* LA VEDETTE — l'argent du jour. Une seule par écran : hiérarchiser
          tout revient à ne rien hiérarchiser. `encaisse === null` rend « — »
          et non « 0 DZD » : zéro serait un chiffre affirmé là où la porte n'a
          rien rendu, et les deux ne veulent pas dire la même chose. */}
      <TuileVedette
        materiau="nuit"
        icone="finances"
        etiquette={t.poulsEncaisse}
        aide={t.poulsEncaisseAide}
        valeur={encaisse === null ? fr.etats.texteAbsent : formaterDzd(encaisse.montantDzd)}
        sousLigne={
          encaisse === null
            ? fr.tableauDeBord.caisse.rien
            : encaisse.perimetre === "cabinet"
              ? fr.tableauDeBord.caisse.perimetreCabinet
              : fr.tableauDeBord.caisse.perimetrePraticienne
        }
      />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * LA CHARGE HORAIRE
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Une colonne par heure RÉELLEMENT OCCUPÉE, de la première à la dernière.
 *
 * ⚠️ LES BORNES VIENNENT DES DONNÉES, PAS D'UN HORAIRE D'OUVERTURE CODÉ EN
 * DUR. Écrire « 8 h → 19 h » supposerait des horaires de cabinet qu'aucune
 * table ne déclare : une journée de trois séances le matin afficherait alors
 * huit colonnes vides, et un écran majoritairement vide se lit comme une panne
 * d'affichage. Les heures creuses ENTRE deux séances sont conservées, elles —
 * c'est un trou dans la journée, et un trou est une information.
 */
export function ChargeJournee({
  journee,
}: {
  readonly journee: readonly CreneauDuJour[];
}): React.JSX.Element {
  const t = fr.tableauDeBord.v8;

  if (journee.length === 0) {
    return <p className="font-ui text-body text-ink-500">{t.chargeVide}</p>;
  }

  // L'heure d'un créneau, telle qu'elle se lit AU CABINET (Africa/Algiers).
  // `heureCabinet` rend « 08:30 » ; on ne garde que l'heure pleine.
  const parHeure = new Map<string, number>();
  for (const c of journee) {
    const h = heureCabinet(c.startsAt).slice(0, 2);
    parHeure.set(h, (parHeure.get(h) ?? 0) + 1);
  }

  const heures = [...parHeure.keys()].sort();
  const premiere = Number(heures[0] ?? "0");
  const derniere = Number(heures[heures.length - 1] ?? "0");

  const creneaux: CreneauFrise[] = [];
  for (let h = premiere; h <= derniere; h += 1) {
    const cle = String(h).padStart(2, "0");
    const n = parHeure.get(cle) ?? 0;
    creneaux.push({
      cle,
      heure: `${cle}:00`,
      n,
      titre: t.chargeCreneau.replace("{heure}", `${cle}:00`).replace("{n}", String(n)),
    });
  }

  return (
    <FriseHeures
      creneaux={creneaux}
      famille="aqua"
      titreTableau={t.chargeTableau}
      colonneLabel={fr.graphes.colonneHeure}
      colonneValeur={fr.graphes.colonneSeances}
    />
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * LA RÉPARTITION PAR STATUT
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * L'anneau des statuts.
 *
 * Les libellés viennent de `fr.tableauDeBord.fil.statut`, le MÊME dictionnaire
 * que le fil de la journée. Recopier les cinq chaînes ici les ferait diverger
 * le jour où l'une seule change — et deux mots différents pour le même statut,
 * sur le même écran, à trente centimètres l'un de l'autre.
 *
 * L'ORDRE EST CELUI DU CYCLE DE VIE (attendu → arrivé → en séance → terminé →
 * absent), et non celui des effectifs. Un anneau dont les parts changent de
 * place à chaque rafraîchissement ne se lit pas : la position devient une
 * information à recalculer au lieu d'une habitude.
 */
const ORDRE_STATUTS = ["confirmed", "arrived", "in_session", "completed", "no_show"] as const;

export function RepartitionStatuts({
  journee,
}: {
  readonly journee: readonly CreneauDuJour[];
}): React.JSX.Element {
  const t = fr.tableauDeBord.v8;

  if (journee.length === 0) {
    return <p className="font-ui text-body text-ink-500">{t.repartitionVide}</p>;
  }

  const parts: PartAnneau[] = [];
  for (const statut of ORDRE_STATUTS) {
    const n = journee.filter((c) => c.status === statut).length;
    if (n === 0) continue;
    parts.push({
      cle: statut,
      label: fr.tableauDeBord.fil.statut[statut],
      // ⚠️ CE POURCENTAGE EST UNE LONGUEUR D'ARC, PAS UN INDICATEUR. Il n'est
      // jamais affiché : la légende porte l'EFFECTIF (« 3 »), qui est ce que
      // la praticienne compte réellement. Un pourcentage sur cinq rendez-vous
      // afficherait « 20 % » pour un seul patient, ce qui donne à un petit
      // nombre l'allure d'une statistique.
      pct: (n * 100) / journee.length,
      valeurLisible: String(n),
    });
  }

  return (
    <Anneau
      parts={parts}
      centreValeur={String(journee.length)}
      centreLibelle={t.repartitionCentre}
      titreTableau={t.repartitionTableau}
      colonneLabel={fr.graphes.colonnePeriode}
      colonneValeur={fr.graphes.colonneSeances}
    />
  );
}
