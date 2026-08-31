/**
 * L'environnement serveur, validé une fois pour toutes — SERVEUR UNIQUEMENT.
 *
 * ═══ POURQUOI VALIDER, ET POURQUOI AU DÉMARRAGE ════════════════════════════
 *
 * Du temps des fonctions Deno, chaque clé se lisait à l'usage :
 * `Deno.env.get("GROQ_API_KEY")`. Une variable absente ne se voyait donc qu'au
 * moment où on s'en servait — c'est-à-dire pendant une consultation, quand la
 * praticienne appuie sur le micro. Le symptôme était un 500 au pire moment, sur
 * une machine où personne ne lit les journaux.
 *
 * Ici, tout est lu et validé une seule fois. Une configuration incomplète
 * empêche le DÉMARRAGE, ce qui est le bon moment pour s'en apercevoir : au
 * lancement, devant l'écran, pas au milieu d'un entretien.
 *
 * ═══ LA DIFFÉRENCE ENTRE OBLIGATOIRE ET FACULTATIF ═════════════════════════
 *
 * `MINDCARE_DATABASE_URL` est obligatoire : sans base, il n'y a pas
 * d'application. Les clés de fournisseurs d'IA sont FACULTATIVES, et c'est un
 * choix clinique, pas une négligence : le cabinet doit pouvoir travailler sans
 * internet (ADR-001, mode hors-ligne). Une clé absente désactive la
 * fonctionnalité correspondante PROPREMENT — la dictée refuse en disant
 * pourquoi — au lieu d'empêcher d'ouvrir un dossier.
 *
 * C'est la même hiérarchie que celle d'`errors.ts` : `transcription`,
 * `synthese` et `analyse` sont des codes distincts d'`indisponible` précisément
 * pour que la panne d'un fournisseur ne se présente pas comme une panne de la
 * base.
 */

import { z } from "zod";

/**
 * ⚠️ AUCUNE DE CES CLÉS NE DOIT PORTER LE PRÉFIXE `NEXT_PUBLIC_`. Next.js
 * remplace textuellement `process.env.NEXT_PUBLIC_*` dans le paquet navigateur ;
 * une clé de fournisseur ainsi préfixée serait livrée à chaque visiteur. C'est
 * la règle 2 de CLAUDE.md, et le contrôle 2 de `preflight.sh` la vérifie.
 *
 * Ce module vit sous `src/server/**` et n'est jamais importé par un composant :
 * rien de ce qu'il lit ne peut donc atteindre le navigateur.
 */
const Schema = z.object({
  // ── La base : sans elle, rien ──────────────────────────────────────────
  MINDCARE_DATABASE_URL: z.string().min(1, "MINDCARE_DATABASE_URL est obligatoire"),

  // ── Cookie et écoute ───────────────────────────────────────────────────
  MC_HTTPS: z.string().optional(),

  // ── Le mode vocal (ADR-024) ────────────────────────────────────────────
  // `cloud` autorise la sortie vers Groq/ElevenLabs ; toute autre valeur la
  // refuse. Le second verrou est en base (`app.is_cloud_dev()`), et il reste :
  // deux verrous indépendants, dont un que le fichier d'environnement ne peut
  // pas ouvrir.
  VOICE_PROVIDER: z.string().optional(),

  // ── Interrupteurs Jarvis ───────────────────────────────────────────────
  JARVIS_ENABLED: z.string().optional(),
  JARVIS_STREAMING: z.string().optional(),
  JARVIS_VOICE_ENABLED: z.string().optional(),

  // ── Fournisseurs — tous facultatifs, voir l'en-tête ────────────────────
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_MODEL: z.string().optional(),
  LLM_MODEL: z.string().optional(),
  SEEKAI_API_KEY: z.string().optional(),
  SEEKAI_MODEL: z.string().optional(),
  SEEKAI_BASE_URL: z.string().optional(),
  NEW_API_KEY: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
  STT_MODEL: z.string().optional(),
  ELEVENLABS_API_KEY: z.string().optional(),
  ELEVENLABS_VOICE_ID: z.string().optional(),
  TTS_MODEL: z.string().optional(),

  // ── Origines autorisées (voir `src/server/cors.ts`) ────────────────────
  CORS_ORIGINS: z.string().optional(),
});

export type EnvServeur = z.infer<typeof Schema>;

let cache: EnvServeur | undefined;

/**
 * Lit et valide l'environnement. Mémoïsé : la validation ne coûte rien, mais un
 * message d'erreur répété à chaque requête noierait le journal.
 *
 * ⚠️ NE JAMAIS JOURNALISER `process.env`, NI LE RÉSULTAT DE CETTE FONCTION.
 * Le message d'erreur ci-dessous ne cite que des NOMS de variables, jamais leur
 * valeur — une clé de fournisseur dans un journal est une clé publiée.
 */
export function env(): EnvServeur {
  if (cache !== undefined) return cache;

  const analyse = Schema.safeParse(process.env);
  if (!analyse.success) {
    const manquantes = analyse.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(
      `Configuration serveur invalide. Variables en cause : ${manquantes}. ` +
        "Le serveur ne démarre pas dans cet état.",
    );
  }

  cache = analyse.data;
  return cache;
}

/** Remise à zéro — tests uniquement. */
export function reinitialiserEnv(): void {
  cache = undefined;
}

/**
 * Les interrupteurs, lus une fois et rendus en booléens.
 *
 * Convention conservée telle quelle du temps des Edge Functions : la chaîne
 * `"true"` active, tout le reste désactive. On ne l'assouplit pas (`"1"`,
 * `"yes"`) — un interrupteur qui accepte plusieurs orthographes finit par être
 * activé par erreur, et celui-ci ouvre une sortie réseau vers un fournisseur
 * d'IA depuis un cabinet de psychiatrie.
 */
export function jarvisActif(): boolean {
  return env().JARVIS_ENABLED === "true";
}

export function jarvisFluxActif(): boolean {
  return env().JARVIS_STREAMING === "true";
}

export function jarvisVoixActive(): boolean {
  return env().JARVIS_VOICE_ENABLED === "true";
}
