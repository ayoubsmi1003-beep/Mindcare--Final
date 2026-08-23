/**
 * Coquille de navigation — PURE PRÉSENTATION.
 *
 * Aucun appel à `src/services/*` au-delà du TYPE `UserRole` (import type
 * uniquement, jamais de valeur). Ce composant ne décide de rien : il reçoit
 * `role` et compose l'affichage. Il n'appelle jamais `getCurrentUser()`.
 *
 * ⚠️ I12 — COMPOSITION PAR RÔLE, PAS CHAMP MASQUÉ.
 * `NAVIGATION_PAR_ROLE` définit, pour chaque rôle, la liste RÉELLE des entrées
 * de menu. Pour `assistant`, le groupe CLINIQUE n'existe PAS dans l'arbre
 * rendu — ses entrées ne sont pas retirées par CSS ni par une condition qui
 * "cacherait" un `<a>` déjà présent : elles ne sont simplement jamais
 * construites. Un élément rendu puis masqué reste dans le DOM et se lit en
 * trois clics dans les outils de développement ; un élément jamais construit
 * n'existe nulle part dans la réponse.
 *
 * NUANCE À NE JAMAIS OUBLIER : ce choix est COSMÉTIQUE. Il ne protège RIEN.
 * Si un jour un appel réseau expose une donnée clinique à l'assistante, ce
 * composant ne l'aurait pas empêché — seule la RLS Postgres protège la
 * donnée (règle 4 de CLAUDE.md). Ce fichier ne doit jamais contenir de
 * `if (role === "assistant")` qui prétendrait cacher une donnée : ici, on ne
 * choisit qu'une liste d'entrées de menu, ce qui est légitime précisément
 * parce que ça ne prétend protéger rien.
 *
 * ÉCRANS NON CONSTRUITS : tout sauf « Patients », « Agenda » et « Finances »
 * est rendu inerte et visiblement à venir (I19) — pas de lien mort qui ouvre
 * une page blanche, et aucun badge de compteur inventé.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * V3 — CE RAIL EST L'ÉLÉMENT SIGNATURE DU PRODUIT
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Il était une colonne blanche, sans icône et SANS AUCUN ÉTAT ACTIF : rien
 * n'indiquait sur quel écran on se trouvait. C'était le plus gros défaut
 * d'orientation de l'application, et il ne coûtait qu'un `usePathname()`.
 *
 * Trois décisions de dessin, chacune avec sa raison :
 *
 * 1. FOND `--grad-auth`, PAS `--grad-brand`. Les deux sont au catalogue
 *    d'ADR-022 ; celui-ci part de `--brand-900` et reste sombre plus longtemps.
 *    Sur un rail plein écran, c'est ce qui garde le blanc pur au-dessus de
 *    5:1 sur toute la hauteur. Le choix est un calcul de contraste, pas un goût.
 *
 * 2. UNE SEULE ENCRE : LE BLANC PUR. Pas de blanc atténué pour les titres de
 *    groupe — sur la partie claire d'un dégradé de marque, aucun alpha < 1 ne
 *    passe 4.5:1 (le calcul est écrit dans `tokens.css`). La hiérarchie se
 *    fait à la TAILLE, à la GRAISSE et à la pastille de fond.
 *
 * 3. SOUS 1024px, LE RAIL SE REPLIE EN ICÔNES au lieu de passer au-dessus du
 *    contenu. Cela referme l'écart avec `04-DESIGN-SYSTEM` §3 que ce fichier
 *    documentait depuis le 2026-08-04, et dont la seule cause était l'absence
 *    d'un jeu d'icônes. Les libellés ne sont pas RETIRÉS quand le rail se
 *    replie — ils sont retirés du FLUX VISUEL et restent dans l'arbre
 *    d'accessibilité. Un rail d'icônes muet pour un lecteur d'écran serait un
 *    écran de moins, pas un écran plus compact.
 */

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { fr, type NomEcran } from "@/i18n/fr";
import type { UserRole } from "@/services/authz";

