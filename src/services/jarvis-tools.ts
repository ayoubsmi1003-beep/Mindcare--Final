/**
 * `jarvis-tools.ts` — l'allowlist des CINQ outils, et la chaîne de validation
 * qui les précède. `03-JARVIS-TOOLS.md` §1–4, `SPRINT-V1.md` §V2.2.
 *
 * ═══ CE FICHIER N'EST PAS UN SECOND CHEMIN D'ACCÈS AUX DONNÉES ═══
 * Les trois outils de LECTURE délèguent aux services existants — `searchPatients`,
 * `listAgenda`, `analyzeSession` — sans réécrire une requête. Un outil qui
 * refabriquerait la sienne divergerait le jour où la porte SQL change de
 * signature, et c'est exactement le défaut qui a coûté une session sur
 * `list_agenda` (024 → 025).
 *
 * Les deux outils d'ÉCRITURE ne délèguent PAS à `createAppointment` ni à
 * `setConsultationPrice`, et c'est le point de sécurité de ce fichier : ces
 * services appellent la porte métier EN DIRECT, sans poser de ligne dans
 * `app.jarvis_actions`. Les emprunter ferait écrire Jarvis sans carte de
 * confirmation — L2 tomberait, en silence, par réutilisation bien intentionnée.
 * Les écritures passent donc par les portes de 033 : proposer, confirmer,
 * exécuter, dans cet ordre et en trois appels distincts.
 *
 * ═══ POURQUOI TROIS APPELS ET NON UN ═══
 * Mesuré sur base jetable au rejeu de 033 : `now()` rend l'horodatage de
 * TRANSACTION. Réunir la confirmation et l'exécution dans une seule transaction
 * donne `confirmed_at = executed_at` à la microseconde, et l'ordre « confirmé
 * PUIS exécuté » cesse d'être démontrable après coup. Ce n'est pas une
 * préférence de style : c'est la seule raison pour laquelle la trace prouve
 * quelque chose.
 */

import { z } from "zod";

import { listAgenda, type AgendaEntry, type ConsultationKind } from "./appointments";
import { db } from "./db";
import { logFieldsFor } from "./errors";
import { analyzeSession, type AnalyseSeance } from "./jarvis";
import { log } from "./log";
import { searchPatients, type PatientListItem } from "./patients";
import { err, ok, type Result } from "./result";
import { fr } from "../i18n/fr";

// ═══════════════════════════════════════════════════════════════════════════
// 1 · L'ALLOWLIST — CINQ, ET LE COMPILATEUR LE VÉRIFIE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * `SESSION-CONTRACTS.md` §V2 : « un sixième outil ajouté dans cette session est
 * un défaut de revue, pas une amélioration ». La phrase est ici rendue
 * exécutoire à trois niveaux, parce qu'un seul se contourne par distraction :
 *   1. `AssertionCinq` ci-dessous — erreur de COMPILATION si la liste change ;
 *   2. `estOutilConnu()` — refus à l'exécution pour un nom hors liste ;
 *   3. la contrainte `jarvis_tool_allowlist` de 033 — refus EN BASE pour les
 *      deux outils d'écriture, y compris face à un appelant qui n'est pas nous.
 */
export const OUTILS_GELES = [
  "analyze_session",
  "search_patients",
  "get_agenda",
  "create_appointment",
  "set_consultation_price",
] as const;

export type ToolName = (typeof OUTILS_GELES)[number];

/** Rend `never` — donc une erreur de compilation — si la liste n'a plus 5 entrées. */
type AssertionCinq<T extends readonly unknown[]> = T["length"] extends 5 ? T : never;
const _cinqExactement: AssertionCinq<typeof OUTILS_GELES> = OUTILS_GELES;
void _cinqExactement;

/** Les deux SEULS outils qui écrivent. Doit correspondre à l'allowlist de 033. */
export const OUTILS_ECRITURE = ["create_appointment", "set_consultation_price"] as const;
export type ToolEcriture = (typeof OUTILS_ECRITURE)[number];

export function estOutilConnu(nom: string): nom is ToolName {
  return (OUTILS_GELES as readonly string[]).includes(nom);
}

export function estOutilEcriture(nom: ToolName): nom is ToolEcriture {
  return (OUTILS_ECRITURE as readonly string[]).includes(nom);
}

