/**
 * `jarvis-identite.ts` — LE SIDECAR D'IDENTITÉ.
 *
 * ═══ CE FICHIER EST LA MOITIÉ DE LA FRONTIÈRE QUI NE FRANCHIT JAMAIS ═══
 * La carte qu'il détient — jeton → identité réelle — vit en mémoire, dans le
 * navigateur, le temps d'un tour. Elle n'est jamais sérialisée, jamais envoyée,
 * jamais journalisée, jamais persistée. Le modèle reçoit `PATIENT_001` ; il
 * rend `{{PATIENT_001}}` ; c'est CE fichier, et lui seul, qui sait que cela
 * veut dire « BELKACEM Nadia ».
 *
 * ═══ POURQUOI UN SIDECAR PLUTÔT QUE `pseudonymize` SEUL ═══
 * `_shared/pseudonymize.ts` fait une substitution TEXTUELLE : il masque un nom
 * là où il apparaît dans une chaîne. C'est la bonne primitive pour du texte
 * libre, et on l'utilise telle quelle dans `jarvis-confidentialite.ts`. Mais
 * elle ne peut pas résoudre le chemin INVERSE sur des ARGUMENTS D'OUTIL : quand
 * le modèle propose `{"patientId": "{{PATIENT_001}}"}`, il faut retrouver un
 * UUID, pas un nom. Une carte de substitution textuelle ne porte pas cette
 * information. D'où une carte à trois colonnes — jeton, identifiant réel,
 * libellé d'affichage — et non deux.
 *
 * ⚠️ CE QUI A CHANGÉ PAR RAPPORT À V-JARVIS-CORE, ET POURQUOI.
 * Jusqu'ici les UUID partaient EN CLAIR vers le fournisseur, délibérément :
 * la boucle d'écriture de 033 en avait besoin, et `jarvis-chat/index.ts` le
 * documentait sans l'adoucir. Ce fichier SUPPRIME ce besoin. Les identifiants
 * réels ne quittent plus la machine ; le modèle manipule des jetons, et la
 * résolution se fait ICI, après son retour, AVANT Zod.
 *
 * Bénéfice collatéral, pas cosmétique : un jeton halluciné ne résout RIEN et
 * échoue proprement à la frontière. Un UUID halluciné, lui, franchissait Zod
 * (c'est une forme valide) et n'échouait qu'au fond d'`execute_jarvis_action`,
 * rangé en `state='failed'` — indiscernable d'un refus de la RLS. On remonte
 * l'échec de plusieurs couches, et on le rend lisible.
 */

/**
 * Les quatre familles de jetons. Le type littéral n'est pas décoratif : un UUID
 * ne correspond pas à `` `PATIENT_${string}` ``, donc passer un identifiant réel
 * là où une référence est attendue ne COMPILE PAS. C'est la garantie la moins
 * chère et la plus fiable de tout ce fichier — elle ne dépend d'aucune revue.
 */
export type RefPatient = `PATIENT_${string}`;
export type RefRendezVous = `RDV_${string}`;
export type RefDocument = `DOC_${string}`;
export type RefPraticien = `PRATICIEN_${string}`;

export type Ref = RefPatient | RefRendezVous | RefDocument | RefPraticien;

type Famille = "PATIENT" | "RDV" | "DOC" | "PRATICIEN";

interface Entree {
  readonly ref: Ref;
  /** L'identifiant RÉEL (UUID). Ne franchit jamais la frontière. */
  readonly reel: string;
  /** Ce que la praticienne doit lire à l'écran. Ne franchit jamais non plus. */
  readonly libelle: string;
  /**
   * Valeurs supplémentaires à masquer dans les textes libres du même dossier —
   * numéro de dossier, prénom seul, nom seul. Alimente le pare-feu.
   */
  readonly identites: readonly string[];
}

/**
 * Le marqueur d'un jeton non résolu. IL NE RESSEMBLE PAS À UN NOM, et c'est
 * voulu : si la carte a été purgée entre la génération et l'affichage (changement
 * de patient en cours de tour), l'écran doit montrer un TROU, pas une identité
 * plausible. Deviner ici, ce serait fabriquer une identité — exactement ce que
 * tout ce fichier existe pour empêcher.
 */
export const MARQUEUR_NON_RESOLU = "[référence inconnue]";

/** `{{PATIENT_001}}` — la forme que le modèle est instruit de produire. */
const MOTIF_JETON = /\{\{([A-Z]+_\d+)\}\}/g;

/**
 * Minuscules, sans accents. Même normalisation que le pare-feu et
 * qu'`assertSafe` : trois définitions différentes de « la même chaîne »
 * finiraient par diverger, et celle qui est trop stricte laisserait passer.
 */
