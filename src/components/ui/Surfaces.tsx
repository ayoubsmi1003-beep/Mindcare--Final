/**
 * Les surfaces : cartes, sections, panneaux, en-têtes, dispositions de fiche.
 *
 * ── LA RÈGLE, ET COMMENT ELLE EST TENUE ───────────────────────────────────
 *
 * Aucune surface qui porte une valeur — nom, dose, score, note, montant, heure
 * — n'admet de dégradé, de verre, de lueur ni de transparence. §4 règle 2, et
 * ce n'est pas une préférence : un texte dont le fond varie change de contraste
 * selon ce qui défile derrière, et « 25 mg » contre « 250 mg » ne se lit pas au
 * conditionnel.
 *
 * V3 a cessé de confier cette règle à la vigilance du relecteur. `Carte`
 * distingue désormais deux familles de niveaux — ceux qui décorent et ceux qui
 * PORTENT — et les seconds REFUSENT `lueur` au niveau du TYPE. Le compilateur
 * dit non avant qu'une revue ait à le dire. C'est l'esprit de la règle 4 de
 * CLAUDE.md — la garantie vit dans le mécanisme, pas dans la consigne —
 * appliqué au design.
 *
 * LA PROFONDEUR VIENT DE L'OMBRE ET DE LA COUCHE, PAS DE L'ACCUMULATION.
 * Trois niveaux d'ombre (`--lift-1/2/3`), froids et verts. Le sol de la page
 * est teinté (`--layer-ambient`) : c'est lui qui détache une carte blanche,
 * et c'est pourquoi une carte n'a plus besoin d'une bordure pour exister.
 */

import type { ReactNode } from "react";

import { Icone, type NomIcone } from "./Icones";

/* ═══════════════════════════════════════════════════════════════════════════
 * LA FAMILLE DE CARTES
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Niveaux qui NE PORTENT PAS de valeur. Le décor y est permis : ce sont des
 * ancrages visuels, des affordances, des surfaces de système.
 */
export type NiveauDecor = "primaire" | "secondaire" | "action" | "ia";

/**
 * Niveaux qui PORTENT une valeur. Opaques, stables, contrastés — et incapables
 * de recevoir une lueur, parce que le type l'interdit.
 */
export type NiveauPorteur = "clinique" | "financier" | "document";

export type NiveauCarte = NiveauDecor | NiveauPorteur;

/**
 * Tous les niveaux sont OPAQUES : la différence est d'élévation, de teinte de
 * bordure et d'accent, jamais de transparence. Une carte translucide n'existe
 * nulle part dans ce système, y compris parmi les niveaux décoratifs — le verre
 * est réservé au mobilier FLOTTANT (panneau Jarvis, ⌘K), qui ne se compose pas
 * avec `Carte`.
 */
/*
 * V8 — LES OMBRES PASSENT DE `lift*` À LA FAMILLE TEINTÉE.
 *
 * `lift1/2/3` sont des gris neutres. Posés sur le sol V8, qui porte un voile
 * de quatre teintes, ils se lisent comme de la saleté plutôt que comme de la
 * lumière — c'est visible dès qu'on met les deux versions côte à côte, et
 * c'est l'un des défauts qui faisaient paraître V7 plat malgré des ombres
 * correctement dosées.
 *
 * Le changement est fait ICI, sur la primitive partagée, plutôt que dans les
 * quarante écrans qui composent une `Carte` : une carte oubliée se verrait
 * immédiatement, une carte parmi quarante ne se verrait jamais.
 */
const NIVEAUX: Record<NiveauCarte, string> = {
  primaire: "bg-card border-rule shadow-carte",
  // Second plan encastré — creusé, donc sans ombre : une surface en retrait
  // qui porterait une ombre portée avancerait au lieu de reculer.
  secondaire: "bg-sunken border-rule shadow-none",
  action: "bg-action-50 border-action-100 shadow-douce",
  ia: "bg-ai-50 border-ai-100 shadow-douce",
  clinique: "bg-card border-rule shadow-douce",
  financier: "bg-card border-rule shadow-douce",
  // Document — un papier posé, l'ombre la plus marquée du jeu de cartes.
  document: "bg-card border-ink-100 shadow-elevee",
};

