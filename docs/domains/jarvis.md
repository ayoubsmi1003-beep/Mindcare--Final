# Domaine Jarvis / voix (CURRENT)

PURPOSE: Orchestrateur borné : intention → capacité → porte → vérification → audit.
Jarvis N'EST PAS le modèle. Voix = boucle locale (wake-word ONNX) + cloud
gated (STT/TTS/LLM).
OWNER RUNTIME: `services/jarvis-boucle.ts` (machine à états, budgets, dédup,
fail-closed) · `services/jarvis-contexte.ts` (broker, cible unique).
CAPACITÉS: `jarvis-capacites.ts` (22 lectures définies, `LECTURES :992`) ·
`jarvis-ecritures.ts` (7 écritures définies, `ECRITURES :567`, cycle confirm/execute) · `alias`/`briefs`/`projections`/`messages`/`identite`/
`confidentialite`. LEGACY (ne pas étendre) : `jarvis-tools.ts`, `jarvis.ts`.
KERNEL (sans I/O): `src/server/jarvis/` (routing, normalisation, lexique,
pseudonymize, contrat-workspace, contexte-seance, resume-cas/chronologie,
proposition, client-sql). EGRESS UNIQUE : `src/server/egress/external-call.ts`.
DB GATES: `confirm_jarvis_action` (`033:141`) · `execute_jarvis_action`
(`033:249`, `063:164`) · allowlist (`033`→`063`) · conversations (`058`).
Détail : `docs/contracts/jarvis-tools.md` + `03-JARVIS-TOOLS.md` §0+§1.
SECURITY: modèle n'exécute rien (propose→confirm→execute→verify→log,
`confirmed_at` avant exécution) · texte → pseudo+assert avant sortie · audio brut
= `garderVoix()` (`VOICE_PROVIDER=cloud` ET `is_cloud_dev()`, fail-closed) ·
résidu connu : texte libre (chat) et re-bascule cloud-dev (cf. ARCHITECTURE.md).
TESTS: `scripts/eval-jarvis-*.mjs` (10 : registre, routage, frontière, injection,
boucle, reveil…) · unit `jarvis-*.test.ts` (10) · e2e `jarvis.spec.ts` ·
J2-E manuel ROUGE (écritures non prouvées en prod).
FORBIDDEN: nouvelle écriture sans carte de confirmation · fetch hors egress ·
`SpeechRecognition` navigateur (envoie l'audio à Google, D-21).
