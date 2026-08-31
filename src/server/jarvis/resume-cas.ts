
/** Voir le commentaire au point d'usage : `Array.isArray` rend `any[]`. */
function estTableauInconnu(v: unknown): v is readonly unknown[] {
  return Array.isArray(v);
}

function estObjetInconnu(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}
/**
 * Contrat du Résumé du cas — module PUR, partagé passerelle ⇄ éval hors ligne.
 *
 * Rien ici ne touche le réseau ni Deno : c'est compilé tel quel par
 * `scripts/eval-resume-cas.mjs`, comme `_shared/routing.ts` l'est par
 * l'eval Jarvis V2. Toute règle de GROUNDING vivant ICI est donc testable
 * sans clé fournisseur et sans base.
 *
 * Deux barrières de véracité, par conception :
 *   1 · CETTE PASSERELLE — les citations sont filtrées contre les seuls
 *       identifiants réellement présents dans le workspace ; les items sans
 *       source vérifiable sont RETIRÉS (jamais montrés puis contestés).
 *   2 · LA PORTE SQL (`save_case_summary`) — toute citation qui aurait quand
 *       même passé la première barrière est refusée EN BASE si elle ne
 *       correspond pas à une ligne du patient. Fail secure, deux fois.
 */

export const PROMPT_VERSION_RESUME = "resume-v1.0";

/** Sections fermées du contrat `content.schema: 1`. */
export const SECTIONS_ITEM = [
  "en_bref",
  "evolution_recente",
  "a_discuter",
  "traitements_documentes",
  "points_attention",
] as const;

export type SectionItem = (typeof SECTIONS_ITEM)[number];

export const MAX_ITEMS_PAR_SECTION = 8;
export const MAX_SIGNAUX_AFFICHES = 5;
export const MAX_PHRASES_EN_BREF = 4;
export const MAX_TEXTE_ITEM = 320;

/**
 * Les six domaines citables, RECOPIÉS DE LA PORTE (053, `v_domaines`).
 *
 * ⚠️ CETTE LISTE DOIT RESTER IDENTIQUE À CELLE DE LA MIGRATION. La base est
 * l'autorité : elle refuse tout le résumé sur un domaine inconnu. Ici, on
 * refuse seulement LA CITATION — un item perd sa source, le résumé survit.
 */
export const DOMAINES_SOURCE = [
  "diagnostic",
  "echelle",
  "prescription",
  "consultation",
  "rdv",
  "document",
] as const;

export interface SourceRef {
  readonly t: (typeof DOMAINES_SOURCE)[number];
  readonly id: string;
}

function estDomaineConnu(t: string): t is SourceRef["t"] {
  return (DOMAINES_SOURCE as readonly string[]).includes(t);
}

/** Forme minimale du workspace consommée ici — le reste n'est jamais lu. */
export interface EspacePourResume {
  readonly clinique: {
    readonly diagnostics: ReadonlyArray<{ id: string; label: string }>;
    readonly echelles: ReadonlyArray<{
      readonly scaleName: string;
      readonly dernier: { readonly score: number | null; readonly date: string };
      readonly precedent: { readonly score: number | null; readonly date: string } | null;
      readonly delta: number | null;
      readonly id?: string;
    }>;
    readonly derniereConsultation: { readonly id: string; readonly startedAt: string } | null;
  } | null;
  readonly traitements: {
    readonly dernierePrescription: {
      readonly id: string;
      readonly prescribedAt: string;
    } | null;
  } | null;
  readonly agenda: {
    readonly prochainRendezVous: unknown;
  };
}

export interface CandidatSignal {
  /** Clé stable — le modèle doit la reciter pour citer un signal. */
  readonly cle: string;
  /** Libellé FACTUEL déterministe — jamais reformulé en conclusion. */
  readonly libelle: string;
  readonly sources: readonly SourceRef[];
}

/**
 * Signaux déterministes, ordre de priorité FIXÉ (le même à chaque génération),
 * plafonnés au nombre affichable. `total` porte le compte complet pour la
 * mention honnête « +N autres » — la complétude garantie, version densité :
 * chaque item AFFICHÉ est ancré, et le reste est compté, pas caché.
 */
