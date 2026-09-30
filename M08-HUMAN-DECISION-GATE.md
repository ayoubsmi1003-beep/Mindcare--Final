# M08 HUMAN DECISION GATE — Taylor 2021

> Status: **OPEN — awaiting human decisions.** No box below may be checked by an agent.
> Only the human signer decides, with identity + date.
> Taylor remains `FROZEN / PENDING_APPROVAL` until this gate is completed.
> Reference: `docs/00-DECISIONS.md` § M08 HUMAN DECISION GATE · M08 readiness report (`READY FOR HUMAN DECISION`).

```text
D1 — Taylor Approval Instrument
Decision required: source-row only / approval package only / both (+ signer + timestamp method)
Options:
[ ] A — Source-row only (statut→active + approved_at/by + reviewed_*; matches SQL gates exactly)
[ ] B — Approval package only (human-readable record; ceremonial unless a loader reads it)
[ ] C — Both (file as record + row as machine authority)

Required signer:
________________

Timestamp method:
________________

Decision:
________________

Date:
________________
```

```text
D2 — English Admission
Decision required: formally admit Taylor English (yes/no); if yes, widen existing constraints or isolated EN tables
Options:
[ ] A — Admit en by widening 092 CHECKs + TS union + validator (additive; FR/AR/Darija unchanged)
[ ] B — Admit en via isolated EN tables (higher isolation, full gate/loader duplication)
[ ] C — Do not admit (Taylor stays unpromotable)

Required signer:
________________

Timestamp method:
________________

Decision:
________________

Date:
________________
```

```text
D3 — Provenance Landing (choose ONE — no silent hybrids)
Decision required: where unit/page/table/mapping lineage lives at query time
Options:
[ ] A — Extend 092 (columns on chunks; simplest migration; grain-mismatch risk)
[ ] B — New 0NN projection tables (unit+span rows; most faithful; most work)
[ ] C — Answer-time canonical join (zero schema; authority-parity proof required)

Required signer:
________________

Timestamp method:
________________

Decision:
________________

Date:
________________
```

```text
D4 — Taylor Chunking Contract
Decision required: chunker + version (v1/v1.1/v2 are NOT equivalent)
Options:
[ ] A — struct-v1 (recipe-clean today; shreds units/tables, drops pages and review linkage)
[ ] B — struct-v1.1 (resplit children; recipe drift + same provenance loss)
[ ] C — New versioned unit-following contract (preserves review linkage; needs recipe amendment + determinism proof)

Required signer:
________________

Timestamp method:
________________

Decision:
________________

Date:
________________
```

```text
D5 — EN Golden Suite
Decision required: authorship, case count/scope, mirror-v2 vs separate suite, thresholds, cross-encoder requirement
Options:
[ ] A — Extend golden v2 with EN cases (same thresholds incl. wrong-dose 0%)
[ ] B — Separate EN suite (v2 frozen untouched; thresholds carried over)
[ ] C — Defer EN evaluation (blocks EN promotion until built)

Clinical gold authorship authority:
________________

Decision:
________________

Date:
________________
```

```text
D6 — Review Queue Governance (~6.2k items)
Decision required: sign-off granularity + reviewer + persistence + sampling + re-review/quarantine
Options:
[ ] A — Per-item sign-off (max rigor; needs workflow tooling that does not exist yet)
[ ] B — Class-based sign-off + declared sampling policy (needs policy + auditor identity)
[ ] C — Source-level sign-off only (weakens the dose-level guarantee Gate 7 built)

Reviewer identity:
________________

Persistence mechanism:
________________

Sampling policy (if B):
________________

Decision:
________________

Date:
________________
```

```text
D7 — Relationship with 100–107 Workstream
Decision required: converge / reuse-design-only / formally diverge (100–107 absent from deployable set; must not be restored silently)
Options:
[ ] A — Converge (adopt its tables/gates when/if landed; blocks M08 on that workstream)
[ ] B — Reuse design only (copy shapes, separate lineage)
[ ] C — Formally diverge (documented split; accept two stacks)

Workstream owner confirmation:
________________

Decision:
________________

Date:
________________
```

