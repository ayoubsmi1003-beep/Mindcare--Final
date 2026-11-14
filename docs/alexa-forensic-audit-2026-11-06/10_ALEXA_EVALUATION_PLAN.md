# Alexa evaluation plan

**Status: proposed, not executed or clinically accepted.** Existing isolated unit passes are a narrow baseline, not an overall score. Build the full golden datasets and agree thresholds before calling a release successful.

## Test environment and isolation

Create a disposable, positively identified synthetic PostgreSQL environment with a unique database name, synthetic-only fixture marker, separate credentials and no route to a clinic database. Before every fixture write and external-provider experiment, check deployment identity and isolation; fail closed if uncertain. Use invented patient names and data only in that environment. Never export real patient information, free notes, audio or identifiers to an external model or evaluation service. Capture versioned source commit, uncommitted diff fingerprint, migrations, feature flags without secrets, model/recipe hashes, hardware and test timestamp.

## Dataset design

| Suite | Coverage and oracle | Measures |
|---|---|---|
| Intent and routing | French, Arabic, Algerian Darija, mixed language, paraphrases, ambiguous requests, direct app, knowledge and multi-domain; expected permitted tool and constraints independently annotated | Correct domain/tool and argument selection; unsupported/clarification accuracy; unnecessary tool calls |
| Application correctness | Synthetic patients, visits, appointments, invoices/payments, statuses, dates around midnight in Algiers, unknown values, two practitioner roles and receptionist | Equality to separately reviewed SQL oracle; identity and cohort accuracy; date-axis and arithmetic accuracy; permission-denial handling; no invented data |
| RAG | Approved source passages and independently annotated relevant passage IDs, page/edition, unanswerable examples, FR→EN and EN→FR, negation, dose and context boundaries | Recall@K, Precision@K, MRR, nDCG, citation identity/page accuracy, supported-claim and abstention accuracy; paired comparison with/without reranker |
| Patient summary | Synthetic longitudinal records, drafts, signed notes, amendments, omissions, stale or conflicting treatments, multiple pages and revisions | Field/visit coverage, temporal attribution, recorded fact versus inference, omission disclosure, unsupported-claim rate; clinician review of meaning |
| Conversation | Multi-turn corpus with ellipsis, corrections, topic changes, cohort intersection, two patients, session changes and process restart | Follow-up resolution, retained metric/population/period, patient isolation, correct clarification, stale-context rejection |
| Voice | Consented non-patient recordings covering French, Arabic, Darija, mixed language, noise, names, interruptions and varied speaking rates | Word/clinical-entity error, endpoint and false-wake rates, interruption recovery, end-to-end percentiles and clinician usability |
| Actions and security | Synthetic authorization roles, prompt injection in records and knowledge, stale revisions, replay, cancellation and confirmation | Zero unauthorized mutation or export, correct identity binding and auditable transitions; distinguish failure from denial and no data |

`tests/eval/` already contains numerous candidate fixtures and golden sets; their provenance, independence, permissions, balance and expected answers must be reviewed before selection. Split development and held-out test sets by concept/intent and source passage, not merely by paraphrase, to reduce leakage. Do not reproduce protected book passages in public reports; keep references and human review under approved access.

An initial standalone dataset, `28_GOLDEN_SYNTHETIQUE_BROUILLON.json`, defines three wholly fictional records, three closed visits, three payments, two appointments and 15 proposed questions including multilingual and follow-up cases. The JSON shape, unique case identifiers and independently recalculated aggregate values passed a simple Python assertion. Its identifiers are symbolic, not database UUIDs; it has not been imported, executed against the app, linguistically reviewed or qualified as a held-out golden set. It does not cover approved-book evidence, real role gates, clinical summaries or voice and cannot serve as the requested complete evaluation dataset by itself.

## Metrics and experimental design

- Retrieval: for each question, rank relevant judged passages. Report Recall@1/3/5, Precision@K, MRR and nDCG per language, source and answerability, including sample counts and uncertainty intervals. A retrieved passage is not automatically a correct answer.
- Grounding: independently annotate every substantive claim as supported, contradicted, unsupported or not assessable; separately score source/page identity and omission. Explicitly examine drug names, dose, polarity, exceptions and temporal qualifiers.
- Application: evaluate both the raw structured result and final wording against a separately implemented, reviewed oracle. Count invented facts, wrong patient/role, silently ignored constraints and incorrect numeric totals as separate failures. Include nonzero and empty/unknown/denied cases.
- Conversation: score the metric, period, population, selected patient, source revision and dependency of every turn. Test after restart and after changing patient or actor; correct clarification is a positive outcome when state is insufficient.
- Latency: use target hardware, cold and warm starts, p50/p95/p99, sample sizes, stage spans (capture, STT, planner, each tool/retrieval stage, generation, validation, TTS) and time to first validated content. Cancellations and timeouts remain in the denominator.
- Clinical review: qualified practitioner reviews a blinded stratified sample, including high-risk and contradictory cases. Report disagreements and adjudication; do not substitute an LLM judge for the clinical oracle.

## Baseline currently available

PASS: 52 tests in four focused unit files and 100 tests in ten focused unit files during this audit. Several use mocked local inference, fake provider or synthetic SQL clients. Historical retrieval observations in `06_RAG_FORENSIC_AUDIT.md` are not a rerun. Baseline scores for live app accuracy, multilingual retrieval, summaries, voice and installed-device latency: **NOT RUN**.

## Proposed gates for human ratification

1. All security and data-isolation invariants are hard gates: any confirmed wrong-patient access, unauthorized write, patient-data egress or false execution claim blocks release. Run both negative and positive controls.
2. All critical deterministic calculations and scope constraints must match their reviewed oracles; no skipped required case silently counts as PASS.
3. Set quantitative retrieval, answer-faithfulness, multilingual and latency thresholds jointly with the clinician after measuring the existing baseline and calculating a sufficiently representative sample. Pre-register the threshold and disaggregated minimums before comparing candidates.
4. A representative clinician must approve clinical wording, factual fidelity and uncertainty handling. Passing synthetic tests or a model benchmark alone cannot establish clinical suitability.
5. Re-run regression suites, packaging and physical-device workflows on the exact candidate; record each result as PASS, FAIL or NOT RUN with environment and evidence.
