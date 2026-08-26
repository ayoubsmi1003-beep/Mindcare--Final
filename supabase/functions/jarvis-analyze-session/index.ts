/**
 * `jarvis-analyze-session` — l'entrée HTTP de l'unique outil Jarvis de S6.
 * `write: false` dans les deux specs (`03-JARVIS-TOOLS.md` §3,
 * `JARVIS-DEMO-SPEC.md` §2) : aucune carte de confirmation, aucune ligne
 * `jarvis_actions` — c'est ce qui rend ce périmètre tenable en une session.
 *
 * ⚠️ RÉPONSE TOUJOURS EN HTTP 200. Le corps est le SEUL contrat de succès/échec
 * — `{ ok: true, data }` ou `{ ok: false, error }`, même convention que
 * `Result<T>` côté client (`src/services/result.ts`). Un statut HTTP non-2xx
 * ferait dépendre le diagnostic du comportement de version de `supabase-js`
 * face à une erreur de fonction, qui a changé d'une release à l'autre ; le
 * corps, lui, ne bouge pas.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@3";

import { assertSafe, BoundaryViolation, pseudonymize, rehydrate } from "../_shared/pseudonymize.ts";
import { enTetesCors, reponsePrealable } from "../_shared/cors.ts";
import { llm } from "../_shared/external-call.ts";
import { getPromptHash, PROMPT_VERSION, SYSTEM_PROMPT_V1 } from "./prompt.ts";
import {
  assemblerContexteSeance,
  formaterDonneesStructurees,
  type SourceBrute,
} from "../_shared/contexte-seance.ts";

// ---------------------------------------------------------------------------
// Budget de tokens (§3.4 n°4) — désormais dans `_shared/contexte-seance.ts`.
//
// ⚠️ L'ANCIENNE TRONCATURE COUPAIT PAR LA FIN, ET C'ÉTAIT LE MAUVAIS SENS. Dans
// une note clinique, la fin porte l'évaluation et le plan — ce que la
// praticienne a DÉCIDÉ. Garder les six premiers milliers de caractères et jeter
// la conclusion produisait un résumé sans décision, sur une note longue.
// L'assemblage coupe maintenant par le DÉBUT, source par source, et dit ce
// qu'il a omis.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Validation étendue (§3.4 n°6) — au-delà de la forme.
// ---------------------------------------------------------------------------
const MAX_ENTREES = 12;
const MAX_LONGUEUR_ENTREE = 400;

const ReponseSchema = z.object({
  noteStructuree: z.object({
    subjective: z.string(),
    objective: z.string(),
    assessment: z.string(),
    plan: z.string(),
  }),
  evolution: z.array(z.string().max(MAX_LONGUEUR_ENTREE)).max(MAX_ENTREES),
  pointsNonExplores: z.array(z.string().max(MAX_LONGUEUR_ENTREE)).max(MAX_ENTREES),
});

type ReponseValidee = z.infer<typeof ReponseSchema>;

function deduplique(entrees: readonly string[]): readonly string[] {
  const vues = new Set<string>();
  const resultat: string[] = [];
  for (const entree of entrees) {
    const cle = entree.trim().toLowerCase();
    if (cle === "" || vues.has(cle)) continue;
    vues.add(cle);
    resultat.push(entree.trim());
  }
  return resultat;
}

/**
 * Retire un bloc de code Markdown (```json ... ``` ou ``` ... ```) qui
 * envelopperait la réponse.
 *
 * ⚠️ TROUVÉ EN VÉRIFICATION LOCALE, PAS EN RELECTURE. Le prompt système
 * demande une réponse « STRICTEMENT en JSON, sans aucun texte avant ou
 * après » — le modèle l'a quand même enveloppée dans une clôture de code au
 * premier appel réel constaté. Sans ce nettoyage, un JSON par ailleurs
 * PARFAITEMENT VALIDE et cliniquement correct échouait au parsing, brûlait la
 * seule reformulation autorisée (§3.4 n°9), puis renvoyait « Assistant
 * indisponible » — l'échec le plus coûteux qui soit : un vrai résultat, jeté.
 * Ne PAS élargir au-delà de cette forme précise : accepter n'importe quel
 * texte autour du JSON reviendrait à abandonner la contrainte de forme que le
 * prompt impose.
 */
function retirerCloture(texte: string): string {
  const nettoye = texte.trim();
  const motif = /^```(?:json)?\s*\n([\s\S]*?)\n?```$/i;
  const trouve = motif.exec(nettoye);
  return trouve?.[1] !== undefined ? trouve[1].trim() : nettoye;
}

/**
 * Rend `null` si la réponse ne satisfait pas les règles cliniques, même quand
 * le JSON est syntaxiquement valide. `null` déclenche la reformulation unique
 * de l'appelant (§3.4 n°9) — jamais une boucle.
 */