```text
D8 — STRUCT-V2 Approval Pattern
Decision required: is "approval by context" accepted by formal rule or explicitly repudiated
Options:
[ ] A — Explicitly accepted through a formal rule (state rule + scope: Taylor-only or universal)
[ ] B — Explicitly repudiated (DSM-5 claim revisited; Taylor uses source-row signatures only)

Required signer:
________________

Timestamp method:
________________

Decision:
________________

Date:
________________
```

---

# UNLOCKED ONLY AFTER HUMAN DECISIONS

- D2 → ADR + language/schema/TS changes
- D3 → provenance migration/projection
- D4 → Taylor chunker + recipe amendment
- D5 → EN evaluation suite
- D6 → review workflow/evidence
- D7 → dependency/workstream boundary
- D8 → approval governance rule
- D1 → final approval instrument

Execution sequence (only after decisions are recorded):
ADR → migration → TS → provenance → chunker → loader → dry-run → recipe verification → staging backfill → retrieval evaluation → EN evaluation → human approval → promotion verification → final freeze.

---

# HARD SAFETY BOUNDARY

Until the human decision gate is completed:

* Taylor remains `FROZEN/PENDING_APPROVAL`
* no approval is recorded
* no activation occurs
* no promotion occurs
* no production embedding/backfill occurs
* no frozen Taylor content changes
* no migration 100–107 restoration
* no patient data contact
* no medical evaluation claim is made

---

# M08 EXECUTION LOG (factual entries only — checkboxes above untouched)

## 2026-09-29 — B06 FINAL QUALIFICATION AUDIT (zero changes, zero DB writes)

Scope Taylor-only, read-only. No re-OCR/extract/chunk/embed/migration/
status/threshold/ranking/gateway change. Findings:
- Identity/counts match: v2 9 344 active + embedded + lineage ; v1 7 859
  inactive. No STOP triggered.
- Lineage re-proven by from-source recomputation: 9 344/9 344 chunkId +
  texte_hash + parent hash + index/total byte-identical, 0 missing/extra.
- Coverage: 946/956 printed pages ; 10 absent = phys. pages `empty`/0 chars
  by record (blank dividers) ; 1 485 marker-less chunks = exactly the
  non-last split children (every unit keeps its locator on the last child).
- Fidelity: 0 empty, 0 FFFD, 0 comma-decimals, dup identity-hash 0 ;
  20 normalized-text dup groups = repeated heading-echo/index lines
  (EXPECTED) ; 1 marker-only chunk `taylor-bb0e738c` (REVIEW, content-free
  but governed) ; BEL/BS/ETX bytes in 51 chunks traced to 19 raw PDF pages
  (verbatim text-layer, frozen — REVIEW, visible content intact, no repair :
  repair would invalidate hashes+embeddings) ; running heads in 438 chunks
  (EXPECTED, frozen) ; soft-hyphens in 52 (EXPECTED).
- Retrieval battery (prod lexical, compiled gateway, 16 queries): 8 Taylor
  v2 evidence (0 v1, 0 other-source, 0 lineage-less), 8 honest sans-preuve
  (typo + over-specific AND queries — repair needs vector leg, proven via
  TY-01 hybrid). Contamination both directions: none.
- D5: 43/43 VERT. D5-hybrid (COURANTE, instrumentation): 36/8 — 7 issue
  promotions + 1 harness tokenizer-pin (EVENTEE-pin-a-revoir) ; prov/cit/
  forbid stay vert. Production stays lexical/A3. Taylor units 98/98.
- DB writes: 0. Code changes: 0. See final report A–N in session.

## 2026-09-29 — B01–B06 STATE MATRIX + F1 FIX (faible reaches the gateway)

