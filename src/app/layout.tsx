/**
 * Racine du document — jetons, fontes, et le bandeau d'ADR-016.
 *
 * ── LES FONTES, ET POURQUOI `google` PLUTÔT QUE `local` ────────────────────
 *
 * V3 câble les quatre familles du §5 de `04-DESIGN-SYSTEM.md`. `next/font/google`
 * TÉLÉCHARGE LES FICHIERS AU BUILD et les sert ensuite depuis notre propre
 * origine : à l'exécution, le poste du cabinet ne fait AUCUNE requête vers
 * Google — ni pour la fonte, ni pour la feuille de style, et aucun cookie n'est
 * posé. Le réseau n'est requis qu'une fois, à la construction.
 *
 * C'est le même résultat que `next/font/local`, que le commentaire de
 * `tokens.css` réclamait, sans avoir à versionner sept binaires ni à les tenir
 * à jour à la main. Le blocage qui y était décrit — « lot bloqué en attente des
 * 4 familles en .woff2 » — n'en était pas un.
 *
 * ⚠️ `variable` ET NON `className`. Chaque famille n'expose qu'une VARIABLE CSS,
 * consommée par `tokens.css` qui garde ses piles système en repli. Poser les
 * `className` de Next directement sur `<body>` court-circuiterait `--font-ui`
 * et rendrait le repli inopérant : le jour où une fonte ne charge pas, le texte
 * doit rester lisible, jamais invisible (I20).
 *
 * ⚠️ LES POIDS SONT ÉNUMÉRÉS, PAS PRIS EN ENTIER. Une famille variable complète
 * embarque tout l'axe ; l'échelle du §5.1 n'utilise que 400/500/600. Demander
 * le reste alourdirait le premier rendu pour des graisses qu'aucun écran
 * n'écrit — et le budget de `06-PERF-BUDGET.md` se mesure au build.
 *
 * MESURÉ au build du 2026-08-20 : **26 fichiers `.woff2`, 392 Ko au total**,
 * et AUCUNE URL `fonts.gstatic.com` ni `fonts.googleapis.com` dans le CSS émis.
 * Le chiffre est plus élevé que les quatre familles ne le laissent croire —
 * Next découpe chaque graisse par plage de caractères — et il est écrit ici
 * parce qu'un commentaire qui annonce « sept fichiers » serait faux et
 * empêcherait la prochaine relecture de vérifier quoi que ce soit. Le total
 * n'est pas chargé d'un coup : le navigateur ne prend que les plages qu'il
 * rencontre.
 *
 * ⚠️ LE BUILD A BESOIN DU RÉSEAU, ET IL ÉCHOUE EN DOUCEUR SANS LUI. Celui du
 * 2026-08-20 a rendu `getaddrinfo ENOTFOUND fonts.gstatic.com` puis
 * « Retrying 1/3… », et a fini par réussir. Si les trois tentatives échouaient,
 * **le build se terminerait quand même** et l'application retomberait
 * silencieusement sur les piles système — d'où le contrôle de checkpoint qui
 * COMPTE les `.woff2` émis au lieu de se fier au code de sortie de `pnpm build`.
 * Un build vert n'est pas la preuve que les fontes sont là.
 */

import type { ReactNode } from "react";

import {
  Fraunces,
  Geist,
  Geist_Mono,
  IBM_Plex_Sans_Arabic,
  Inter,
  Newsreader,
} from "next/font/google";

import { SyntheticDataBanner } from "@/components/SyntheticDataBanner";

// Source unique des jetons de design (I10). Importé au niveau racine : aucun
// écran ne rend correctement sans lui, tailwind.config.ts ne faisant que
// consommer les variables qu'il déclare.
import "../styles/tokens.css";

/** Interface — neutre, dense, excellente en petites tailles (§5). */
const fonteUi = Geist({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-ui-emise",
  display: "swap",
});

/**
 * Données — heures, doses, montants, chronomètre. `tabular-nums` est appliqué
 * par `tokens.css` : une colonne de doses qui ne s'aligne pas se lit mal, et
 * elle se lit avec un patient qui parle.
 */
const fonteNum = Geist_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-num-emise",
  display: "swap",
});

/**
 * Document — aperçus de certificats UNIQUEMENT, jamais l'interface. Quand
 * Newsreader apparaît, la praticienne sait qu'elle regarde quelque chose qui
 * sera imprimé et signé : la typographie encode l'état juridique du contenu.
 * L'employer comme fonte décorative détruirait exactement ce signal.
 */
const fonteDoc = Newsreader({
  subsets: ["latin"],
  weight: ["400"],
  variable: "--font-doc-emise",
  display: "swap",
});

/**
 * Arabe — transcriptions et étiquettes bilingues. Vraie fonte arabe, jamais un
 * fallback : `subsets: ["arabic"]` est ce qui embarque réellement les glyphes.
 * Sans lui, la variable existerait et le texte arabe retomberait silencieusement
 * sur une fonte système, ce qui est précisément ce que le §5 refuse.
 */
const fonteAr = IBM_Plex_Sans_Arabic({
  subsets: ["arabic"],
  weight: ["400", "500", "600"],
  variable: "--font-ar-emise",
  display: "swap",
});

