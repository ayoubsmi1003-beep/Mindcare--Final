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
| The question is echoed and model tokens leak (`email:missing`, `samir_belkacem`) | `agent-loop.ts` unresolved parts | visible in many failed answers |
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

## 8. Closed choice with the 1B model: three measured rounds
On the catalogue's 168 development paraphrases (`MINDCARE_SEMANTIC_CALIBRATION=1`), local model on the i3:
| Rule | Right | Wrong | "none" | Non-record questions misread (of 6) | s / choice |
|---|---:|---:|---:|---:|---:|
| model picks any of e5's 8 closest | 94 | 45 | 29 | 4 | 14 |
| + `readFamily`: only the family the words name | 85 | 30 | 53 | 1 | 7 |
| + **the model must agree with e5's closest**; book questions refused by the layer itself | **78** | **1** | 89 | **0** | 7 |
- 30 of the first round's 45 errors crossed families; `readFamily` (one person named or referred to → patient reads; a day, a
  period or "les patients" → practice; otherwise open) decides that from the words. On the catalogue it files 152 examples, all
  in their own family, and leaves 16 open.
- Agreement of two independent judges is what removed the rest: alone, each is wrong far too often.
- The last row is derived from the second-to-last run's logged choices plus the knowledge check, which can only turn an answer
  into "none" (2 right answers became "none", the misread negative too); the agreement run itself gave 80 / 1 / 87 / 1.
- **Optimistic by construction:** e5's centroids are built from these same paraphrases. The real measure is C270, which the
  catalogue never saw. The layer stays behind `ALEXA_MEANING=1` until C270 has measured it.

## 9. C270 `p2`: book routing + reading by meaning (`ALEXA_MEANING=1`, `cd741a0`, 2026-11-11)
Same frozen 270 turns, same eval DB, run alone on the i3.
| | base | p2 |
|---|---:|---:|
| Turns passed | 105 | **118** |
| Patients / contexte / agenda / finance / livres / variation | 23 / 19 / 12 / 14 / 28 / 9 | 25 / 21 / 12 / 16 / 35 / 9 |
| Turns that reached the 1B planner | 128 | 106 |
| Latency median / p95 | 2.9 s / 138 s | 2.0 s / 141 s |
| Wrong or missing patient | 41 | 36 |
| Routing / tools failing | 15 | 8 |
| Book questions answered by the right passage | 28 / 79 | 35 / 79 |
| Passages shown, word for word | 203 / 204 | 245 / 246 |
| Echoed question / internal token in the answer | 63 / 7 | 0 / 0 |
- **14 turns gained, 1 lost.** Books gave 7 (routing, §7); the meaning layer 7 (an age, allergies, "on le revoit quand",
  "plus court", "il s'agit de quel patient", two outstanding-balance wordings).
