/**
 * Test de connexion — LECTURE SEULE, aucun effet provider.
 *
 * Dit QUELLES capacités MindCare sont réellement disponibles sur le compte
 * connecté (découverte live + motifs), sans jamais écrire, envoyer ni
 * publier. C'est le « juste vérifier que la Page est connectée » : le bilan
 * répond connecté/non-connecté + capacités une par une.
 */
import { randomUUID } from "node:crypto";

import { listerOutilsComposio } from "@/server/egress/external-call";

import { OUTILS_COMMUNICATION, resoudreSlug } from "./registre-outils";

export type CanalTestable = "whatsapp" | "facebook" | "instagram";

const TOOLKITS: Readonly<Record<CanalTestable, readonly string[]>> = {
  whatsapp: ["whatsapp"],
  facebook: ["facebook"],
  instagram: ["instagram"],
};

export interface CapaciteBilan {
  readonly nom: string;
  readonly disponible: boolean;
}

export interface BilanConnexion {
  readonly canal: CanalTestable;
  readonly connecte: boolean;
  readonly capacites: readonly CapaciteBilan[];
}

export async function testerConnexion(canal: CanalTestable): Promise<BilanConnexion> {
  const capacites: CapaciteBilan[] = [];
  let decouverteOk = false;

  for (const toolkit of TOOLKITS[canal]) {
    const liste = await listerOutilsComposio(toolkit, randomUUID());
    if (!liste.ok) continue;
    decouverteOk = true;
    for (const outil of OUTILS_COMMUNICATION) {
      if (outil.toolkit !== toolkit) continue;
      capacites.push({
        nom: outil.nom,
        disponible: resoudreSlug(outil.motifs, liste.data) !== null,
      });
    }
  }

  return {
    canal,
    connecte: decouverteOk && capacites.some((c) => c.disponible),
    capacites,
  };
}