function normaliserIdentite(valeur: string): string {
  return valeur
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * LA CARTE. Une instance par TOUR, pas par conversation : deux tours consécutifs
 * ne partagent pas leurs jetons, ce qui borne mécaniquement ce qu'un jeton
 * pourrait désigner s'il fuitait d'un contexte à l'autre.
 *
 * ⚠️ ELLE N'EST PAS UN CACHE. Ne jamais l'exposer à la persistance (058), à
 * `log`, ni à la télémétrie du §12 — cette dernière ne porte que des empreintes
 * et des comptes.
 */
export class CarteIdentite {
  /** ref → entrée. */
  readonly #parRef = new Map<string, Entree>();
  /** identifiant réel → ref, pour que le même dossier reçoive TOUJOURS le même jeton. */
  readonly #parReel = new Map<string, Ref>();
  /**
   * identité NORMALISÉE → ref. Index maintenu à la frappe plutôt que reconstruit
   * à chaque masquage : `masquerIdentites` interroge une fois par identité et
   * par feuille textuelle, ce qui ferait un balayage quadratique sur une
   * chronologie un peu fournie.
   */
  readonly #parIdentite = new Map<string, Ref>();
  /** Compteur par famille — `PATIENT_001`, `PATIENT_002`… */
  readonly #compteurs = new Map<Famille, number>();

  /**
   * Frappe (ou retrouve) le jeton d'une identité réelle.
   *
   * IDEMPOTENT SUR `reel`, et c'est indispensable : si le même patient est
   * atteint par deux capacités du même tour — l'agenda puis le dossier — il doit
   * porter UN SEUL jeton. Deux jetons pour une personne feraient croire au
   * modèle qu'il regarde deux dossiers, et il raisonnerait juste sur des
   * prémisses fausses.
   */
  frapper(
    famille: Famille,
    reel: string,
    libelle: string,
    identites: readonly string[] = [],
  ): Ref {
    const existante = this.#parReel.get(reel);
    if (existante !== undefined) return existante;

    const suivant = (this.#compteurs.get(famille) ?? 0) + 1;
    this.#compteurs.set(famille, suivant);
    const ref = `${famille}_${String(suivant).padStart(3, "0")}` as Ref;

    // Les identités sont dédupliquées et débarrassées des vides ICI plutôt que
    // chez l'appelant : le pare-feu les consomme telles quelles, et une chaîne
    // vide y ferait masquer tout le texte.
    const propres = Array.from(
      new Set([libelle, ...identites].map((v) => v.trim()).filter((v) => v.length >= 2)),
    );

    this.#parRef.set(ref, { ref, reel, libelle, identites: propres });
    this.#parReel.set(reel, ref);
    for (const i of propres) {
      // `setIfAbsent` : la PREMIÈRE frappe gagne. Deux dossiers homonymes
      // partagent la chaîne « BELKACEM » ; l'attribuer au second effacerait
      // silencieusement le masquage du premier. En cas d'homonymie, masquer
      // vers un jeton ou l'autre protège identiquement — perdre l'entrée, non.
      if (!this.#parIdentite.has(normaliserIdentite(i))) {
        this.#parIdentite.set(normaliserIdentite(i), ref);
      }
    }
    return ref;
  }

  /** Raccourcis typés — le seul moyen d'obtenir une `RefPatient` bien formée. */
  patient(reel: string, libelle: string, identites: readonly string[] = []): RefPatient {
    return this.frapper("PATIENT", reel, libelle, identites) as RefPatient;
  }
  rendezVous(reel: string, libelle: string): RefRendezVous {
    return this.frapper("RDV", reel, libelle) as RefRendezVous;
  }
  document(reel: string, libelle: string, identites: readonly string[] = []): RefDocument {
    return this.frapper("DOC", reel, libelle, identites) as RefDocument;
  }
  praticien(reel: string, libelle: string): RefPraticien {
    return this.frapper("PRATICIEN", reel, libelle, [libelle]) as RefPraticien;
  }

  /**
   * Jeton → identifiant réel. Le chemin de retour des ARGUMENTS d'outil.
   * Rend `null` sur un jeton inconnu — l'appelant doit traiter ce cas comme un
   * argument invalide, JAMAIS comme une absence de filtre.
   */
  resoudre(ref: string): string | null {
    return this.#parRef.get(ref)?.reel ?? null;
  }

  /**
   * Remplace récursivement toute chaîne `{{REF}}` par l'identifiant réel, dans
   * une structure d'arguments rendue par le modèle.
   *
   * ⚠️ REND `null` DÈS LE PREMIER JETON NON RÉSOLU, pour la structure ENTIÈRE.
   * Résoudre partiellement produirait un appel d'outil à moitié valide — par
   * exemple un `reschedule` visant le bon rendez-vous avec le mauvais patient.
   * Un refus total est la seule issue sûre ; c'est le même raisonnement que
   * `executerAction` qui refuse de lire `NULL` comme un succès.
   */
  resoudreArguments(valeur: unknown): unknown | null {
    if (typeof valeur === "string") {
      const seul = /^\{\{([A-Z]+_\d+)\}\}$/.exec(valeur);
      if (seul !== null) {
        const nom = seul[1];
        if (nom === undefined) return null;
        return this.resoudre(nom);
      }
      // Un jeton EN MILIEU de chaîne dans un argument n'a aucun sens légitime :
      // les arguments sont des identifiants, des dates, des montants. On refuse
      // plutôt que de substituer dans un texte qu'on n'attendait pas là.
      return MOTIF_JETON.test(valeur) ? null : valeur;
    }
    if (Array.isArray(valeur)) {
      const sortie: unknown[] = [];
      for (const v of valeur) {
        const r = this.resoudreArguments(v);
        if (r === null && v !== null) return null;
        sortie.push(r);
      }
      return sortie;
    }
    if (typeof valeur === "object" && valeur !== null) {
      const sortie: Record<string, unknown> = {};
      for (const [cle, v] of Object.entries(valeur as Record<string, unknown>)) {
        const r = this.resoudreArguments(v);
        if (r === null && v !== null) return null;
        sortie[cle] = r;
      }
      return sortie;
    }
    return valeur;
  }

  /**
   * Rendu à l'écran : `{{PATIENT_001}}` → « BELKACEM Nadia ».
   *
   * C'est la DERNIÈRE étape, après le réalignement canonique sur `payload`.
   * Un jeton inconnu devient `MARQUEUR_NON_RESOLU` — visible, jamais deviné.
   */
  rendre(texte: string): string {
    return texte.replace(MOTIF_JETON, (_entier, nom: string) => {
      const libelle = this.#parRef.get(nom)?.libelle;
      // ⚠️ UN LIBELLÉ VIDE EST UN JETON NON RÉSOLU, PAS UN NOM VIDE. Une entrée
      // peut être frappée par une capacité qui ne connaît que l'identifiant et
      // pas le nom (`get_patient_timeline`). Rendre `""` produirait « le
      // patient  a… » : un trou muet, indiscernable d'une phrase mal tournée.
      // Le marqueur, lui, se VOIT — et une entrée sans libellé n'a de toute
      // façon aucune identité à masquer, donc elle doit alerter, pas se taire.
      if (libelle === undefined || libelle.trim() === "") return MARQUEUR_NON_RESOLU;
      return libelle;
    });
  }

  /**
   * Toutes les valeurs identifiantes connues de ce tour, pour le pare-feu et
   * pour `assertSafe`. Triées de la PLUS LONGUE à la plus courte : c'est l'ordre
   * qu'exige `pseudonymize` pour ne pas laisser de résidu partiel (un nom de
   * famille court contenu dans un nom composé plus long).
   */
  identites(): readonly string[] {
    const toutes = new Set<string>();
    for (const e of this.#parRef.values()) {
      for (const i of e.identites) toutes.add(i);
    }
    return Array.from(toutes).sort((a, b) => b.length - a.length);
  }

  /**
   * Le texte porte-t-il une référence à rendre ? C'est la question qui décide,
   * dans `jarvis-voix.ts`, entre synthèse EXTERNE et synthèse LOCALE.
   *
   * ⚠️ Détection STRUCTURELLE — la présence d'un `{{…}}` — et non une heuristique
   * sur le contenu. Une heuristique se trompe silencieusement ; ceci ne se
   * trompe que si le modèle n'a pas produit de jeton, cas où il n'y a par
   * définition aucune identité à protéger.
   */
  porteUneReference(texte: string): boolean {
    MOTIF_JETON.lastIndex = 0;
    return MOTIF_JETON.test(texte);
  }

  /**
   * Le jeton auquel appartient une valeur identifiante. Consommé par
   * `jarvis-confidentialite.masquerIdentites` — insensible à la casse et aux
   * accents, parce que « Nassim » et « nassím » sont la même fuite.
   */
  refPourIdentite(identite: string): Ref | null {
    return this.#parIdentite.get(normaliserIdentite(identite)) ?? null;
  }

  /** Nombre d'entrées — pour la télémétrie §12, qui ne porte que des comptes. */
  get taille(): number {
    return this.#parRef.size;
  }
}

/**
 * LA CARTE DU TOUR COURANT. Module-level, comme `patient-actif.ts` — un seul
 * état partagé entre le panneau et l'écran plein.
 */
let carteCourante = new CarteIdentite();

export function carte(): CarteIdentite {
  return carteCourante;
}

/**
 * Purge et recommence. Appelé au DÉBUT de chaque tour, et à CHAQUE changement
 * de patient cible (§7.1 : la cible est remplacée, jamais accumulée).
 *
 * ⚠️ C'est le mécanisme qui empêche la contamination A→B→A. Sans cette purge,
 * `PATIENT_001` continuerait de désigner Nadia pendant qu'on parle de Karim, et
 * la réponse serait rendue avec le mauvais nom — une erreur d'identité dans un
 * dossier médical, c'est-à-dire le pire défaut que ce produit puisse avoir.
 */
export function reinitialiserCarte(): CarteIdentite {
  carteCourante = new CarteIdentite();
  return carteCourante;
}