function validerEtNettoyer(brut: string): ReponseValidee | null {
  let json: unknown;
  try {
    json = JSON.parse(retirerCloture(brut));
  } catch {
    return null;
  }

  const analyse = ReponseSchema.safeParse(json);
  if (!analyse.success) return null;

  const donnees = analyse.data;

  // Chaque point non exploré DOIT être une question — c'est la seule garantie
  // que « ce n'est qu'une question » (§9.2, jamais une conclusion).
  if (donnees.pointsNonExplores.some((p) => !p.trim().endsWith("?"))) return null;

  const evolution = deduplique(donnees.evolution);
  const pointsNonExplores = deduplique(donnees.pointsNonExplores);

  const noteVide =
    donnees.noteStructuree.subjective.trim() === "" &&
    donnees.noteStructuree.objective.trim() === "" &&
    donnees.noteStructuree.assessment.trim() === "" &&
    donnees.noteStructuree.plan.trim() === "";

  // Rien à montrer sur les trois blocs = échec, pas une case vide légitime.
  if (noteVide && evolution.length === 0 && pointsNonExplores.length === 0) return null;

  return { noteStructuree: donnees.noteStructuree, evolution, pointsNonExplores };
}

// ---------------------------------------------------------------------------
// Lignes attendues des deux portes lues — mêmes noms que côté client S5/S6.
// ---------------------------------------------------------------------------
interface ConsultationRow {
  readonly patient_id: string | null;
  readonly raw_notes: string | null;
  readonly first_name: string | null;
  readonly last_name: string | null;
  readonly record_number: string | null;
}

interface PreviousNoteRow {
  readonly started_at: string;
  readonly note_status: string | null;
  readonly subjective: string | null;
  readonly objective: string | null;
  readonly assessment: string | null;
  readonly plan: string | null;
}

interface CorpsRequete {
  readonly consultationId: string;
}

function estCorpsValide(valeur: unknown): valeur is CorpsRequete {
  return (
    typeof valeur === "object" &&
    valeur !== null &&
    typeof (valeur as { consultationId?: unknown }).consultationId === "string" &&
    (valeur as { consultationId: string }).consultationId.length > 0
  );
}

function reponseEchec(req: Request, code: string, message: string): Response {
  return new Response(JSON.stringify({ ok: false, error: { code, message } }), {
    status: 200,
    headers: { "Content-Type": "application/json", ...enTetesCors(req) },
  });
}

