TASK:        ingest-maudsley-taylor-2021
DOMAIN:      knowledge
OBJECTIVE:   Build source-locked, page-traceable, frozen canonical-v2.1 package for Taylor 2021 (978 pp, en) with zero critical errors, then STOP before chunking/embeddings/activation.
ALLOWED_FILES: context/ingest-maudsley-taylor-2021.md; knowledge/canonical-v2/maudsley-prescribing-guidelines-2021-taylor-14e/sha256-14072b5bf1a74cd5aa754d7fbbfb8a9fd146cd77a49996676c5b5094c16cd9d0/**; docs/superpowers/plans/2026-09-25-taylor-2021-canonical-ingestion.md
REQUIRED_CONTEXT: AGENTS.md; CLAUDE.md rules R1/R3/R4/R7/R9; Books Taylor PDF (read-only); this manifest; book-local KNOWLEDGE_INGESTION_PLAN.md; src/server/knowledge/ingestion.ts; src/server/knowledge/decoupage.ts; src/server/knowledge/types.ts; supabase/migrations/092_knowledge_rag.sql (read-only gate reference)
FORBIDDEN_CONTEXT: Other book directories; old OCR/graphify artifacts; shared ingestion code modification; PostgreSQL writes; chunks; embeddings; retrieval; STATE.md; docs/archive/**; fr.ts; patient data; web substitution (BNF/NICE/FDA)
SECURITY_CONSTRAINTS: Local source only; no external upload; no cloud PDF service; no OCR; no translation; no silent medical repair; no shared script modification; no database write; no clinical activation
VALIDATION:  python3 tools/taylor_pipeline.py verify-raw (978 raw files + 978 page records + hash chain) + replay hash equality; qpdf --check pass; every BLOCKED/WARNING inspected
STOP_CONDITION: qa-report.json + review-queue.json + issues.jsonl + golden-set.jsonl written with explicit PASS/WARNING/BLOCKED, content-manifest frozen, governance state FROZEN, status still PENDING_APPROVAL, zero chunk/embedding/DB/activation side effects.
