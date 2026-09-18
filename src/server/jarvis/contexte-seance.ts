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

// ═══════════════════════════════════════════════════════════════════════════
// L'HISTORIQUE DES NOTES — LA POLITIQUE DE SÉLECTION, EN CODE
// ═══════════════════════════════════════════════════════════════════════════

export interface AmendementNote {
  readonly reason?: string | null;
  readonly body?: string | null;
  readonly created_at?: string | Date | null;
}

/**
 * Une ligne rendue par `app.get_patient_notes_history` (migration 065).
 *
 * ⚠️ `started_at` EST `string | Date`, ET C'EST MESURÉ, PAS DEVINÉ. PostgREST
 * rendait les `timestamptz` en chaînes ISO ; `pg` direct les rend en objets
 * `Date`. Typer `string` seul a fait lever `started_at.slice` en production
 * dès que l'historique existait — l'analyse tombait AVANT tout appel modèle.
 * Les deux formes se normalisent par `instantMs` / `dateCourte` ci-dessous,
 * jamais par un `.slice()` nu.
 */
export interface NoteHistorique {
  readonly consultation_id?: string | null;
  readonly started_at?: string | Date | null;
  readonly note_status?: string | null;
  readonly signed_at?: string | null;
  readonly subjective?: string | null;
  readonly objective?: string | null;
  readonly assessment?: string | null;
  readonly plan?: string | null;
  readonly amendments?: readonly AmendementNote[] | null;
}

/**
 * Millisecondes d'une date lue en base (chaîne ISO ou `Date` `pg`), ou null.
 * Le jour calendaire rendu est UTC dans les deux cas — `slice(0, 10)` d'une
 * chaîne ISO comme `toISOString()` lisent la partie date UTC — donc identique
 * à ce que PostgREST produisait avant le portage.
 */
function instantMs(valeur: unknown): number | null {
  if (typeof valeur === "string") {
    const ms = Date.parse(valeur);
    return Number.isNaN(ms) ? null : ms;
  }
  if (valeur instanceof Date) {
    const ms = valeur.getTime();
    return Number.isNaN(ms) ? null : ms;
  }
  return null;
}

/** `YYYY-MM-DD`, ou null si la valeur n'est pas une date lisible. */
function dateCourte(valeur: unknown): string | null {
  if (typeof valeur === "string") return valeur.slice(0, 10);
  if (valeur instanceof Date && !Number.isNaN(valeur.getTime())) {
    return valeur.toISOString().slice(0, 10);
  }
  return null;
}

export interface HistoriqueRendu {
  readonly texte: string | null;
  readonly notesRetenues: number;
  readonly notesDisponibles: number;
  /** Vrai si le budget a écarté au moins une note. Doit être DIT au modèle. */
  readonly incomplet: boolean;
}

function corpsNote(n: NoteHistorique): string {
  const parts: string[] = [];
  if (n.subjective?.trim()) parts.push(`S : ${n.subjective.trim()}`);
  if (n.objective?.trim()) parts.push(`O : ${n.objective.trim()}`);
  if (n.assessment?.trim()) parts.push(`A : ${n.assessment.trim()}`);
  if (n.plan?.trim()) parts.push(`P : ${n.plan.trim()}`);
  return parts.join("\n");
}

/**
 * Met en forme l'historique des notes, du PLUS ANCIEN au plus récent.
 *
 * ⚠️ L'ORDRE DE LECTURE EST CHRONOLOGIQUE, PAS CELUI DU SQL. La porte rend du
 * plus récent au plus ancien — c'est le bon ordre pour PAGINER (on veut les
 * plus pertinentes d'abord) et le mauvais pour LIRE une évolution. Une
 * évolution se raconte dans le sens du temps ; présentée à l'envers, elle se
 * lit comme une dégradation quand c'est une amélioration.
 *
 * ⚠️ LES AMENDEMENTS SUIVENT LEUR NOTE, ET SONT MARQUÉS COMME TELS. Sur une
 * note amendée, le dernier mot de la praticienne est dans l'amendement (008) :
 * l'omettre ferait lire une version qu'elle a explicitement corrigée.
 *
 * ⚠️ CE QUI EST ÉCARTÉ FAUTE DE PLACE EST COMPTÉ ET DIT. Un historique tronqué
 * en silence produirait un résumé qui paraît fondé sur tout le dossier.
 */
