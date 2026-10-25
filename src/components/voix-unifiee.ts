"use client";

import { useEffect, useState } from "react";

import { abonnerVoixLocale } from "@/services/alexa-local";
import { abonnerVoix } from "@/services/jarvis-reveil";
import type { VueVoix } from "@/services/jarvis-reveil";

/**
 * La vue vocale unifiée : la boucle (presser-pour-parler) gagne dès qu'elle
 * n'est pas désactivée, sinon c'est la machine du réveil (veille, écoute,
 * traitement, parole). Un seul témoin pour deux machines.
 */
const ETEINTE: VueVoix = { etat: "desactive", raison: null, reveilArme: false, sourceParole: null };

export function useVueVoixUnifiee(): VueVoix {
  const [boucle, setBoucle] = useState<VueVoix | null>(null);
  const [reveil, setReveil] = useState<VueVoix | null>(null);

  useEffect(() => abonnerVoixLocale(setBoucle), []);
  useEffect(() => abonnerVoix(setReveil), []);

  const b = boucle ?? ETEINTE;
  if (b.etat !== "desactive") return b;
  return reveil ?? ETEINTE;
}
