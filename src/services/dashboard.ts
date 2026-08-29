/**
 * Le tableau de bord de la praticienne — l'écran du matin (V4).
 *
 * ⚠️ CE FICHIER NE REQUÊTE AUCUNE TABLE. Il appelle la porte
 * `app.dashboard_today` (059) et c'est tout. Le budget de 06-PERF-BUDGET.md
 * accorde à cet écran UN SEUL appel serveur : toute lecture supplémentaire
 * ajoutée ici le ferait passer ROUGE au checkpoint, quelle que soit sa
 * légitimité apparente.
 *
 * ═══ LE CONTRAT DE LECTURE EST ÉTROIT, ET IL EST FIGÉ ICI ══════════════════
 *
 * La porte rend sept champs, et pas un de plus :
 *   · `consultation_ouverte`   — la séance en cours de l'appelante, ou null ;
 *   · `journee`                — SES rendez-vous du jour, champs opérationnels ;
 *   · `suivant`                — le prochain à passer, ou null ;
 *   · `attente_nombre`         — combien sont arrivés et attendent ;
 *   · `encaisse`               — la caisse du jour, ou NULL si hors périmètre ;
 *   · `nouveaux_patients_mois` — les dossiers ouverts ce mois civil ;
 *   · `propositions`           — les actions Jarvis non tranchées, plafond 3.
 *
 * Ce qui N'Y FIGURE PAS, par conception : motif de consultation (ADR-017),
 * notes cliniques, contenu de séance, score, tendance, adhérence, alerte. Le
 * typage ci-dessous est la contrepartie honnête : un champ absent de
 * l'interface ne peut pas être affiché, et un champ présent ici est un champ
 * que la base a accepté de rendre.
 *
 * ⚠️ ZÉRO DÉCISION D'AUTORISATION ICI. La porte est SECURITY DEFINER possédée
 * par `app_gatekeeper` (sans BYPASSRLS) : les policies de 004, 006, 007, 011 et
 * 012 décident des lignes. Un écran vide signifie « rien de VISIBLE par vous »,
 * jamais « rien ».
 *
 * ⚠️ `encaisse` VAUT `null` POUR L'ASSISTANTE, ET CE N'EST PAS UNE ERREUR
 * (ADR-005, D-14). L'écran ne rend alors pas le bloc. Il ne le remplace surtout
 * pas par un zéro, qui se lirait « rien encaissé aujourd'hui » au lieu de « ce
 * chiffre ne vous regarde pas ».
 */

import { db } from "./db";
import { logFieldsFor } from "./errors";
import { log } from "./log";
import { err, ok, type Result } from "./result";

import type { AppointmentStatus, ConsultationKind } from "./appointments";
import type { ToolName } from "./jarvis-tools";

/** Le patient de la séance ouverte. Aucun champ clinique : un nom et une heure. */
export interface SeanceOuverte {
  readonly id: string;
  readonly startedAt: string;
  readonly patientId: string;
  readonly recordNumber: string;
  readonly firstName: string;
  readonly lastName: string;
}

/**
 * Un créneau du fil de la journée. Même vérité qu'`AgendaEntry`, amputée de ce
 * dont le tableau de bord n'a pas l'usage : ni source, ni notes administratives
 * (elles appartiennent au poste d'accueil), ni identité de praticienne — le fil
 * ne montre que SA journée, la répéter à chaque ligne serait du bruit.
 */
export interface CreneauDuJour {
  readonly id: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly status: AppointmentStatus;
  readonly kind: ConsultationKind | null;
  readonly arrivedAt: string | null;
  readonly patientId: string | null;
  readonly recordNumber: string | null;
  readonly firstName: string | null;
  readonly lastName: string | null;
}

/**
 * La caisse du jour. `montantDzd` compte les paiements ENCAISSÉS
 * (`collected_at IS NOT NULL`), jamais les montants facturés — l'écran écrit
 * « encaissé » et dit vrai. `perimetre` vient de la base pour que le sous-titre
 * nomme ce qui a réellement été filtré, et change avec la règle le jour où elle
 * change.
 */
