/**
 * `contexte-seance.ts` — CE QUE LE MODÈLE LIT POUR ANALYSER UNE SÉANCE,
 * ET DANS QUEL ORDRE.
 *
 * ═══ LE DÉFAUT QUE CE MODULE RÉPARE ═══
 *
 * `analyze_session` ne lisait que deux choses : les notes brutes de la séance
 * en cours, et UNE note précédente. Ni diagnostics, ni échelles, ni traitement
 * en cours. Le résumé produit était donc cohérent avec ce qu'on lui avait
 * montré — et aveugle à tout le reste du dossier.
 *
 * ═══ LA PRÉSÉANCE EST DÉTERMINISTE, ET ELLE VIT ICI ═══
 *
 *   1 · notes finalisées de la praticienne
 *   2 · données cliniques structurées (diagnostics, échelles, prescriptions)
 *   3 · évaluation saisie
 *   4 · transcription
 *   5 · contexte longitudinal
 *
 * ⚠️ ELLE N'EST PAS DANS LE PROMPT, ET C'EST VOULU. Une consigne de préséance
 * écrite en langue naturelle est une SUGGESTION : le modèle la suit la plupart
 * du temps. Ici, la préséance décide de ce qui ENTRE dans le contexte et de ce
 * qui est tronqué en premier quand le budget se remplit — c'est une propriété
 * du code, vérifiable par une éval, et pas une intention.
 *
 * ⚠️ CE QUI EST TRONQUÉ EST DIT. Une troncature muette produirait un résumé qui
 * paraît complet et ne l'est pas — la pire forme d'erreur pour un document
 * clinique, parce que rien à l'écran ne signale ce qui manque.
 *
 * ⚠️ CE MODULE N'INVENTE RIEN ET NE DÉDUIT RIEN. Il met en forme ce que les
 * portes SQL ont rendu. Une source absente produit une source ABSENTE, jamais
 * une valeur par défaut plausible (règle 8).
 */

/** Les cinq natures de source, dans l'ordre exact de la préséance. */
export type TypeSource =
  | "notes-finalisees"
  | "donnees-structurees"
  | "evaluation-saisie"
  | "transcription"
  | "contexte-longitudinal";

/**
 * Le rang de préséance. Plus petit = plus fiable, servi en premier, tronqué en
 * dernier.
 *
 * ⚠️ LES NOTES FINALISÉES PRIMENT SUR LA TRANSCRIPTION, TOUJOURS. Si la
 * praticienne a corrigé dans ses notes ce que la transcription rapportait, ce
 * sont ses notes qui font foi : la transcription est une capture de ce qui a
 * été dit, ses notes sont ce qu'elle a décidé de retenir. Inverser cet ordre
 * ferait dire au résumé le contraire du dossier.
 */
const RANG: Readonly<Record<TypeSource, number>> = {
  "notes-finalisees": 1,
  "donnees-structurees": 2,
  "evaluation-saisie": 3,
  transcription: 4,
  "contexte-longitudinal": 5,
};

/** Budget par source, en caractères. Proportionné au rang. */
const BUDGET: Readonly<Record<TypeSource, number>> = {
  "notes-finalisees": 6_000,
  "donnees-structurees": 3_000,
  "evaluation-saisie": 2_000,
  transcription: 4_000,
  "contexte-longitudinal": 3_000,
};

/** Plafond global. Au-delà, on tronque en remontant depuis le rang le plus élevé. */
const BUDGET_TOTAL = 14_000;

export interface SourceBrute {
  readonly type: TypeSource;
  /** Titre affiché au modèle. Décrit la PROVENANCE, pas le contenu. */
  readonly libelle: string;
  readonly contenu: string | null;
}

export interface SourceRetenue {
  readonly type: TypeSource;
  readonly libelle: string;
  readonly caracteres: number;
  readonly tronquee: boolean;
}

