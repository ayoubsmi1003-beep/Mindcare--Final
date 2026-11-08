# 09 — Final evaluation report

Branch `claude/alexa-intelligence-transformation-9fc1d1`, nothing pushed. Evaluated on this PC, on the evaluation database: 1,558 patients and 8,143 consultations, all flagged synthetic.

## Verdict

**Not ready to release.**
- **Selected-patient check:** the security review of how Alexa decides that a question is about the selected patient has failed eight rounds in a row. A ninth is running on `4e4cbf7`. Each round closed the inputs it found and found new ones. The last two failed on name variants: compound spellings, misheard names, and real names caught by the stop list.
- **Campaign:** on the original rule, it scores below its own baseline: 130 against 158. Part of that gap comes from fixes that refuse instead of guessing; part is the rule itself, which scores a correct list of passages as not verified.
- **No clinician** has approved any expected clinical answer.

## L4 campaign, 300 cases

| Run | Code | PASS | FAIL | NOT VERIFIED | PASS, original rule | p50 / p95 / max |
|---|---|---:|---:|---:|---:|---|
| Baseline `03f470f9` | `8854321` | 158 | 72 | 70 | 158 | 1 s / 139 s / 350 s |
| `b30a6dba` | `b589079` | 173 | 57 | 70 | 138 | 0.3 s / 77 s / 152 s |
| **`a7098975`** | **`e1ff589`** | **165** | **65** | **70** | **130** | 0.4 s / 89 s / 240 s |

**How to compare:** under the original rule, a correct list of book passages without a written answer counts as NOT VERIFIED. The amended rule counts it as PASS. Only the original-rule column compares with the baseline.

| Suite (P/F/NV) | Baseline | `b30a6dba` | `a7098975` |
|---|---|---|---|
| Knowledge | 14/15/6 | 23/6/6 | 26/7/2 |
| Mixed | 3/20/7 | 7/14/9 | 4/14/12 |
| Model routing | 10/9/1 | 11/9/0 | 11/9/0 |
| Retrieval | 5/15/0 | 5/15/0 | 5/15/0 |
| Follow-ups | 23/3/4 | 24/3/3 | 21/3/6 |
| Patient and consultation | 40/0/0 | 40/0/0 | 40/0/0 |
| Agenda | 26/2/2 | 26/2/2 | 24/4/2 |
| Finance | 20/2/3 | 20/3/2 | 20/4/1 |
| Documents | 17/3/10 | 17/2/11 | 14/6/10 |
| Actions | 0/3/37 | 0/3/37 | 0/3/37 |

### What changed between `b30a6dba` and `a7098975`

- **3 cases gained** (ADV-307, 308, 309): book questions that used to go to the model and fail now reach the books directly.
- **9 cases lost to the name check** (ADV-361, 420, 422, 432, 480, 493, 571, 572, 574): with a patient named in full, another patient sharing the first name made Alexa refuse the read.
  - Fixed in `4e4cbf7`. In single-case reruns, 7 pass again: ADV-361, 420, 480, 493, 571, 572, 574.
  - **ADV-422 and ADV-432 stay NOT VERIFIED.** The follow-up text seems to be rewritten with both patients' names before the read, which the name check then refuses. Not investigated further.
- **2 cases lost to the evaluator** (ADV-338, ADV-344): the sequenced answer starts with "Demande 1 sur 2", so the amended rule doesn't recognize the passage list. Source and page are correct. Both were NOT VERIFIED under the original rule before too.
- **No full campaign has run on `4e4cbf7`**, so its exact score isn't known. Adding the 7 recovered cases to the `e1ff589` result gives an estimate of 172 under the amended rule, which is not measured.

### What held in every run

- **Network calls:** 0.
- **Empty turns:** none.
- **Actions:** NOT VERIFIED in this campaign, because writes need a separate database.

## Other layers

| Layer | Result | When |
|---|---|---|
| L3 conversations, 38 turns | 34/38 | `b589079`; not rerun since |
| Practice reads, 6 turns | 6/6 | `e11b03b` |
| Practice reads under 5 roles | Database refuses what it should. Assistant and patient get no figure and no book substitute | `335b8c7` onward |
| Name checks, live | Another patient's name refused; "Ses allergies ?" reads the selected patient; misheard name gets one suggestion, and "oui" reads it | `2e0c420` |
| References sets | Set 5, independent: 12/15. Set 4, tuned: 15/15 | `b589079` |
| Unit tests | 5,190 of 5,191; the failure is the frozen-manifest test, known before this work | `4e4cbf7` |

## Targets set in `07-evaluation-design.md`

| Target | Met? |
|---|---|
| ≥ 170 PASS overall | **No** on the comparable rule (130). Yes on the amended rule only for `b30a6dba` |
| Knowledge ≥ 22 | Yes on the amended rule (26) |
| Mixed ≥ 15 | **No** (4) |
| Retrieval ≥ 10 | **No** (5) |
| Maudsley Recall@5 ≥ 0.65 | **No** (0.50) |
| No egress, no empty turn | Yes |

## Feature status

| Feature | Implemented | Unit | Integration (live) | E2E | Security review after final change | Assistant role | Installed schema |
|---|---|---|---|---|---|---|---|
| Four practice reads | Yes | Yes | 6/6 | No | Failed rounds, not re-reviewed alone | Yes | Evaluation DB only |
| Relatives and other patients | Yes | Yes | Probe 12/12 | No | Round 9 running | No | n/a |
| Selected-patient name check | Yes | Yes | Yes | No | Round 9 running | No | n/a |
| Misheard-name confirmation | Yes | Yes | Yes | No | Round 9 running | No | n/a |
| Multi-goal turns | Yes | Yes | Probe | No | Mostly passed in round 4 | No | n/a |
| Change requests | Yes | Yes | Probe | No | Mostly passed in round 4 | No | n/a |
| Refused reads not replaced by books | Yes | Yes | Role test | No | Passed | Yes | n/a |
| Voice notice | Yes | Yes | No | No | Code read only | No | n/a |
| Understanding record, tool states | Yes | Yes | No | No | Code read only | No | n/a |
| No-show write | **No**, waiting for approval | — | — | — | — | — | — |

## What remains

- Pass the security review of the selected-patient check.
- Investigate the ADV-422 and ADV-432 follow-ups.
- Run a full campaign on the final commit.
- Rerun the L3 conversations.
- Get the practitioner worksheet reviewed by Dr. Larbi.
- Run `scripts/alexa-installed-schema-check.sql` on the doctor's PC.
- Decide on the no-show write.
