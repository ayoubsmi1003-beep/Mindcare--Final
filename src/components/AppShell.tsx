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
 * ÉCRANS NON CONSTRUITS : tout sauf « Patients » est rendu inerte et
 * visiblement à venir (I19) — pas de lien mort qui ouvre une page blanche, et
 * aucun badge de compteur inventé.
 */

"use client";

import Link from "next/link";

import { fr } from "@/i18n/fr";
import type { UserRole } from "@/services/authz";

import { BandeauSeanceEnCours } from "./BandeauSeanceEnCours";

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

type EcranKey = keyof typeof fr.nav.ecrans;

interface GroupeNav {
  readonly titre: string;
  readonly ecrans: readonly EcranKey[];
}

/**
 * Écrans construits à ce jour. Tout le reste est inerte et visiblement à venir
 * (I19) — pas de lien mort qui ouvre une page blanche.
 *
 * S4 y ajoute `agenda`. La liste est la SEULE chose à toucher ici quand un
 * écran est livré : la navigation elle-même ne change pas.
 */
const ECRANS_CONSTRUITS: readonly EcranKey[] = ["patients", "agenda"];

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

export function AppShell({
  role,
  nomComplet,
  onDeconnexion,
  children,
}: AppShellProps): React.JSX.Element {
  const groupes = navigationPour(role);

  return (
    /* SOUS LA RUPTURE `tablet` (1024px), LA COQUILLE REPASSE À UNE COLONNE.
     *
     * La navigation occupait 248px FIXES à toute largeur. Mesuré à l'écran le
     * 2026-08-04 sur 390px : il restait ~140px au contenu, la grille d'agenda
     * s'y brisait à une lettre par ligne et la page atteignait 7458px de haut.
     *
     * ⚠️ ÉCART ASSUMÉ AVEC `04-DESIGN-SYSTEM` §3, qui prescrit « < 1024px nav →
     * icônes ». Aucun jeu d'icônes n'existe dans ce dépôt, et en inventer un ici
     * poserait un vocabulaire visuel entier au détour d'un correctif de mise en
     * page. La navigation passe donc AU-DESSUS du contenu, pleine largeur, en
     * attendant les icônes. Ce n'est pas la conformité au §3, c'est ce qui ne
     * casse pas l'écran d'ici là — et la cible reste 1920×1080, le poste du
     * cabinet. */
    <div
      className="grid grid-cols-1 tablet:grid-cols-app"
      style={{
        minHeight: "var(--size-viewport)",
        background: "var(--paper)",
        fontFamily: "var(--font-ui)",
      }}
    >
      <nav
        aria-label={fr.nav.groupes.menu}
        className="border-b border-rule tablet:border-b-0 tablet:border-r"
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--s-6)",
          padding: "var(--s-5) var(--s-4)",
          background: "var(--card)",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--s-1)",
            padding: "0 var(--s-2)",
          }}
        >
          <span
            style={{
              fontSize: "var(--text-eyebrow-size)",
              lineHeight: "var(--text-eyebrow-leading)",
              letterSpacing: "var(--text-eyebrow-tracking)",
              fontWeight: "var(--weight-semibold)",
              textTransform: "uppercase",
              color: "var(--ink-500)",
            }}
          >
            {fr.coquille.deconnexionCompte}
          </span>
          <span
            style={{
              fontSize: "var(--text-body-size)",
              lineHeight: "var(--text-body-leading)",
              fontWeight: "var(--weight-semibold)",
              color: "var(--ink-900)",
            }}
          >
            {nomComplet || fr.etats.texteAbsent}
          </span>
          <button
            type="button"
            onClick={onDeconnexion}
            style={{
              alignSelf: "flex-start",
              marginTop: "var(--s-2)",
              minHeight: "var(--target-min)",
              padding: "var(--s-1) var(--s-3)",
              borderRadius: "var(--r-md)",
              border: "var(--rule-width) solid var(--rule)",
              background: "var(--card)",
              color: "var(--ink-700)",
              fontSize: "var(--text-label-size)",
              lineHeight: "var(--text-label-leading)",
              fontFamily: "var(--font-ui)",
              cursor: "pointer",
            }}
          >
            {fr.actions.seDeconnecter}
          </button>
        </div>

        {groupes.map((groupe) => (
          <div key={groupe.titre} style={{ display: "flex", flexDirection: "column", gap: "var(--s-2)" }}>
            <span
              style={{
                padding: "0 var(--s-2)",
                fontSize: "var(--text-eyebrow-size)",
                lineHeight: "var(--text-eyebrow-leading)",
                letterSpacing: "var(--text-eyebrow-tracking)",
                fontWeight: "var(--weight-semibold)",
                textTransform: "uppercase",
                color: "var(--ink-500)",
              }}
            >
              {groupe.titre}
            </span>

            <ul style={{ listStyle: "none", margin: "var(--size-0)", padding: "var(--size-0)", display: "flex", flexDirection: "column", gap: "var(--s-1)" }}>
              {groupe.ecrans.map((ecranKey) => {
                const libelle = fr.nav.ecrans[ecranKey];
                const construit = ECRANS_CONSTRUITS.includes(ecranKey);

                return (
                  <li key={ecranKey}>
                    {construit ? (
                      <Link
                        href={`/${ecranKey}`}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          minHeight: "var(--target-min)",
                          padding: "var(--s-2) var(--s-2)",
                          borderRadius: "var(--r-md)",
                          color: "var(--ink-900)",
                          fontSize: "var(--text-body-size)",
                          lineHeight: "var(--text-body-leading)",
                          textDecoration: "none",
                        }}
                      >
                        {libelle}
                      </Link>
                    ) : (
                      <div
                        aria-disabled="true"
                        title={fr.coquille.ecranAVenir}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: "var(--s-2)",
                          minHeight: "var(--target-min)",
                          padding: "var(--s-2) var(--s-2)",
                          borderRadius: "var(--r-md)",
                          color: "var(--ink-300)",
                          fontSize: "var(--text-body-size)",
                          lineHeight: "var(--text-body-leading)",
                          cursor: "default",
                        }}
                      >
                        <span>{libelle}</span>
                        <span
                          style={{
                            fontSize: "var(--text-label-size)",
                            lineHeight: "var(--text-label-leading)",
                            letterSpacing: "var(--text-label-tracking)",
                            color: "var(--ink-300)",
                          }}
                        >
                          {fr.coquille.ecranAVenir}
                        </span>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
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
      <div style={{ display: "flex", flexDirection: "column" }}>
        <BandeauSeanceEnCours role={role} />
        <main
          style={{
            flex: "1 1 auto",
            width: "var(--size-full)",
            maxWidth: "var(--grid-main-max)",
            margin: "0 auto",
            padding: "var(--s-8) var(--s-6)",
          }}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