export function formaterHistoriqueNotes(
  notes: readonly NoteHistorique[],
  budgetCaracteres = BUDGET["contexte-longitudinal"],
): HistoriqueRendu {
  // ⚠️ ON RETRIE ICI PLUTÔT QUE DE FAIRE CONFIANCE À L'APPELANT. La porte 065
  // rend déjà du plus récent au plus ancien — mais s'en remettre à cet ordre
  // ferait dépendre la POLITIQUE DE SÉLECTION d'un `ORDER BY` situé dans une
  // autre couche. Le jour où quelqu'un ajusterait ce tri pour une autre raison,
  // l'analyse retiendrait silencieusement les notes les plus ANCIENNES : aucune
  // erreur, aucun test rouge, juste un résumé fondé sur le mauvais bout du
  // dossier. Le coût du tri est nul, celui de la confiance ne l'est pas.
  const utiles = notes
    .filter((n) => corpsNote(n) !== "")
    .slice()
    .sort((a, b) => {
      const da = instantMs(a.started_at);
      const db = instantMs(b.started_at);
      // Une date illisible part en fin de liste : elle ne doit ni évincer une
      // note datée, ni faire basculer l'ordre au hasard du parsing.
      if (da === null && db === null) return 0;
      if (da === null) return 1;
      if (db === null) return -1;
      return db - da;
    });

  if (utiles.length === 0) {
    return { texte: null, notesRetenues: 0, notesDisponibles: notes.length, incomplet: false };
  }

  // On retient depuis la PLUS RÉCENTE — c'est elle qui décrit l'état actuel —
  // puis on inverse pour la lecture. Prendre les plus anciennes en premier
  // remplirait le budget avec ce qui compte le moins.
  const retenues: { note: NoteHistorique; rendu: string }[] = [];
  let total = 0;
  for (const n of utiles) {
    const date = dateCourte(n.started_at) ?? "date inconnue";
    // Le statut est un FAIT porté au modèle, pas un filtre : une note non
    // signée reste de la matière écrite par la praticienne, mais elle ne fait
    // pas foi comme une note signée.
    const statut = n.note_status === "signed" ? "signée" : "NON SIGNÉE (brouillon)";
    const amendements = (n.amendments ?? [])
      .filter((a) => (a.body ?? "").trim() !== "")
      .map(
        (a) =>
          `  ↳ Amendement du ${dateCourte(a.created_at) ?? "?"}` +
          `${a.reason?.trim() ? ` (${a.reason.trim()})` : ""} : ${(a.body ?? "").trim()}`,
      );

    const rendu = [
      `### Consultation du ${date} — note ${statut}`,
      corpsNote(n),
      ...(amendements.length > 0
        ? ["(Corrections postérieures de la praticienne — elles priment sur le corps ci-dessus.)", ...amendements]
        : []),
    ].join("\n");

    if (total + rendu.length > budgetCaracteres && retenues.length > 0) break;
    retenues.push({ note: n, rendu });
    total += rendu.length;
  }

  const incomplet = retenues.length < utiles.length;
  const entete = incomplet
    ? `(${retenues.length} note(s) sur ${utiles.length} transmises — les plus récentes. Les plus anciennes ne t'ont pas été montrées : n'en déduis rien.)`
    : `(${retenues.length} note(s) — l'historique complet disponible.)`;

  const corps = retenues
    .slice()
    .reverse() // chronologique : le passé d'abord
    .map((r) => r.rendu)
    .join("\n\n");

  return {
    texte: `${entete}\n\n${corps}`,
    notesRetenues: retenues.length,
    notesDisponibles: utiles.length,
    incomplet,
  };
}