// ═══════════════════════════════════════════════════════════════════════════
// 2 · LES SCHÉMAS — la frontière que la sortie du modèle doit franchir
// ═══════════════════════════════════════════════════════════════════════════
//
// ⚠️ `z.guid()` ET NON `z.uuid()`, ET C'EST MESURÉ, PAS PRÉFÉRÉ. Zod 4 fait
// valider à `z.uuid()` la version et la variante RFC 4122. Les identifiants du
// jeu de développement (`00000000-…-0000000000b1`) n'ont pas de nibble de
// version : `z.uuid()` les REFUSE, alors que le cast `::uuid` de Postgres les
// accepte. Un schéma plus strict que la base ne protège de rien et casse tout
// ce qui n'est pas issu de `gen_random_uuid()`. `z.guid()` valide la forme
// 8-4-4-4-12 et rejette le reste — vérifié contre la lib installée, pas lu
// dans la doc.
const Guid = z.guid();

/** ISO 8601 AVEC fuseau. Un instant sans fuseau est faux une heure par nuit (I8). */
const InstantIso = z.iso.datetime({ offset: true });

/**
 * Les treize valeurs de `app.consult_kind` (024), recopiées ici parce que Zod a
 * besoin de valeurs à l'exécution — mais VERROUILLÉES sur le type existant par
 * le `satisfies` : retirer ou mal orthographier une entrée ne compile plus.
 *
 * ⚠️ Cette liste a d'abord été écrite de mémoire — `premiere`, `urgence`,
 * `controle` — et aucune des trois n'existe. Un `z.enum` inventé aurait refusé
 * les types réels et accepté des types que la base rejette au cast, l'échec
 * arrivant tout en bas, dans `execute_jarvis_action`, rangé en `failed` et
 * indiscernable d'un refus de la RLS. Même famille de défaut que la signature
 * à cinq arguments de `create_appointment`.
 */
const TYPES_DE_CONSULTATION = [
  "premiere_consultation",
  "suivi",
  "psychotherapie_individuelle",
  "therapie_couple",
  "therapie_familiale",
  "therapie_groupe",
  "teleconsultation",
  "certificat_medical",
  "renouvellement_ordonnance",
  "evaluation_psychiatrique",
  "bilan_psychologique",
  "entretien_famille",
  "entretien_tiers",
] as const satisfies readonly ConsultationKind[];

/**
 * `strictObject` partout : une clé inattendue est REJETÉE, jamais ignorée. Un
 * modèle qui hallucine `{"patient_id": …, "force": true}` doit échouer à la
 * frontière du schéma — un champ silencieusement ignoré aujourd'hui devient un
 * champ silencieusement pris en compte le jour où quelqu'un l'ajoute.
 */
export const SCHEMAS = {
  analyze_session: z.strictObject({
    consultationId: Guid,
  }),

  search_patients: z.strictObject({
    // 2 caractères minimum : une requête d'un caractère rendrait le cabinet
    // entier et transformerait un outil de recherche en outil d'export.
    query: z.string().trim().min(2).max(80),
    // Plafonné à 5 — `SPRINT-V1.md` §V2.2 : « ≤ 5 résultats + désambiguïsation ».
    limit: z.number().int().min(1).max(5).optional(),
  }),

  get_agenda: z.strictObject({
    from: InstantIso,
    to: InstantIso,
    practitionerId: Guid.optional(),
  }),

  create_appointment: z.strictObject({
    patientId: Guid,
    practitionerId: Guid,
    startsAt: InstantIso,
    // Mêmes bornes qu'en base (024). Dupliquées ici pour un refus LISIBLE, pas
    // pour remplacer la contrainte : la base reste l'autorité.
    durationMinutes: z.number().int().min(5).max(240),
    notesAdmin: z.string().max(500).optional(),
    kind: z.enum(TYPES_DE_CONSULTATION).optional(),
  }),

  set_consultation_price: z.strictObject({
    consultationId: Guid,
    // Dinars ENTIERS, jamais de centime ni de flottant (ADR-018).
    amountDzd: z.number().int().min(0).max(1_000_000),
  }),
} as const satisfies Record<ToolName, z.ZodType>;

