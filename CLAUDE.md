# CLAUDE.md
**MindCare OS — Cabinet Dr. Larbi N., Alger**
Read this file completely before writing any code. Every session. No exceptions.

---

## WHAT THIS IS

A clinical system for a solo psychiatric practice in Algiers. Real patients, real medical records, real legal exposure under Algerian **Loi 18-07**.

This is not a demo, not a prototype, not a portfolio piece. A bug here can misstate a dose, expose a psychiatric record, or destroy the legal value of a medical file.

**When speed and safety conflict, safety wins. Always. Without asking.**

---

## THE DOCUMENTS

| File | Contains |
|---|---|
| `00-DECISIONS.md` | Locked decisions + ADRs. **The document wins over your judgment.** |
| `01-SCHEMA.md` | DDL, RLS, triggers, migrations, acceptance tests |
| `02-SECURITY-BOUNDARY.md` | Data tiers, pseudonymization gateway, secrets |
| `03-JARVIS-TOOLS.md` | Tool allowlist, execution contract, clinical guardrails |
| `04-DESIGN-SYSTEM.md` | Tokens, type, motion, components, French UI copy |
| `05-BUILD-PLAN.md` | Hour-by-hour plan, checkpoints, sacrifice order |

Working on a domain → read its file first. Don't reconstruct decisions from memory.

---

## THE TEN HARD RULES

**1. Patient-identifying data never leaves the machine.**
Names, DOB, phone, address, ID numbers, `patient_id`. Not to a cloud API, not to a log, not to an error message, not to a chat.

**2. One exit door.**
External calls go through `_shared/external-call.ts` only. If you write `fetch('https://…')` anywhere else, you broke the architecture. CI catches it — don't make CI the first line of defense.

**3. No secrets client-side.**
`SERVICE_ROLE_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY` live in server env. `ANON_KEY` is the only key that reaches the browser. A key that appeared in a commit or a chat is compromised — revoke it, no debate.

**4. Security lives in the database.**
RLS on every patient table, `FORCE ROW LEVEL SECURITY`. Never filter permissions in JavaScript. If you write `if (role === 'assistant')` to hide clinical data, that's a design bug — fix the policy instead.

**5. Signed notes are immutable.**
15-minute draft window, then locked by trigger. Corrections are amendments. Never add a bypass, never add an admin override, never "just this once."

**6. Jarvis proposes, humans decide.**
Every write shows a confirmation card and waits for a click. `state='executed'` without `confirmed_at` is a constraint violation by design. Don't route around it.

**7. Audio is never written to disk.**
RAM → Groq → text → freed. No temp files, no IndexedDB, no "cache for retry."

**8. No fake data in shipped features.**
An empty state is honest. Mock data in a delivered screen is a lie that will be discovered in front of a patient.

**9. Everything degrades.**
API down → the app still works. She can run a consultation, write a note, print a certificate with zero AI. Jarvis is an accelerator, never a dependency.

**10. Red checkpoint = stop.**
Fix it. Don't proceed, don't work around it, don't leave a TODO.

---

## ROLES — MEMORIZE THIS

| Role | Sees | Never sees |
|---|---|---|
| `owner` (Dr. Larbi) | Everything, all practitioners, all revenue | — |
| `practitioner` (Dr. #2) | Own patients, own notes, **own revenue only** | Other practitioners' anything |
| `assistant` | Identity, contact, appointments, payment amount + status | **Clinical notes, transcripts, diagnoses, prescriptions, consultation reason** |
| `patient` | Own aftercare data | Everything else |

**Strict walls.** No shared patients between practitioners. No exceptions in code.

⚠️ **The `reason` column trap.** RLS filters rows, not columns. The assistant front-end queries the view `appointments_admin` — **never** the table `appointments`. Check this in every review.

---

## FORBIDDEN — DO NOT BUILD

```
execute_sql              → bypasses RLS
delete_clinical_note     → ADR-004
sign_clinical_note       → only a human signs; it carries her medical liability
send_message_to_patient  → no automated messages to psychiatric patients
export_patient_data      → exfiltration in one call
modify_permissions       → privilege escalation
read_file / write_file / run_command → system access
```

If one of these seems necessary, the requirement was misunderstood. Ask.

---

## CLINICAL LANGUAGE

Jarvis describes. It never concludes.

| ❌ Never | ✅ Always |
|---|---|
| "Le patient est dépressif." | "Éléments évoquant une symptomatologie dépressive — à évaluer." |
| "Prescrire de la sertraline." | "Aucun ISRS dans l'historique." |
| "Risque suicidaire élevé." | "Mention d'idées noires à 12:34 — exploration suggérée." |

Permanent disclaimer on live insights: *« Aide à la décision — le jugement clinique appartient au praticien. »*

🔴 **Intake and aftercare questions must never suggest a side effect.** It biases self-reporting. This is a clinical requirement from the doctor herself. Every new question gets human review against this rule.

---

## UI RULES

- **French everywhere.** No hardcoded strings — i18n from day one.
- **Arabic** for transcript output. Real font (`IBM Plex Sans Arabic`), `dir="rtl"`, line-height 1.8.
- **Tokens only.** No invented hex values, no invented durations. `04-DESIGN-SYSTEM.md` §3 and §8.
- **Glass on floating chrome only.** Never on data surfaces. §4 of the design system — this one is a safety rule, not taste.
- **Red is a budget.** Disk critical and data loss only. A cancelled appointment is not red.
- **Fonts bundled locally.** The cabinet's Wi-Fi drops.
- **Buttons name their action.** `Signer la note` → toast `Note signée.` Same verb throughout. Never `Soumettre` or `OK`.

---

## WORKFLOW

1. **Plan mode first.** Show the plan. Wait for approval.
2. **One task, one commit.** `feat(patients): liste + recherche trigram`
3. **Every task ends with a copy-pasteable checkpoint** producing green or red. Never "looks good."
4. **Done means all six** (§9 of `05-BUILD-PLAN.md`): real data · RLS verified for 3 roles · degrades cleanly · empty + error states written · design tokens respected · reproducible green checkpoint.
5. **Push back.** If an instruction conflicts with these rules, say so before writing code. Being right at 2am is worth more than being agreeable.

---

## BEFORE EVERY COMMIT

```bash
# no external calls outside the gateway
grep -rn "fetch(['\"]https://" --include="*.ts" --include="*.tsx" src/ supabase/ \
  | grep -v "_shared/external-call.ts"

# no secrets client-side
grep -rn "SERVICE_ROLE\|GROQ_API_KEY\|OPENROUTER_API_KEY" src/

# no audio on disk
find . -name "*.webm" -o -name "*.wav" -o -name "*.ogg"
```
All three return nothing. Any output = do not commit.

---

## CURRENT STATE

**Month 1 — deliberate compromises, documented, time-boxed:**
- STT via Groq (no GPU on the machine) — flips local via `STT_PROVIDER`
- LLM via OpenRouter — flips local via the model routing table
- Prescriptions recorded, **not printed** — she writes by hand
- Consents on paper
- Vidal not yet imported (~60 medications seeded manually)

**Not built yet:** voice Jarvis · aftercare · communications · external agents · public site · pgvector memory

**Month 2, on GPU arrival:** local Whisper, local LLM, long-term memory. **Config change, not a rebuild.** Keep it that way.

---

## THE TEST

Before shipping any screen, ask:

1. Does this help her treat, or help us impress? The second one gets removed.
2. Can she read this value in half a second, with a patient talking?
3. If the network dies right now, does she lose work?
4. Would this record hold up in front of a judge?

---

*If something here contradicts what you were just asked to do — stop and say so.*
