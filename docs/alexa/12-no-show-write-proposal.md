# Proposal: letting Alexa mark a patient absent

**Status: not implemented. Waiting for your approval.** No migration, code or test for this write exists yet.

## What it does

The doctor or assistant says "Marque [patient] absent à son rendez-vous de 10 h". Alexa identifies the appointment and shows a proposal. The appointment changes only after a person confirms in the panel.

Today Alexa can't do this. The Agenda screen can, through `app.mark_appointment_no_show`.

## Schema change

The next free migration number, `214`, should not be used, because the doctor's PC and others may hold a record of the deleted 214. The migration would be **`215_alexa_mark_no_show_action.sql`**, with no new table, column or enum type:

| Object | Change |
|---|---|
| `app.jarvis_actions`, constraint `jarvis_tool_allowlist` | Drop and re-add with one more value, `mark_appointment_no_show`. Existing rows stay valid, since the list only grows |
| `app.propose_jarvis_action` (both overloads from migration 190) | Add the value to the accepted list |
| `app.execute_jarvis_action` | Add the value to the accepted list, plus one `WHEN` branch that calls the existing `app.mark_appointment_no_show((v_args ->> 'appointment_id')::uuid)`, with `v_table := 'appointments'` |

Migration 190 and its predecessors stay untouched. The two functions are copied from their latest definition, because `CREATE OR REPLACE` needs the whole body.

**This adds one allowlist value, which Rule 9 says I must ask you about.**

## Authorization flow

1. **Understand:** the sentence must start with a mark or report verb and name an absence. Alexa never infers it from "il n'est pas venu" alone.
2. **Identify:** the patient and the appointment come from the existing read gates, under the caller's identity. Several matching appointments produce a question, never a guess.
3. **Propose:** `app.propose_jarvis_action` records the proposal. Nothing changes yet.
4. **Confirm:** a person presses the button and `confirmed_at` is written before execution (Rule 7).
5. **Execute:** `app.execute_jarvis_action` calls the existing gate, which is `SECURITY INVOKER`, so the database applies the caller's own rights. No role check is added in JavaScript.
6. **Trace:** the same transaction writes the audit row through the existing trigger.
7. **Verify:** Alexa reads the appointment again and reports the state it finds, not the state it asked for.

## Risks

| Risk | How it's handled | Left open |
|---|---|---|
| Wrong patient or wrong appointment | Proposal shows name, date and time. Identical names produce a question. Relatives and "l'autre patient" are refused earlier | A person can still confirm the wrong line |
| Marking absent someone who arrived | The existing gate allows `arrived` to `no_show`, and keeps `arrived_at` | **Your decision:** Alexa could refuse this case, which is stricter than the screen. I recommend refusing it |
| Marking a past or future appointment | The proposal shows the date | A rule limiting this to today isn't in the screen either. **Your decision** |
| Undoing a mistake | Not confirmed yet: I haven't checked whether the transition trigger allows going back from `no_show` | To test before coding. If it doesn't, the proposal must say the change can't be undone |
| Statistics change | Absences are counted by `get_analysis_overview` | This is the intended effect |
| Replay | The gate returns the same id if already absent, so a second run changes nothing | None known |
| Installed database differs | The evaluation database already shows that a recorded migration doesn't prove a function's shape | Run `scripts/alexa-installed-schema-check.sql` before applying |

## Tests required before calling it finished

- **Unit:** the proposal is built only from a mark-absent sentence. "Qui était absent hier ?" stays a read, and "Il n'est pas venu" doesn't propose.
- **Database checkpoint, in a rolled-back transaction:** one row per role and state.
  - Owner, in-scope practitioner and assistant: what the database allows.
  - Out-of-scope practitioner: same message as "not found".
  - Patient role: refused.
  - Each of `requested`, `confirmed`, `arrived`, `in_session`, `completed`, `cancelled`, `no_show` as the starting state.
  - Execution without `confirmed_at`: refused.
- **Atomicity:** if the audit write fails, the status doesn't change.
- **Integration, on the disposable action database:** propose, confirm, execute, read again; the audit row exists.
- **Campaign:** run the action suite with `ALEXA_EVAL_EXECUTE_ACTIONS=1`.
- **Security review** of the final diff, before the commit.

## What I need from you

1. Approval to add the allowlist value in migration `215`.
2. Should Alexa refuse to mark absent someone already marked arrived? I recommend yes.
3. Should Alexa limit this to today's appointments? I recommend yes, because older corrections are better made on the screen.