export type ArgsDe<N extends ToolName> = z.infer<(typeof SCHEMAS)[N]>;

/**
 * LA SEULE ENTRÉE POUR UNE SORTIE DE MODÈLE. Aucun appelant ne doit atteindre
 * un outil sans être passé par ici.
 *
 * L'ordre est : sortie du modèle → Zod → contrat d'outil → RLS → proposition →
 * confirmation humaine → exécution. Un type TypeScript ne valide RIEN à
 * l'exécution : il a disparu au moment où le JSON du modèle arrive.
 */
export function validerArguments<N extends ToolName>(
  nom: N,
  argsBruts: unknown,
): Result<ArgsDe<N>> {
  const analyse = SCHEMAS[nom].safeParse(argsBruts);
  if (!analyse.success) {
    // On journalise le CHEMIN du champ fautif, jamais sa valeur : un argument
    // halluciné peut contenir un nom de patiente (règle 1). `LogFields` est une
    // interface FERMÉE — elle a refusé à la compilation un champ libre où la
    // valeur aurait pu se glisser. C'est I5 qui fait son travail.
    log.error("jarvis.outil.arguments", {
      code: "regle-metier",
      context: `outil:${nom}:${analyse.error.issues.map((i) => i.path.join(".")).join(",")}`,
    });
    return err({ code: "regle-metier", message: fr.jarvis.argumentsInvalides });
  }
  return ok(analyse.data as ArgsDe<N>);
}

// ═══════════════════════════════════════════════════════════════════════════
// 3 · LECTURE — délégation aux services existants, jamais de requête nouvelle
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Résultat d'une recherche de patient tel que Jarvis a le droit de le rendre.
 *
 * ⚠️ `plusieurs` EXISTE POUR QUE LE CHOIX SOIT IMPOSSIBLE À FAIRE SEUL. Le
 * type ne comporte AUCUNE variante « le plus probable » : la désambiguïsation
 * n'est pas une politesse d'interface, c'est l'absence de tout chemin de code
 * par lequel un homonyme pourrait être choisi. `SESSION-CONTRACTS.md` §V2 :
 * « Jarvis qui choisit entre deux homonymes » est un interdit.
 */
export type ResultatRecherche =
  | { readonly type: "aucun" }
  | { readonly type: "unique"; readonly patient: PatientListItem }
  | { readonly type: "plusieurs"; readonly candidats: readonly PatientListItem[] };

export async function outilSearchPatients(
  args: ArgsDe<"search_patients">,
): Promise<Result<ResultatRecherche>> {
  const resultat = await searchPatients({ query: args.query, limit: args.limit ?? 5 });
  if (!resultat.ok) return err(resultat.error);

  const lignes = resultat.data.rows;
  if (lignes.length === 0) return ok({ type: "aucun" });

  // Un seul résultat VISIBLE : c'est déterministe, il n'y a rien à arbitrer.
  // « Visible » et non « existant » — la RLS a pu en masquer d'autres, et c'est
  // un fonctionnement normal, pas une ambiguïté à signaler.
  const premier = lignes[0];
  if (lignes.length === 1 && premier !== undefined) {
    return ok({ type: "unique", patient: premier });
  }

  return ok({ type: "plusieurs", candidats: lignes });
}

export async function outilGetAgenda(
  args: ArgsDe<"get_agenda">,
): Promise<Result<readonly AgendaEntry[]>> {
  // `listAgenda` porte déjà la signature VIVANTE de `app.list_agenda` (025,
  // quatre arguments). C'est la raison de déléguer : une requête écrite ici
  // aurait visé les trois arguments de 024, droppés depuis, et échoué en 42883.
  //
  // La clé est OMISE plutôt que passée à `undefined` : sous
  // `exactOptionalPropertyTypes`, « absente » et « présente et indéfinie » sont
  // deux choses différentes, et seule la première veut dire « pas de filtre ».
  // ⚠️ INSTRUMENT — contrôle 1 du §V2. Un agenda vide a été conclu « aucun
  // rendez-vous visible » sans que personne n'ait vu les bornes RÉELLEMENT
  // passées : les bornes sont calculées par le MODÈLE, elles n'étaient donc
  // observables nulle part. On journalise les DEUX INSTANTS et un BOOLÉEN de
  // filtre — jamais l'identifiant de praticien lui-même, qui désigne une
  // personne (même raison que le retrait de `patientId` de `LogFields`).
  // Une borne est une date, pas une donnée de dossier : règle 1 tenue.
  log.info("jarvis.outil.agenda", {
    context: `de:${args.from} a:${args.to} filtrePraticien:${args.practitionerId !== undefined}`,
  });

  const resultat = await listAgenda(
    args.practitionerId === undefined
      ? { from: args.from, to: args.to }
      : { from: args.from, to: args.to, practitionerId: args.practitionerId },
  );

  // Le compte, séparé des bornes : c'est le couple « bornes demandées → lignes
  // rendues » qui distingue une mauvaise plage d'un périmètre réellement vide.
  log.info("jarvis.outil.agenda", {
    count: resultat.ok ? resultat.data.length : 0,
    ...(resultat.ok ? {} : { code: resultat.error.code }),
  });

  return resultat;
}

