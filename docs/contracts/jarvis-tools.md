# Contrat — outils Jarvis (CURRENT)

> Registre actif : `capacites` (lecture) + `ecritures` (écriture).
> Définies dans le code : 22 lectures (`LECTURES`, `capacites.ts:992`) +
> 7 écritures (`ECRITURES`, `ecritures.ts:567`) — l'allowlist `033`→`063`
> peut en exposer un sous-ensemble : vérifier l'écart défini/exposé avant d'ajouter.
> `jarvis-tools.ts` + `jarvis.ts` = LEGACY (retraite Phase 5, ne pas étendre).

## INPUT
Intention normalisée (`shared/jarvis/routing.ts` + `normalisation.ts`),
jamais le texte patient brut comme instruction (injection : notes = données).

## OUTPUT
Lecture : DTO `Safe*` (whitelist, `jarvis-projections.ts`). Écriture : proposition
+ carte de confirmation, JAMAIS d'exécution directe par le modèle.

## AUTHORIZATION
Cycle imposé : propose → confirm → execute → verify → log.
- `app.confirm_jarvis_action` (`033:141`) pose `confirmed_at` (transaction séparée).
- `app.execute_jarvis_action` (`033:249`, `063:164`) exige `confirmed` + revérifie.
- CHECK `jarvis_must_confirm` (`012`) : `executed` ⇒ `confirmed_at NOT NULL`.
- Surface bornée : `jarvis_tool_allowlist` (`033`→`063`) + `allowlist.generated.ts`.

## DB GATE
Boucle (`jarvis-boucle.ts`) n'importe QUE de la lecture. Aucun chemin modèle →
écriture, même si le modèle la propose (rendu à l'appelant).

## SIDE EFFECTS
Tout appel externe passe par `server/egress/external-call.ts` après
`pseudonymize()` + `assertSafe()` (texte). Audio brut = verrou voix (`garderVoix()` :
`VOICE_PROVIDER=cloud` ET `app.is_cloud_dev()`, fail-closed).

## ERRORS
Échec honnête nommé (`eval-jarvis-ecritures` : scénario N). Budget/dédup/fail-closed
dans la boucle. Audit : `audit.log_boundary_crossing` (insert-only).

## TESTS
- `scripts/eval-jarvis-*.mjs` (registre, routage, frontière, injection, boucle)
- `tests/unit/jarvis-*.test.ts` (enveloppe, routage, pare-feu, boucle)
- `tests/e2e/jarvis.spec.ts` · J2-E manuel = ROUGE connu (écritures non prouvées)

## DO NOT LOAD
Finance, patients, documents, migrations hors `033`/`063`, `fr.ts` entier,
`STATE.md`. Capacités exactes : `03-JARVIS-TOOLS.md` §0 (état réel), pas §§3-4.