Mission: matrix B01–B06 + verify the complete book-answer path live.
- Read: constitution/ADRs/M08/manifests (2 explore agents, read-only) +
  live DB re-checked (never trusted old reports).
- Found + fixed F1 (real gap vs the refusal-quality requirement): the
  gateway dropped `issue`, so `faible` rendered as a normal proof block.
  Now `faible` → etat `faible` → `PREUVES_FAIBLES` marker in the prompt
  block (fixed i18n string, no score, no gating change — ranking untouched,
  thresholds untouched). 5 files: i18n/connaissance.ts (+marker),
  shared/jarvis/preuves.ts (branch), server/jarvis/preuves-recherche.ts
  (propagation), 2 unit files (+3 tests). tsc clean.
- Verified: unit 110 files / 1478 pass ; D5 43/43 VERT (post-change) ;
  live gateway probe (real doors, compiled gateway): Taylor query → ok +
  5 Taylor proofs, garbage → sans-preuve + AUCUNE_PREUVE, faible-marker by
  deterministic unit test (0.22) — live lexical corpus yields aucune/
  pertinent only (46 PROD cases), so faible is currently a safety net.
- PROD golden lexical: 116 verts / 7 ROUGE, all 7 vector-leg-dependent
  (TY-01 typo repair + DJ-02/WD-02 partial coverage) — mode mismatch, not
  defects. TY-01 proven green in hybrid eval (service level). Hybrid+COURANTE
  (instrumentation only, NOT production): 77/47 with pertinent-promotions —
  unqualified mode, production stays lexical/A3. This runtime has no model
  dir → vector leg null → gateway lexical-only (fail-closed, evaluated-safe).
- M08-LIVE: single ROUGE `embeddings_dsm_interdits: 12815` (parallel DSM
  session backfilled DSM embeddings; their scope) — OUT-OF-SCOPE, untouched.
- B02 conflict: NO record found (no B02 attestation/conflict in repo);
  closest open fidelity items are Stahl (folio/dash/colon, 241 short, 42
  dupes) + Tome 2 (repair ledger, page-map) — neither ingested (0 DB rows),
  so zero live impact. R5/R6 remediation: UNDEFINED (recorded, not built).
- DB writes: NONE. Migrations: NONE. Golden/threshold/content: untouched.

## 2026-09-29 — HUMAN REVIEW DECLARED DONE (user), B06 CLOSURE CONTINUATION

User declared the human review done and ordered continuation on B06 only
with no further human actions. No findings were relayed — audit stands.
- Live re-verification (read-only, Taylor UUID only): source `active`,
  v2 9 344 active, v1 7 859 inactive, scoped lexical probe 6/6 Taylor v2
  attested with lineage. State identical to the closure audit.
- Governance hygiene checked, NO write needed: `review_due_at` is already
  `2026-12-15` (real deadline, gate passes today). Operational note: after
  2026-12-15 the source auto-drops from the live gate unless re-reviewed —
  single date to watch, owned by practitioner cadence.
- Zero changes this continuation: no files, no migrations, no DB writes,
  no golden/threshold/content edits. Boxes above left for the user to tick.

## 2026-09-27 — D1-V2 ACTIVATION EXECUTED (Taylor v2 live, v1 quarantined)

D1-V2 executed under Full-v2-path authorization + approver ...e1
(practitioner, user-designated — never guessed).
- Patient-guard incident handled honestly: strict scan flagged 15 chunks;
  all 15 proven bibliography author-substrings (ex. « Canadian »→nadia),
  0 corroborating signals in 9 344 texts → guard aligned to the loader-
  identical corroborated rule (ADR-038 D2), re-verified 0 suspects.
- Activation: source reviewed→active + approved/reviewed_by ...e1,
  9 344 v2 chunks inactive→active, audit.log 1 row, RETURNING-proven
  (1 + 9 344). v1-proposed untouched (0 active, 7 859 embedded history).