export async function outilAnalyzeSession(
  args: ArgsDe<"analyze_session">,
): Promise<Result<AnalyseSeance>> {
  return await analyzeSession(args.consultationId);
}

// ═══════════════════════════════════════════════════════════════════════════
// 4 · ÉCRITURE — les trois portes de 033, dans l'ordre, en trois appels
// ═══════════════════════════════════════════════════════════════════════════

/** Ce que l'humaine lit avant d'accepter. Chaque champ modifié y figure (V2.5). */
export interface CarteConfirmation {
  readonly actionId: string;
  /**
   * ⚠️ ÉLARGI DE `ToolEcriture` À `string` EN 063, ET C'EST DÉLIBÉRÉ. Les
   * écritures ne sont plus les deux seules d'ici : `jarvis-ecritures.ts` en
   * déclare quatre autres, et l'allowlist de 063 en admet sept en base.
   *
   * Ce champ N'A JAMAIS ÉTÉ UNE FRONTIÈRE — il ne l'était pas quand il était
   * typé, il ne l'est pas davantage maintenant. Ce qui borne réellement les
   * écritures, c'est la contrainte `jarvis_tool_allowlist` en base et le
   * registre d'écriture côté client. Un type d'affichage qui prétendrait
   * garantir la sécurité serait la sorte de garantie fausse qui empêche la
   * relecture suivante de chercher la vraie.
   */
  readonly outil: string;
  readonly titre: string;
  readonly champs: ReadonlyArray<{ readonly libelle: string; readonly valeur: string }>;
  /**
   * Un acte visible du patient ou irréversible — l'interface le signale.
   * La base ne fait pas la différence, et c'est normal : la gravité est une
   * notion d'écran, pas de contrainte.
   */
  readonly critique?: boolean;
}

/**
 * ÉTAPE 1 — proposer. Écrit une ligne `proposed` et rien d'autre : aucune table
 * métier n'est touchée. `cabinet_id` et `actor_id` ne sont PAS transmis — la
 * porte les prend de `app.current_cabinet()` et `auth.uid()`. Les accepter
 * d'ici déplacerait une décision d'autorisation dans le client.
 */
/**
 * `patientId` → `patient_id`. La frontière entre les deux conventions du §4 de
 * `CLAUDE.md` : `camelCase` en TypeScript, `snake_case` en base.
 *
 * ⚠️ TROUVÉ EN EXÉCUTANT, PAS EN RELISANT. `033` extrait `v_args ->> 'patient_id'`
 * et le client sérialisait `patientId` : les quatre extractions rendaient NULL,
 * `app.create_appointment` levait « Rendez-vous incomplet », et la ligne finissait
 * en `state='failed'`, `error='P0001'`. Aucune écriture n'était possible — pas
 * pour un argument mal formé, mais pour TOUS. Les 30 contrôles statiques
 * restaient verts : ils vérifient que les portes sont appelées, pas que les
 * clés se correspondent.
 *
 * La conversion vit ICI et non dans `033`, qui est appliquée et ne se modifie
 * pas (règle 9) — et parce qu'un adaptateur de nommage appartient au client,
 * pas au schéma.
 */
