# 10 — Known limitations

As of 2026-11-07, on branch `claude/alexa-intelligence-transformation-9fc1d1`, nothing pushed. Each limitation was measured or reproduced unless it says otherwise.

## Model and hardware

- **The local model is MiniCPM 1B.**
  - Conversation quality comparable to large cloud models isn't reachable with it.
  - French answers written from English books aren't produced. Alexa lists the closest passages instead (see "References" below).
- **Model calls are slow on this PC:** 12.8 s median for a planner call, measured over 247 calls. Valid planner output peaked at 309 tokens.
- **The model sometimes writes until it hits its limit** (`LocalModelTruncated`). This happened in 25 of 300 campaign turns, taking 45 to 102 s each. The limit is now 360 tokens, so these turns fail sooner. They still fail.
- **Routing guesses meaning from wording.** About 1 turn in 5 still reaches the model planner. A model-based understanding step wasn't built, for three reasons:
  - each extra call costs about 13 s;
  - 244 of 300 campaign cases never need the model;
  - a 1B model's output would still have to be checked by the same rules.

  `TurnUnderstanding` (`src/shared/alexa/turn-understanding.ts`) records what each turn asks, without a model.

## Who the question is about

- A question about a relative or another patient is now closed before any read, even with a patient selected. This covers `sa mère`, `son père`, `la mère de X`, `l'autre patient` and similar.
  - **Accepted cost:** a question about the selected patient's own family history must be asked as "antécédents familiaux de ce patient".
  - **Also closed:** "Que disent ses notes sur sa mère ?"
- A lowercase name is recognized only in the forms the name parser knows.
  - A full name after allergies, bilan, adverse effects, history, adherence or measurements now names that patient instead of the selected one.
  - **The critical bug found by the review predates this work:** with a patient selected, "Allergies de Karim Benali" read the selected patient. It's now fixed and tested, but it shows the parser is a list of known forms, not an understanding.
- **Speech-to-text:** whether Whisper writes `œ` or `oe` wasn't checked. Both are now handled.

## Checking names before reading the selected patient

Before a read falls back to the selected patient, every unknown Latin word, and each pair of adjacent words, is looked up in the audited patient search. A match with another patient leads to a question, and nothing is read.
- **Matching:** names are compared with spaces, hyphens and apostrophes ignored, and a spelling key tolerates misheard names.
- **The selected patient's own full name**, said exactly, is no reason to refuse.
- **Arabic words:** never looked up, since patient names are stored only in Latin script.
- **Risk vocabulary** (mourir, suicide and similar): never looked up, so a risk question is never refused because a patient bears a similar name.

Remaining, after ten review rounds:
- **Compound twins:** "Ben Ali" and "Benali" count as the same name. If the selected Salim Ben Ali has a homonym Salim Benali, the homonym isn't asked about. The same holds for an exact homonym of the selected patient.
- **Threshold:** a misheard name relies on the search's trigram threshold. Three real cases blocked as they should, but a very short or very distorted first name may still find nothing.
- **Actions** aren't name-checked: a proposal shows the patient's name and waits for a person.
- **Audit log:** a read with name-like words writes 1 to 5 extra searches to it. An ordinary read writes none.
- **Real model:** no model-driven turns were run against these checks; they guard whatever tool the model calls.

## Several requests in one message

- Requests joined by "puis", "ensuite" or a new sentence run as separate turns, each answered or reported as not done. There are at most three per message; the rest are named as not done.
- No split happens when:
  - a condition or filter word appears (`si`, `sauf`, `sans`, `uniquement`, `seulement`);
  - a date in the first request may or may not apply to the others;
  - a request opens a screen, or prepares a change.
- In those cases the old route runs, and any request it leaves unanswered is named, never dropped silently.
- **Two named outputs sent to the model still fail slowly.** "Quels traitements à revoir et les rendez-vous de demain ?" took 141 s and reported both parts as without a reliable answer.
- With requested outputs, the model sometimes attaches two goals to one read. The second goal is now reported as not established.
  - **Not fixed:** "Combien de patients ai-je et quel est le prix du lithium ?" still lists 20 patient names that weren't asked for.

## Change requests

- **Unsupported changes are refused at once, with no read:** marking messages read, deleting or archiving messages, deleting a record.
- **A change answered by a read now says "Je n'ai rien modifié".**
- **Recognition is a word list.** An unusual phrasing of a change may still get only a read without that sentence.
- **Marking a patient absent** isn't implemented. It needs your approval: see `12-no-show-write-proposal.md`.

## Practice reads (statistics, workload, timeline, case summary)

- Only exact sentences reach them. For example, "Statistiques du mois dernier" and "chronologie des prescriptions" don't.
- **Workload:**
  - It covers the whole practice even with a patient selected.
  - It reads 100 rows, shows 20, and says so.
- **Different counts:** statistics include archived records, and the workload doesn't.
- **Assistant and patient roles:** for the timeline and case summary, Alexa answers "aucun … visible avec votre accès". The database returns no rows rather than an error, so Alexa can't tell "not allowed" from "nothing recorded".
- **Last security review of these reads:** see `09-final-evaluation-report.md`.

## Installed databases

- **Workload screen on the evaluation database:** the database records migration 211 as applied but still has the three-argument `list_medication_workload`, so the Treatments screen's workload call fails there.
  - Alexa's call works with both versions.
  - The doctor's PC has migration 211 too, so it may have either version. Run `scripts/alexa-installed-schema-check.sql` to know.
- **Migration 214 is absent on the doctor's PC.** No current code or migration depends on it. Documents created during development and flagged `is_synthetic` stay visible in the Documents tab, which is the intended outcome.

## References (book answers)

- **Alexa lists the closest whole passages,** with section and page. It doesn't write an answer or claim the passage answers the question. English passages stay in English.
- **Retrieval misses some management topics:** serotonin syndrome, antidepressant discontinuation, acute agitation and neuroleptic malignant syndrome (practitioner worksheet G14, G15, G19, G39).
- **Some chunks seem to carry the wrong heading** (worksheet G29, G36). Fixing that needs re-ingestion, which is out of scope without approval.
- **Stahl page numbers are positions in the source file,** which may differ from printed pages.
- **A question with no answer in the books still gets the closest passages,** labelled as such.
- **Other known issues:**
  - The reranker takes 5 passages before filtering.
  - Voice stops at 32 sentences or 2,000 characters per sentence.
  - The question is capped at 300 characters.

## Voice

- **Answers that may not be read aloud are no longer silent.** A fixed notice says the answer is on screen. These are partial answers, refusals and answers carrying an identity.
- **The notice is only unit-tested.** It hasn't been heard on the cabinet's audio setup.

## Evaluation

- **Expected results:**
  - No clinician has approved any expected clinical answer.
  - The campaign's private oracles were written by earlier sessions.
- **The old pass rule:** comparing with the baseline needs it, which the reports call `passingUnderOriginalRule`.
- **Actions** are NOT VERIFIED in the main campaign, because executing writes needs a separate database.
- **Safety tables are empty** on the evaluation database: allergies, adverse events, adherence and measurements have 0 rows. Those reads are tested with fixtures, not with real-shaped data.
- **This PC is slower than the cabinet's target PC,** so measured latency is pessimistic.