interface CarteBase {
  readonly children: ReactNode;
  /**
   * La carte est cliquable dans son ensemble.
   *
   * N'ajoute AUCUNE translation. Une carte qui se soulève sous le curseur
   * déplace la cible qu'on vise, et sur un agenda dense on vise beaucoup. Le
   * survol change l'ombre et la bordure — perceptible, sans mouvement.
   */
  readonly interactive?: boolean;
}

/**
 * ⚠️ L'UNION DISCRIMINÉE EST LE GARDE-FOU. Ne pas l'aplatir en une seule forme
 * avec `lueur?: boolean` : ce serait rendre au relecteur une responsabilité que
 * le compilateur assume aujourd'hui.
 */
export type CarteProps = CarteBase &
  (
    | {
        readonly niveau?: NiveauDecor;
        /**
         * La lueur, et ses trois usages dans tout le produit : navigation
         * active, orbe Jarvis, carte de confirmation. Si tout brille, plus rien
         * n'est spécial.
         */
        readonly lueur?: boolean;
      }
    | {
        readonly niveau: NiveauPorteur;
        /** Interdit ici, et le type le dit. Voir l'en-tête de ce fichier. */
        readonly lueur?: never;
      }
  );

export function Carte(props: CarteProps): React.JSX.Element {
  const { children, interactive = false, niveau = "primaire" } = props;
  const lueur = "lueur" in props && props.lueur === true;

  return (
    <div
      className={[
        // V8 — `rounded-2xl` (26px). Une carte à 10 px se lit comme un
        // composant de framework, à 26 px comme une surface dessinée.
        "rounded-2xl border",
        NIVEAUX[niveau],
        lueur ? "shadow-glow-brand" : "",
        interactive
          ? "transition duration-quick ease-out hover:border-action-500 hover:shadow-elevee"
          : "transition duration-quick ease-soft",
      ].join(" ")}
    >
      {children}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * LA PASTILLE D'ICÔNE — le motif qui porte l'identité
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Un carré arrondi teinté, une icône dedans.
 *
 * C'est le motif le plus répété de l'interface, et le moins cher : il donne à
 * une liste de blocs un rythme et une couleur sans qu'aucun fond de carte ait à
 * changer — donc sans jamais toucher au contraste du texte qui suit. C'est
 * exactement ce qu'on veut d'un porteur d'identité : très visible, et sans
 * aucun effet sur la lisibilité de ce qu'il accompagne.
 *
 * Le `ton` suit les jetons de RÔLE, jamais la palette : `ia` est réservé à
 * Jarvis et à l'analyse, `info` à ce qui informe, `action` au reste. Les tons
 * cliniques (`attention`, `positif`) ne sont volontairement PAS proposés — une
 * pastille n'est pas un statut, et lui en donner l'apparence ferait passer un
 * ornement pour une information clinique.
 */
export function PastilleIcone({
  nom,
  ton = "action",
  taille = "normale",
}: {
  readonly nom: NomIcone;
  readonly ton?: "action" | "ia" | "info" | "neutre";
  readonly taille?: "normale" | "grande";
}): React.JSX.Element {
  /* V8 — les pastilles prennent le MATÉRIAU de leur famille plutôt qu'un
   * aplat clair bordé. Même information, même contraste d'icône ; ce qui
   * change est que la pastille cesse d'être un rectangle de plus. */
  const tons = {
    action: "bg-tuile-menthe text-emeraude-700 border border-emeraude-100",
    ia: "bg-tuile-lavande text-violet-700 border border-violet-100",
    info: "bg-tuile-azur text-azure-700 border border-azure-100",
    neutre: "bg-tuile-neutre text-ink-500 border border-rule",
  } as const;

  return (
    <span
      aria-hidden
      className={[
        "inline-flex items-center justify-center rounded-xl shadow-douce",
        taille === "grande" ? "h-11 w-11" : "h-9 w-9",
        tons[ton],
      ].join(" ")}
    >
      <Icone nom={nom} taille={taille === "grande" ? 24 : 20} />
    </span>
  );
}

/* ══════════════════════════════════════════════════════════════════════
 * LES EN-TÊTES ONT ÉTÉ RETIRÉS EN V7 — ET LA RÈGLE QU'ILS PORTAIENT SURVIT
 * ══════════════════════════════════════════════════════════════════════
 *
 * Ce fichier exportait `EnTeteEcran` (héros sur `--grad-brand`), `MetaHeros`
 * et `EnTetePage`. Les trois sont supprimés : l'identité d'un écran vit
 * désormais dans la barre supérieure de la coquille (`coquille/Topbar.tsx`),
 * une fois, au même endroit, pour tous les écrans.
 *
 * ⚠️ LA RÈGLE DE SÉCURITÉ QU'ILS ENCODAIENT N'EST PAS ABANDONNÉE, ELLE EST
 * DEVENUE STRUCTURELLE. ADR-022 interdit un dégradé derrière un nom de
 * patient, au même titre que derrière une dose ou un montant. La répartition
 * « écran de LIEU → héros dégradé / écran de PERSONNE → en-tête sobre »
 * existait pour tenir cette règle, et elle reposait entièrement sur le fait
 * que chaque écrivain d'écran choisisse le bon des deux composants.
 *
 * En V7 il n'y a plus de choix à faire : la barre supérieure est OPAQUE, sans
 * dégradé, sur tous les écrans. Un nom de patient y est donc toujours posé
 * sur un fond uni. La règle ne dépend plus d'une discipline, elle découle de
 * la structure — la seule forme de garde-fou qui tienne dans le temps.
 *
 * Le sur-titre disparaît avec eux, et délibérément : un libellé en capitales
 * posé au-dessus d'un titre est un ornement qui affaiblit le titre qu'il
 * prétend introduire.
 */

/**
 * Une section de page : un titre, et ce qu'il annonce.
 *
 * Le titre est un `heading` et non un `title` : sur un écran qui en compte
 * plusieurs, réserver `title` au sujet de la page garde la hiérarchie lisible.
 * L'espace est ce qui dit « ceci est un autre sujet », plus fiable qu'un trait.
 */
export function Section({
  titre,
  icone,
  action,
  children,
}: {
  readonly titre: string;
  /** Une pastille devant le titre — le rythme visuel d'un écran long. */
  readonly icone?: NomIcone;
  /** Une action qui porte sur la section entière, alignée à droite du titre. */
  readonly action?: ReactNode;
  readonly children: ReactNode;
}): React.JSX.Element {
  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule pb-3">
        <div className="flex items-center gap-3">
          {icone === undefined ? null : <PastilleIcone nom={icone} />}
          <h2 className="font-ui text-heading font-bold text-ink-900">{titre}</h2>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/**
 * Un panneau d'information — un fait, pas une alerte.
 *
 * Ton neutre par défaut. `attention` existe pour ce qui demande un geste ; il
 * n'y a pas de ton `critical`, volontairement : aucun panneau d'information
 * n'annonce une perte de données, et le rouge reste un budget (§4 règle 1).
 */
export function PanneauInfo({
  titre,
  ton = "neutre",
  children,
}: {
  readonly titre?: string;
  readonly ton?: "neutre" | "attention" | "positif";
  readonly children: ReactNode;
}): React.JSX.Element {
  const tons = {
    neutre: "bg-sunken border-rule text-ink-700",
    attention: "bg-attention-bg border-attention text-ink-700",
    positif: "bg-positive-bg border-positive text-ink-700",
  } as const;
  const encres = {
    neutre: "text-ink-500",
    attention: "text-attention-ink",
    positif: "text-positive",
  } as const;

  return (
    <div className={["rounded-md border p-4", tons[ton]].join(" ")}>
      {titre === undefined ? null : (
        <p
          className={[
            "font-ui text-label font-medium uppercase tracking-label",
            encres[ton],
          ].join(" ")}
        >
          {titre}
        </p>
      )}
      <div className="font-ui text-body">{children}</div>
    </div>
  );
}

/**
 * La grille d'une fiche : des champs en lecture, sur plusieurs colonnes.
 *
 * `auto-fit` plutôt qu'un nombre de colonnes figé : la même fiche donne quatre
 * colonnes sur le poste du cabinet (1920), deux sur un portable, une sur un
 * écran étroit — sans point de rupture à maintenir et sans qu'aucun champ ne
 * soit jamais écrasé sous sa largeur lisible.
 */
export function GrilleChamps({ children }: { readonly children: ReactNode }): React.JSX.Element {
  return <div className="grid grid-cols-fiche gap-x-8 gap-y-6">{children}</div>;
}
