/**
 * `enregistrement-live.ts` — M09 slice 3 · la couture live PII-safe.
 *
 * ═══ CE QUE C'EST ═══
 * Le constructeur PUR `BilanTour → LiveRunRecord` + l'anneau borné + le
 * drapeau OFF-par-défaut. Seuls voyagent : ids OPAQUES sous empreinte
 * (runId, jamais brut), enums fermées (chemin, verdicts, noms d'intentions),
 * comptes, latences, métadonnées C4 (titre/section/version des preuves).
 *
 * ═══ CE QUE CE N'EST PAS ═══
 *   · Pas de texte : ni réponse, ni extrait, ni mention, ni libellé, ni args
 *     d'outils, ni snapshots, ni ancre, ni conversationId/patientId. L'entrée
 *     est une interface ÉTROITE (champs nommés) : tout le reste est ignoré
 *     par construction, pas par vigilance (même discipline que `log.ts`).
 *   · Pas de persistance : l'anneau est mémoire vive, rien ne survit au
 *     rechargement, par décision (slice 3). Pas de réseau, pas de DB.
 *   · Pas un anonymiseur : l'empreinte FNV-1a (idiome M03) n'est qu'une
 *     cheville de correspondance, pas un mécanisme de confidentialité. La
 *     non-joignabilité vient de l'EXCLUSION des identifiants, pas du hash.
 *     Ne jamais y faire transiter un identifiant brut « parce qu'il est
 *     haché après ».
 */

export const VERSION_CONTRAT_LIVE = "m09-live-v1" as const;

/** L'anneau ne grandit jamais : au-delà, le plus ancien tombe. */
export const TAILLE_ANNEAU_LIVE = 200 as const;

/** Chemins fermés (miroir `CheminJarvis` + `inconnu` — jamais de pass-through). */

/**
 * L'entrée ÉTROITE : exactement ce que la couture lit d'un tour, rien de
 * plus. `conversation.ts` y projette le `BilanTour` champ par champ (la
 * projection EST la porte PII — relire ce mapping, pas le reste).
 */
export interface EntreeBilanLive {
  readonly runId: string;
  readonly chemin: string | null;
  readonly interrompu: boolean;
  readonly persiste: boolean;
  readonly dureeMs: number;
  readonly appels: readonly EntreeAppelLive[];
  readonly preuves: readonly EntreePreuveLive[];
  readonly nbSnapshots: number;
  readonly propositionInconnue: { readonly nom: string } | null;
  readonly resolution: EntreeResolutionLive | null;
}

export interface AppelLive {
  readonly capacite: string;
  readonly ms: number;
  readonly ok: boolean;
  readonly code?: string;
  readonly deduplique: boolean;
}

/** Jambe d'appel admise en entrée (sous-ensemble PII-safe de `TraceAppel`). */
export interface EntreeAppelLive {
  readonly capacite: string;
  readonly ms: number;
  readonly ok: boolean;
  readonly code?: string;
  readonly deduplique: boolean;
  /** Jamais rendu (ni brut, ni compté) : présent pour compatibilité d'appel. */
  readonly toolCallId?: string;
}

export interface PreuveLive {
  readonly titre: string;
  readonly section: string | null;
  readonly version: string;
}

/** Preuve admise en entrée (l'`extrait`, s'il est présent, est écarté). */
export interface EntreePreuveLive {
  readonly titre: string;
  readonly section: string | null;
  readonly version: string;
  readonly extrait?: string;
}

export interface ResolutionLive {
  readonly etat: string;
  readonly intentionChainee: string | null;
  readonly intentionRetenu: string | null;
}

/** Résolution admise en entrée (verdict réduit à `etat` par l'appelant). */
export interface EntreeResolutionLive {
  readonly etat: string;
  readonly intentionChainee: string | null;
  readonly intentionRetenu: string | null;
}