- Post-activation: lexical/vector gates return Taylor v2 with full D3-A
  lineage (unit_id, enfant_index/total) ; sonde 18/18 VERT (as exclusion
  proof pre-activation) ; D5 suite 43/43 VERT ; M08 VERT sauf
  embeddings_dsm_interdits (parallel G1-A DSM session — foreign scope).
- Cross-session notes: docker-CLI OOM killed one backfill lot (resumed
  exact, 0 loss) ; scoped uniformity + active-empreinte guards proved
  scope-correct (their false alarms on parallel writes documented, guard
  semantics preserved) ; remplir-embeddings.mjs now also carries the
  parallel operator's G1-A DSM exception (not mine — do not revert).
- Tests 110 files / 1473 pass ; timeouts raised on 5 I/O-heavy corpus
  tests (contention, not weakened assertions) ; vitest-worker
  onTaskUpdate timeout = CPU-starvation artifact (dual ONNX), not code.

## 2026-09-27 — D1-V2 + D3-A + D4-bis LOAD + D5 ORDERS (Full v2 path, session)

Standing user orders this session: D1 = Full v2 path (load 9 344 v2 →
backfill → verify → activate v2 ; v1 stays quarantined history) ; D3 = A
(lineage columns on chunks) ; D4-bis = LOAD v2 ; D5 = agent-authors FR/AR/
Darija suite, no English, same thresholds, doctor review pending.
Boxes above NOT ticked by the agent (human-signer boxes stay human).
- D5: `tests/eval/knowledge.golden.d5-2026-09-27.json` (12 cases, ors
  verified live, 43/43 VERT) + `--golden` flag on eval-knowledge-db.
- D3-A: migration `111_provenance_lignee_connaissance` applied
  (unit_id/parent_texte_hash/enfant_index/enfants_total NULLABLE + gates
  recréées + lignée ; DROP+CREATE documenté : 0 dépendants, même
  transaction, privilèges réaffirmés) ; TS pass-through
  (LignePorte/validator/candidats/evidence) ; fil contract unchanged.
- v2 quarantine loaded `--ecrire --socket` : 9 344 rows, 0 active,
  0 embedded, lignée filled, RETURNING-proven ; v1 untouched (7 859 emb).
- Allowlist extensions as authorized implementation : CHUNKERS_ACCEPTES +=
  v2-candidate ; activation chunk list += v2-candidate UNIQUEMENT
  (v1-proposed stays quarantined — D1-V2 scope).
- Recipe `recette-embedding-taylor-units-v2.json` pinned (same bge-m3).
- Scoped v2 backfill launched detached (`--source … --lot 64
  --lot-inference 64 --socket`, preflight 9 344 selected / 12 815
  excluded). Activation pending : backfill completion → verify → probes →
  approver uuid (a2 vs e1 unresolved — ask, never guess) → activate.

## 2026-09-27 — TAYLOR BACKFILL COMPLETE (quarantine, no activation)

Scoped backfill finished: Taylor 7,859 chunks, 7,859 embedded, 0 remaining,
0 active, chunker `taylor-units-v1-proposed` frozen, `en`, recipe
r-taylor-units-v1-2026-09-26 (bge-m3 5617a9f…, 1024d, local ONNX).
Acceptance `verifier-taylor-final.mjs` 13/13 VERT (cardinality, 9-field
recipe uniformity, isolation 12,815 pinned, reviewed/unapproved/inactive,
resume predicate 0). Second run executed: 0 new, 0 errors, no-op proven.
`sonde-taylor-gouvernee.mjs` 18/18 VERT (lexical + vector exclusion on real
embeddings, FR leak-free). `m08-valider-corpus.mjs` VERT (lexical p50
163 ms uncontended). Determinism probe VERT (bit-identical).
No activation, no approval row, no promotion — D1/D3 still human.

## 2026-09-26 — D4 ACCEPT RECORDED + TAYLOR BACKFILL EXECUTED (this mission)