export function construireCandidats(
  espace: EspacePourResume,
): { candidats: readonly CandidatSignal[]; total: number } {
  const tous: CandidatSignal[] = [];
  const clinique = espace.clinique;

  if (clinique !== null) {
    // 1 · Écarts de mesures — NEUTRES : chiffres seulement, aucun mot de
    // valence (« amélioré/aggravé » interdit tant que l'orientation des
    // échelles n'est pas exposée canoniquement).
    for (const e of clinique.echelles) {
      if (
        e.delta !== null &&
        e.precedent !== null &&
        e.dernier.score !== null &&
        e.precedent.score !== null &&
        typeof e.id === "string"
      ) {
        tous.push({
          cle: `echelle:${e.id}`,
          libelle: `${e.scaleName} : ${String(e.precedent.score)} (${e.precedent.date}) → ${String(e.dernier.score)} (${e.dernier.date})`,
          sources: [{ t: "echelle", id: e.id }],
        });
      }
    }

    // 2 · Prescription antérieure à la dernière séance documentée.
    const px = espace.traitements?.dernierePrescription ?? null;
    const derCons = clinique.derniereConsultation;
    if (px !== null && derCons !== null && px.prescribedAt < derCons.startedAt) {
      tous.push({
        cle: `prescription:${px.id}`,
        libelle: "La prescription documentée est antérieure à la dernière séance.",
        sources: [
          { t: "prescription", id: px.id },
          { t: "consultation", id: derCons.id },
        ],
      });
    }

    // 3 · Aucune mesure depuis plus de trois mois (ancrage : dernière séance).
    const plusRecenteMesure = clinique.echelles
      .map((e) => e.dernier.date)
      .sort()
      .at(-1);
    const maintenant = Date.now();
    if (
      plusRecenteMesure !== undefined &&
      maintenant - Date.parse(plusRecenteMesure) > 90 * 24 * 3600 * 1000
    ) {
      const ancrage =
        derCons !== null ? [{ t: "consultation" as const, id: derCons.id }] : [];
      tous.push({
        cle: "echelles:perimees",
        libelle: "Aucune mesure d'échelle documentée depuis plus de trois mois.",
        sources: ancrage,
      });
    }

    // 4 · Dossier actif sans rendez-vous à venir.
    if (
      espace.agenda.prochainRendezVous === null ||
      espace.agenda.prochainRendezVous === undefined
    ) {
      tous.push({
        cle: "agenda:sans_prochain",
        libelle: "Aucun rendez-vous à venir n'est fixé.",
        sources: [],
      });
    }
  }

  return { candidats: tous.slice(0, MAX_SIGNAUX_AFFICHES), total: tous.length };
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation de la sortie modèle — filtre de grounding, côté passerelle
// ─────────────────────────────────────────────────────────────────────────────

interface ItemBrut {
  readonly texte: unknown;
  readonly sources: unknown;
  readonly cle?: unknown;
}

function nettoyerItem(item: ItemBrut, idsAutorises: ReadonlySet<string>): ItemResumeNet | null {
  if (typeof item.texte !== "string") return null;
  const texte = item.texte.trim();
  if (texte === "" || texte.length > MAX_TEXTE_ITEM) return null;

  const sources: SourceRef[] = [];
  if (Array.isArray(item.sources)) {
    for (const s of item.sources) {
      if (typeof s !== "object" || s === null) continue;
      const t = (s as { t?: unknown }).t;
      const id = (s as { id?: unknown }).id;
      if (typeof t !== "string" || typeof id !== "string") continue;
      // ⚠️ LE DOMAINE SE VÉRIFIE, IL NE SE CASTE PAS. `t as SourceRef["t"]`
      // laissait passer n'importe quelle chaîne inventée par le modèle ; la
      // porte refusait alors le résumé ENTIER (« Type de source inconnu. »,
      // P0001) et la praticienne n'obtenait rien du tout. Mesuré en production
      // le 2026-08-30. Écarter la citation fautive coûte une source ; refuser
      // le résumé coûte le résumé.
      if (!estDomaineConnu(t)) continue;
      if (!idsAutorises.has(id)) continue; // citation sans fait réel → retirée
      sources.push({ t, id });
    }
  }
  return { texte, sources };
}

export interface ItemResumeNet {
  readonly texte: string;
  readonly sources: readonly SourceRef[];
}

export interface ContenuValide {
  readonly schema: 1;
  readonly en_bref: readonly ItemResumeNet[];
  readonly evolution_recente: readonly ItemResumeNet[];
  readonly a_discuter: readonly ItemResumeNet[];
  readonly dernier_etat: Readonly<Record<string, unknown>> | null;
  readonly traitements_documentes: readonly ItemResumeNet[];
  readonly points_attention: readonly ItemResumeNet[];
}

/** Coupe à N phrases, frontière explicite — tronquer n'ajoute rien. */
export function couperPhrases(texte: string, max: number): string {
  const morceaux = texte.split(/(?<=[.!?…])\s+/u);
  return morceaux.slice(0, max).join(" ");
}

/**
 * Valide ET nettoie la sortie modèle.
 * Rend `null` si rien de présentable ne survit (échec → « indisponible »,
 * dernier résumé valide conservé côté écran).
 */
export function validerContenuResume(
  brut: unknown,
  espace: EspacePourResume,
  candidats: readonly CandidatSignal[],
  /**
   * Identifiants citables EN PLUS de ceux du workspace.
   *
   * Sert la mémoire longitudinale (067) : une analyse de séance est rattachée à
   * une consultation, et c'est LA CONSULTATION qui est citée — un domaine que
   * la porte 053 valide déjà. Aucune migration n'est nécessaire pour ancrer un
   * fait venu d'une analyse, et la praticienne peut remonter à la séance
   * source depuis le résumé.
   */
  idsSupplementaires: ReadonlySet<string> = new Set(),
): ContenuValide | null {
  if (typeof brut !== "object" || brut === null) return null;
  const o = brut as Record<string, unknown>;

  // L'ensemble des faits citables = tout identifiant présent dans le workspace.
  // ⚠️ LECTURES DÉFENSIVES — CETTE FONCTION EST UN FILTRE DE SÉCURITÉ.
  // Elle décide quels identifiants un résumé a le droit de citer ; elle doit
  // donc échouer VIDE, jamais lever. Un `!== null` sur un champ `undefined`
  // laissait passer, puis le `.id` levait : 500 en production, résumé perdu,
  // et une porte de grounding hors service. `!= null` couvre les deux absences,
  // et les tableaux sont vérifiés avant d'être parcourus. Un identifiant
  // manquant restreint les citations — le défaut sûr.
  const idsAutorises = new Set<string>();
  const clinique = espace.clinique;
  if (clinique != null) {
    // ⚠️ `Array.isArray()` rétrécit vers `any[]` : sans le garde ci-dessous,
    // `d.id` est un accès sur `any`, et le lint du dépôt l'interdit à juste
    // titre — c'est ce jeu d'identifiants qui borne les citations du résumé.
    // Un `any` ici affaiblirait le garde-fou qui empêche le modèle de citer
    // une source inexistante.
    if (estTableauInconnu(clinique.diagnostics)) {
      for (const d of clinique.diagnostics) {
        if (estObjetInconnu(d) && typeof d["id"] === "string") idsAutorises.add(d["id"]);
      }
    }
    if (estTableauInconnu(clinique.echelles)) {
      for (const e of clinique.echelles) {
        if (estObjetInconnu(e) && typeof e["id"] === "string") idsAutorises.add(e["id"]);
      }
    }
    const derniereConsultation = clinique.derniereConsultation;
    if (derniereConsultation != null && typeof derniereConsultation.id === "string") {
      idsAutorises.add(derniereConsultation.id);
    }
  }
  const px = espace.traitements?.dernierePrescription ?? null;
  if (px != null && typeof px.id === "string") idsAutorises.add(px.id);
  for (const id of idsSupplementaires) idsAutorises.add(id);

  const clesSignaux = new Set(candidats.map((c) => c.cle));

  const sectionItems = (
    valeur: unknown,
    restreindreAuxSignaux: boolean,
  ): ItemResumeNet[] => {
    if (!Array.isArray(valeur)) return [];
    const out: ItemResumeNet[] = [];
    for (const brutItem of valeur.slice(0, MAX_ITEMS_PAR_SECTION)) {
      if (typeof brutItem !== "object" || brutItem === null) continue;
      const ib = brutItem as ItemBrut;
      const net = nettoyerItem(ib, idsAutorises);
      if (net === null) continue;
      if (restreindreAuxSignaux) {
        const cle = typeof ib.cle === "string" ? ib.cle : "";
        if (!clesSignaux.has(cle)) continue; // un signal non fourni n'existe pas
        const cand = candidats.find((c) => c.cle === cle);
        // Les sources d'un signal viennent des CANDIDATS — jamais inventées.
        out.push({
          texte: net.texte,
          sources: cand !== undefined ? [...cand.sources] : [],
        });
      } else {
        out.push(net);
      }
      if (out.length >= (restreindreAuxSignaux ? MAX_SIGNAUX_AFFICHES : MAX_ITEMS_PAR_SECTION)) break;
    }
    return out;
  };

  const enBrefBrut = Array.isArray(o.en_bref)
    ? o.en_bref.filter((i): i is ItemBrut => typeof i === "object" && i !== null)
    : [];

  let enBref = enBrefBrut
    .map((i) => nettoyerItem(i, idsAutorises))
    .filter((i): i is ItemResumeNet => i !== null)
    .slice(0, MAX_ITEMS_PAR_SECTION);
  // `noUncheckedIndexedAccess` ne déduit pas `[0]` d'un `length === 1` : on
  // lit l'élément, puis on teste CE QU'ON A LU. Même sûreté, sans assertion.
  const seulEnBref = enBref.length === 1 ? enBref[0] : undefined;
  if (seulEnBref !== undefined) {
    enBref = [{ ...seulEnBref, texte: couperPhrases(seulEnBref.texte, MAX_PHRASES_EN_BREF) }];
  }

  const contenu: ContenuValide = {
    schema: 1,
    en_bref: enBref,
    evolution_recente: sectionItems(o.evolution_recente, false),
    a_discuter: sectionItems(o.a_discuter, true),
    dernier_etat:
      typeof o.dernier_etat === "object" && o.dernier_etat !== null
        ? (o.dernier_etat as Readonly<Record<string, unknown>>)
        : null,
    traitements_documentes: sectionItems(o.traitements_documentes, false),
    points_attention: sectionItems(o.points_attention, false),
  };

  const vide =
    contenu.en_bref.length === 0 &&
    contenu.evolution_recente.length === 0 &&
    contenu.a_discuter.length === 0 &&
    contenu.traitements_documentes.length === 0 &&
    contenu.points_attention.length === 0;

  return vide ? null : contenu;
}
