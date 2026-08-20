/**
 * Le jeu d'icônes — dessiné ici, pas installé.
 *
 * ── POURQUOI AUCUNE DÉPENDANCE ────────────────────────────────────────────
 *
 * Le dépôt compte CINQ dépendances de production. Cette retenue est une
 * posture, pas un hasard : chaque paquet ajouté est une surface à auditer sur
 * un produit qui manipule des dossiers psychiatriques, et la trajectoire du
 * projet (D-17, auto-hébergement, poste sans réseau garanti) la confirme.
 *
 * Mais la vraie raison est ailleurs : une bibliothèque tierce donne les mêmes
 * icônes qu'à tout le monde. Le logo de MindCare est un trait blanc organique —
 * un cerveau composé de feuilles et de vrilles. Ces seize tracés en reprennent
 * la langue : trait de 1.75, terminaisons et jonctions ARRONDIES, aucune pointe.
 * C'est ce qui fait qu'une icône de cette interface ressemble à ce logo et pas à
 * un autre produit. Une identité ne s'installe pas depuis npm.
 *
 * ── CE QUI NE VARIE PAS ───────────────────────────────────────────────────
 *
 * Grille de 24, `viewBox` de 24, trait de 1.75 — les trois ensemble. Un tracé
 * dessiné sur une autre grille se repère immédiatement dans une colonne de
 * navigation : les contours ne s'alignent plus. Le trait ne s'épaissit jamais
 * pour « faire plus visible » : c'est la couleur qui porte l'emphase, et elle a
 * des jetons pour ça.
 *
 * `currentColor` PARTOUT, aucun `fill`. L'icône prend la couleur de son texte,
 * donc son contraste est celui du texte à côté d'elle — déjà vérifié. Une icône
 * qui porte sa propre couleur est une couleur de plus à mesurer, et personne ne
 * la mesure.
 *
 * ── ACCESSIBILITÉ ─────────────────────────────────────────────────────────
 *
 * `aria-hidden` par DÉFAUT. Dans cette interface une icône accompagne toujours
 * un libellé écrit ; l'annoncer une seconde fois au lecteur d'écran ferait dire
 * « Patients Patients ». Une icône réellement seule passe `titre`, et devient
 * alors une image nommée. Le défaut est celui du cas fréquent, et l'exception
 * doit s'écrire — jamais l'inverse.
 */

import type { NomEcran } from "@/i18n/fr";

/**
 * Les noms d'icônes REPRENNENT les clés d'écran de `fr.nav.ecrans`, plus quatre
 * icônes d'interface. Ce n'est pas une commodité de nommage : `TRACES` étant un
 * `Record<NomIcone, …>`, ajouter un écran à `fr.nav.ecrans` sans lui dessiner de
 * tracé ne compile pas. La navigation écrit donc `<Icone nom={ecranKey} />`
 * sans table de correspondance à tenir à jour — et sans qu'un écran neuf puisse
 * atteindre le rail avec un trou à la place de son icône.
 */
export type NomIcone =
  | NomEcran
  | "deconnexion"
  | "recherche"
  | "jarvis"
  | "chevron";

/** Trait commun. Aucune icône ne le redéfinit. */
const TRAIT = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

/**
 * Les tracés, sur une grille de 24.
 *
 * Chacun est composé de segments arrondis et de courbes douces : ni angle vif,
 * ni ligne qui se termine net. C'est la contrainte formelle héritée du logo, et
 * elle est plus stricte qu'elle n'en a l'air — elle interdit par exemple
 * l'engrenage habituel des « paramètres », dont les dents sont anguleuses par
 * construction. D'où des curseurs, qui disent la même chose en rond.
 */
