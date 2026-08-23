/**
 * La surface d'attention — LE plafond dur du cockpit : jamais plus de NEUF
 * items actionnables dans la zone principale.
 *
 * ⚠️ CE FICHIER EST PUR. Aucun réseau, aucun état, aucune horloge interne :
 * `maintenant` arrive en argument, ce qui rend la priorité testable sans
 * runner et reproductible au checkpoint (contrôle « ≤ 9 items »).
 *
 * PRIORISATION STRICTEMENT OPÉRATIONNELLE — jamais médicale, jamais inférée :
 *   1. paiement à encaisser        — l'argent attendu en caisse
 *   2. rendez-vous en retard       — l'heure de début est passée, pas arrivé
 *   3. patient en salle d'attente  — par attente DÉCROISSANTE
 *   4. rendez-vous imminent        — commence dans moins de 15 min
 *   5. demande à confirmer         — file `requested`
 *
 * Au-delà de neuf : les suivants sont comptés et annoncés (« N autres »),
 * jamais perdus — les files dédiées ci-dessous portent l'intégralité des
 * données. Aucune donnée clinique ne transite ici : le type d'entrée est le
 * contrat de lecture du board (046), administratif par construction.
 */

import type { PaiementAccueil, RdvAccueil } from "@/services/reception";

/** Seuil « imminent » : un RDV commençant dans moins de 15 min réclame l'œil. */
const SEUIL_IMMINENT_MIN = 15;

export type ItemAttention =
  | { readonly type: "paiement"; readonly cle: string; readonly paiement: PaiementAccueil }
  | { readonly type: "retard"; readonly cle: string; readonly rdv: RdvAccueil }
  | {
      readonly type: "attente";
      readonly cle: string;
      readonly rdv: RdvAccueil;
      /** Minutes écoulées depuis `arrived_at` — calculé ICI, une seule fois. */
      readonly minutesAttente: number;
    }
  | { readonly type: "imminent"; readonly cle: string; readonly rdv: RdvAccueil }
  | { readonly type: "demande"; readonly cle: string; readonly rdv: RdvAccueil };

export interface ResultatAttention {
  readonly affiches: readonly ItemAttention[];
  readonly restants: number;
}

function minutesDepuis(iso: string | null, maintenant: Date): number {
  if (iso === null) return 0;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((maintenant.getTime() - t) / 60000));
}

export function itemsAttention(
  journee: readonly RdvAccueil[],
  demandes: readonly RdvAccueil[],
  paiements: readonly PaiementAccueil[],
  maintenant: Date,
): ResultatAttention {
  const items: ItemAttention[] = [];

  for (const paiement of paiements) {
    if (paiement.collectedAt === null) {
      items.push({ type: "paiement", cle: `paiement:${paiement.paymentId}`, paiement });
    }
  }

  for (const rdv of journee) {
    if (rdv.patientId === null && rdv.status !== "confirmed") continue;

    if (rdv.status === "confirmed") {
      const debut = Date.parse(rdv.startsAt);
      if (Number.isNaN(debut)) continue;
      const ecartMin = Math.floor((maintenant.getTime() - debut) / 60000);
      // Le retard se mesure sur la journée affichée uniquement ; un RDV futur
      // n'est ni retard ni imminent avant son seuil.
      if (ecartMin > 0) {
        items.push({ type: "retard", cle: `rdv:${rdv.id}`, rdv });
      } else if (-ecartMin < SEUIL_IMMINENT_MIN) {
        items.push({ type: "imminent", cle: `rdv:${rdv.id}`, rdv });
      }
    }

    if (rdv.status === "arrived") {
      items.push({
        type: "attente",
        cle: `rdv:${rdv.id}`,
        rdv,
        minutesAttente: minutesDepuis(rdv.arrivedAt, maintenant),
      });
    }
  }

  // Salle d'attente triée par attente décroissante AVANT l'assemblage final :
  // la priorité relative entre deux patients qui attendent est le chrono.
  const attentes = items
    .filter((i): i is Extract<ItemAttention, { type: "attente" }> => i.type === "attente")
    .sort((a, b) => b.minutesAttente - a.minutesAttente);

  for (const rdv of demandes) {
    items.push({ type: "demande", cle: `demande:${rdv.id}`, rdv });
  }

  const ordonnees = [
    ...items.filter((i) => i.type === "paiement"),
    ...items.filter((i) => i.type === "retard"),
    ...attentes,
    ...items.filter((i) => i.type === "imminent"),
    ...items.filter((i) => i.type === "demande"),
  ];

  return { affiches: ordonnees.slice(0, 9), restants: Math.max(0, ordonnees.length - 9) };
}