Deno.serve(async (req) => {
  const prealable = reponsePrealable(req);
  if (prealable !== null) return prealable;

  if (req.method !== "POST") {
    return reponseEchec(req, "methode-invalide", "Méthode non supportée.");
  }

  const authorization = req.headers.get("Authorization");
  if (authorization === null) {
    return reponseEchec(req, "non-authentifie", "Assistant indisponible.");
  }

  let corps: unknown;
  try {
    corps = await req.json();
  } catch {
    return reponseEchec(req, "requete-invalide", "Requête invalide.");
  }
  if (!estCorpsValide(corps)) {
    return reponseEchec(req, "requete-invalide", "Requête invalide.");
  }

  // ── Étape 2 : client scopé au JWT de l'appelant — JAMAIS le service role. ──
  // La RLS s'applique exactement comme un appel direct depuis le navigateur
  // (L3, `03-JARVIS-TOOLS.md` §1 : « Jarvis hérite des permissions de la
  // praticienne connectée, n'élève jamais »). `db: { schema: "app" }` reprend
  // la convention de `src/services/db/supabase.ts`.
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (supabaseUrl === undefined || supabaseAnonKey === undefined) {
    return reponseEchec(req, "configuration", "Assistant indisponible.");
  }

  const client = createClient(supabaseUrl, supabaseAnonKey, {
    db: { schema: "app" },
    global: { headers: { Authorization: authorization } },
  });

  const { data: consultationRows, error: erreurConsultation } = await client.rpc("get_consultation", {
    p_id: corps.consultationId,
  });
  if (erreurConsultation !== null) {
    return reponseEchec(req, "indisponible", "Assistant indisponible.");
  }

  const consultation = (consultationRows as readonly ConsultationRow[] | null)?.[0];
  const patientId = consultation?.patient_id ?? null;
  const rawNotes = consultation?.raw_notes ?? null;

  // ── Étape 3 : sans patient ou sans notes, pas d'appel LLM sur du vide. ──
  if (patientId === null || rawNotes === null || rawNotes.trim() === "") {
    return reponseEchec(req, "regle-metier", "Aucune note à analyser pour cette séance.");
  }

  const { data: previousRows } = await client.rpc("get_previous_note", {
    p_patient_id: patientId,
    p_excluding_consultation_id: corps.consultationId,
  });
  const precedente = (previousRows as readonly PreviousNoteRow[] | null)?.[0] ?? null;

  // ── Le dossier structure : diagnostics, echelles, derniere prescription. ──
  //
  // AVANT CETTE LECTURE, L'ANALYSE ETAIT AVEUGLE AU DOSSIER. Elle ne voyait que
  // les notes du jour et UNE note precedente : ni diagnostic enregistre, ni
  // score d'echelle, ni traitement. Le resume produit etait coherent avec ce
  // qu'on lui avait montre, et muet sur tout le reste.
  //
  // On passe par la porte `get_patient_workspace` -- jamais un SELECT direct
  // (regle 6) : c'est elle qui journalise la lecture du dossier et qui applique
  // `can_see_clinical`. Un echec ici n'interrompt PAS l'analyse : mieux vaut un
  // resume fonde sur les notes seules qu'aucun resume, a condition de ne rien
  // affirmer sur ce qu'on n'a pas lu.
  let donneesStructurees: string | null = null;
  const { data: workspace, error: erreurWorkspace } = await client.rpc("get_patient_workspace", {
    p_id: patientId,
  });
  if (erreurWorkspace === null && workspace !== null && typeof workspace === "object") {
    const w = workspace as { clinique?: unknown; traitements?: unknown };
    donneesStructurees = formaterDonneesStructurees(w.clinique ?? null, w.traitements ?? null);
  }

  // ── Etape 4 : assemblage par PRESEANCE, budget borne, troncature DITE. ──
  //
  // L'ordre n'est plus une consigne de prompt mais une propriete du code :
  // notes finalisees > donnees structurees > transcription > longitudinal.
  // Voir `_shared/contexte-seance.ts`, et `scripts/eval-contexte-seance.mjs`
  // qui l'eprouve hors ligne.
  const noteAnterieure = precedente
    ? [precedente.subjective, precedente.objective, precedente.assessment, precedente.plan]
        .filter((champ) => champ !== null && champ.trim() !== "")
        .join("\n")
    : null;

  const sources: readonly SourceBrute[] = [
    {
      type: "notes-finalisees",
      libelle: "Notes de la praticienne pour la seance en cours",
      contenu: rawNotes,
    },
    {
      type: "donnees-structurees",
      libelle: "Donnees cliniques enregistrees au dossier",
      contenu: donneesStructurees,
    },
    {
      type: "contexte-longitudinal",
      libelle: "Consultation precedente",
      contenu: noteAnterieure,
    },
  ];

  const contexte = assemblerContexteSeance(sources);

  const identites = [consultation?.first_name, consultation?.last_name, consultation?.record_number].filter(
    (v): v is string => typeof v === "string" && v.trim() !== "",
  );

  // ── Étape 5 : pseudonymisation, prompt anti-injection. ──
  const blocDonnees = ["<donnees_patient>", contexte.bloc, "</donnees_patient>"].join("\n");

  const { texte: bloqueSans, map } = pseudonymize(blocDonnees, identites);

  try {
    assertSafe(bloqueSans, identites);
  } catch (cause) {
    if (cause instanceof BoundaryViolation) {
      return reponseEchec(req, "frontiere", "Assistant indisponible.");
    }
    throw cause;
  }

  const promptHash = await getPromptHash();
  const sessionToken = crypto.randomUUID();

  const messages = [
    { role: "system" as const, content: SYSTEM_PROMPT_V1 },
    { role: "user" as const, content: bloqueSans },
  ];

  // ── Étape 6 : appel, validation, UNE reformulation maximum (§3.4 n°9). ──
  const premierAppel = await llm({
    purpose: "jarvis",
    promptVersion: PROMPT_VERSION,
    promptHash,
    messages,
    sessionToken,
  });

  if (!premierAppel.ok) {
    return reponseEchec(req, premierAppel.error.code, premierAppel.error.message);
  }

  let validee = validerEtNettoyer(premierAppel.data);

  if (validee === null) {
    const reformulation = await llm({
      purpose: "jarvis",
      promptVersion: PROMPT_VERSION,
      promptHash,
      sessionToken,
      messages: [
        ...messages,
        { role: "user" as const, content: "Le format n'était pas respecté. Réponds STRICTEMENT au format JSON demandé, sans aucun texte hors du JSON." },
      ],
    });

    if (!reformulation.ok) {
      return reponseEchec(req, reformulation.error.code, reformulation.error.message);
    }
    validee = validerEtNettoyer(reformulation.data);
  }

  if (validee === null) {
    return reponseEchec(req, "indisponible", "Assistant indisponible.");
  }

  // ── Réhydratation — les jetons redeviennent les identités d'origine. ──
  const resultat = {
    noteStructuree: {
      subjective: rehydrate(validee.noteStructuree.subjective, map),
      objective: rehydrate(validee.noteStructuree.objective, map),
      assessment: rehydrate(validee.noteStructuree.assessment, map),
      plan: rehydrate(validee.noteStructuree.plan, map),
    },
    evolution: validee.evolution.map((e) => rehydrate(e, map)),
    pointsNonExplores: validee.pointsNonExplores.map((p) => rehydrate(p, map)),
  };

  return new Response(JSON.stringify({ ok: true, data: resultat }), {
    status: 200,
    headers: { "Content-Type": "application/json", ...enTetesCors(req) },
  });
});