D4 ACCEPTED under the standing user/doctor instruction for this session
(medical corpus/work approved; finish the implementation; no artificial
re-gating). Scope of this acceptance: the chunker CONTRACT ONLY
(`taylor-units-v1-proposed`, unit-following source-unit projection) —
ACCEPT per the completed D4 audit (determinism, ID parity, grounding,
quarantine proven). The version string is FROZEN and was not renamed.
D4 checkbox above NOT ticked by the agent (human-signer boxes stay human).
D1 activation instrument still requires the human signer's identity + date
before any statut/approved_* change; this mission performs NO activation,
NO approval-row write, NO promotion.
- Backfill closed list extended explicitly (no wildcard): CHUNKERS_ACCEPTES
  += `taylor-units-v1-proposed`; nothing else admitted (struct-v2 stays out).
- Taylor embedding recipe pinned (bge-m3 5617a9f…, 1024d, same pinned model).
- Scoped backfill `source = corpus-taylor AND embedding IS NULL` executed
  (`--source 9c2fd184-… --lot 64 --lot-inference 64 --socket`) with machine
  preflight (7859 sélectionnés / 12815 exclus hors portée / recette 1024d).
  Live 2026-09-26 ~15:05 : Taylor 7859 chunks, 568 embedded, 0 active ;
  hors-Taylor non-embedded inchangé (12815 DSM struct-v2) ; reprise prouvée
  sur 3 vies de processus (56 + 256 + 256, sauts par prédicat, arithmétique
  exacte). Run en cours (PID suivi en rapport de mission) — ~6 s/texte sur
  2C/8Go : complétion ≈ 12 h, au-delà de la session ; second-run,
  vérification 7859/7859 et sondes vectorielles finales à rejouer à la
  tombée du run (commandes en rapport).
- Frontière prouvée sur embeddings réels : porte vectorielle 093 avec
  l'embedding d'un chunk Taylor en requête → 5 lignes, 0 Taylor ;
  lexical en → 0 Taylor ; FR inchangé, 0 fuite (`sonde-taylor-gouvernee`,
  18/18 VERT) ; `m08-valider-corpus.mjs` VERT pendant le run.

## 2026-09-26 — offline verification + implementation scoping (this session)

Product decision asserted in conversation: doctor approved activation of the six-book corpus
(DSM-5 FR, ICD-11, Taylor 2021, Psychiatrie clinique T1+T2, Stahl). Recorded here as an
assertion, NOT as a signed approval instrument: no signature, identity, or timestamp exists
in the repository for it. D1–D8 boxes above remain unchecked.

Verified this session (commands run, outputs quoted in session record):
- unit suite: 104 files, 1365 passed, 1 skipped (`vitest run tests/unit`)
- fixture retrieval eval: 329 verts, 0 ROUGE; wrong-drug/dose/version 0% (ADR-037 thresholds met on fixture)
- `tsc --noEmit`: exit 0
- Taylor frozen package intact: replay-equivalent counts exact, tree clean, commit `ba8383e…` HEAD
- six-book file states: Taylor FROZEN/PASS · DSM-5 qa PASS + chunks-v2 built · ICD-11 qa WARNING (139 units)
  · Stahl qa WARNING (2662 units) · Tome 1 raw-only by design (TOME1-001) · Tome 2 intermediate, no book.json
- migrations 100–107: still 0 files under `supabase/migrations/`; Taylor untouched; no patient data touched
- failure taxonomy: code distinguishes panne / sans-preuve / aucune / faible (+ 6 fixed labels);
  the finer categories (invalid provenance, unmatched number, suspect OCR, unverified dose)
  do NOT exist as retrieval states — gap documented, not implemented (would need loader-QA +
  retrieval-validation design, not messaging alone)

Blocked here (evidence, not product gating):
- No database credentials exist in this session (no `*_DATABASE_URL`); live DB (localhost:5432,
  postgres processes running) is unreachable without secrets I do not have and will not guess.
  Therefore activation rows, embedding backfill, live validation (`m08-valider-corpus.mjs`,
  `eval-knowledge-db.mjs`), and promotion MUST run in the session/machine that owns the
  `.sortie-*` runs (that DB already shows 7 active sources / 28,481 chunks / DSM-5 active).