export interface ContexteSeance {
  /** Le bloc à placer entre les balises `<donnees_patient>`. */
  readonly bloc: string;
  /** Ce qui a réellement été retenu — pour la trace et pour l'éval. */
  readonly sources: readonly SourceRetenue[];
  readonly caracteresTotal: number;
  /** Vrai si au moins une source a été tronquée. */
  readonly tronque: boolean;
}

function marqueur(omis: number): string {
  return `\n[…tronqué ici — ${omis} caractères non transmis]`;
}

/**
 * Place occupée par le marqueur de troncature, RÉSERVÉE dans le plafond.
 *
 * ⚠️ SANS CETTE RÉSERVE, CHAQUE SOURCE TRONQUÉE DÉPASSAIT SON PLAFOND de la
 * longueur du marqueur. Sur quatre sources, le budget global était dépassé
 * d'environ deux cents caractères — un débordement discret, jamais visible à
 * l'œil, qui ne se serait manifesté qu'en refus du fournisseur sur un dossier
 * particulièrement lourd. Le marqueur fait partie du coût qu'il annonce.
 */
const RESERVE_MARQUEUR = 64;

function couper(contenu: string, plafond: number): { texte: string; tronquee: boolean } {
  if (contenu.length <= plafond) return { texte: contenu, tronquee: false };

  // On coupe au début : dans une note clinique, la FIN porte l'évaluation et le
  // plan — c'est-à-dire ce que la praticienne a décidé. Garder le début et
  // jeter la conclusion produirait un résumé sans décision.
  const garde = Math.max(0, plafond - RESERVE_MARQUEUR);
  const entete = marqueur(contenu.length - garde).trim();
  return { texte: `${entete}\n${contenu.slice(contenu.length - garde)}`, tronquee: true };
}

/**
 * Assemble le contexte. PURE : aucune entrée/sortie, aucune horloge, aucun
 * accès réseau — donc éprouvable hors ligne, ce qui est la seule façon de
 * vérifier une règle de préséance sans dépendre d'un modèle.
 */