function versSnakeCase(args: Record<string, unknown>): Record<string, unknown> {
  const sortie: Record<string, unknown> = {};
  for (const [cle, valeur] of Object.entries(args)) {
    sortie[cle.replace(/[A-Z]/g, (lettre) => `_${lettre.toLowerCase()}`)] = valeur;
  }
  return sortie;
}

export async function proposerAction<N extends ToolEcriture>(
  entree: {
    readonly conversationId: string;
    readonly demandeUtilisateur: string;
    readonly outil: N;
    readonly args: ArgsDe<N>;
  },
): Promise<Result<string>> {
  const resultat = await db().rpc<string>("propose_jarvis_action", {
    p_conversation_id: entree.conversationId,
    p_user_utterance: entree.demandeUtilisateur,
    p_tool_name: entree.outil,
    // `tool_args` voyage en TEXTE : `RpcArgs` ne transporte que des scalaires
    // (ADR-020). La porte fait le cast en jsonb et échoue bruyamment si le
    // contenu n'est pas un objet.
    p_tool_args: JSON.stringify(versSnakeCase(entree.args)),
  });

  if (!resultat.ok) {
    log.error("jarvis.action.proposition", logFieldsFor(resultat.error));
    return err(resultat.error);
  }

  const id = resultat.data[0];
  if (id === undefined) {
    // La porte rend toujours un identifiant en cas de succès. Vide = la RLS a
    // refusé sans lever. On ne rend pas un succès : la carte s'afficherait sur
    // une proposition qui n'existe pas.
    log.error("jarvis.action.proposition", { code: "vide" });
    return err({ code: "interdit", message: fr.erreurs.interdit });
  }

  return ok(id);
}

/**
 * ÉTAPE 2 — confirmer. Pose `confirmed_at`. Appel SÉPARÉ de l'exécution : c'est
 * ce qui rend l'ordre vérifiable (voir l'en-tête du fichier).
 */
export async function confirmerAction(actionId: string): Promise<Result<string>> {
  const resultat = await db().rpc<string>("confirm_jarvis_action", { p_id: actionId });
  if (!resultat.ok) {
    log.error("jarvis.action.confirmation", logFieldsFor(resultat.error));
    return err(resultat.error);
  }

  const quand = resultat.data[0];
  if (quand === undefined || quand === null) {
    // `NULL` = ligne inexistante OU masquée par la RLS. La porte ne distingue
    // pas les deux (ADR-003) et l'interface ne doit pas non plus.
    return err({ code: "introuvable", message: fr.jarvis.propositionIntrouvable });
  }
  return ok(quand);
}

/** ÉTAPE 2bis — refuser. Refuser est le défaut : aucune raison n'est demandée. */
export async function refuserAction(actionId: string): Promise<Result<boolean>> {
  const resultat = await db().rpc<boolean>("reject_jarvis_action", { p_id: actionId });
  if (!resultat.ok) {
    log.error("jarvis.action.refus", logFieldsFor(resultat.error));
    return err(resultat.error);
  }
  return ok(resultat.data[0] === true);
}

/**
 * ÉTAPE 3 — exécuter. N'aboutit que sur une ligne déjà `confirmed` : la porte
 * lève sinon, et ce n'est pas ce code qui le décide.
 *
 * ⚠️ UN RETOUR NULL N'EST PAS UN SUCCÈS. La porte rend `NULL` quand elle a
 * basculé la ligne en `failed` — cible introuvable, hors périmètre, ou refus de
 * la RLS. Le rendre en `ok` afficherait « rendez-vous créé » sur un rendez-vous
 * qui n'existe pas. C'est le défaut exact qui avait été trouvé par relecture
 * sur `set_consultation_price` avant même l'exécution de 033.
 */
export async function executerAction(actionId: string): Promise<Result<string>> {
  const resultat = await db().rpc<string>("execute_jarvis_action", { p_id: actionId });
  if (!resultat.ok) {
    log.error("jarvis.action.execution", logFieldsFor(resultat.error));
    return err(resultat.error);
  }

  const affecte = resultat.data[0];
  if (affecte === undefined || affecte === null) {
    log.error("jarvis.action.execution", { code: "sans-effet" });
    return err({ code: "regle-metier", message: fr.jarvis.actionSansEffet });
  }

  log.info("jarvis.action.execution", { count: 1 });
  return ok(affecte);
}
