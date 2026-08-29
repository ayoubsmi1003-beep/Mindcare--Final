/**
 * LA COQUILLE — V7. Pure présentation.
 *
 * Aucun appel à `src/services/*` au-delà du TYPE `UserRole` (import type
 * uniquement, jamais de valeur). Cette coquille ne décide de rien : elle reçoit
 * `role` et compose. Elle n'appelle jamais `getCurrentUser()`.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * CE QUI CHANGE EN V7
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 1. DEUX MONDES AU LIEU D'UN. Le rail est du CHROME (encre froide profonde),
 *    le contenu est du PAPIER. Avant, un unique lavage teinté de marque allait
 *    du bord gauche au bord droit, le rail n'étant que ce lavage en dégradé :
 *    rien ne distinguait l'outil de la matière. Voir `coquille/Rail.tsx`.
 *
 * 2. UNE BARRE SUPÉRIEURE, ET PLUS DE BANNIÈRE HÉROS. L'identité de page monte
 *    dans une barre de 60 px partagée. Les 120 px de dégradé qui ouvraient
 *    chaque écran à l'identique disparaissent — c'était la cause première du
 *    « même interface, autres couleurs ». Voir `coquille/Topbar.tsx`.
 *
 * 3. LE CONTENU EST PLEINE LARGEUR. `max-w-main` (1120 px centré) imposait la
 *    même colonne à tous les écrans, ce qui poussait chacun vers la même pile
 *    verticale de cartes. Chaque écran compose désormais selon son travail :
 *    le bento est un outil, pas l'identité du produit.
 *
 * 4. L'ASSISTANT N'EST PLUS UNE BULLE FLOTTANTE. Son lanceur était une
 *    pastille en bas à droite ; il est maintenant le champ de commande de la
 *    barre supérieure. Même ⌘K, même panneau — mais l'assistant appartient à
 *    l'instrument au lieu d'être posé dessus.
 */

"use client";

import { usePathname } from "next/navigation";
import { useState } from "react";

import { fr, type NomEcran } from "@/i18n/fr";
import type { UserRole } from "@/services/authz";

import { BandeauSeanceEnCours } from "./BandeauSeanceEnCours";
import { BootVoix } from "./BootVoix";
import { PanneauJarvis } from "./PanneauJarvis";
import { Rail } from "./coquille/Rail";
import { Topbar } from "./coquille/Topbar";

export interface AppShellProps {
  readonly role: UserRole;
  readonly nomComplet: string;
  /**
   * Fermeture de session. Fournie par l'écran, pas appelée ici : la coquille
   * reste présentationnelle et ne connaît aucun service.
   */
  readonly onDeconnexion: () => void;
  /**
   * L'identité de l'écran, affichée dans la barre supérieure.
   *
   * Optionnelle : les écrans de LIEU (`/patients`, `/agenda`, `/finances`…)
   * la déduisent de la route, ce qui garantit qu'un titre ne diverge jamais du
   * libellé de la navigation. Les écrans de PERSONNE ou d'objet
   * (`/consultation/<id>`, `/patients/<id>`) la fournissent, parce qu'aucune
   * route ne peut deviner un nom de patient.
   */
  readonly titre?: string;
  readonly sousTitre?: string;
  /** Actions de page, à droite de la barre. Une action dominante au plus. */
  readonly actions?: React.ReactNode;
  /**
   * Retire la gouttière du contenu, pour les écrans qui gèrent eux-mêmes leurs
   * bords — la grille de l'agenda, les trois volets de Documents, le cockpit.
   * Sans cette échappatoire, ces écrans repeindraient un fond par-dessus la
   * gouttière pour l'annuler, ce qui est la même chose en moins lisible.
   */
  readonly sansGouttiere?: boolean;
  /**
   * LE MODE SÉANCE. Quand une consultation est ouverte, l'interface se retire :
   * plus de rail, plus de barre supérieure, le fond glisse vers l'encre de
   * nuit. Il ne reste que la personne, la note et le chrono.
   *
   * Le rail et la barre sont RETIRÉS DE L'ARBRE, pas seulement translatés
   * hors-champ. Une navigation invisible mais toujours focalisable enverrait
   * la tabulation d'un lecteur d'écran dans douze liens fantômes au milieu
   * d'une consultation — le contraire de l'effet recherché.
   *
   * Alexa, elle, RESTE montée : la dictée pendant la séance est le cœur du
   * cas d'usage. C'est le seul mobilier qui survit au repli.
   */
  readonly modeSeance?: boolean;
  readonly children: React.ReactNode;
}