import { BandeauSeanceEnCours } from "./BandeauSeanceEnCours";
import { PanneauJarvis } from "./PanneauJarvis";
import { Icone, MarqueMindCare } from "./ui/Icones";

export interface AppShellProps {
  readonly role: UserRole;
  readonly nomComplet: string;
  /**
   * Fermeture de session. Fournie par l'écran, pas appelée par ce composant :
   * la coquille reste présentationnelle et ne connaît aucun service.
   *
   * ⚠️ CE BOUTON N'EST PAS UN ORNEMENT. Le poste est dans une salle de
   * consultation, et le patient suivant s'assoit devant l'écran. Sans commande
   * de déconnexion, la seule façon de fermer une session est de vider le
   * stockage du navigateur — donc personne ne le fait. Une version antérieure
   * livrait `signOut()` et ses libellés sans aucun appelant.
   */
  readonly onDeconnexion: () => void;
  readonly children: React.ReactNode;
}

interface GroupeNav {
  readonly titre: string;
  readonly ecrans: readonly NomEcran[];
}

/**
 * Écrans construits à ce jour. Tout le reste est inerte et visiblement à venir
 * (I19) — pas de lien mort qui ouvre une page blanche.
 *
 * La liste est la SEULE chose à toucher ici quand un écran est livré : la
 * navigation elle-même ne change pas, et son icône existe déjà (le jeu d'icônes
 * couvre les douze écrans par construction de type).
 */
const ECRANS_CONSTRUITS: readonly NomEcran[] = [
  "tableauDeBord",
  "patients",
  "agenda",
  "finances",
  "documents",
];

/**
 * Composition COMPLÈTE — praticienne (`owner`/`practitioner`). Les deux rôles
 * partagent la même navigation ; c'est la RLS qui restreint les LIGNES vues
 * (ses patients, ses revenus), jamais ce composant.
 */
const NAVIGATION_PRATICIENNE: readonly GroupeNav[] = [
  { titre: fr.nav.groupes.menu, ecrans: ["tableauDeBord"] },
  {
    titre: fr.nav.groupes.clinique,
    ecrans: ["patients", "agenda", "messages", "documents", "traitements", "suivi"],
  },
  { titre: fr.nav.groupes.gestion, ecrans: ["finances", "statistiques"] },
  { titre: fr.nav.groupes.systeme, ecrans: ["agents", "journalActivite", "parametres"] },
];

/**
 * Composition SÉPARÉE — assistante (I12). Le groupe CLINIQUE est absent : ni
 * notes, ni transcriptions, ni diagnostics, ni motif de consultation, ni les
 * écrans qui n'en portent que ça (`Messages`, `Documents`, `Traitements`,
 * `Suivi`) ne sont construits pour ce rôle. `Patients` et `Agenda` restent :
 * identité, coordonnées et rendez-vous sont dans son périmètre (WORKING-
 * CONTEXT §6). `Finances` reste pour le statut et le montant d'un paiement,
 * jamais un motif clinique. `Statistiques` et `Agents` sont omis : rien dans
 * §6 ne les lui accorde, et à défaut de décision explicite on ne construit
 * pas l'accès.
 */
const NAVIGATION_ASSISTANTE: readonly GroupeNav[] = [
  { titre: fr.nav.groupes.menu, ecrans: ["tableauDeBord"] },
  { titre: fr.nav.groupes.gestion, ecrans: ["patients", "agenda", "finances"] },
  { titre: fr.nav.groupes.systeme, ecrans: ["parametres"] },
];

function navigationPour(role: UserRole): readonly GroupeNav[] {
  switch (role) {
    case "owner":
    case "practitioner":
      return NAVIGATION_PRATICIENNE;
    case "assistant":
      return NAVIGATION_ASSISTANTE;
  }
}

/**
 * Visible au-dessus de `tablet`, lisible par un lecteur d'écran EN DESSOUS.
 *
 * Ce n'est pas `hidden tablet:inline` : `hidden` retire l'élément de l'arbre
 * d'accessibilité, et le rail replié deviendrait une colonne de pictogrammes
 * sans nom. Ici le texte sort du flux visuel et reste annoncé — un utilisateur
 * au lecteur d'écran ne perd rien quand la fenêtre rétrécit.
 */