export interface CaisseDuJour {
  /** Dinars ENTIERS (ADR-018). Affiché par `formaterDzd`, jamais recomposé ici. */
  readonly montantDzd: number;
  readonly seances: number;
  readonly perimetre: "cabinet" | "praticienne";
}

/**
 * Une action que Jarvis a proposée et que la praticienne n'a ni confirmée ni
 * refusée. ⚠️ AUCUN AGENT DE FOND N'EN ÉCRIT : ces lignes naissent uniquement
 * d'une conversation réelle avec Jarvis. Une liste vide est le cas NORMAL, et
 * l'écran affiche alors son état vide — il n'invente pas une suggestion pour
 * remplir la carte (règle 8).
 */
export interface PropositionJarvis {
  readonly id: string;
  readonly toolName: ToolName;
  readonly toolArgs: unknown;
  readonly userUtterance: string;
  readonly proposedAt: string;
}

export interface TableauDeBord {
  readonly seanceOuverte: SeanceOuverte | null;
  readonly journee: readonly CreneauDuJour[];
  readonly suivant: CreneauDuJour | null;
  readonly attenteNombre: number;
  /** `null` = hors périmètre financier, PAS « zéro » (ADR-005). */
  readonly encaisse: CaisseDuJour | null;
  readonly nouveauxPatientsMois: number;
  readonly propositions: readonly PropositionJarvis[];
  /** Heure serveur de génération — l'écran l'affiche, il ne la recalcule pas. */
  readonly genereA: string;
}

/* ─── La forme brute du jsonb rendu par la porte ───────────────────────────── */

interface SeanceRow {
  readonly id: string;
  readonly started_at: string;
  readonly patient_id: string;
  readonly record_number: string;
  readonly first_name: string;
  readonly last_name: string;
}

interface CreneauRow {
  readonly id: string;
  readonly starts_at: string;
  readonly ends_at: string;
  readonly status: AppointmentStatus;
  readonly kind: ConsultationKind | null;
  readonly arrived_at: string | null;
  readonly patient_id: string | null;
  readonly record_number: string | null;
  readonly first_name: string | null;
  readonly last_name: string | null;
}

interface CaisseRow {
  readonly montant_dzd: number | string;
  readonly seances: number | string;
  readonly perimetre: "cabinet" | "praticienne";
}

interface PropositionRow {
  readonly id: string;
  readonly tool_name: ToolName;
  readonly tool_args: unknown;
  readonly user_utterance: string;
  readonly proposed_at: string;
}

/** Une ligne, un objet — la porte rend un `jsonb` unique. */
interface TableauRow {
  readonly consultation_ouverte: unknown;
  readonly journee: unknown;
  readonly suivant: unknown;
  readonly attente_nombre: unknown;
  readonly encaisse: unknown;
  readonly nouveaux_patients_mois: unknown;
  readonly propositions: unknown;
  readonly genere_a: unknown;
}

function estTableauJson(valeur: unknown): valeur is readonly unknown[] {
  return Array.isArray(valeur);
}

/**
 * ⚠️ RENVOIE UN `boolean`, PAS UN PRÉDICAT DE TYPE. Un `valeur is Record<string,
 * unknown>` obligerait chaque appelant à un `as unknown as XRow` — une double
 * assertion, que la règle `no-restricted-syntax` du dépôt interdit à juste
 * titre. En laissant `valeur` en `unknown`, une seule assertion suffit, comme
 * dans `reception.ts`.
 */
function estObjet(valeur: unknown): boolean {
  return typeof valeur === "object" && valeur !== null && !Array.isArray(valeur);
}

/**
 * `bigint` de Postgres arrive en chaîne par PostgREST dès qu'il dépasse la
 * plage sûre de JavaScript. Un `count` rendu « "3" » comparé à `0` avec `>`
 * fonctionne par coercion et masque le problème jusqu'au jour où on l'additionne
 * — donc on convertit ici, une fois, explicitement.
 */
