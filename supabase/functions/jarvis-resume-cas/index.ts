/**
 * `jarvis-resume-cas` — génération du Résumé du cas.
 *
 * ⚠️ L'IA NE BLOQUE JAMAIS L'ÉCRAN : cette fonction est appelée APRÈS le
 * rendu du workspace, sur geste explicite (« Générer / Actualiser »). En cas
 * d'échec, l'écran garde l'ancien résumé ou affiche le Point de situation —
 * jamais une page cassée.
 *
 * Chemin de vérité (deux barrières) :
 *   1 · `_shared/resume-cas.ts` filtre les citations contre les faits réels ;
 *   2 · `app.save_case_summary` REFUSE en base toute citation non vérifiée.
 *
 * Aucune identité patient ne sort : les champs identitaires sont retirés de
 * la charge, et `pseudonymize`+`assertSafe` verrouillent ce qui reste.
 */
import { createClient } from "npm:@supabase/supabase-js@2";

import { assertSafe, BoundaryViolation, pseudonymize } from "../_shared/pseudonymize.ts";
import { enTetesCors, reponsePrealable } from "../_shared/cors.ts";
import { llm } from "../_shared/external-call.ts";
import {
  construireCandidats,
  validerContenuResume,
  type EspacePourResume,
} from "../_shared/resume-cas.ts";
import { getPromptHash, PROMPT_VERSION, SYSTEM_PROMPT_RESUME } from "./prompt.ts";

interface CorpsRequete {
  readonly patientId: string;
}

function estCorpsValide(valeur: unknown): valeur is CorpsRequete {
  return (
    typeof valeur === "object" &&
    valeur !== null &&
    typeof (valeur as { patientId?: unknown }).patientId === "string" &&
    (valeur as { patientId: string }).patientId.length > 0
  );
}

function reponseEchec(req: Request, code: string, message: string): Response {
  return new Response(JSON.stringify({ ok: false, error: { code, message } }), {
    status: 200,
    headers: { "Content-Type": "application/json", ...enTetesCors(req) },
  });
}

/** Retire une clôture Markdown éventuelle (leçon jarvis-analyze-session). */
function retirerCloture(texte: string): string {
  const nettoye = texte.trim();
  const motif = /^```(?:json)?\s*\n([\s\S]*?)\n?```$/i;
  const trouve = motif.exec(nettoye);
  return trouve?.[1] !== undefined ? trouve[1].trim() : nettoye;
}