const TRACES: Record<NomIcone, React.JSX.Element> = {
  // Quatre surfaces égales — la vue d'ensemble, avant qu'aucune ne domine.
  tableauDeBord: (
    <>
      <rect x="3.2" y="3.2" width="7.6" height="7.6" rx="2.4" />
      <rect x="13.2" y="3.2" width="7.6" height="7.6" rx="2.4" />
      <rect x="3.2" y="13.2" width="7.6" height="7.6" rx="2.4" />
      <rect x="13.2" y="13.2" width="7.6" height="7.6" rx="2.4" />
    </>
  ),
  // Deux personnes, la seconde en retrait : un dossier n'est jamais seul.
  patients: (
    <>
      <circle cx="9.2" cy="8" r="3.4" />
      <path d="M3.2 19.6c0-3.1 2.7-5 6-5s6 1.9 6 5" />
      <path d="M16.2 5.2a3.4 3.4 0 0 1 0 5.9" />
      <path d="M17.4 15.1c2.1.7 3.4 2.3 3.4 4.5" />
    </>
  ),
  // Un calendrier, et le point du jour courant.
  agenda: (
    <>
      <rect x="3.2" y="5.2" width="17.6" height="15.6" rx="3.2" />
      <path d="M8.4 3.2v4M15.6 3.2v4M3.2 10.4h17.6" />
      <circle cx="8.6" cy="14.8" r="1.15" />
    </>
  ),
  // Une bulle dont la pointe est, elle aussi, arrondie.
  messages: (
    <path d="M20.8 12.2a7.9 7.9 0 0 1-7.9 7.9H7.6l-3.7 2.7 1.1-4.1a7.9 7.9 0 0 1 7.9-11.4h.1a7.9 7.9 0 0 1 7.8 4.9z" />
  ),
  // Une page et son coin replié — le geste qui dit « document » sans mot.
  documents: (
    <>
      <path d="M14.2 3.2H7.4a2.6 2.6 0 0 0-2.6 2.6v12.4a2.6 2.6 0 0 0 2.6 2.6h9.2a2.6 2.6 0 0 0 2.6-2.6V8.2z" />
      <path d="M14.2 3.2v3.4a1.6 1.6 0 0 0 1.6 1.6h3.4" />
    </>
  ),
  // Une gélule, en diagonale, avec son joint.
  traitements: (
    <>
      <path d="M10.6 3.9 3.9 10.6a4.75 4.75 0 0 0 6.7 6.7l6.7-6.7a4.75 4.75 0 0 0-6.7-6.7z" />
      <path d="M7.25 7.25l6.7 6.7" />
    </>
  ),
  // Une courbe qui monte. Sans chiffre : ce n'est pas une donnée, c'est un mot.
  suivi: (
    <>
      <path d="M3.4 16.4l5.1-5.1 3.4 3.4 8-8" />
      <path d="M15.3 6.7h4.6v4.6" />
    </>
  ),
  // Un billet. Pas un symbole monétaire : le dinar n'en a pas d'universel.
  finances: (
    <>
      <rect x="2.6" y="6.2" width="18.8" height="11.6" rx="3.2" />
      <circle cx="12" cy="12" r="2.7" />
      <path d="M6.4 10.4v3.2M17.6 10.4v3.2" />
    </>
  ),
  // Trois barres. La comparaison, réduite à sa forme.
  statistiques: (
    <>
      <path d="M6.2 19.4v-5.6M12 19.4V5.4M17.8 19.4v-8.8" />
      <path d="M3.4 20.8h17.2" />
    </>
  ),
  // Une présence qui rayonne — c'est Jarvis, vu de loin.
  agents: (
    <>
      <circle cx="12" cy="12" r="4.6" />
      <path d="M12 3.2v1.9M12 18.9v1.9M3.2 12h1.9M18.9 12h1.9" />
    </>
  ),
  // Des événements, chacun précédé de sa marque.
  journalActivite: (
    <>
      <circle cx="4.6" cy="6.4" r="1.15" />
      <circle cx="4.6" cy="12" r="1.15" />
      <circle cx="4.6" cy="17.6" r="1.15" />
      <path d="M8.6 6.4h11.8M8.6 12h11.8M8.6 17.6h7.8" />
    </>
  ),
  // Des curseurs, pas un engrenage : une dent est anguleuse, et rien ici ne
  // l'est. Ils disent mieux « réglable », en plus.
  parametres: (
    <>
      <path d="M3.4 7.6h8.2M16.2 7.6h4.4" />
      <circle cx="13.9" cy="7.6" r="2.3" />
      <path d="M3.4 16.4h4.4M12.4 16.4h8.2" />
      <circle cx="10.1" cy="16.4" r="2.3" />
    </>
  ),
  // Sortir. La flèche quitte le cadre, elle n'y rentre pas.
  deconnexion: (
    <>
      <path d="M14.4 3.8H6.6a2.6 2.6 0 0 0-2.6 2.6v11.2a2.6 2.6 0 0 0 2.6 2.6h7.8" />
      <path d="M10.4 12h9.8M17.2 8.8l3.2 3.2-3.2 3.2" />
    </>
  ),
  recherche: (
    <>
      <circle cx="10.9" cy="10.9" r="6.5" />
      <path d="M15.7 15.7l4.7 4.7" />
    </>
  ),
  // L'étincelle — la seule icône qui porte l'IA, et elle ne sert qu'à ça.
  jarvis: (
    <>
      <path d="M10.4 3.4l1.7 4.4 4.4 1.7-4.4 1.7-1.7 4.4-1.7-4.4L4.3 9.5l4.4-1.7z" />
      <path d="M17.6 14.6l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" />
    </>
  ),
  chevron: <path d="M9.2 4.8l7.2 7.2-7.2 7.2" />,
};

