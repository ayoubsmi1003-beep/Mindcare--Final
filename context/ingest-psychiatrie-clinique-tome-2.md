TASK:        ingest psychiatric book only
DOMAIN:      knowledge
OBJECTIVE:   Build a provenance-complete canonical representation of one French psychiatric textbook, with exact PDF and printed-page traceability, then stop at QA/review freeze; no retrieval indexing.
ALLOWED_FILES: knowledge/canonical-v2/psychiatrie-clinique-tome-2-2016-tc-media/sha256-22fc03a89c7676559ddaa306b272116fb15119500a8c91667565ee31e80f9f76/**; context/ingest-psychiatrie-clinique-tome-2.md
REQUIRED_CONTEXT: AGENTS.md; books source PDF only; this manifest; the book-specific plan in the allowed output directory; docs/00-DECISIONS.md ADR-037/038/039/040; src/server/knowledge/ingestion.ts; src/server/knowledge/decoupage.ts; src/server/knowledge/types.ts
FORBIDDEN_CONTEXT: Do not load or modify other book directories; old OCR/graphify ingestion artifacts; shared ingestion scripts or schemas; root KNOWLEDGE_INGESTION_PLAN.md; STATE.md; docs/archive/**; fr.ts; unrelated migrations; patient data.
SECURITY_CONSTRAINTS: Local source only; no external upload; no PostgreSQL writes; no clinical activation; no OCR; no translation; no silent medical repair.
VALIDATION:   Validate every canonical file against the book-local schema; verify source SHA-256 and 826-page count; replay extraction and compare hashes; run page-continuity, provenance, table, medication, numeric, and cross-reference QA; inspect every BLOCKED/WARNING item.
STOP_CONDITION: Book QA report and review queue are written with explicit PASS/WARNING/BLOCKED status, all page checkpoints are recorded, and no chunking, embeddings, database projection, or activation has occurred.
