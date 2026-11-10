# 09 — Final evaluation report 26/7/2 | 5/14/11 | 11/9/0 | 5/15/0 | 22/3/5 | 40/0/0 | 26/2/2 | 20/3/2 | 17/2/11 | 0/3/37 |

Branch `claude/alexa-intelligence-transformation-9fc1d1`, nothing pushed. Evaluated on this PC, on the evaluation database: 1,558 patients and 8,143 consultations, all flagged synthetic.

## Verdict

**Not ready to release yet.**
- **Selected-patient check:** the security review of how Alexa decides that a question is about the selected patient failed nine rounds. Round 10, on `e4dccbe`, found no high-severity path and judged it releasable with reservations.
  - The two cases the reviewer asked to check on the real database both block, 3 out of 3 each: a compound surname written joined ("benali" for "Ben Ali"), and a misheard first name alone.
  - The remaining low risks are listed in `10-known-limitations.md`.
- **Campaign, final run on `f644b0e`:** 172 PASS on the amended rule; on the original rule, 136 against a baseline of 158. Part of that gap comes from fixes that refuse instead of guessing; part is the rule itself, which scores a correct list of passages as not verified.
- **No clinician** has approved any expected clinical answer.

## L4 campaign, 300 cases

| Run | Code | PASS | FAIL | NOT VERIFIED | PASS, original rule | p50 / p95 / max |
|---|---|---:|---:|---:|---:|---|
| Baseline `03f470f9` | `8854321` | 158 | 72 | 70 | 158 | 1 s / 139 s / 350 s |
| `b30a6dba` | `b589079` | 173 | 57 | 70 | 138 | 0.3 s / 77 s / 152 s |
| `a7098975` | `e1ff589` | 165 | 65 | 70 | 130 | 0.4 s / 89 s / 240 s |
| **`4ea3ecd2`** | **`f644b0e`**, final | **172** | **58** | **70** | **136** | 0.3 s / 66 s / 160 s |

**How to compare:** under the original rule, a correct list of book passages without a written answer counts as NOT VERIFIED. The amended rule counts it as PASS. Only the original-rule column compares with the baseline.

| Suite (P/F/NV) | Baseline | `b30a6dba` | `a7098975` | **Final `4ea3ecd2`** |
|---|---|---|---|---|
| Knowledge | 14/15/6 | 23/6/6 | 26/7/2 | 26/7/2 |
| Mixed | 3/20/7 | 7/14/9 | 4/14/12 | 5/14/11 |
| Model routing | 10/9/1 | 11/9/0 | 11/9/0 | 11/9/0 |
| Retrieval | 5/15/0 | 5/15/0 | 5/15/0 | 5/15/0 |
| Follow-ups | 23/3/4 | 24/3/3 | 21/3/6 | 22/3/5 |
| Patient and consultation | 40/0/0 | 40/0/0 | 40/0/0 | 40/0/0 |
| Agenda | 26/2/2 | 26/2/2 | 24/4/2 | 26/2/2 |
| Finance | 20/2/3 | 20/3/2 | 20/4/1 | 20/3/2 |
| Documents | 17/3/10 | 17/2/11 | 14/6/10 | 17/2/11 |
| Actions | 0/3/37 | 0/3/37 | 0/3/37 | 0/3/37 |

### What changed between `b30a6dba` and `a7098975`

- **3 cases gained** (ADV-307, 308, 309): book questions that used to go to the model and fail now reach the books directly.
- **9 cases lost to the name check** (ADV-361, 420, 422, 432, 480, 493, 571, 572, 574): with a patient named in full, another patient sharing the first name made Alexa refuse the read.
  - Fixed in `4e4cbf7`. In single-case reruns, 7 pass again: ADV-361, 420, 480, 493, 571, 572, 574.
  - **ADV-422 and ADV-432 stay NOT VERIFIED.** The follow-up text seems to be rewritten with both patients' names before the read, which the name check then refuses. Not investigated further.
- **2 cases lost to the evaluator** (ADV-338, ADV-344): the sequenced answer starts with "Demande 1 sur 2", so the amended rule doesn't recognize the passage list. Source and page are correct. Both were NOT VERIFIED under the original rule before too.
### Final run on `f644b0e`

- **172 PASS, 58 FAIL, 70 NOT VERIFIED; 136 under the original rule,** against a baseline of 158. No network call, no empty turn.
- **Against `e1ff589`:** the 7 cases lost to the name check pass again (ADV-361, 420, 480, 493, 571, 572, 574). ADV-515 and ADV-576 went from FAIL to NOT VERIFIED.
- **Against `b589079`, the run before this session's changes:** 3 book questions gained (ADV-307, 308, 309). ADV-338 and 344 lost to the evaluator. ADV-422 and ADV-432 lost: their follow-up text seems to be rewritten with both names before the read, which the name check refuses. ADV-323 and ADV-353 went from NOT VERIFIED to FAIL; ADV-349 from FAIL to NOT VERIFIED.

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
| ≥ 170 PASS overall | **No** on the comparable rule (136). Yes on the amended rule (172), which counts a correct passage list as PASS |
| Knowledge ≥ 22 | Yes on the amended rule (26) |
| Mixed ≥ 15 | **No** (5) |
| Retrieval ≥ 10 | **No** (5) |
| Maudsley Recall@5 ≥ 0.65 | **No** (0.50) |
| No egress, no empty turn | Yes |

## Feature status

| Feature | Implemented | Unit | Integration (live) | E2E | Security review after final change | Assistant role | Installed schema |
|---|---|---|---|---|---|---|---|
| Four practice reads | Yes | Yes | 6/6 | No | Failed rounds, not re-reviewed alone | Yes | Evaluation DB only |
| Relatives and other patients | Yes | Yes | Probe 12/12 | No | Round 10: no high finding, releasable with reservations | No | n/a |
| Selected-patient name check | Yes | Yes | Yes | No | Round 10: no high finding, releasable with reservations | No | n/a |
| Misheard-name confirmation | Yes | Yes | Yes | No | Round 10: no high finding, releasable with reservations | No | n/a |
| Multi-goal turns | Yes | Yes | Probe | No | Mostly passed in round 4 | No | n/a |
| Change requests | Yes | Yes | Probe | No | Mostly passed in round 4 | No | n/a |
| Refused reads not replaced by books | Yes | Yes | Role test | No | Passed | Yes | n/a |
| Voice notice | Yes | Yes | No | No | Code read only | No | n/a |
| Understanding record, tool states | Yes | Yes | No | No | Code read only | No | n/a |
| No-show write | **No**, waiting for approval | — | — | — | — | — | — |

## What remains

- Run real-model turns against the selected-patient name check.
- Investigate the ADV-422 and ADV-432 follow-ups.
- Run a full campaign on the final commit.
- Rerun the L3 conversations.
- Get the practitioner worksheet reviewed by Dr. Larbi.
- Run `scripts/alexa-installed-schema-check.sql` on the doctor's PC.
- Decide on the no-show write.
