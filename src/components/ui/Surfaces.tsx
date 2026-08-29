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

import { Icone, MotifFeuilles, type NomIcone } from "./Icones";

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
const NIVEAUX: Record<NiveauCarte, string> = {
  // V2 — L2 structure + L1 ambient : teinte subtile, radius XL, ombre plus diffuse
  primaire: "bg-card border-rule/70 shadow-lift2",
  // Second plan encastré — reste sunken
  secondaire: "bg-sunken border-rule shadow-none",
  // Affordance action — tinté marque mais reste L5 sélectif
  action: "bg-action-50 border-action-100 shadow-lift1",
  // Jarvis — voile violet très contenu
  ia: "bg-ai-50 border-ai-100 shadow-lift1",
  // Porteurs valeur — blanc franc, élévation minimale, radius affiné
  clinique: "bg-card border-rule/60 shadow-lift1",
  financier: "bg-card border-rule/60 shadow-lift1",
  // Document — papier objet, ombre plus marquée pour feuille
  document: "bg-card border-ink-100 shadow-lift2",
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
        "rounded-xl border",
        NIVEAUX[niveau],
        lueur ? "shadow-glow-brand" : "",
        interactive
          ? "transition duration-quick ease-out hover:border-action-300 hover:shadow-lift3"
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
  const tons = {
    action: "bg-action-50 text-action-600 border border-action-100",
    ia: "bg-ai-50 text-ai-600 border border-ai-100",
    info: "bg-info-50 text-info-600 border border-info-100",
    neutre: "bg-sunken text-ink-500 border border-rule",
  } as const;

  return (
    <span
      aria-hidden
      className={[
        "inline-flex items-center justify-center rounded-xl shadow-lift1",
        taille === "grande" ? "h-11 w-11" : "h-9 w-9",
        tons[ton],
      ].join(" ")}
    >
      <Icone nom={nom} taille={taille === "grande" ? 24 : 20} />
    </span>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * LES EN-TÊTES — deux, et la frontière entre eux est une règle de sécurité
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * L'EN-TÊTE HÉROS — la surface de marque en tête d'écran.
 *
 * ⚠️⚠️ SON TITRE N'EST JAMAIS UN NOM DE PATIENT. C'EST LA RÈGLE ENTIÈRE DE CE
 * COMPOSANT, ET ELLE N'EST PAS ESTHÉTIQUE.
 *
 * Le fond est `--grad-brand`. ADR-022 interdit un dégradé derrière un nom de
 * patient, au même titre que derrière une dose ou un montant. Un en-tête héros
 * posé sur `/patients/[id]` mettrait donc le nom du dossier — la donnée la plus
 * identifiante de l'application — sur un fond dont le contraste varie d'un bout
 * à l'autre.
 *
 * D'où la répartition, qui n'est pas un compromis mais le dessin lui-même :
 *   · les écrans de LIEU  (Patients, Agenda, Finances, Nouveau rendez-vous)
 *     portent le héros — leur titre est un nom d'endroit, pas de personne ;
 *   · les écrans de PERSONNE (un dossier, un rendez-vous, une consultation)
 *     gardent `EnTetePage`, sobre et opaque.
 * L'application y gagne un rythme : on entre dans la couleur, on travaille au
 * calme. La règle de sécurité et le rythme visuel disent ici la même chose.
 *
 * UNE SEULE ENCRE : le blanc pur. Il n'existe pas de blanc atténué dans ce
 * système — sur l'arrêt clair du dégradé, aucun alpha < 1 ne passe 4.5:1 (le
 * calcul est dans `tokens.css`). La hiérarchie se fait à la taille et à la
 * graisse.
 */
export function EnTeteEcran({
  icone,
  surTitre,
  titre,
  sousTitre,
  actions,
  meta,
}: {
  /** L'icône de l'écran, dans une pastille de verre clair sur la marque. */
  readonly icone?: NomIcone;
  readonly surTitre?: string;
  /** Un nom de LIEU. Jamais un nom de personne — voir ci-dessus. */
  readonly titre: string;
  readonly sousTitre?: string;
  readonly actions?: ReactNode;
  /**
   * v9 — LA RANGÉE DE CONTEXTE, sous le titre. La date du jour, un compteur
     réel, un sélecteur : ce que l'œil réclame en arrivant sur un écran de
     lieu. Elle vit SOUS un filet posé sur la marque (`--on-brand-surface`),
     et ses textes restent soumis à la règle de l'encre unique : blanc pur,
     hiérarchie à la taille et à la graisse.
   */
  readonly meta?: ReactNode;
}): React.JSX.Element {
    return (
     <header className="sur-marque relative overflow-hidden rounded-2xl bg-grad-brand p-7 shadow-lift3 lg:p-8">
       <div aria-hidden="true" className="absolute inset-0 bg-grad-hero-reflet" />
       <MotifFeuilles className="absolute -right-2 -top-4 h-32 w-64 text-on-brand opacity-filigrane" />
       {/* hairline interne haut — épaisseur sans ombre lourde */}
       <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/10" />
       <div className="relative flex flex-wrap items-start justify-between gap-6">
         <div className="flex min-w-0 items-start gap-4">
           {icone === undefined ? null : (
             <span
               aria-hidden
               className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-on-brand text-brand-700 shadow-lift2"
             >
               <Icone nom={icone} taille={20} />
             </span>
           )}
            <div className="flex min-w-0 flex-col gap-2">
              {surTitre === undefined ? null : (
                <span className="font-ui text-eyebrow font-bold uppercase tracking-eyebrow text-on-brand">
                  {surTitre}
                </span>
              )}
              <h1 className="font-ui text-display font-bold tracking-display text-on-brand break-words">
                {titre}
              </h1>
              {sousTitre === undefined ? null : (
                <p className="max-w-2xl font-ui text-body font-regular leading-relaxed text-on-brand">{sousTitre}</p>
              )}
           </div>
         </div>
         {actions === undefined ? null : (
           <div className="flex flex-wrap items-center gap-3">{actions}</div>
         )}
       </div>
       {meta === undefined ? null : (
         <div className="relative mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-white/15 pt-4">
           {meta}
         </div>
       )}
     </header>
   );
}

/**
 * Un objet de la rangée de contexte d'un en-tête de lieu — icône, puis texte.
 *
 * v9 : la rangée `meta` d'`EnTeteEcran` était sinon composée de spans nus,
 * chacun avec son espacement. La pièce existe pour que la date, un compteur
 * ou une mention se posent au même rythme d'un écran à l'autre. Encre blanche
 * pure (règle de la marque) ; l'icône ne se annonce pas — le texte à côté
 * parle déjà.
 */
export function MetaHeros({
  icone,
  children,
}: {
  readonly icone: NomIcone;
  readonly children: ReactNode;
}): React.JSX.Element {
  return (
    <span className="inline-flex min-w-0 items-center gap-2 font-ui text-label font-medium text-on-brand">
      <Icone nom={icone} taille={16} />
      <span className="truncate">{children}</span>
    </span>
  );
}

/**
 * L'en-tête SOBRE : sur-titre, titre, sous-titre, actions.
 *
 * Celui des écrans de personne — un dossier, un rendez-vous, une consultation —
 * dont le titre EST une donnée identifiante. Fond opaque, encre `--ink-900`,
 * aucun ornement derrière le nom. C'est le pendant volontairement calme de
 * `EnTeteEcran`, pas une version dégradée de celui-ci.
 *
 * Le sur-titre (`eyebrow`, majuscules) porte le contexte — de quel dossier, de
 * quelle semaine il s'agit — et le titre porte le sujet. Les séparer permet de
 * lire le contexte sans relire le titre, ce qui compte quand on ouvre le même
 * écran quarante fois par jour.
 */
export function EnTetePage({
  surTitre,
  titre,
  sousTitre,
  actions,
}: {
  readonly surTitre?: string;
  readonly titre: string;
  readonly sousTitre?: string;
  readonly actions?: ReactNode;
}): React.JSX.Element {
  return (
    <header className="flex flex-wrap items-start justify-between gap-5 border-b border-rule/60 pb-6">
      <div className="flex min-w-0 flex-col gap-2">
        {surTitre === undefined ? null : (
          <span className="font-ui text-eyebrow font-bold uppercase tracking-eyebrow text-action-600">
            {surTitre}
          </span>
        )}
        <h1 className="font-ui text-display font-bold tracking-display text-ink-900 break-words">{titre}</h1>
        {sousTitre === undefined ? null : (
          <p className="max-w-2xl font-ui text-body font-regular leading-relaxed text-ink-500">{sousTitre}</p>
        )}
      </div>
      {actions === undefined ? null : (
        <div className="flex flex-wrap items-center gap-3">{actions}</div>
      )}
    </header>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * LE RESTE — inchangé dans son intention, aligné sur les nouveaux jetons
 * ═══════════════════════════════════════════════════════════════════════════ */

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
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule/40 pb-3">
        <div className="flex items-center gap-3">
          {icone === undefined ? null : <PastilleIcone nom={icone} />}
          <h2 className="font-ui text-heading font-bold tracking-tight text-ink-900">{titre}</h2>
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
