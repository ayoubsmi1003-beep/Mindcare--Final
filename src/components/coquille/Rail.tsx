/**
 * LE RAIL DE NAVIGATION — V7.
 *
 * PURE PRÉSENTATION. Aucun appel à `src/services/*` au-delà du TYPE
 * `UserRole` (import type uniquement). Ce composant ne décide de rien : il
 * reçoit `role` et compose l'affichage.
 *
 * ⚠️ I12 — COMPOSITION PAR RÔLE, PAS CHAMP MASQUÉ.
 * Pour `assistant`, le groupe CLINIQUE n'existe PAS dans l'arbre rendu : ses
 * entrées ne sont pas retirées par CSS ni par une condition qui « cacherait »
 * un `<a>` déjà présent — elles ne sont jamais construites. Un élément rendu
 * puis masqué se lit en trois clics dans les outils de développement.
 *
 * NUANCE À NE JAMAIS OUBLIER : ce choix est COSMÉTIQUE, il ne protège RIEN.
 * Seule la RLS Postgres protège la donnée (règle 4 de CLAUDE.md). Ce fichier
 * ne doit jamais contenir de `if (role === …)` qui prétendrait cacher une
 * donnée : ici on ne choisit qu'une liste d'entrées de menu, ce qui est
 * légitime précisément parce que ça ne prétend rien protéger.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * CE QUI CHANGE EN V7, ET POURQUOI
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 1. LE RAIL N'EST PLUS UN DÉGRADÉ DE MARQUE, C'EST DU CHROME.
 *    `--grad-auth` faisait du rail la version sombre du même monde que le
 *    contenu : un seul neutre, du bord gauche au bord droit. Le rail est
 *    désormais `--chrome-900`, une encre froide qui n'appartient pas au monde
 *    du contenu. C'est cette séparation — le cadre recule, la matière avance —
 *    qui fait qu'un instrument se lit comme un instrument.
 *
 * 2. LES DEUX DÉCORS SONT RETIRÉS. Le voile `--grad-hero-reflet` et le filet
 *    blanc en haut ne portaient aucune information. Sur un fond uni, ils n'ont
 *    même plus de prétexte technique.
 *
 * 3. L'ENCRE N'EST PLUS UNIQUE. Sur l'ancien dégradé, aucun blanc atténué ne
 *    passait 4.5:1, d'où la règle « blanc pur partout » et une hiérarchie
 *    tenue à la seule graisse. Sur un fond UNI et mesuré, trois encres tiennent
 *    le plancher : 15.6 / 9.00 / 4.72:1. La hiérarchie redevient une affaire
 *    de valeur, comme elle doit l'être.
 *
 * 4. LA PASTILLE « OS » DISPARAÎT, et les titres de groupe passent en casse de
 *    phrase. Capitales + interlettrage large sont le costume de l'« eyebrow » :
 *    ils crient un libellé qui n'a besoin que d'être repérable.
 */

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { fr, type NomEcran } from "@/i18n/fr";
import type { UserRole } from "@/services/authz";

import { Icone, MarqueMindCare } from "../ui/Icones";

export interface RailProps {
  readonly role: UserRole;
  readonly nomComplet: string;
  /**
   * Fermeture de session. Fournie par l'écran, jamais appelée ici : le rail
   * reste présentationnel et ne connaît aucun service.
   *
   * ⚠️ CE BOUTON N'EST PAS UN ORNEMENT. Le poste est dans une salle de
   * consultation et le patient suivant s'assoit devant l'écran. Sans commande
   * de déconnexion, la seule façon de fermer une session serait de vider le
   * stockage du navigateur — donc personne ne le ferait.
   */
  readonly onDeconnexion: () => void;
}

interface GroupeNav {
  readonly titre: string;
  readonly ecrans: readonly NomEcran[];
}

/**
 * Écrans construits à ce jour. Tout le reste est inerte et visiblement à venir
 * (I19) — pas de lien mort qui ouvre une page blanche, et aucun badge de
 * compteur inventé. La liste est la SEULE chose à toucher quand un écran est
 * livré : son icône existe déjà, le jeu couvrant les douze écrans par
 * construction de type.
 */