const LIBELLE_REPLIABLE =
  "absolute h-0 w-0 overflow-hidden opacity-0 tablet:static tablet:h-auto tablet:w-auto tablet:overflow-visible tablet:opacity-100";

export function AppShell({
  role,
  nomComplet,
  onDeconnexion,
  children,
}: AppShellProps): React.JSX.Element {
  const groupes = navigationPour(role);
  const chemin = usePathname();

  /**
   * L'écran courant. `startsWith` avec la barre finale, et pas seulement
   * l'égalité : `/patients/<uuid>` doit allumer « Patients ». Sans la barre,
   * un futur `/patientsarchives` s'allumerait aussi.
   */
  const estActif = (ecran: NomEcran): boolean =>
    chemin === `/${ecran}` || chemin.startsWith(`/${ecran}/`);

  return (
    <div
      className="grid min-h-0 flex-1 grid-rows-1 grid-cols-app-compact overflow-hidden tablet:grid-cols-app"
      style={{ height: "var(--size-full)" }}
    >
      {/* `sur-marque` bascule l'anneau de focus en blanc : `--action-600` est la
          marque elle-même et disparaîtrait dans ce fond. Sans cette classe, la
          navigation au clavier serait invisible exactement ici. */}
      <nav
        aria-label={fr.coquille.navigationPrincipale}
        className="sur-marque sticky top-0 flex h-full flex-col gap-5 overflow-hidden bg-grad-auth px-3 py-5 shadow-lift3 tablet:px-4"
      >
        {/* ── La marque. Le mark hérite de `currentColor`, donc blanc ici sans
            qu'on ait à le dire. Le mot disparaît avec le repli, le mark reste :
            c'est lui qui identifie le produit, pas le texte. */}
        <div className="flex items-center gap-3 px-2 text-on-brand">
          <MarqueMindCare taille={32} titre="MindCare OS" />
          <span
            className={["font-ui text-heading font-semibold", LIBELLE_REPLIABLE].join(" ")}
          >
            MindCare
          </span>
        </div>

        {/* ⚠️ LE COMPTE EST COLLÉ EN BAS **DANS** LA ZONE QUI DÉFILE, ET C'EST
            LE COMPROMIS CORRECT — deux tentatives plus naïves ont échoué avant.
            Mesuré à 1920×1080, « Se déconnecter » tombait sous le bord de
            l'écran. Or ce bouton n'est pas un ornement : le poste est dans une
            salle de consultation et le patient suivant s'assoit devant l'écran.
            · L'ancrer HORS de la zone de défilement (`shrink-0` en fin de rail)
              ne suffit pas : le rail est `sticky top-0`, il se cale sur le haut
              de la FENÊTRE, tandis que le bandeau ADR-016 le pousse vers le bas.
              Sa hauteur déborde donc de celle du bandeau, en bas, hors de vue —
              et `max-h-screen` ne rattrape pas ce décalage.
            · Le fixer à une hauteur calculée reviendrait à coder en dur la
              hauteur d'un bandeau qui se replie sur deux lignes en fenêtre
              étroite et DISPARAÎT le jour de l'auto-hébergement.
            `mt-auto` dans le conteneur qui défile donne les deux propriétés qui
            comptent : le bloc se pose en bas quand il y a la place, et il reste
            ATTEIGNABLE par défilement quand il n'y en a pas. Jamais coupé. */}
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto">
        {groupes.map((groupe) => (
          <div key={groupe.titre} className="flex flex-col gap-2">
            {/* Le titre de groupe s'efface au repli : à 72px il n'y a pas de
                place, et son rôle — regrouper visuellement — est déjà tenu par
                l'espacement entre les blocs. */}
            <span
              className={[
                "px-2 font-ui text-eyebrow font-semibold uppercase text-on-brand",
                LIBELLE_REPLIABLE,
              ].join(" ")}
            >
              {groupe.titre}
            </span>

            <ul className="flex list-none flex-col gap-1 p-0">
              {groupe.ecrans.map((ecran) => {
                const libelle = fr.nav.ecrans[ecran];
                const construit = ECRANS_CONSTRUITS.includes(ecran);
                const actif = construit && estActif(ecran);

                if (!construit) {
                  return (
                    <li key={ecran}>
                      <div
                        aria-disabled="true"
                        title={fr.coquille.ecranAVenir}
                        className="flex min-h-target items-center justify-center gap-3 rounded-full px-3 py-2 text-on-brand tablet:justify-between"
                      >
                        <span className="flex items-center gap-3">
                          {/* Opacité RÉDUITE sur l'ICÔNE, jamais sur le texte :
                              un pictogramme discret reste identifiable, un
                              libellé sous 4.5:1 ne se lit plus. */}
                          <Icone nom={ecran} taille={20} className="opacity-disabled" />
                          <span
                            className={["font-ui text-body", LIBELLE_REPLIABLE].join(" ")}
                          >
                            {libelle}
                          </span>
                        </span>
                        {/* Décision Q12 : la mention reste VISIBLE et assumée.
                         *
                         * ⚠️ ELLE A ÉTÉ NETTEMENT CALMÉE APRÈS REVUE VISUELLE.
                         * Première version : pastille de fond, MAJUSCULES,
                         * demi-gras. Vu à l'écran, l'effet était l'inverse de
                         * l'intention — neuf « BIENTÔT » criaient plus fort que
                         * les trois écrans qui marchent, et l'œil y allait en
                         * premier. Une mention d'indisponibilité qui domine la
                         * navigation est un contresens.
                         *
                         * Calmée par la TAILLE et la GRAISSE, jamais par le
                         * contraste : bas de casse, graisse normale, pas de
                         * pastille. Le blanc pur reste (≥ 5:1 sur toute la
                         * hauteur du rail). C'est la règle du système — la
                         * hiérarchie ne s'obtient pas en rendant un texte
                         * moins lisible. */}
                        <span
                          className={[
                            "shrink-0 font-ui text-label font-regular text-on-brand",
                            LIBELLE_REPLIABLE,
                          ].join(" ")}
                        >
                          {fr.coquille.bientot}
                        </span>
                      </div>
                    </li>
                  );
                }

                return (
                  <li key={ecran}>
                    <Link
                      href={`/${ecran}`}
                      /* `aria-current="page"` et PAS seulement une couleur :
                         l'écran courant doit être annoncé, pas seulement vu.
                         §4.4 — un statut ne repose jamais sur la couleur seule. */
                      aria-current={actif ? "page" : undefined}
                      className={[
                        "flex min-h-target items-center justify-center gap-3 rounded-full px-3 py-2 font-ui text-body text-on-brand no-underline transition duration-quick ease-soft tablet:justify-start",
                        actif
                          ? "bg-on-brand-surface font-semibold shadow-glow-brand"
                          : "hover:bg-on-brand-surface-hover",
                      ].join(" ")}
                    >
                      <Icone nom={ecran} taille={20} />
                      <span className={LIBELLE_REPLIABLE}>{libelle}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}

        {/* ── Le compte, ANCRÉ en bas et hors de la zone qui défile. `mt-auto` plutôt qu'une hauteur fixe :
            le rail porte quatre groupes pour la praticienne et trois pour
            l'assistante, et une valeur figée serait fausse pour l'une des deux. */}
        <div className="mt-auto flex shrink-0 flex-col gap-2 border-t border-on-brand-surface px-2 pt-4">
          <span
            className={[
              "font-ui text-eyebrow font-semibold uppercase text-on-brand",
              LIBELLE_REPLIABLE,
            ].join(" ")}
          >
            {fr.coquille.deconnexionCompte}
          </span>
          {/* Le nom de l'utilisatrice connectée EST une donnée identifiante.
              Il est ici sur un fond de marque — admis parce que ce fond est le
              dégradé sombre et que l'encre est le blanc pur (≥ 5:1 sur toute
              la hauteur du rail), jamais un blanc atténué. */}
          {/* ⚠️ UNE SEULE LIGNE, ET C'EST STRUCTUREL.
              Sans `truncate`, « Praticienne 1 (données de test) » se répartit sur
              trois lignes et POUSSE LE BOUTON DE DÉCONNEXION SOUS LE BORD DE
              L'ÉCRAN — mesuré à 1920×1080. Ancrer le bloc en bas ne suffisait
              pas : c'est le bloc lui-même qui grandissait. Un nom long est la
              règle, pas l'exception (I11), et le bouton qui ferme la session
              dans une salle de consultation ne peut pas dépendre de sa
              longueur. Le nom complet reste lisible en infobulle. */}
          <span
            title={nomComplet || fr.etats.texteAbsent}
            className={["truncate font-ui text-body font-semibold text-on-brand", LIBELLE_REPLIABLE].join(
              " ",
            )}
          >
            {nomComplet || fr.etats.texteAbsent}
          </span>
          <button
            type="button"
            onClick={onDeconnexion}
            title={fr.actions.seDeconnecter}
            className="mt-2 flex min-h-target items-center justify-center gap-3 rounded-full bg-on-brand-surface-hover px-3 py-2 font-ui text-label text-on-brand transition duration-quick ease-soft hover:bg-on-brand-surface tablet:justify-start"
          >
            <Icone nom="deconnexion" taille={20} />
            <span className={LIBELLE_REPLIABLE}>{fr.actions.seDeconnecter}</span>
          </button>
        </div>
        </div>
      </nav>

      {/* DEUX COLONNES, PAS TROIS — ET C'EST DÉLIBÉRÉ.
          Le §3 décrit une troisième colonne de contexte (340px, repliable).
          Elle n'est pas posée ici parce qu'aucun écran n'a encore de contenu à
          y mettre. Une version antérieure de ce fichier rendait déjà le bouton
          « Masquer le contexte » au-dessus d'une colonne inexistante : un
          bouton qui ne replie rien apprend à la praticienne que les commandes
          de cette interface ne font pas ce qu'elles disent, ce qui coûte plus
          cher que la colonne manquante. Le jeton `--grid-context-width` existe
          et attend l'écran qui en aura besoin. */}
      {/* ⚠️ `min-h-0` + `overflow-hidden` SUR CETTE COLONNE, ET SUR LA GRILLE.
          Sans eux, la grille de l'agenda — plus haute que la fenêtre — faisait
          grandir sa RANGÉE, donc la colonne, donc le rail : mesuré à 1359 px de
          haut pour une fenêtre de 1080, « Se déconnecter » à 1342. Le rail
          suivait la taille du CONTENU d'à côté, ce qu'aucun mobilier ne devrait
          faire. Un enfant de grille refuse par défaut de descendre sous la
          taille de son contenu : `min-h-0` lève ce refus, `overflow-hidden`
          borne la boîte, et le défilement retombe alors là où il doit être —
          dans `<main>`, et nulle part ailleurs. */}
      <div className="flex min-h-0 flex-col overflow-hidden">
        <BandeauSeanceEnCours role={role} />
        <main
          className="mx-auto w-full max-w-main flex-1 overflow-y-auto px-6 py-8"
        >
          {children}
        </main>
      </div>

      {/* V2 — LE PANNEAU JARVIS. Monté ici et nulle part ailleurs : une seule
          instance pour toute l'application, donc une seule conversation, donc
          des propositions regroupées dans `app.jarvis_actions`. Le monter par
          écran en créerait une par page.

          Il ne reçoit AUCUNE prop : la coquille reste présentationnelle et ne
          connaît toujours aucun service. Le panneau est autonome, et son
          indisponibilité n'atteint rien de ce qui l'entoure — le retirer est
          une suppression de ligne, pas une reprise. */}
      <PanneauJarvis />
    </div>
  );
}