/**
 * Interface — Inter. Remplace Geist comme fonte d'interface (arbitrage explicite
 * de la médecin, qui prime sur le choix typographique d'ADR-022). Geist reste
 * chargée : d'autres écrans s'y appuient encore, et les retypographier n'était
 * pas le périmètre demandé.
 */
const fonteInter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-inter-emise",
  display: "swap",
});

/**
 * Chiffres financiers de grande taille — Fraunces. Réservée aux MONTANTS des
 * tuiles Finances : c'est une fonte à fort contraste, excellente à 30 px et
 * illisible à 12. L'employer comme fonte de texte courant annulerait le signal
 * qu'elle porte — « ceci est un chiffre d'argent, pas une étiquette ».
 *
 * ⚠️ PAS D'`axes` ICI. next/font refuse `axes` dès qu'un `weight` explicite est
 * donné — les deux s'excluent (« Axes can only be defined … when the weight
 * property is nonexistent or set to `variable` »). On garde les DEUX graisses
 * énumérées plutôt que l'axe optique : deux graisses figées pèsent moins qu'une
 * fonte variable complète, et cet écran n'en emploie pas d'autre.
 */
const fonteDisplay = Fraunces({
  subsets: ["latin"],
  weight: ["500", "600"],
  variable: "--font-display-emise",
  display: "swap",
});

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    /* `suppressHydrationWarning` SUR CETTE BALISE ET NULLE PART AILLEURS.
       Une extension de navigateur (TrendTrack) pose `data-trendtrack-react-active`
       sur `<html>` AVANT que React ne s'hydrate : le serveur n'a pas rendu cet
       attribut, le client le trouve, et React déclare l'arbre entier
       non réconcilié. Le défaut n'est pas dans ce dépôt et aucune correction de
       notre code ne le ferait disparaître — le poste du cabinet portera ses
       propres extensions.

       ⚠️ CE N'EST PAS UN INTERRUPTEUR À GÉNÉRALISER. Posé plus bas dans l'arbre,
       il masquerait de VRAIES divergences serveur/client — une dose, un montant
       ou une heure de rendez-vous affichés différemment selon le rendu, sans
       qu'aucun avertissement ne le signale. Il ne couvre ici que les attributs
       de `<html>` lui-même, pas ses enfants. */
    <html
      lang="fr"
      suppressHydrationWarning
      className={`${fonteUi.variable} ${fonteNum.variable} ${fonteDoc.variable} ${fonteAr.variable} ${fonteInter.variable} ${fonteDisplay.variable}`}
    >
      {/* ⚠️ COLONNE FLEX, ET CE N'EST PAS COSMÉTIQUE.
          Le bandeau ADR-016 précède la coquille. Tant que `<body>` était un bloc
          ordinaire, le rail — haut de `100vh` — commençait SOUS le bandeau et
          dépassait donc du bas de l'écran d'exactement sa hauteur : « Se
          déconnecter » tombait hors de vue. Mesuré à 1920×1080.
          Ici le bandeau ne rétrécit pas (`shrink-0`), la coquille prend le reste
          (`flex-1`), et le rail demande « toute la hauteur DISPONIBLE » au lieu
          de « toute la hauteur de l'écran ». `min-h-0` autorise l'enfant flex à
          être plus petit que son contenu, sans quoi il refuse de se comprimer et
          le problème revient intact.

          ⚠️ `h-screen` ET NON `min-h-screen` : une hauteur MINIMALE ne résout
          aucun pourcentage chez les enfants — `h-full` sur le rail y retombait
          silencieusement sur `auto`, et le rail s'arrêtait à la hauteur de ses
          entrées, laissant une bande vide sous lui. Il faut une hauteur
          DÉFINIE. Conséquence assumée : c'est désormais la COLONNE DE CONTENU
          qui défile, pas la page — la disposition d'application classique, où
          le mobilier reste fixe et où seul ce qu'on lit bouge. */}
      <body className="flex h-screen flex-col overflow-hidden">
        {/* ADR-016 — posé À LA RACINE, donc impossible à oublier sur un écran.
            Placé dans un layout par page, il manquerait exactement là où on ne
            l'a pas prévu, c'est-à-dire là où on en aurait besoin.

            ⚠️ V3 DEVAIT LE SUPPRIMER. IL NE L'A PAS FAIT, ET C'EST DÉLIBÉRÉ.
            Le contrat de session écrit « bandeau supprimé après V0 (il n'a plus
            d'objet EN LOCAL) » — or on n'est pas en local : `app.deployment`
            vaut toujours `cloud-dev`. Ce bandeau est la surface visible de la
            condition 2 d'ADR-016 (« données synthétiques uniquement »), et il
            s'efface DÉJÀ tout seul le jour où la base répond `self-hosted`.
            Le retirer maintenant supprimerait une garantie vivante pour une
            raison esthétique. Il a été RESTYLÉ, pas enlevé. */}
        <div className="shrink-0">
          <SyntheticDataBanner />
        </div>
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </body>
    </html>
  );
}
