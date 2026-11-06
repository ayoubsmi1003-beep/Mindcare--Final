# 05 — Target architecture

Status: approved direction (plan of 2026-11-06). Constraint: MiniCPM 1B stays, CPU only, 4,096-token context. No cloud inference.

## Principles

1. **Deterministic code decides what can be decided deterministically.** A 17-20 s model call is the last resort, not the default.
2. **Regexes stop deciding meaning and keep guarding safety.** Patient-scope, write-authorization and clinical-safety gates are untouched.
3. **Keep the existing tools and SQL gates.** No second source of truth, no business logic in Alexa.
4. **Every addition is flag-gated or independently testable,** and flips only on measured improvement.
5. **No new engines without a contract and a benefit.** The brief's 20-engine picture maps to the components below.

## Flow

```
Input + appContext
   │
   ├─ Closed forms: courtesy, clock, safe abstention ─► answer, state untouched
   │
   ▼
ConversationFrame ──► FollowupResolver
   (structured memory)   rewrites a follow-up by SLOTS, or asks one question
   │
   ▼
Existing gates: patient scope, period, cancellation, admission
   │
   ├─ Deterministic route (direct*) ─────────────┐
   │                                             │
   └─ Otherwise: Understanding (compact model)   │
        multi-part goal, source need, entities   │
              │                                  │
              ▼                                  ▼
        Plan (dependency graph) ──► Executors (existing tools, parallel when independent)
                                       │
          Knowledge engine ◄───────────┤
          retrieve → recover → select  │
                                       ▼
                       Verifier (citations, numbers, drugs, negation)
                                       │
                                       ▼
                  Answer + TurnOutcome + Trace + Frame update
```

## Components

### ConversationFrame (`src/server/alexa/conversation-frame.ts`)

Extends `WorkingReference`, which keeps working as is.

```ts
interface ConversationFrame {
  activePatientId?: string;            // UUID only, re-verified by a gate on each read
  patientSource?: "ui" | "named" | "listed";
  domain?: "knowledge" | "patient" | "agenda" | "finance" | "documents" | "application" | "general";
  section?: string;                    // last patient section actually read
  knowledge?: {
    medications: string[]; topic?: string; aspect?: KnowledgeAspect;
    condition?: string; book?: string;
  };
  executedTools: { name: string }[];   // at most 6
  unresolved?: "patient" | "period" | "subject";
}
```

**Rules:**
- A courtesy, clock or safe-abstention turn leaves the frame untouched.
- A book question doesn't erase the active patient. "Et chez cette patiente ?" can still reach it.
- A different explicit patient replaces the frame's patient and clears patient-derived fields. No carry-over between patients.
- A cabinet-wide request preserves the patient but doesn't read it.
- Persistence: closed fields only; free text stays in-process, as `lastRequest` does today.

### FollowupResolver (same module)

Pure function: `(text, frame) → { kind: "none" } | { kind: "rewrite", text, patientId? } | { kind: "clarify", slot }`.

| Doctor says | Frame | Result |
|---|---|---|
| "Et la clozapine ?" | knowledge, sertraline, posologie | "posologie de la clozapine ?": medication **replaced** |
| "Et ses effets ?" | knowledge, sertraline | "effets indésirables de la sertraline ?": aspect replaced |
| "Et pendant la grossesse ?" | knowledge, sertraline, posologie | condition set, replacing any previous condition |
| "Et chez cette patiente ?" | knowledge + active patient | mixed: patient section + same topic |
| "Et chez cette patiente ?" | no patient | one clarification |
| "Et son traitement ?" | patient read | same patient, section treatments |
| "Résume-moi tout ça." | patient read | same patient, section summary |

The 16 existing rewriters stay until the evaluation shows the resolver covers them; they encode measured cases.

### Understanding (`src/server/alexa/understanding.ts`)

Runs only when no deterministic route applies.

```ts
interface TurnUnderstanding {
  parts: { goal: string;
           source: "patient" | "knowledge" | "general" | "agenda" | "finance" | "documents" | "application" | "action" | "unknown";
           section?: PatientSection; subject?: string; dependsOn?: number }[]; // at most 4
  clarification?: string;
}
```

