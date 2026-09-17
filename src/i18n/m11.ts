/**
 * `m11.ts` — libellés M11 (palette, brief matin, lecture de journée).
 *
 * Module séparé, `fr.ts` gelé (découpe Phase 6) : précédent `m09.ts`,
 * `resolution.ts`. Fonctions de composition autorisées (précédent
 * `fr.jarvis.contexte.ilYaNMin`) — les chiffres restent calculés par
 * l'appelant, jamais ici.
 */
export const m11 = {
  palette: {
    titre: "Commande",
    invite: "Consigne pour Jarvis",
    envoyer: "Envoyer",
    fermer: "Fermer la commande",
    ouvrir: "Ouvrir la commande",
    vide: "Décrivez ce qu'il faut faire — même conversation que le panneau.",
  },
  brief: {
    titre: "Brief du matin",
    aide: "Point opérations du jour — sans IA, mêmes chiffres que l'écran",
  },
  journee: {
    pause: (duree: string, debut: string, fin: string): string =>
      `Pause de ${duree} (${debut}–${fin}).`,
    retard: (nom: string, minutes: number): string =>
      `${nom} : arrivé avec ${minutes} min de retard.`,
    reste: (nombre: number, prochain: string): string =>
      `${nombre} créneau(x) restant(s), prochain à ${prochain}.`,
    aucunReste: "Journée terminée — plus aucun créneau restant.",
    sansDossier: "Sans dossier",
  },
};
