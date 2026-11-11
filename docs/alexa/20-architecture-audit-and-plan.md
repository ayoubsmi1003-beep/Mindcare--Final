# 20 — C270 phase: architecture audit, decisions and measurements

Branch `claude/alexa-conversational-intelligence-e9e6f8`, based on `71bb162` (C200–C202 work). Plan approved on 2026-11-11.
This file records what the code really does, what was measured, and what changed in the plan because of a measurement.

## 1. The pipeline as it runs (native path)
`POST /api/alexa/turn` → `runAlexa` (`orchestrator.ts`) → consultation patient from the server (`withConsultationPatient`) →
`understandTurn` (third party, change requests) → shortcuts (dialogue, clock, next patient, deterministic action) →
about fifteen follow-up rewriters → **word frames** (`patient-question.ts`, `agenda-frame.ts`, `practice-frame.ts`): each turns a
recognised request into a fixed **closed question** → `runAgentLoop`: 39 deterministic `direct*` builders execute closed questions
with no model; anything else goes to the **local MiniCPM 1B** in a 2-to-5-call tool loop (30–350 s on the doctor's PC) → SQL gates
under RLS → `presentAgentResults` → sentences. Books: `readKnowledge` (lexical AND gate + e5 vectors, fused, reranked) → verbatim
passages (`knowledge-references.ts`), never model text.

## 2. Root causes found (C202: 110/200)
| Cause | Where | Effect in C202 |
|---|---|---|
| Intent is a word list; unknown wording falls to the slow 1B loop | frames, `agent-loop.ts` | 59 of 98 failing turns |
| Follow-up state readable only on an identical `appContext` string | `conversation-state.ts:72` | follow-ups lost after a page change |
| A name the parser misses falls back to the screen patient | `patient-mention.ts` stop list | 2 cross-patient reads |
| The question is echoed and model tokens leak (`email:missing`, `nadir_mazouni`) | `agent-loop.ts` unresolved parts | visible in many failed answers |
| Lexical book gate needs EVERY word, no stemming | `123_knowledge_lexical_reader.sql` | one stray word = no passage |
| Book vectors built from 128 tokens, no heading | recipe `e5-base` | French→English misses |
| Glossary alias check disabled expansion on any English token | `terminologie-bilingue.ts:649` | expansion silently off |
| Budget stopped at the first oversized passage | `recherche.ts:164` | shorter good passages dropped |

## 3. A measurement that changed the plan: e5 cannot route by itself
The plan proposed nearest-neighbour intent matching with the e5-base model already installed. Measured on the catalogue's own
165 French paraphrases (27 read intents, leave-one-out, `tests/unit/alexa-semantic-intent.test.ts` and an offline script):

| Method | Right intent first |
|---|---:|
| raw k-NN (cosine) | 75 / 168 |
| centred k-NN | 78 / 168 |
| centred class centroid | **89 / 168** |
| linear classifier (5-fold) | 71 / 168 |
| family only (patient / agenda / finance / activity), centroid | 124 / 168 |
| **right intent among the 8 closest centroids** | **163 / 168** |

Short French questions about one patient embed very close together (margins of 0.01–0.03). Routing on that would have added
confident wrong reads. BGE-M3 (stronger) is not installed on the PC. **Decision:** e5 is used as a **shortlist** (8 intents,
97 % recall), and **one constrained call** to the local model chooses among them or answers "none" (`semantic-intent.ts`,
task `intent_choice`, JSON schema enum, 24 tokens). The closed question is then written by the frames' own renderers
(`intent-render.ts`) and runs deterministically. This replaces the 2–5-call tool loop for reads only when no frame understood
the turn, never for a change request or a book question. It is **off unless `ALEXA_MEANING=1`** until C270 measures it; its
accuracy with the 1B model is measured once the campaigns no longer occupy the CPU (calibration test, on request).

## 4. Lexical book gate: migrations 215–221 (approved: additive)
`app.search_knowledge_lexical_ranked` matches ANY word of the question and ranks chunks by the share of the question's weight
they hold (each word weighs ln(1 + N/df)). Built in steps, each applied on the evaluation database only and kept as history:
| Migration | Change | Why |
|---|---|---|
| 215 | the gate (any word, equal weights) | the AND gate of 123 returns nothing when one word is missing |
| 216 | words weighted by rarity | filler words won with equal weights |
| 217 | one index pass, 200 best | 0.88 s → 0.51 s |
| 218 | **approval filters before any count or limit; counts over approved rows only; words kept in question order; role-membership guard** | adversarial review: 217 could return nothing when superseded chunks filled its 200 places, and its counts revealed whether a word occurs in non-approved content |
| 219 | per-word index lookup with the filters | 218 took 68 s on "kleptomanie criteres" |
| 220 | rank only the 300 best approved chunks | 219 took 7.4 s on common words |
| 221 | words with a digit kept whole (5-HT2A, CYP2D6) | second review: they were split and never found |
Final timings on the doctor's class of PC (i3 4th gen, 8 GB, a campaign running on the same CPU): under 10 ms to 0.69 s; the
AND gate of 123 takes 0.17–0.22 s on common words. Security as 123: SECURITY DEFINER owned by the NOLOGIN reader role,
restrictive policy on the function's own tsquery (restored on exit), cabinet policies, EXECUTE for `authenticated` only (`anon`
refused, checked), no injection path (each word through `quote_literal`, probed). The headers of 215 and 217 overstate their
security and output; 218 says so. Not yet called by the application. Second review: security OK; at a coverage tie on the 300th place the cut is by id; at most 12 words. **The doctor's PC needs 215 to 221 in order.**