/**
 * L'écran de la route courante, s'il en est un. Sert à déduire le titre par
 * défaut de la barre supérieure : un titre déduit ne peut pas diverger du
 * libellé affiché dans le rail, alors que deux chaînes recopiées divergent
 * toujours un jour.
 */
function ecranDeLaRoute(chemin: string): NomEcran | null {
  const segment = chemin.split("/")[1] ?? "";
  if (segment === "") return null;
  return segment in fr.nav.ecrans ? (segment as NomEcran) : null;
}

export function AppShell({
  role,
  nomComplet,
  onDeconnexion,
  titre,
  sousTitre,
  actions,
  sansGouttiere = false,
  modeSeance = false,
  children,
}: AppShellProps): React.JSX.Element {
  /**
   * L'ouverture de l'assistant vit ICI parce que deux enfants la partagent :
   * le champ de commande de la barre l'ouvre, le panneau la referme. Un store
   * de plus serait disproportionné pour un booléen dont les deux seuls
   * lecteurs sont frères.
   */
  const [alexaOuvert, setAlexaOuvert] = useState(false);

  /**
   * ⚠️ CE `role !==` EST UNE COMPOSITION D'INTERFACE, PAS UN CONTRÔLE DE
   * SÉCURITÉ (règle 4). Ce qu'Alexa peut lire ou écrire est décidé par la RLS
   * et les portes SQL, qui ne connaissent pas ce composant.
   */
  const avecAlexa = role !== "assistant";

  /**
   * Le titre par défaut. `usePathname` et non `window.location` : la valeur
   * doit survivre au rendu serveur ET suivre les navigations client, ce
   * qu'une lecture directe de l'URL ne fait ni l'un ni l'autre.
   */
  const chemin = usePathname();
  const ecranCourant = ecranDeLaRoute(chemin);
  const titreEffectif = titre ?? (ecranCourant === null ? "" : fr.nav.ecrans[ecranCourant]);

  return (
    <div
      className={[
        "flex min-h-0 flex-1 overflow-hidden",
        /* Le remappage de variables vit dans tokens.css (§ MODE SÉANCE) : les
           composants de l'espace de travail ne savent rien de la nuit, ils
           lisent `var(--card)` comme toujours et c'est --card qui change. */
        modeSeance ? "mode-seance bg-night-bg" : "",
      ].join(" ")}
    >
      {modeSeance ? null : (
        <Rail role={role} nomComplet={nomComplet} onDeconnexion={onDeconnexion} />
      )}

      {/* ⚠️ `min-h-0` + `overflow-hidden` SUR CETTE COLONNE, ET C'EST STRUCTUREL.
          Sans eux, la grille de l'agenda — plus haute que la fenêtre — faisait
          grandir sa rangée, donc la colonne, donc le rail : mesuré à 1359 px de
          haut pour une fenêtre de 1080, « Se déconnecter » à 1342. Le rail
          suivait la taille du CONTENU d'à côté, ce qu'aucun mobilier ne devrait
          faire. Un enfant de flex refuse par défaut de descendre sous la taille
          de son contenu : `min-h-0` lève ce refus, et le défilement retombe
          alors là où il doit être — dans `<main>`, et nulle part ailleurs. */}
      <div className="flex min-w-0 min-h-0 flex-1 flex-col overflow-hidden bg-canevas">
        {modeSeance ? null : (
          <Topbar
            titre={titreEffectif}
            {...(sousTitre === undefined ? {} : { sousTitre })}
            {...(actions === undefined ? {} : { actions })}
            {...(avecAlexa ? { onOuvrirCommande: () => setAlexaOuvert(true) } : {})}
          />
        )}

        {/* Rappeler « une séance est en cours » à quelqu'un qui est DANS la
            séance serait du bruit : le bandeau ne sert qu'ailleurs. */}
        {modeSeance ? null : <BandeauSeanceEnCours role={role} />}

        <main
          id="contenu-principal"
          className={[
            "min-h-0 flex-1 overflow-y-auto",
            sansGouttiere ? "" : "px-6 py-6",
          ].join(" ")}
        >
          {children}
        </main>
      </div>

      {/* `BootVoix` porte le cycle de vie du mot de réveil et ne rend rien ; il
          vit ici pour durer autant que l'application, pas autant qu'un écran. */}
      {avecAlexa ? (
        <>
          <BootVoix />
          <PanneauJarvis ouvert={alexaOuvert} onChangerOuvert={setAlexaOuvert} />
        </>
      ) : null}
    </div>
  );
}