const ECRANS_CONSTRUITS: readonly NomEcran[] = [
  "tableauDeBord",
  "patients",
  "agenda",
  "finances",
  "documents",
  "parametres",
  "jarvis",
];

/**
 * Composition COMPLÈTE — praticienne (`owner`/`practitioner`). Les deux rôles
 * partagent la même navigation ; c'est la RLS qui restreint les LIGNES vues
 * (ses patients, ses revenus), jamais ce composant.
 */
const NAVIGATION_PRATICIENNE: readonly GroupeNav[] = [
  { titre: fr.nav.groupes.menu, ecrans: ["tableauDeBord", "jarvis"] },
  {
    titre: fr.nav.groupes.clinique,
    ecrans: ["patients", "agenda", "messages", "documents", "traitements", "suivi"],
  },
  { titre: fr.nav.groupes.gestion, ecrans: ["finances", "statistiques"] },
  { titre: fr.nav.groupes.systeme, ecrans: ["agents", "journalActivite", "parametres"] },
];

/**
 * Composition SÉPARÉE — assistante (I12). Deux écrans : Tableau de bord et
 * Agenda. Le cockpit de réception porte lui-même la recherche patient et
 * l'encaissement, ce qui rend une entrée « Patients » ou « Finances »
 * redondante plutôt que restrictive.
 */