Deno.serve(async (req) => {
  const prealable = reponsePrealable(req);
  if (prealable !== null) return prealable;

  if (req.method !== "POST") {
    return reponseEchec(req, "methode-invalide", "Requête invalide.");
  }

  const authorization = req.headers.get("Authorization");
  if (authorization === null) {
    return reponseEchec(req, "non-authentifie", "Résumé indisponible.");
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

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (supabaseUrl === undefined || supabaseAnonKey === undefined) {
    return reponseEchec(req, "configuration", "Résumé indisponible.");
  }

  // Client scopé au JWT de l'appelante — L3 : Jarvis n'élève jamais.
  const client = createClient(supabaseUrl, supabaseAnonKey, {
    db: { schema: "app" },
    global: { headers: { Authorization: authorization } },
  });

  // ── Lecture par LA PORTE auditée (trace « fiche », RLS de l'appelante). ──
  const { data: wsRows, error: erreurWs } = await client.rpc("get_patient_workspace", {
    p_id: corps.patientId,
  });
  if (erreurWs !== null) {
    return reponseEchec(req, "indisponible", "Résumé indisponible.");
  }
  // ⚠️ get_patient_workspace retourne un jsonb SCALAIRE (047/057) : PostgREST
  // livre donc un OBJET directement — le lire comme un tableau rendait
  // `espace` indéfini et refusait chaque dossier avant tout appel LLM.
  // Tolérance tableau conservée : elle ne peut rien ouvrir de plus.
  const chargeWs = wsRows as unknown;
  const espace = (Array.isArray(chargeWs) ? chargeWs[0] : chargeWs) as
    | (Record<string, unknown> & EspacePourResume)
    | null
    | undefined;

  // Introuvable OU hors périmètre OU rôle sans clinique : même réponse.
  if (
    espace === undefined ||
    espace.clinique === null ||
    typeof espace.identite !== "object"
  ) {
    return reponseEchec(req, "regle-metier", "Ce dossier n'ouvre pas de résumé.");
  }

  // ── Candidats déterministes (≤5) + empreinte des faits couverts. ──
  const { candidats, total } = construireCandidats(espace);

  const sourceState = {
    diagnostics: Array.isArray(espace.clinique.diagnostics)
      ? espace.clinique.diagnostics.length
      : 0,
    echelles: Array.isArray(espace.clinique.echelles)
      ? espace.clinique.echelles.length
      : 0,
    consultations: espace.clinique.nombreConsultations ?? null,
    prescriptions: espace.traitements?.nombrePrescriptions ?? null,
    dernierEvenement:
      espace.clinique.derniereConsultation?.startedAt ??
      espace.agenda?.dernierRendezVous?.startsAt ??
      null,
  };

  // ── Charge SANS identité patient : zéro Tier-0 chez le fournisseur. ──
  const charge = {
    faits: {
      clinique: espace.clinique,
      traitements: espace.traitements,
      agenda: espace.agenda,
    },
    signaux_possibles: candidats.map((c) => ({
      cle: c.cle,
      libelle: c.libelle,
      sources: c.sources,
    })),
    consignes: {
      total_signaux: total,
      plafond_signaux: Math.min(candidats.length, 5),
    },
  };

  const identites = [
    (espace.identite as { firstName?: unknown }).firstName,
    (espace.identite as { lastName?: unknown }).lastName,
    (espace.identite as { recordNumber?: unknown }).recordNumber,
  ]
    .filter((v): v is string => typeof v === "string" && v.trim() !== "");

  const blocDonnees = [
    "<<<DONNEES_DOSSIER>>>",
    JSON.stringify(charge),
    "<<<FIN_DONNEES_DOSSIER>>>",
  ].join("\n");

  const { texte: bloqueSans, map } = pseudonymize(blocDonnees, identites);
  try {
    assertSafe(bloqueSans, identites);
  } catch (cause) {
    if (cause instanceof BoundaryViolation) {
      return reponseEchec(req, "frontiere", "Résumé indisponible.");
    }
    throw cause;
  }

  const promptHash = await getPromptHash();
  const messages = [
    { role: "system" as const, content: SYSTEM_PROMPT_RESUME },
    {
      role: "system" as const,
      content:
        "Date du jour (Africa/Algiers) : " +
        new Intl.DateTimeFormat("fr-FR", { timeZone: "Africa/Algiers", dateStyle: "long" }).format(
          new Date(),
        ),
    },
    { role: "user" as const, content: bloqueSans },
  ];

  const modele = Deno.env.get("OPENROUTER_MODEL") ?? "google/gemini-2.5-flash";

  const premier = await llm({
    purpose: "resume-cas",
    promptVersion: PROMPT_VERSION,
    promptHash,
    sessionToken: crypto.randomUUID(),
    messages,
  });
  if (!premier.ok) {
    return reponseEchec(req, premier.error.code, premier.error.message);
  }

  let brut: unknown;
  try {
    brut = JSON.parse(retirerCloture(premier.data));
  } catch {
    brut = null;
  }
  let contenu = validerContenuResume(brut, espace, candidats);

  if (contenu === null) {
    const reformulation = await llm({
      purpose: "resume-cas",
      promptVersion: PROMPT_VERSION,
      promptHash,
      sessionToken: crypto.randomUUID(),
      messages: [
        ...messages,
        {
          role: "user" as const,
          content:
            "Le format n'était pas respecté. Réponds STRICTEMENT avec l'objet JSON demandé, sans texte hors du JSON.",
        },
      ],
    });
    if (!reformulation.ok) {
      return reponseEchec(req, reformulation.error.code, reformulation.error.message);
    }
    try {
      brut = JSON.parse(retirerCloture(reformulation.data));
    } catch {
      brut = null;
    }
    contenu = validerContenuResume(brut, espace, candidats);
  }

  if (contenu === null) {
    return reponseEchec(req, "indisponible", "Résumé indisponible.");
  }

  // ── Écriture par LA PORTE (versions monotones, citations revérifiées). ──
  const { data: sauvegardeRows, error: erreurSauvegarde } = await client.rpc(
    "save_case_summary",
    {
      p_patient_id: corps.patientId,
      p_content: JSON.stringify(contenu),
      p_source_state: JSON.stringify(sourceState),
      p_model: modele,
      p_prompt_version: PROMPT_VERSION,
      p_prompt_hash: promptHash,
    },
  );
  if (erreurSauvegarde !== null) {
    return reponseEchec(req, "regle-metier", "Le résumé a été refusé par une règle du dossier.");
  }
  const resume = (sauvegardeRows as ReadonlyArray<unknown> | null)?.[0];
  if (resume === undefined || resume === null) {
    return reponseEchec(req, "regle-metier", "Ce dossier n'ouvre pas de résumé.");
  }

  return new Response(
    JSON.stringify({
      ok: true,
      data: { resume, totalSignaux: total, plafondSignaux: candidats.length },
    }),
    { status: 200, headers: { "Content-Type": "application/json", ...enTetesCors(req) } },
  );
});