export function assemblerContexteSeance(brutes: readonly SourceBrute[]): ContexteSeance {
  // 1 · on écarte le vide. Une source présente mais vide n'est pas une source :
  //     l'annoncer au modèle l'inviterait à combler le blanc.
  const utiles = brutes.filter(
    (s): s is SourceBrute & { contenu: string } =>
      typeof s.contenu === "string" && s.contenu.trim() !== "",
  );

  // 2 · tri par préséance. `index` départage à rang égal pour que deux
  //     exécutions sur les mêmes données rendent le MÊME bloc — sans quoi le
  //     hash de prompt varierait sans que rien n'ait changé.
  const triees = utiles
    .map((s, index) => ({ s, index }))
    .sort((a, b) => RANG[a.s.type] - RANG[b.s.type] || a.index - b.index)
    .map((x) => x.s);

  const retenues: SourceRetenue[] = [];
  const morceaux: string[] = [];
  let total = 0;

  for (const source of triees) {
    // Ce qui reste du budget global, jamais plus que le budget de la nature.
    const restant = BUDGET_TOTAL - total;
    if (restant <= 0) {
      // ⚠️ ON LE DIT PLUTÔT QUE DE L'OMETTRE EN SILENCE.
      retenues.push({
        type: source.type,
        libelle: source.libelle,
        caracteres: 0,
        tronquee: true,
      });
      continue;
    }
    const plafond = Math.min(BUDGET[source.type], restant);
    const { texte, tronquee } = couper(source.contenu.trim(), plafond);

    morceaux.push(`## ${source.libelle}\n${texte}`);
    retenues.push({
      type: source.type,
      libelle: source.libelle,
      caracteres: texte.length,
      tronquee,
    });
    total += texte.length;
  }

  return {
    bloc: morceaux.join("\n\n"),
    sources: retenues,
    caracteresTotal: total,
    tronque: retenues.some((s) => s.tronquee),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// MISE EN FORME DES DONNÉES STRUCTURÉES
// ═══════════════════════════════════════════════════════════════════════════

interface Diagnostic {
  readonly label?: string | null;
  readonly code?: string | null;
  readonly is_primary?: boolean | null;
  readonly onset_date?: string | null;
  readonly resolved_at?: string | null;
}

interface LignePrescription {
  readonly designation?: string | null;
  readonly dose?: string | null;
  readonly frequency_per_day?: number | null;
  readonly duration_days?: number | null;
}

interface Echelle {
  readonly scale_code?: string | null;
  readonly scale_name?: string | null;
  readonly dernier?: { readonly score?: number | null; readonly measured_at?: string | null } | null;
  readonly precedent?: { readonly score?: number | null; readonly measured_at?: string | null } | null;
}

/**
 * Rend le bloc « données structurées » à partir du workspace patient.
 *
 * ⚠️ « DERNIÈRE PRESCRIPTION » N'EST PAS « TRAITEMENT EN COURS ». Le schéma ne
 * porte ni `stopped_at` ni statut de ligne — la porte SQL le dit explicitement.
 * Écrire « traitement actuel » ici ferait affirmer au résumé une chose que la
 * base n'enregistre pas, et cette affirmation atterrirait dans un dossier.
 */
export function formaterDonneesStructurees(clinique: unknown, traitements: unknown): string | null {
  const lignes: string[] = [];

  const c = clinique as { diagnostics?: readonly Diagnostic[]; echelles?: readonly Echelle[] } | null;

  const diagnostics = c?.diagnostics ?? [];
  if (diagnostics.length > 0) {
    lignes.push("Diagnostics enregistrés au dossier :");
    for (const d of diagnostics) {
      const nom = d.label ?? d.code ?? null;
      if (nom === null) continue;
      const marques = [
        d.is_primary === true ? "principal" : null,
        d.onset_date != null ? `depuis ${d.onset_date}` : null,
        d.resolved_at != null ? `résolu le ${d.resolved_at}` : null,
      ].filter((x): x is string => x !== null);
      lignes.push(`- ${nom}${marques.length > 0 ? ` (${marques.join(", ")})` : ""}`);
    }
  }

  const echelles = c?.echelles ?? [];
  if (echelles.length > 0) {
    lignes.push("", "Échelles — deux dernières mesures :");
    for (const e of echelles) {
      const nom = e.scale_name ?? e.scale_code ?? null;
      if (nom === null || e.dernier?.score == null) continue;
      // Une seule mesure ne fait pas une tendance : on ne rend un écart que
      // s'il y a réellement deux points.
      const evolution =
        e.precedent?.score == null
          ? "une seule mesure — aucune tendance"
          : `précédent ${e.precedent.score}`;
      lignes.push(`- ${nom} : ${e.dernier.score} (${evolution})`);
    }
  }

  const t = traitements as
    | { derniere_prescription?: { prescribed_at?: string | null; lignes?: readonly LignePrescription[] } | null }
    | null;
  const px = t?.derniere_prescription ?? null;
  if (px !== null && (px.lignes ?? []).length > 0) {
    lignes.push("", `Dernière prescription enregistrée (${px.prescribed_at ?? "date inconnue"}) :`);
    for (const l of px.lignes ?? []) {
      const nom = l.designation ?? null;
      if (nom === null) continue;
      const details = [
        l.dose ?? null,
        l.frequency_per_day != null ? `${l.frequency_per_day}/j` : null,
        l.duration_days != null ? `${l.duration_days} j` : null,
      ].filter((x): x is string => x !== null);
      lignes.push(`- ${nom}${details.length > 0 ? ` — ${details.join(", ")}` : ""}`);
    }
    lignes.push(
      "(Historique de prescription. La base n'enregistre pas l'arrêt d'un traitement :",
      "ne pas en conclure que ce traitement est en cours.)",
    );
  }

  const texte = lignes.join("\n").trim();
  return texte === "" ? null : texte;
}
