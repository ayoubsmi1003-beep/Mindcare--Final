/**
 * LES ILLUSTRATIONS — V8 « Aurora ». Une seule direction artistique.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POURQUOI DES ILLUSTRATIONS, ALORS QUE V7 LES AVAIT INTERDITES
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `05-UX-CONTRACT` §3 écrivait « jamais d'illustration » dans les états vides,
 * et la raison était bonne : les mascottes et les scènes rigolotes des produits
 * grand public sont déplacées dans un cabinet, et elles remplacent souvent la
 * phrase qui expliquerait POURQUOI c'est vide.
 *
 * La règle qui survit est la seconde, pas la première. UNE ILLUSTRATION
 * N'EXCUSE JAMAIS UNE PHRASE ABSENTE : chaque composant ci-dessous est posé À
 * CÔTÉ d'un texte qui dit pourquoi l'écran est vide et propose un geste. Ce
 * qu'elle ajoute, c'est que le « rien » ait été COMPOSÉ — la différence entre
 * un écran qui n'a pas de données et un écran qui a l'air cassé.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * LA DIRECTION : DUOTONE GÉOMÉTRIQUE, PAS DE PERSONNAGE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Un seul vocabulaire de formes — arcs, disques, filets — dans deux tons d'une
 * même famille plus un accent. Aucun visage, aucune main, aucun objet
 * représenté au trait : une silhouette humaine dans un logiciel de psychiatrie
 * finit toujours par ressembler à un patient, et personne ne veut d'un patient
 * dessiné là où il devrait y en avoir un vrai.
 *
 * ⚠️ JAMAIS DANS UN DOSSIER CLINIQUE ACTIF. Ces scènes vivent dans les états
 * vides, l'accueil et les exceptions. Une décoration à côté d'une note signée
 * ou d'une posologie brouille ce qui est une donnée et ce qui n'en est pas.
 *
 * ⚠️ `aria-hidden` SANS EXCEPTION. Elles ne portent aucune information : la
 * phrase à côté la porte. Les annoncer ferait entendre « image » à un lecteur
 * d'écran avant le seul texte utile de l'écran.
 */

/** Le vocabulaire fermé. Un nom = une scène, pas un catalogue extensible. */
export type NomScene = "agendaVide" | "dossierVide" | "documentVide" | "assistanteAuRepos";

/**
 * Les familles de chaque scène. Elles suivent le SUJET, jamais l'humeur :
 * l'agenda est aqua parce que l'agenda est aqua partout dans le produit, pas
 * parce qu'une journée vide serait « calme ».
 */
/*
 * ⚠️ LES TONS ONT ÉTÉ REMONTÉS APRÈS UNE PASSE DE CRITIQUE VISUELLE.
 *
 * Première version : socle en ton 100, formes en ton 200. Vu à l'écran, la
 * scène de l'agenda vide rendait un disque bleu très pâle portant une carte
 * BLANCHE — deux valeurs si proches que le dessin se lisait comme une tache,
 * et à 130 px on ne distinguait plus le calendrier du fond. Une illustration
 * qu'on ne reconnaît pas est pire qu'une icône : elle occupe la place d'une
 * explication sans rien expliquer.
 *
 * Le socle passe donc au ton 200 et les formes au ton 400 : trois valeurs
 * franchement écartées, et le blanc de la carte redevient le point le plus
 * clair de la composition, donc son sujet.
 */
const TONS: Record<NomScene, { readonly clair: string; readonly moyen: string; readonly accent: string }> = {
  agendaVide: {
    clair: "var(--aqua-200)",
    moyen: "var(--aqua-400)",
    accent: "var(--aqua-700)",
  },
  dossierVide: {
    clair: "var(--emeraude-200)",
    moyen: "var(--emeraude-400)",
    accent: "var(--emeraude-700)",
  },
  documentVide: {
    clair: "var(--ambre-200)",
    moyen: "var(--ambre-400)",
    accent: "var(--ambre-700)",
  },
  assistanteAuRepos: {
    clair: "var(--violet-200)",
    moyen: "var(--violet-400)",
    accent: "var(--violet-600)",
  },
};