## 5. Novelty threshold of C270, corrected
The plan set e5 cosine 0.92 as "same question". It flagged 186 of 330 new turns; reading the pairs, most were the same record
section in other words or for another period. 0.97 was kept; every pair from 0.97 up (25) was reworded; none remains.

## 6. C270 baseline on the unchanged code (`71bb162`, label `base`, 2026-11-11)
**105 PASS / 163 FAIL / 1 BLOCKED / 1 not verified, of 270 turns** (cases: 84 of 233). Run alone on the i3 PC, 2 h 42 min in total.

| Category | PASS / turns |
|---|---:|
| Patients | 23 / 55 |
| Identité et contexte | 19 / 45 |
| Agenda | 12 / 40 |
| Finance et activité | 14 / 35 |
| Livres | 28 / 80 |
| Variation de formulation | 9 / 15 |

- **The 1B model path is the main cause.** 128 turns reached the local model (median 74 s per turn); 19 of them pass, 8 of 87
  outside books. Turns that never reach it take a median 0.9 s. This is what the meaning layer (§3) replaces for reads.
- **Patient identity**: 41 turns read no patient or the wrong one. One turn answered about another patient (X003#2: after a
  named other patient, a follow-up went back to the screen patient).
- **Books**: 28/79 questions answered by the right passage; 204 passages shown, 203 word for word, 203/203 pages right. The
  failures are retrieval (no passage 26, wrong passage 26) and 9 book questions sent to the model instead of the books.
- **Naturalness** (notes, not in the verdict): question echoed 63, generic no-answer 37, raw template 27, internal token 7.
- Latency: median 2.9 s, p95 138 s, worst 246 s.
- Reporter fix found while reading this run: the count of model turns looked for a call the code never makes and printed 0; it
  now reads the trace's model stage (`report-c270.mjs`). No case or verdict changed.

## 7. Book questions that never reached the books (from the baseline traces)
Of the 52 failing book turns, 28 showed no passage at all: Alexa did not recognise them as book questions and sent them to the
1B model (14–98 s), which found nothing or, 5 times, wrote its own text. Two causes, both in `request-contract.ts`:
- **Closed word lists.** The rules know about 40 drugs and a few dozen disorders; lemborexant, pitolisant, valbénazine, pica,
  mérycisme, énurésie were unknown. A vocabulary is now **generated from the approved books' own headings**
  (`scripts/gen-book-topics.mjs` → `book-topics.generated.ts`): 149 drug monographs of the prescriber's guide and 228 head terms
  of the DSM's index, minus 70 everyday, record or scaffolding words, listed with their reason in the generator. It is used only
  to send a question to the books; the drug list that guards the egress boundary and the unknown-word patient lookup are untouched.
- **"est-il / a-t-il" always read as a person.** "Comment le trouble cauchemars est-il défini ?" was a patient question. The
  words before an inverted verb now decide: a clinical topic or a book topic with no person word is the subject.
Also: "c'est quoi" / "pour quoi" count as questions; "Critères de…" / "Définition de…" requests too; an interrogative is never a
name. Result on the 28 baseline turns: 21 now routed to the books (4 before); the 7 left are clinical vignettes ("si un patient
sous…") or a word no heading holds (thiamine). Record questions stay off the books (tests: `alexa-book-topics.test.ts`; all
4,599 Alexa unit tests pass, the one failure is the pre-existing V8 manifest hash).

## 8. Closed choice with the 1B model: calibrated, NOT enabled
On the catalogue's 168 development paraphrases (`MINDCARE_SEMANTIC_CALIBRATION=1`), 14 s per choice on the i3:
| Run | Shortlist holds the intent | Right | Wrong | "none" | Non-record questions misread (of 6) |
|---|---:|---:|---:|---:|---:|
| e5 shortlist + model choice | 168 | 94 | 45 | 29 | 4 |
A wrong closed read answers confidently about the wrong thing; 27 % is not acceptable, so `ALEXA_MEANING` stays off.
30 of the 45 wrong choices crossed families (a patient question read as agenda or the reverse). The words decide that family
without any model: `readFamily` (one person named or referred to → patient reads; a day, a period or "les patients" → practice;
otherwise open) now narrows the shortlist. On the catalogue it files 152 examples, all in their own family, and leaves 16 open.