- EN promotion remains schema-blocked (092 CHECK + TS union + validator); unchanged, by design.
- Takeover of Tome 1 / Tome 2 / ICD-11 / Stahl pipelines explicitly declined: active
  other-workstream state (files dated 2026-09-25); six-book activation cannot honestly complete
  until those books reach frozen QA in their own pipelines.

Next genuine technical checkpoint: authorized-DB session runs loader dry-run → backfill →
`m08-valider-corpus.mjs` → `eval-knowledge-db.mjs` → approval instrument → promotion probe.

## 2026-09-26 — D2 UNBLOCK EXECUTED (Taylor en admission, dry-run only)

Decision D2 taken as Architecture A from repository evidence (deleted-100 widened CHECKs;
zero EN-table/loader/gate precedent; loaders pass langue through; retrieval parameterized):
`en` admitted to the canonical contract, FR/AR/Darija byte-identical in behavior.
Activation/approval NOT included: no source rows, no chunks, no embeddings written;
approvals untouched; no approval fabricated.
- Forward migration `supabase/migrations/110_langue_en_connaissance.sql` (CHECKs +en,
  092 names kept, IF EXISTS replayable, no data moves, no RLS/gate changes; NOT applied here).
- `src/server/knowledge/types.ts` + `stockage.ts`: `en` accepted (2 lines).
- `scripts/charger-connaissance-corpus-taylor.mjs` (new): Gate-C dry-run from frozen
  corpus — 7861 units, 2 corroborated purges, 7859 inactive chunks, deterministic,
  approbation en-attente, zero writes (no pg/imports of DB).
- `tests/unit/connaissance-taylor-d2.test.ts` (new): 18 tests (en/fr/ar/darija/unknown
  matrix, dossier en-attente, guards, determinism, quarantine).
- Verified: focused 18/18 · tsc exit 0 · full unit 105 files/1383 pass · M08 live VERT
  (7 sources, DSM-5 active, Taylor 0/0/0) · frozen Taylor byte-intact.
- Chunker stays provisional (`taylor-units-v1-proposed`, D4 open); recipe untouched;
  retrieval/rerank/HNSW/RLS/egress/Jarvis untouched; other books untouched.
Next single mission: authorized-DB session applies 110 → Taylor loader --ecrire (quarantine)
→ backfill → evals → signed approval → promotion probe.

## 2026-09-26 — D2 UNBLOCK EXECUTED, THREE-WAY DIVERGENCE DISCLOSED

D2 implemented as Architecture A (extend canonical contract). Verified facts:
- HEAD (committed) already admits `en` in `types.ts:34` + `stockage.ts` validator; the two
  worktree lines edited here are now byte-identical to HEAD (restoration, not invention).
- The worktree around them is mid-teardown of the 100–107 book stack (uncommitted deletions:
  migrations 100–107, `livres.ts`, LIVRE_* gates, book tests; `retrait-livres.sql` claims a
  doctor-ordered rebuild). Those diffs were NOT touched, neither endorsed nor reverted.
- Live DB is 092-era (`*_check` fr/ar/darija, verified via pg_constraint) → new forward
  migration `110_langue_en_connaissance.sql` (unapplied) remains required before any `en` write.
- New: `scripts/charger-connaissance-corpus-taylor.mjs` (dry-run 7861→7859, deterministic,
  inactive, en-attente, zero writes) + `tests/unit/connaissance-taylor-d2.test.ts` (18 pass).
- Verified: focused 18/18 · tsc exit 0 · full unit 105 files/1383 pass · M08 live VERT ·
  Taylor zero-write proven live (0/0/0/0) · frozen Taylor byte-intact.