/**
 * Une scène.
 *
 * ⚠️ `viewBox` CARRÉ ET `xMidYMid meet` (le défaut) : les formes sont des
 * cercles et des arcs, et un cercle étiré est un ovale — qui se lit comme un
 * défaut de rendu, pas comme un dessin.
 */
export function Scene({
  nom,
  taille = 128,
}: {
  readonly nom: NomScene;
  readonly taille?: number;
}): React.JSX.Element {
  const t = TONS[nom];

  return (
    <svg
      width={taille}
      height={taille}
      viewBox="0 0 120 120"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      {/* LE SOCLE, COMMUN AUX QUATRE SCÈNES. C'est lui qui les fait lire comme
          une famille plutôt que comme quatre dessins : le disque doux, l'arc
          d'horizon, et le même filet d'accent. */}
      <circle cx="60" cy="60" r="46" fill={t.clair} />
      <path
        d="M22 74a38 38 0 0 0 76 0"
        stroke={t.moyen}
        strokeWidth="2"
        strokeLinecap="round"
      />

      {nom === "agendaVide" ? (
        <>
          {/* Une grille de jours, dont un seul est marqué : la journée libre
              n'est pas une absence de calendrier, c'est un calendrier vide. */}
          <rect x="38" y="38" width="44" height="40" rx="8" fill="var(--card)" />
          <rect x="38" y="38" width="44" height="11" rx="8" fill={t.moyen} />
          <circle cx="49" cy="60" r="3" fill={t.moyen} />
          <circle cx="60" cy="60" r="3" fill={t.moyen} />
          <circle cx="71" cy="60" r="3" fill={t.accent} />
          <circle cx="49" cy="70" r="3" fill={t.moyen} />
          <circle cx="60" cy="70" r="3" fill={t.moyen} />
        </>
      ) : null}

      {nom === "dossierVide" ? (
        <>
          <rect x="36" y="34" width="48" height="52" rx="9" fill="var(--card)" />
          <rect x="45" y="46" width="30" height="4" rx="2" fill={t.moyen} />
          <rect x="45" y="56" width="22" height="4" rx="2" fill={t.moyen} />
          <rect x="45" y="66" width="26" height="4" rx="2" fill={t.moyen} />
          <circle cx="78" cy="80" r="10" fill={t.accent} />
          <path d="M74 80h8M78 76v8" stroke="var(--card)" strokeWidth="2.5" strokeLinecap="round" />
        </>
      ) : null}

      {nom === "documentVide" ? (
        <>
          {/* La feuille A5, coin replié — la même forme que l'aperçu réel de
              l'écran Documents. Un état vide qui annonce ce qui va apparaître. */}
          <path
            d="M40 30h28l14 14v46a6 6 0 0 1-6 6H40a6 6 0 0 1-6-6V36a6 6 0 0 1 6-6Z"
            fill="var(--card)"
          />
          <path d="M68 30l14 14H70a2 2 0 0 1-2-2V30Z" fill={t.moyen} />
          <rect x="43" y="56" width="30" height="4" rx="2" fill={t.moyen} />
          <rect x="43" y="66" width="22" height="4" rx="2" fill={t.moyen} />
          <rect x="43" y="76" width="26" height="4" rx="2" fill={t.accent} />
        </>
      ) : null}

      {nom === "assistanteAuRepos" ? (
        <>
          {/* L'orbe au repos, et ses deux anneaux d'écoute. Ils sont DESSINÉS,
              pas animés : l'orbe réel n'anime que ce que la machine rapporte,
              et une illustration qui pulserait promettrait une écoute qui
              n'a pas lieu (règle 8). */}
          <circle cx="60" cy="58" r="30" stroke={t.moyen} strokeWidth="2" />
          <circle cx="60" cy="58" r="21" stroke={t.moyen} strokeWidth="2" />
          <circle cx="60" cy="58" r="13" fill={t.accent} />
          <circle cx="55" cy="53" r="4" fill="var(--card)" opacity="0.55" />
        </>
      ) : null}
    </svg>
  );
}