- **The meaning layer executed 13 reads.** 7 passed. One was the wrong intent and cost a turn that passed before: "combien
  a-t-il réglé" read as the patient's consultation count. No catalogue intent covers one patient's payments, so a patient read
  is now refused when the question carries a money word (`PATIENT_MONEY`, unit test). One more was a near miss ("ma matinée
  est chargée" → free slots, not a count; it failed in `base` too). The other 4 chose the right intent and failed on the patient
  (context, Phase 3). 12 more turns were shortlisted but needed a patient or a period nobody gave, and went on as before.
- **A book question reached the layer**: a criteria request with no question word ("<trouble> critères diagnostic") was
  shortlisted as the patient's diagnoses; with a patient on screen it would have read the record. "critères"/"définition" with a
  book topic now count as a book question anywhere in the sentence, not only as the first word.
- Remaining failures are mostly the patient (36), facts the deterministic readers do not give yet (99), and book retrieval (30
  "no relevant passage", 30 "passage does not answer"): Phases 3 and 5.

## 10. Phase 3: who the question is about (`d6529e7`), and which period (`6829422`)
Read from the 36 `p2` turns with a wrong or missing patient. Nearly all touched **no** patient: the name was not found, so
the turn fell to the 1B model. Rule 2 classification (now in `report-c270.mjs`): every judged failure in `p2` is Alexa's; the
only unjudged turns are test-data limitations (1 BLOCKED, 1 not verified).
| Capability that failed | Cause | Fix (shared code, not per question) |
|---|---|---|
| Entity extraction | A name was recognised only as "words no list knows"; any ordinary verb beside it ("a consulté", "les passages") made two groups, and the parser gave up | Beside one full name, a lone lower-case word or the sentence's capitalised first word is vocabulary |
| Entity resolution | A word glued to the name ("<nom> juste avant") made the patient search find nobody, then offer sound-alikes | The resolver drops one edge word of a 3+ word name, kept only when the rest names one patient exactly |
| Understanding | Reading by meaning took "j'avais mis", "le fasse entrer" for names and asked "Quel patient ?" with the patient on screen | Same rule as the word frames: a name the patient search cannot find is vocabulary |
| Safety | "Quel âge a <nom> ?" reached the general model, which **invented an age** | A person's own attribute (age, address, weight, allergies…) asked about someone is never admitted to the general model; age is a profile read |
| Understanding | "la prochaine fois qu'il vient", "son prochain passage" were not the next appointment | Any word of a visit with "prochain" names it |
| Period | Only explicit dates and named months had bounds: "hier", "la semaine passée", "l'an dernier", "en 2025", "depuis janvier", "depuis le début du mois" asked for dates, or read **all of history** | `civil-period.ts`, one reader for French civil periods, used by consultations, documents and finance after the explicit parsers |
| Period | "la dernière séance" counted as a period and triggered "précisez les dates" | A rank among visits is not a period |
| Entity extraction | "avant-hier" was taken for a patient's name and removed before the period was read | Calendar words are never names |
| Period | "patients vus la semaine dernière" was answered **for the current month** | An activity question over a period its frame cannot write is no longer defaulted to the month |
Tests: `alexa-patient-names.test.ts` (21), `alexa-civil-period.test.ts` (25), development wordings only.

**C270 `p3` (`6829422`): 127/270 turns** (patients 28/55, context 24/45, agenda 13/40, finance 17/35, books 35/80, variation
10/15). Gains over `p2`: P029, P048, X001 (2 turns), X016#3, A030, V010, P055, F011; no turn lost. Still wrong: X003, where a
three-word lower-case name was not found and the following pronoun then read the patient on screen (2 turns), and P042, where an
exact full name was offered among sound-alikes. Rule 2: every judged failure is Alexa's; 1 turn is a test-data limitation.

## 11. A patient's visit count over a period
In `p3`, "<nom> a consulté combien de fois l'an passé ?" and "Depuis janvier, combien de séances ?" were answered with the
count of the **whole record**: the patient frame recognised a count and dropped the period. "Son traitement de l'an passé" lost
its period the same way. This is a silent wrong answer, the worst kind.
| Capability | Cause | Fix |
|---|---|---|
| Argument construction | The patient frame's canonical sentences have no period slot | A count carries the period as explicit dates ("du 01/01/2025 au 31/12/2025"), read by the same readers as the consultation admission (`namedFrenchPeriod`) |
| Argument construction | Any other section, or a period no reader can bound ("septembre et octobre", "ce semestre"), would silently cover all dates | The frame is refused; the turn keeps its previous route, which asks for dates |
| Answer | "Ce dossier contient 12 consultations" does not say over which period | The count sentence names the period first ("Du 01/01/2025 au 31/12/2025, ce dossier contient…") |
| Entity scope | A day or week word made every patient question "the practice" | Kept for questions with no pronoun or name; with "il", "lui" or a name, the period applies to that patient |
Words that only look like a period are not one: "antidépresseur" (no word boundary before), "depuis combien d'années" (a
duration), "la dernière séance" (a rank). Tests: `alexa-patient-count-period.test.ts` (13), development wordings only.

## 12. Books: a French drug name reaches the English drug guide
`tests/integration/alexa-book-aspects.live.test.ts` asks, in varied French, about one aspect (mechanism, indications, elderly,
dependence, delay of action) of 20 drugs, and checks structurally that the passage shown comes from that drug's own monograph
section. Only pairs whose section exists are judged: 53 of the 100 pairs have no such rubric in the corpus (for example
"Habit Forming" exists for few monographs). That is a data limitation, not a retrieval failure.
| Capability | Cause | Fix |
|---|---|---|
| Retrieval (query construction) | The rubric query kept the French drug name ("how the drug works gabapentine"), absent from the English book, so other drugs' rubrics filled the places | A content word that is a monograph name, or one once its French final "e" is dropped ("disulfirame", "prégabaline"), is written as the monograph's name and kept as an invariant |
Measured on the evaluation database (read-only): **29 → 32 / 47 at rank 1, 36 → 37 / 47 in the top 5**; 3 pairs fixed, none
lost. Remaining misses are mostly wrong-book choices (a Maudsley chapter or a DSM section ranked first) and a neighbouring
rubric of the right drug ("Children and Adolescents" for "Commonly Prescribed for").

## 13. The named patient survives the rewrite (X003, P042 in `p3`)
| Capability | Cause | Fix |
|---|---|---|
| Entity extraction | The closed question for a named profile or age, "Affiche le profil de <nom>.", is a form the name parser does not read: the name was lost, the read fell back on the open record and was refused ("Je ne suis pas sûre que cette question vise le dossier ouvert") | "Affiche le profil du patient <nom>.", the form the selected-patient version already used; same fix in the phone follow-up rewrite |
| Entity resolution | "<nom> cumule combien…": the glued verb made the search return a list of close names; the edge-word retry ran only when the search found nobody | Also on a list, unless one of the listed people carries every written word (a real choice between people of that name) |
A guard test now renders every patient section with lower-case, capitalised and three-word names and checks that the parser
reads back the same name and that the question is admitted to one tool. It would have caught the profile form.

## 14. C270 `p4` (`49145f9`, 2026-11-12), and its two lost turns
**133/270 turns** (patients 31/55, context 27/45, agenda 13/40, finance 17/35, books 35/80, variation 10/15); against `p3`:
8 gained (P019, P020, X002#1: period count; X003#1 and #2: named patient; P042: glued verb; X004#2; L050: disulfirame), 2 lost.
Book passages: 240/241 word for word. Rule 2: every judged failure is Alexa's; 1 test-data limitation.
| Lost turn | Capability | Cause | Fix |
|---|---|---|---|
| L043 (sodium under a drug) | Retrieval (query construction) | §12 also made every monograph name an *invariant*, which adds a "rubric + drug" query without the other words; "sodium" was dropped and the drug's unrelated rubrics (Pregnancy) came first. The turn had passed in `base`, `p2` and `p3` | Invariants back to the closed drug list; the monograph spelling of §12 stays |
| X003#3 ("Revenons à mon patient : sa dernière note ?") | Context (which patient) | Now that the named patient is kept (§13), a possessive reused it; nothing read "mon patient", "le dossier ouvert", "revenons à…" as the record on screen | `namesTheOpenRecord` (`conversation-frame.ts`): when a record is open, those words read it, never the patient discussed last; without an open record nothing changes |
Prazosine dependence (fixed by the invariant in §12) was lost by its revert: the French linking verb ("entraîne-t-elle",
"provoque-t-elle") stayed in every rubric query. Those verbs are now question words; "accoutumance" joins the dependence
concept. Drug × rubric check: **33 / 47 at rank 1, 38 / 47 in the top 5** (§12: 32 and 37), no new miss. Replayed on C270:
X003 (3 turns) and L043 pass. Unit tests fail without each fix.


## 15. Agenda: absences, cancellations counted, and periods named by month or day; visits ranked before the last
| Capability | Cause | Fix |
|---|---|---|
| Understanding (agenda status) | The agenda frame had no concept for a patient who did not come ("qui n'est pas venu", "absences non excusées", "lapins", "ne se sont pas présentés"), though the gate filters the « non honoré » status | An absence concept renders "Quels sont / Combien de rendez-vous non honorés <période> ?"; a counted cancellation renders "Combien de rendez-vous annulés…"; "il", "elle" or a name still leave it to the patient routes |
| Period reading (agenda) | The frame's own period list knew no month ("en septembre", "sur l'ensemble du mois d'octobre") nor "depuis le début du mois" | When that list finds nothing, the shared civil reader of the patient and finance frames (`namedFrenchPeriod`) reads it, written as an explicit day or range; the meaning layer uses the same reader. A month without its year more than six months back is not guessed |
| Understanding (agenda) | "qui était au programme", "quelque chose de prévu" were not agenda wording | Added to the overview and "who is expected" concepts |
| Understanding (patient) | "l'avant-dernière séance", "juste avant sa dernière visite", "la troisième en remontant" were read as the last visit; "depuis la plus récente" as an unreadable period | A rank before the last visit reads the latest-visits list (dates of the five latest); "depuis la plus récente" is where the counting starts |
| Understanding (patient) | "Depuis combien d'années est-il suivi ?" was a visit count | How long a patient has been followed is the date of the first visit; a treatment question keeps the treatment route |
Replayed on C270 (code not otherwise changed): agenda **13 → 22 / 40**, patients **31 → 33 / 55** and context **27 → 29 / 45**
(X003#3 included), P017 passes; no turn lost in these three domains. Still unread: "le week-end", "entre mardi et jeudi". Wording
gap left: the agenda answer says "rendez-vous prévus" for past absences (existing answer template).

## 16. A loss caught by the finance replay, and patients who came at least once
§15 let the agenda frame read any month; the agenda frame runs before the activity and money frames, so "Combien de
consultations en septembre ?", "patients vus en août" and "séances réglées en août" became appointment counts (F009, F016, F025
lost on a finance replay). The civil period is now read by the agenda frame only for appointments, absences or cancellations
named as such, never with a money word. Separately, "combien de patients ont consulté / sont venus au moins une fois" is an
activity question (statistics hold "patients vus"); a name or a pronoun keeps it with the patient routes. Weeks stay a tool
limitation: the statistics view reads months and years only.
Replayed on C270 against `p4`: agenda 13 → 22 / 40, finance 17 → 18 / 35, 10 gained, none lost.

## 17. C270 `p5` (`713d045`, 2026-11-12)
**149/270 turns** (patients 34/55, context 29/45, agenda 22/40, finance 18/35, books 36/80, variation 10/15); against `p4`:
16 gained, none lost (agenda 9, patients 3, context 2, finance 1, books 1: L043). Turns reaching the local model: 86 (93 in `p4`).
Book passages: 240/241 word for word. Rule 2: every judged failure is Alexa's; 1 test-data limitation. Largest remaining
group: book retrieval (40 turns), then facts missing from an answer (37), then which patient (23).

## 18. Book questions that never reached the books (16 turns in `p5`)
| Capability | Cause | Fix |
|---|---|---|
| Who it is about (name parser) | Ordinary words were read as a patient's name, and a name sends a question to the record: "pour retenir une…", "c'est quoi exactement", "une place contre l'akathisie", "chez un patient dément", "pour autant" | French function words (interrogatives, adverbs, prepositions, pronouns) are never part of a name; "pour" + infinitive + article is a purpose; "un patient …" / "une patiente …" describes, it names no record (and scopes none); one lower-case word naming a drug or disorder of the books is a topic |
| Understanding (write or read) | A write verb anywhere made the sentence a write request: "quand on arrête la valbénazine", "qu'est-ce qui change", "ne passe pas", "si un patient arrête de fumer" | In a book question, a verb with its own subject, in a "si/quand/lorsque" clause, followed by "-t-il", or asked about ("faut-il arrêter") describes; commands and any sentence about a named or possessed patient keep the write route |
| Understanding (question form) | "est-il", "sont-ils" were not seen as questions; "agent de tranquillisation rapide" ended like a full name | Any verb–pronoun inversion is a question; words ending in -tion/-sion are not a name |
Unit tests: `alexa-book-routing-grammar.test.ts` (development wordings, real names and commands kept). Replayed on C270 (16 book
cases, patients, context, variation: 131 turns): 4 gained (L007, L014, L059, V004), none lost, no patient changed. Seven more
book turns now reach the right drug's monograph and fail on the rubric (retrieval). L027 (a case description), L060 (thiamine:
Maudsley's vocabulary is not in the generated topic list) and L079 (a generic "médicament … arrêter") are still not routed.

## 19. A disorder asked for what makes it reaches its own diagnostic criteria
| Capability | Cause | Fix |
|---|---|---|
| Retrieval (DSM rubric) | The criteria were preferred only for a few words ("critères", "durée", "définition"); "à partir de quand", "quelle fenêtre de temps", "est-il défini", "comment se présente", "quelles formes" fell to short neighbouring chunks of the same disorder (prevalence, course, "Biochimie") | A question naming a disorder of the manual's own index (generated `BOOK_DISORDER_TERMS`, every word present in any order, several terms added up) and asking what makes it (definition, presentation, threshold of time or frequency, forms, onset) — no other rubric, treatment or drug — adds "<term> critères diagnostiques" and prefers the criteria leaf |
| Retrieval (which disorder) | Another disorder's criteria that merely mention the one asked (bipolar II's exclusion of schizophreniform, binge-eating's of bulimia) won the criteria tie-break | The criteria leaf leads only under the heading that owns it (the words before the first "—", or the section just above the leaf), never the chapter |
Structural check `alexa-book-dsm-criteria.live.test.ts` (20 disorders no C270 case uses, 40 development wordings; the right
chunk known from the manual's own headings): **rank 1: 4 → 36 / 40, top 5: 14 → 37 / 40**. Drug × rubric check unchanged
(33 / 47, 38 / 47). C270 books replayed: **36 → 49 / 80** against `p5` (DSM criteria 10, routing of §18 3), none lost.
Still missed: "phobie spécifique" (the generated index holds "phobie speciique": a ligature lost by the generator, data);
"anxiété de séparation" (its criteria chunk scores under the relevance floor).

## 20. A named patient's next appointment, asked as coming or holding one
"<nom> a-t-il un rendez-vous de prévu ?" and "<nom> vient quand ?" were neither read as the next appointment (the concept knew
"prochain", "revient", "reconvoqué") nor kept their patient: the name parser took "prévu" for a name. Coming ("vient / passera
… quand") or holding an appointment ("a-t-il un rendez-vous", "de prévu", "à venir", "planifié") in the present is now the next
appointment, never with a word of the last, a previous or the first visit; appointment states ("prévu", "programmé",
"planifié") join the parser's status words. Practice-wide questions ("Qui a un rendez-vous demain ?") keep the agenda route.
Replayed on C270 (patients, context, agenda: 140 turns): 2 gained (P046, X008#3), none lost.