export interface LiveRunRecord {
  readonly schema: typeof VERSION_CONTRAT_LIVE;
  /** Empreinte du runId (jamais brut — non joignable aux conversations). */
  readonly empreinteRun: string;
  readonly horodatage: number;
  readonly chemin: string;
  readonly interrompu: boolean;
  readonly persiste: boolean;
  readonly dureeMs: number;
  readonly appels: readonly AppelLive[];
  readonly nbAppels: number;
  readonly preuves: readonly PreuveLive[];
  readonly nbPreuves: number;
  readonly nbSnapshots: number;
  readonly propositionInconnue: string | null;
  readonly resolution: ResolutionLive | null;
  /** Empreinte du canonique SANS horodatage (diff/replay stables). */
  readonly empreinte: string;
}

export interface ExportLive {
  readonly mission: "M09";
  readonly kind: "live";
  readonly contrat: typeof VERSION_CONTRAT_LIVE;
  readonly horodatage: number;
  readonly records: readonly LiveRunRecord[];
}

/**
 * FNV-1a 32 bits, hexadécimal (idiome M03 `hacherContribution`, même
 * avertissement) : cheville de correspondance, PAS de confidentialité.
 */
export function hacherFnv1a(canonique: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < canonique.length; i++) {
    h ^= canonique.charCodeAt(i) ?? 0;
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Canonique à clés triées (stable, indépendant de l'ordre d'insertion). */
function canonique(valeur: unknown): string {
  if (valeur === null || valeur === undefined) return "null";
  if (Array.isArray(valeur)) return `[${valeur.map((v) => canonique(v)).join(",")}]`;
  if (typeof valeur === "object") {
    const o = valeur as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonique(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(valeur) ?? "null";
}

function cheminFerme(chemin: string | null): string {
  if (chemin === "connaissance" || chemin === "patient" || chemin === "refus") return chemin;
  return "inconnu";
}

/**
 * Projette un tour en record live. TOTALE sur l'entrée étroite : champs
 * inconnus = ignorés, chemin inconnu = `inconnu`, jamais d'exception.
 */
export function construireRecordLive(entree: EntreeBilanLive, horodatage: number = Date.now()): LiveRunRecord {
  const appels: AppelLive[] = entree.appels.map((a) => {
    const base: AppelLive = { capacite: a.capacite, ms: a.ms, ok: a.ok, deduplique: a.deduplique };
    return a.code === undefined ? base : { ...base, code: a.code };
  });
  const preuves: PreuveLive[] = entree.preuves.map((p) => ({ titre: p.titre, section: p.section, version: p.version }));
  const corps = {
    schema: VERSION_CONTRAT_LIVE,
    empreinteRun: hacherFnv1a(`m09-live-v1:${entree.runId}`),
    chemin: cheminFerme(entree.chemin),
    interrompu: entree.interrompu,
    persiste: entree.persiste,
    dureeMs: entree.dureeMs,
    appels,
    nbAppels: appels.length,
    preuves,
    nbPreuves: preuves.length,
    nbSnapshots: entree.nbSnapshots,
    propositionInconnue: entree.propositionInconnue === null ? null : entree.propositionInconnue.nom,
    resolution:
      entree.resolution === null
        ? null
        : {
            etat: entree.resolution.etat,
            intentionChainee: entree.resolution.intentionChainee,
            intentionRetenu: entree.resolution.intentionRetenu,
          },
  };
  return { ...corps, horodatage, empreinte: hacherFnv1a(canonique(corps)) };
}

/** Anneau borné : le plus ancien tombe, la lecture est défensive (copie). */
export class AnneauLive<TRecord = LiveRunRecord> {
  private readonly file: TRecord[] = [];
  constructor(private readonly capacite: number = TAILLE_ANNEAU_LIVE) {}

  pousser(record: TRecord): void {
    this.file.push(record);
    while (this.file.length > this.capacite) this.file.shift();
  }

  lire(): TRecord[] {
    return [...this.file];
  }

  get taille(): number {
    return this.file.length;
  }

  /** Vide l'anneau (tests uniquement — jamais en production). */
  vider(): void {
    this.file.length = 0;
  }
}

/** Exporte l'anneau au contrat `m09-live-v1` (clés fermées, voir live-schema.json). */
export function exporterAnneau(anneau: AnneauLive<LiveRunRecord>, horodatage: number = Date.now()): ExportLive {
  return {
    mission: "M09",
    kind: "live",
    contrat: VERSION_CONTRAT_LIVE,
    horodatage,
    records: anneau.lire(),
  };
}

/**
 * Interrupteur de captation (pendant client de `INTENT_CLASSIFIER_ENABLED`) :
 * OFF par défaut — la captation du trafic live, même PII-safe, est un acte
 * de politique, jamais un défaut. Les tests le basculent ; la prod attend
 * une affordance dédiée (mission ultérieure).
 */
let captationActive = false;

export function activerCaptationLive(active: boolean): void {
  captationActive = active;
}

export function captationLiveActivee(): boolean {
  return captationActive;
}

/**
 * M09 reliquat · contrat `m09-live-v2` (ADDITIF, `m09-live-v1` FIGÉ).
 *
 * ═══ CE QUI CHANGE, ET CE QUI NE CHANGE PAS ═══
 * Le record v2 ENVELOPPE le v1 (`{v1, approbation}`) : l'export v1 se
 * projette sans recalcul, donc octet-identique au contrat gelé. Les tours
 * portent `approbation: null` ; seuls les records d'approbation (geste
 * humain accepter/refuser, vérification M06) la portent.
 *
 * Pas de `retrievalFp` dans l'export : la jambe (titre, section, version)
 * voyage déjà dans `preuves`, et l'ingest (`ingerer-live.mjs`, node:crypto)
 * en dérive le SHA-256 persisté de façon déterministe — une seule
 * représentation par couche, pas de double identifiant pour la même preuve.
 * `node:crypto` est interdit ici (module partagé navigateur).
 *
 * `issue` fermée : les cinq issues M06 (`IssueConnue`) + `inconnu` (repli
 * total, jamais de devinette, jamais d'exception). `inconnu` vit aussi dans
 * le CHECK 098 : l'étiquette dit le trou au lieu de le combler.
 */
export const VERSION_CONTRAT_LIVE_V2 = "m09-live-v2" as const;

export const ISSUES_APPROBATION = ["ok", "echec", "inconnue", "bloquee", "duplicata", "inconnu"] as const;
export type IssueApprobation = (typeof ISSUES_APPROBATION)[number];

export interface ApprobationLive {
  /** Empreinte de la ligne `app.jarvis_actions` (jamais l'UUID brut). */
  readonly actionFp: string;
  readonly issue: IssueApprobation;
  /** Empreinte (actionFp, issue constatée) — lie l'approbation à son constat. */
  readonly executionFp: string | null;
  /** Jointure opportuniste vers le tour proposant (null = sans lien). */
  readonly runFp: string | null;
}

export interface LiveRunRecordV2 {
  readonly v1: LiveRunRecord;
  readonly approbation: ApprobationLive | null;
  /**
   * Empreintes d'invocation, PARALLÈLES à `v1.appels` (même ordre, même
   * longueur) : `toolCallId` haché ou null quand rien n'a été invoqué
   * (sonde, porte, dédup — par construction M04). Le brut ne franchit
   * jamais la projection ; la persistance écrit `ai_live_calls.tool_call_fp`.
   */
  readonly outilsFp: readonly (string | null)[];
}

export interface ExportLiveV2 {
  readonly mission: "M09";
  readonly kind: "live";
  readonly contrat: typeof VERSION_CONTRAT_LIVE_V2;
  readonly horodatage: number;
  readonly records: readonly LiveRunRecordV2[];
}

/** Empreinte d'une ligne d'action (corrélation, PAS de confidentialité). */
export function empreinteAction(actionId: string): string {
  return hacherFnv1a(`m09-act:${actionId}`);
}

/** Empreinte d'une invocation réelle de capacité (couture M04→M09). */
export function empreinteOutil(toolCallId: string): string {
  return hacherFnv1a(`m09-tc:${toolCallId}`);
}

/** Empreinte du constat d'exécution (même action, autre issue = autre empreinte). */
export function empreinteExecution(actionFp: string, issue: string): string {
  return hacherFnv1a(`m09-exec:${actionFp}:${issue}`);
}

function issueFermee(issue: string): IssueApprobation {
  return (ISSUES_APPROBATION as readonly string[]).includes(issue)
    ? (issue as IssueApprobation)
    : "inconnu";
}

export interface EntreeApprobationLive {
  readonly actionFp: string;
  readonly issue: string;
  readonly executionFp?: string | null;
  readonly runFp?: string | null;
}

/**
 * Enveloppe un tour (construction v1 inchangée) + approbation éventuelle.
 * TOTALE : issue inconnue = `inconnu`, champs manquants = null.
 */
export function construireRecordLiveV2(
  entree: EntreeBilanLive,
  approbation: EntreeApprobationLive | null,
  horodatage: number = Date.now(),
): LiveRunRecordV2 {
  const v1 = construireRecordLive(entree, horodatage);
  const outilsFp = entree.appels.map((a) =>
    a.toolCallId === undefined ? null : empreinteOutil(a.toolCallId),
  );
  if (approbation === null) return { v1, approbation: null, outilsFp };
  return {
    v1,
    approbation: {
      actionFp: approbation.actionFp,
      issue: issueFermee(approbation.issue),
      executionFp: approbation.executionFp ?? null,
      runFp: approbation.runFp ?? null,
    },
    outilsFp,
  };
}

/**
 * Record d'approbation : le geste humain (accepter/refuser) et son constat,
 * rattachés au tour proposant par `runFp` quand il est connu. Le corps v1
 * est minimal et déterministe (id synthétique secret-dérivé d'empreintes,
 * jamais d'identifiant brut) : `chemin` vaut `inconnu`, il n'y a ni appel
 * ni preuve — tout le sens vit dans `approbation`.
 */
export function construireRecordApprobation(
  entree: {
    readonly runFp: string | null;
    readonly actionFp: string;
    readonly issue: string;
    readonly executionFp?: string | null;
    readonly dureeMs: number;
  },
  horodatage: number = Date.now(),
): LiveRunRecordV2 {
  const issue = issueFermee(entree.issue);
  const v1 = construireRecordLive(
    {
      runId: `m09-approbation:${entree.actionFp}:${issue}`,
      chemin: "inconnu",
      interrompu: false,
      persiste: true,
      dureeMs: entree.dureeMs,
      appels: [],
      preuves: [],
      nbSnapshots: 0,
      propositionInconnue: null,
      resolution: null,
    },
    horodatage,
  );
  return {
    v1,
    approbation: {
      actionFp: entree.actionFp,
      issue,
      executionFp: entree.executionFp ?? null,
      runFp: entree.runFp,
    },
    outilsFp: [],
  };
}

/** Exporte l'anneau v2 au contrat `m09-live-v2` (clés fermées, voir live-schema-v2.json). */
export function exporterAnneauV2(
  anneau: AnneauLive<LiveRunRecordV2>,
  horodatage: number = Date.now(),
): ExportLiveV2 {
  return {
    mission: "M09",
    kind: "live",
    contrat: VERSION_CONTRAT_LIVE_V2,
    horodatage,
    records: anneau.lire(),
  };
}

/**
 * Projette un anneau v2 vers l'export `m09-live-v1` (contrat gelé) : les
 * records v1 sont ceux qu'aurait rendus la couture slice 3, sans recalcul.
 */
export function exporterAnneauV1(
  anneau: AnneauLive<LiveRunRecordV2>,
  horodatage: number = Date.now(),
): ExportLive {
  return {
    mission: "M09",
    kind: "live",
    contrat: VERSION_CONTRAT_LIVE,
    horodatage,
    records: anneau.lire().map((r) => r.v1),
  };
}