- **Prompt under 400 tokens,** against the current full catalogue, with a strict JSON schema.
- **The model proposes, the server verifies:** parts map to tools through the capability registry, and every existing gate still runs. A model plan is never authorization.
- **Off by default** (`ALEXA_UNDERSTANDING=1`), enabled only if the evaluation improves.

### Plan and execution

`directIntegratedMixedWorkflow` generalizes to a dependency graph: `DirectWorkflow` steps gain `dependsOn`, independent reads run in parallel, and budgets stay at 3 rounds and 6 calls. Tool results are checked before dependents run. A dependent step's query is built from a **canonical subject** (`mixedKnowledgeQueries`): one per medication, name without dose or form, at most 3.

### InferenceProvider (`src/server/alexa/inference/`)

```ts
type InferenceTask = "understanding" | "tool_selection" | "general" | "knowledge_selection"
  | "knowledge_french" | "narrative" | "summary" | "classification";

interface InferenceProvider { id: string; modelVersion: string; complete(request): Promise<Completion>; }
interface TaskProfile { provider: string; timeoutMs: number; maxOutputTokens: number; fallback?: string; }
```

Only MiniCPM is registered. Records latency, token counts and model version per task. A later model becomes a registry entry plus a benchmark, with no orchestration changes. Egress rules are unchanged: anything external would still go through `external-call.ts`.

### CapabilityRegistry (`src/shared/alexa/capabilities.ts`)

```ts
interface Capability {
  id: string; domain: string; description: string; tool: AgentToolName; section?: string;
  mode: "read" | "propose"; status: "A" | "B" | "C" | "D" | "E";
  gates: string[]; roles: ("owner" | "practitioner" | "assistant")[]; limits: string[];
}
```

Single source for the understanding prompt, Alexa's own "what can you do" answer, unsupported-feature answers and the evaluation matrix. A unit test binds every entry to a real tool schema and an allowlisted gate, so a listed capability can't drift from the code. `roles` documents behaviour and tests it; RLS still decides.

### Knowledge engine

```
planKnowledgeQuery → lexical + dense → RRF → rerank → select
        ▲                                         │ weak or empty
        └── bounded recovery, at most 3 attempts ◄┘
            1 term-subset query  2 alternate language  3 neighbouring chunks
```

**Publication contract:**
```ts
interface KnowledgeClaim { french: string; quotes: { chunkId: string; quote: string; page: number | null }[]; verified: boolean; }
```

1. **Verifier (deterministic):** numbers and units, drug names, negation, population qualifiers must match the cited quotes.
2. **Verified:** publish the French claim, with the source passage and its real page beside it, labelled as a reformulation.
3. **Not verified:** publish the verbatim passage in a French frame.
4. **Unsafe content, or no proof:** say so. Evidence that exists is never hidden behind "indisponible".

The status stays `partial`, never `supported`: a verified reformulation is checked for consistency, not proven to be entailed. Where approved books disagree, each position is shown with its source.

### TurnOutcome

```ts
type TurnOutcome = "answered" | "partial" | "clarification" | "capability_unavailable" | "insufficient_evidence"
  | "permission_denied" | "tool_failed" | "model_unavailable" | "cancelled";
```

Derived on the server from the existing terminal status and part results. Added to `done`, and old clients ignore it. An empty answer can't end as `answered`. Voice announces a partial answer rather than staying silent.

### Trace

```ts
interface TurnTrace {
  traceId: string; route: "closed" | "direct" | "understanding" | "model_loop";
  routeName?: string; followup?: { resolver: string };
  stages: { stage: string; ms: number; code: string }[];
  knowledge?: { recipe: string; lexical: number; dense: number; selected: number; attempts: number; fallback?: string };
}
```

Closed codes only, no patient text or names. Stored in the existing `complete_jarvis_turn` payload as version 4, with no migration.

## General conversation

Admission widens: anything without a patient or app target and without an action can reach the model. Guards keep real risks only, not ordinary words such as `stress` or `sommeil`. Short bounded history, 320 tokens, and a visible label saying the answer is general knowledge, not from the books. Factual reliability stays limited by the 1B model and is reported.

## Unchanged

RLS, SQL gates, `external-call.ts`, classification, write proposal/confirmation flow, quote validators on what's actually published, UI (except the small label for reformulations), the database schema. New migrations only if a stop point is cleared with the user.
