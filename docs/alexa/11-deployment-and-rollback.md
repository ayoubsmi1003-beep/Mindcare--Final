# 11 — Deployment and rollback

Nothing on this branch is pushed or deployed. This page says what to check before installing it at the cabinet, and how to go back.

## Before installing

1. **Check the installed database,** read-only. Keep the output.

   ```
   psql -X -A -t -f scripts/alexa-installed-schema-check.sql <cabinet connection>
   ```

   - **`treatment screen call : INCOMPATIBLE`:** the Treatments screen's workload view fails on that database. Alexa's read still works. A repair needs a new migration, which I'll propose only after seeing this output.
   - **`migration 214 : absent`:** this is expected on the doctor's PC. Nothing depends on it, and it must not be recreated.
2. **No new migration is in this branch.** Migration history doesn't change.
3. **Configuration:**
   - The packaged build already sets `ALEXA_NATIVE_AGENT_ENABLED=1` (`scripts/preparer-paquet.mjs`).
   - Hybrid book search needs `KNOWLEDGE_VECTOR=1` and `KNOWLEDGE_VECTOR_RECETTE=e5-base`, plus the recipe files in the package.
   - Without them, search falls back to lexical only, which is slower to find answers but safe.
4. **Privacy:**
   - A packaged install refuses every cloud inference call (`src/server/egress/external-call.ts`, `installationLivree()`), whatever the database says.
   - No change on this branch adds a network call.

## What changes for the users

| Change | Visible effect |
|---|---|
| Relatives and other patients | "Les allergies de son père" is no longer answered from the selected record. Alexa asks for the person's name |
| Several requests | Each request gets "Demande 1 sur 2 :" and its own answer or "n'a pas été traitée" |
| Unsupported changes | "Je ne peux pas faire cette modification et je n'ai rien changé." at once, instead of a long wait |
| Change answered by a read | "Je n'ai rien modifié" comes first |
| Refused read | "Lecture refusée par les permissions" instead of book passages |
| Voice | A partial or restricted answer is announced as shown on screen instead of being silent |
| Practice reads | Statistics, treatment workload, a treatment timeline and case summary state answer exact sentences |
| Book questions | Many more go straight to the books, without the model. "Que sait-on…", "Localise…" and "Risque de lithium pendant la grossesse" used to take 20 to 150 s |

## Rollback

| To undo | How |
|---|---|
| Everything | Reinstall the previous package. No data or schema changed, so nothing needs reverting in the database |
| Only the book list behaviour | `ALEXA_KNOWLEDGE_SELECTION=model` restores the model's selection. That path did not pass its review; use it only briefly |
| Hybrid search | Unset `KNOWLEDGE_VECTOR` |

There's no flag for the routing and safety changes, on purpose. A switch that brings back reading the wrong patient's record shouldn't exist.

## After installing

- Ask, with a test record selected:
  - "Les allergies de son père", which must ask for a name;
  - "Montre l'accueil puis les traitements à revoir", which must give two labelled answers;
  - "Supprime mes messages internes", which must refuse at once.
- Run the role test on a copy of the database if one is available: `tests/integration/alexa-practice-roles.live.test.ts`. It only runs against the evaluation database's name, on purpose.
- Watch "why did this turn fail" traces with `node scripts/alexa-why.mjs`. They hold closed codes only, including understanding codes and tool states.