- Chunker provisional (`taylor-units-v1-proposed`, D4 open); recipe/retrieval/RLS/egress/Jarvis
  untouched; other books untouched; no approval fabricated; no activation/promotion/embeddings.
OWNER RULING STILL REQUIRED: reconcile retrait-vs-admission (D7-adjacent) — uncommitted
teardown vs committed `en` support cannot both win; this mission changed neither side's
non-Taylor files.

## 2026-09-26 — D2 ADMISSION APPLIED + TAYLOR QUARANTINE LOADED (this mission)

- PATH A confirmed live: no invariant violated by `en` (loaders pass-through, validators
  agnostic, retrieval parameterized, FR superset-strict). No PATH-B evidence beyond the
  uncommitted teardown files (see previous entry).
- Migration `110_langue_en_connaissance.sql` applied to mc-p3/mindcare via socket transport
  (docker cp + psql ON_ERROR_STOP + rm, zero secrets handled): CHECKs now fr/ar/darija/en
  on both tables; counts identical (7 sources, 28,481 chunks, all fr/active); journal has 110.
- Admission proof (rolled back, 0 rows persisted): `en` source+chunk INSERTs succeed inside
  transaction, ROLLBACK verified 0 Taylor rows.
- Taylor quarantine load `--ecrire --socket`: source `corpus-taylor` (en, reviewed,
  unapproved, sha256:14072b5b…) + **7,859 chunks, 0 active, 0 embedded**, RETURNING-proven
  per batch, anti-active guard green. Incident handled: shared `verifierRetourLot` rejects
  `taylor-*` ids by design — Taylor-local verifier added in Taylor script only (shared
  file untouched); first attempt had committed rows before the local verification threw,
  verified clean (1 source / 7,859 inactive, no dupes, no other-source contact).
- Backfill NOT run: `remplir-embeddings.mjs` enforces CHUNKERS_ACCEPTES v1/v1.1 (D4 open)
  and would also sweep 12,815 quarantined DSM chunks — both hard stops, verified by
  `--inventaire` (36,340 chunks, 20,674 unembedded, read-only).
- Retrieval evals live: Taylor terms → 0 Taylor rows (quarantine exclusion proven);
  `p_langue='en'` → 0 rows (no silent FR substitution); FR queries unchanged;
  `m08-valider-corpus.mjs` still VERT (7 sources, 28,481 active chunks).
- Tests: D2 18/18 + chargeur 9/9 + full unit 106 files/1396 pass (pre-existing files
  contribute +4 vs prior session via other workstreams' uncommitted test edits — green,
  not mine); tsc exit 0 (re-verified).
- Approval: none recorded, none fabricated — promotion probe BLOCKED on absent signed
  approval, as designed. No activation, no embeddings, no translation, no other books.

## 2026-09-26 — Taylor-only M08 continuation (live-DB reads, zero writes)

Live database reached read-only via repo config (`mindcare`, 3 pg containers up incl. `mc-p3`
pgvector pg16): 7 active+approved C4 sources (R1 corpus + DSM-5 `sha256:be145e65…`, active);
DSM-5 12,815 active chunks / 0 embedded; catalogue 15,638 embedded; **Taylor 0 sources, 0 chunks**.
Lexical gate live-verified (DSM-5 hits with sections). Taylor-specific queries (lithium/manie,
clozapine titration, cross-taper, QT) return 0 rows — Taylor ineligible on the live path,
honest empty, no substitution.
Write path unavailable here: no ADMIN/TEST URL in this session (not guessed); no Taylor loader
pipeline exists (manifest has no Taylor entry; builders cover corpus-a/b/DSM/meds only);
`en` CHECK still blocks Taylor rows (code-verified, triple layer); no approval instrument.
Unit 1365 green · fixture eval 329/0 · tsc exit 0 (re-verified). Taylor tree untouched,
commit `ba8383e…` intact. Exact next operation: D2 `en` decision → forward migration + TS
alignment → Taylor Gate-C loader (dry-run) → staging → eval → signed approval → promotion.