const NAVIGATION_ASSISTANTE: readonly GroupeNav[] = [
  { titre: fr.nav.groupes.menu, ecrans: ["tableauDeBord", "agenda"] },
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
 * Les initiales du compte connecté — première lettre des deux premiers mots.
 * `trim()` d'abord, `charAt` ensuite : une chaîne d'espaces ne doit pas jeter.
 * Un nom vide rend une chaîne vide — le disque nu se lit « compte » sans
 * inventer d'identité.
 */
function monogrammeCompte(nomComplet: string): string {
  const mots = nomComplet.trim().split(/\s+/).filter((m) => m.length > 0);
  return mots
    .slice(0, 2)
    .map((m) => m.charAt(0).toUpperCase())
    .join("");
}

/**
 * Visible au-dessus de `desktop`, lisible par un lecteur d.écran EN DESSOUS.
 *
 * Ce n'est PAS `hidden desktop:inline` : `hidden` retire l'élément de l'arbre
 * d'accessibilité, et le rail replié deviendrait une colonne de pictogrammes
 * sans nom. Ici le texte sort du flux visuel et reste annoncé.
 */
/*
 * ⚠️ LA RUPTURE EST `desktop` (1280), PAS `tablet` (1024) — ET C'EST UNE
 * CORRECTION VUE A L'ECRAN. Avec `tablet:`, le rail reprenait ses 244 px A
 * PARTIR de 1024, c'est-a-dire exactement a la largeur ou il devait se replier.
 * Mesure a 1024 : 244 de rail + 48 de gouttiere laissaient 732 px de travail,
 * et la grille de la semaine n'y montrait plus que cinq jours sur sept.
 * En dessous de 1280, le rail est un rail d'icones.
 */
const LIBELLE_REPLIABLE =
  "absolute h-0 w-0 overflow-hidden opacity-0 desktop:static desktop:h-auto desktop:w-auto desktop:overflow-visible desktop:opacity-100";

export function Rail({ role, nomComplet, onDeconnexion }: RailProps): React.JSX.Element {
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
    <nav
      aria-label={fr.coquille.navigationPrincipale}
      className="sur-chrome flex h-full w-rail-compact shrink-0 flex-col gap-6 overflow-hidden border-r border-chrome-rule bg-chrome-900 px-3 py-5 desktop:w-rail"
    >
      <div className="flex items-center gap-3 px-2">
        <MarqueMindCare taille={24} titre="MindCare OS" />
        <span
          className={[
            "font-ui text-heading font-semibold tracking-heading text-chrome-ink",
            LIBELLE_REPLIABLE,
          ].join(" ")}
        >
          MindCare
        </span>
      </div>

      {/* ⚠️ LE COMPTE EST COLLÉ EN BAS **DANS** LA ZONE QUI DÉFILE, ET C'EST LE
          COMPROMIS CORRECT — deux tentatives plus naïves ont échoué avant.
          Mesuré à 1920×1080, « Se déconnecter » tombait sous le bord de
          l'écran. L'ancrer hors de la zone de défilement ne suffit pas, et le
          fixer à une hauteur calculée reviendrait à coder en dur la hauteur
          d'un bandeau qui se replie sur deux lignes en fenêtre étroite et
          DISPARAÎT le jour de l'auto-hébergement. `mt-auto` dans le conteneur
          qui défile donne les deux propriétés qui comptent : le bloc se pose en
          bas quand il y a la place, et il reste ATTEIGNABLE par défilement
          quand il n'y en a pas. Jamais coupé. */}
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto">
        {groupes.map((groupe) => (
          <div key={groupe.titre} className="flex flex-col gap-1">
            {/* Le titre de groupe s'efface au repli : à 68px il n'y a pas de
                place, et son rôle — regrouper — est déjà tenu par l'espacement. */}
            <span
              className={[
                "px-3 pb-1 font-ui text-label font-medium tracking-label text-chrome-ink-faint",
                LIBELLE_REPLIABLE,
              ].join(" ")}
            >
              {groupe.titre}
            </span>

            <ul className="flex list-none flex-col gap-px p-0">
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
                        className="flex min-h-target items-center justify-center gap-3 rounded-lg px-3 py-2 text-chrome-ink-faint desktop:justify-between"
                      >
                        <span className="flex items-center gap-3">
                          <Icone nom={ecran} taille={20} />
                          <span
                            className={["font-ui text-body font-regular", LIBELLE_REPLIABLE].join(" ")}
                          >
                            {libelle}
                          </span>
                        </span>
                        {/* Décision Q12 : la mention reste VISIBLE et assumée,
                            mais calmée par la TAILLE et la GRAISSE, jamais par
                            le contraste. Une première version en pastille et
                            capitales faisait crier neuf « BIENTÔT » plus fort
                            que les écrans qui marchent — l'inverse exact de
                            l'intention. */}
                        <span
                          className={[
                            "shrink-0 font-ui text-label font-regular",
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
                      aria-current={actif ? "page" : undefined}
                      className={[
                        "flex min-h-target items-center justify-center gap-3 rounded-lg px-3 py-2 font-ui text-body no-underline transition duration-quick ease-out desktop:justify-start",
                        actif
                          ? "bg-chrome-actif font-semibold text-chrome-ink"
                          : "font-regular text-chrome-ink-soft hover:bg-chrome-survol hover:text-chrome-ink",
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

        <div className="mt-auto flex shrink-0 flex-col gap-2 border-t border-chrome-rule pt-4">
          <div className="flex items-center gap-3 px-1">
            <span
              aria-hidden="true"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-chrome-voile font-ui text-label font-semibold text-chrome-ink"
            >
              {monogrammeCompte(nomComplet)}
            </span>
            {/* ⚠️ UNE SEULE LIGNE, ET C'EST STRUCTUREL. Sans `truncate`,
                « Praticienne 1 (données de test) » se répartit sur trois lignes
                et POUSSE LE BOUTON DE DÉCONNEXION SOUS LE BORD DE L'ÉCRAN —
                mesuré à 1920×1080. Un nom long est la règle, pas l'exception
                (I11). Le nom complet reste lisible en infobulle. */}
            <span
              title={nomComplet || fr.etats.texteAbsent}
              className={[
                "min-w-0 truncate font-ui text-body font-medium text-chrome-ink",
                LIBELLE_REPLIABLE,
              ].join(" ")}
            >
              {nomComplet || fr.etats.texteAbsent}
            </span>
          </div>
          <button
            type="button"
            onClick={onDeconnexion}
            title={fr.actions.seDeconnecter}
            className="flex min-h-target items-center justify-center gap-3 rounded-lg px-3 py-2 font-ui text-body font-regular text-chrome-ink-soft transition duration-quick ease-out hover:bg-chrome-survol hover:text-chrome-ink desktop:justify-start"
          >
            <Icone nom="deconnexion" taille={20} />
            <span className={LIBELLE_REPLIABLE}>{fr.actions.seDeconnecter}</span>
          </button>
        </div>
      </div>
    </nav>
  );
}