function versNombre(valeur: unknown): number {
  const n = typeof valeur === "string" ? Number(valeur) : valeur;
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

/* ─── Conversions défensives ───────────────────────────────────────────────── */
/*
 * La porte garantit sa propre forme. Ces gardes existent pour qu'une divergence
 * future se voie comme un bloc vide explicite plutôt que comme un plantage de
 * rendu au pire moment — un matin, en salle d'attente pleine.
 */

function versSeance(valeur: unknown): SeanceOuverte | null {
  if (!estObjet(valeur)) return null;
  const s = valeur as SeanceRow;
  return {
    id: s.id,
    startedAt: s.started_at,
    patientId: s.patient_id,
    recordNumber: s.record_number,
    firstName: s.first_name,
    lastName: s.last_name,
  };
}

function versCreneau(brut: unknown): CreneauDuJour | null {
  if (!estObjet(brut)) return null;
  const c = brut as CreneauRow;
  return {
    id: c.id,
    startsAt: c.starts_at,
    endsAt: c.ends_at,
    status: c.status,
    kind: c.kind ?? null,
    arrivedAt: c.arrived_at ?? null,
    patientId: c.patient_id ?? null,
    recordNumber: c.record_number ?? null,
    firstName: c.first_name ?? null,
    lastName: c.last_name ?? null,
  };
}

function versJournee(valeur: unknown): readonly CreneauDuJour[] {
  if (!estTableauJson(valeur)) return [];
  return valeur
    .map(versCreneau)
    .filter((c): c is CreneauDuJour => c !== null);
}

function versCaisse(valeur: unknown): CaisseDuJour | null {
  // ⚠️ `null` REMONTE TEL QUEL. Ne jamais rendre `{ montantDzd: 0 }` ici : la
  // porte distingue « rien encaissé » de « hors périmètre », et l'écran a besoin
  // de la même distinction pour choisir entre un chiffre et l'absence de carte.
  if (!estObjet(valeur)) return null;
  const c = valeur as CaisseRow;
  return {
    montantDzd: versNombre(c.montant_dzd),
    seances: versNombre(c.seances),
    perimetre: c.perimetre,
  };
}

function versPropositions(valeur: unknown): readonly PropositionJarvis[] {
  if (!estTableauJson(valeur)) return [];
  return valeur
    .filter(estObjet)
    .map((brut) => {
      const p = brut as PropositionRow;
      return {
        id: p.id,
        toolName: p.tool_name,
        toolArgs: p.tool_args,
        userUtterance: p.user_utterance,
        proposedAt: p.proposed_at,
      };
    });
}

/**
 * Tout l'écran du matin, en un appel.
 *
 * `jour` est une date de cabinet au format `YYYY-MM-DD` — la calculer avec
 * `aujourdHuiCabinet()` de `finance-calendrier`, jamais avec `new Date()`
 * côté navigateur : le poste peut être à une autre heure que le cabinet, et une
 * journée décalée d'une heure est une caisse fausse.
 *
 * Rend `null` si la porte ne rend aucune ligne — l'écran affiche alors son état
 * vide, pas une erreur.
 */
export async function getDashboardToday(
  jour: string,
): Promise<Result<TableauDeBord | null>> {
  const result = await db().rpc<TableauRow>("dashboard_today", { p_day: jour });

  if (!result.ok) {
    // Ni identifiant patient, ni montant dans le journal (règle 1, I5). La trace
    // légale de lecture est écrite par la porte elle-même.
    log.error("tableauDeBord.charger", logFieldsFor(result.error));
    return err(result.error);
  }

  const row = result.data[0];
  if (row === undefined) return ok(null);

  log.info("tableauDeBord.charger", { count: 1 });
  return ok({
    seanceOuverte: versSeance(row.consultation_ouverte),
    journee: versJournee(row.journee),
    suivant: versCreneau(row.suivant),
    attenteNombre: versNombre(row.attente_nombre),
    encaisse: versCaisse(row.encaisse),
    nouveauxPatientsMois: versNombre(row.nouveaux_patients_mois),
    propositions: versPropositions(row.propositions),
    genereA: typeof row.genere_a === "string" ? row.genere_a : "",
  });
}