export interface IconeProps {
  readonly nom: NomIcone;
  /**
   * 20 pour une icône accolée à du texte de corps, 24 dans la navigation.
   * L'échelle s'arrête là : au-delà, un tracé de 1.75 paraît fin et grêle, et
   * l'épaissir romprait l'alignement avec toutes les autres.
   */
  readonly taille?: 20 | 24;
  /**
   * À ne renseigner QUE si l'icône est seule, sans libellé écrit à côté.
   * Sinon le lecteur d'écran annonce deux fois la même chose.
   */
  readonly titre?: string;
  readonly className?: string;
}

export function Icone({
  nom,
  taille = 24,
  titre,
  className,
}: IconeProps): React.JSX.Element {
  const decorative = titre === undefined;

  return (
    <svg
      width={taille}
      height={taille}
      viewBox="0 0 24 24"
      role={decorative ? undefined : "img"}
      aria-hidden={decorative ? true : undefined}
      aria-label={titre}
      /* `shrink-0` : dans une ligne de navigation, un libellé long ne doit
         jamais comprimer l'icône — une icône écrasée à 18px de large casse
         l'alignement de toute la colonne. */
      className={["shrink-0", className ?? ""].join(" ")}
      {...TRAIT}
    >
      {TRACES[nom]}
    </svg>
  );
}

/**
 * Le mark du logo — le cerveau de feuilles, redessiné à la grille du système.
 *
 * ⚠️ CE N'EST PAS `docs/Mindcare mark.svg`. Ce fichier-là fait 26 Ko, porte un
 * `<rect>` de fond OPAQUE (il ne se pose donc pas sur un dégradé) et décrit son
 * tracé en centaines de courbes issues d'une vectorisation automatique. Le
 * poser tel quel dans le rail aurait chargé 26 Ko pour un objet de 32px, avec
 * un fond qui aurait fait un carré clair au milieu du dégradé.
 *
 * Ici : la même idée — deux hémisphères composés de feuilles — au trait, en
 * `currentColor`, donc blanc sur la marque sans qu'on ait à le dire. Le fichier
 * d'origine reste la référence de la praticienne pour l'impression.
 */
export function MarqueMindCare({
  taille = 32,
  titre,
}: {
  readonly taille?: number;
  readonly titre?: string;
}): React.JSX.Element {
  const decorative = titre === undefined;

  return (
    <svg
      width={taille}
      height={taille}
      viewBox="0 0 24 24"
      role={decorative ? undefined : "img"}
      aria-hidden={decorative ? true : undefined}
      aria-label={titre}
      className="shrink-0"
      {...TRAIT}
      strokeWidth={1.5}
    >
      {/* Le sillon central — les deux hémisphères ne se touchent pas. */}
      <path d="M12 4.4v15.2" />
      {/* Hémisphère gauche */}
      <path d="M12 5.2a3.1 3.1 0 0 0-5 1.2 2.9 2.9 0 0 0-2.2 4.3 3 3 0 0 0 .5 4.2 3.1 3.1 0 0 0 2.9 3.4 2.8 2.8 0 0 0 3.8 1.3" />
      {/* Hémisphère droit */}
      <path d="M12 5.2a3.1 3.1 0 0 1 5 1.2 2.9 2.9 0 0 1 2.2 4.3 3 3 0 0 1-.5 4.2 3.1 3.1 0 0 1-2.9 3.4 2.8 2.8 0 0 1-3.8 1.3" />
      {/* Quatre feuilles — le motif qui distingue ce cerveau d'un pictogramme
          médical. Deux par hémisphère, orientées vers l'extérieur. */}
      <path d="M9.6 8.6c-1.1-.5-2.2-.2-2.7.7.9.6 2 .5 2.7-.7zM9.6 14.4c-1.1.5-2.2.2-2.7-.7.9-.6 2-.5 2.7.7z" />
      <path d="M14.4 8.6c1.1-.5 2.2-.2 2.7.7-.9.6-2 .5-2.7-.7zM14.4 14.4c1.1.5 2.2.2 2.7-.7-.9-.6-2-.5-2.7.7z" />
    </svg>
  );
}
