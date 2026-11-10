# Routing and conversation audit

**Status: PARTIAL; static reconstruction plus focused unit tests.** The installed routing flag, real multilingual performance, broad follow-up success and clinical safety remain unverified.

## Routes and decision points

`src/app/api/alexa/turn/route.ts` selects native agent only when `ALEXA_NATIVE_AGENT_ENABLED` equals `1`; otherwise it delegates to `legacyAlexaTurn`. These are different execution paths and cannot share an unqualified readiness claim.

On the native path, `src/server/alexa/orchestrator.ts`, `runAlexa`, applies `planRequest` to deterministic greetings, clock and abstentions; `deterministicActionRequest` identifies some explicit action proposals without a model. It restores a scoped `WorkingReference`, recognizes a series of specific follow-ups, can issue certain direct aggregate reads, and otherwise calls `runAgentLoop`. For an unrouted non-patient knowledge question, a governed retrieval fallback may run. Its eligibility is narrower than all failed questions: it excludes selected/named patient context and requires `planKnowledgeQuery` to accept the question.

`src/server/alexa/agent-loop.ts`, `runAgentLoop`, uses deterministic French admission (`frenchRequestAdmission`, count/compound contracts and requested-output decomposition) along with local-model declaration/tool calls. `src/shared/alexa/agent.ts`, `validateLedger`, requires unique IDs and already-declared dependencies; parts carry pending, answered, needs-input, unsupported, failed, budget-limited and cancelled states. The bounded planner has three rounds, six calls and two-way parallelism. Multi-intent support therefore exists, but cannot be inferred for arbitrary requests or more than the budgets allow.

`src/server/alexa/agent-tools.ts`, `agentExecutor`, checks whether generated filters, names, periods, document references and action arguments are grounded in the actual request or previously authorized context. It returns explicit `needs_input`, `unsupported` and partial/error states for several cases. Some tests deliberately simulate a model failure; a passing failure-handling test does not qualify the model.

## Conversation state

`conversation-state.ts`, `ConversationState`, keys entries by actor and conversation and checks patient, page and context key. `WorkingReference` carries intent, count, selection/cursors, selected patient, some date/filter fields and an in-memory last request. `referenceForPersistence` removes the raw last request; a restored reference has structured data only. Cache retention is 15 idle minutes; maximum entries 256. The turn route persists/restores structured references and task state through SQL gates. Continuation tokens in `agent-continuation.ts` bind actor, conversation, request/context hash, patient, cursor, source revision and time.

These are protective mechanisms, not a universal discourse model. The native orchestrator has explicit, ordered follow-up recognizers for agenda, finance, patients, clinical comparisons and other topics; coverage outside those patterns must be measured. In particular, a durable reference need not carry the full population, metric, evidence or question needed for an arbitrary multi-turn analytic follow-up. Do not claim that an elliptical request was answered correctly without tracing its retained scope and applied query.

## Fragile or explicitly limited cases

| Case | Verified static reason | Effect | Regression experiment |
|---|---|---|---|
| « les premières consultations » in history/summary | `agent-tools.ts` calls `requestsOldestConsultations` and returns `unsupported` for the applicable sections | The requested oldest visits are not silently replaced by the newest. | Synthetic timeline with distinct earliest/latest visits; assert clear refusal until a verified oldest-first query exists. |
| Documents matching words in their body without a selected document | `agent-tools.ts` rejects `documentBodySearchRequested` on the relevant branch | The app has documents, but Alexa cannot promise unrestricted body search. | Compare selected-document text read with global body search; assert explicit unsupported response and no broadened search. |
| « parmi eux » after a patient count | `WorkingReference` and explicit follow-up recognizers carry bounded state rather than an unrestricted cohort graph; exact support varies by request | Scope loss or refusal is a risk, not a confirmed failure for every phrasing. | Synthetic prior cohort, period change and new-patient intersection; assert same population, revision and deterministic SQL oracle. |
| One mixed patient + knowledge question | `agent-loop.ts` has direct mixed workflows; prior report `ALEXA-MIXED-SYNTHESIS-AUDIT.md` recorded nine no-evidence knowledge parts in a lexical-only run | The patient section can be returned while the knowledge part is incomplete; lack of evidence is not a license to guess. | Reproduce on isolated synthetic patient and approved corpus under observed effective lexical/vector settings; assert separate provenance and partial status. |
| Short follow-up after restart | `referenceForPersistence` removes `lastRequest`; restored state retains only structured reference fields | Some in-memory wording-dependent follow-ups may not be reconstructible after restart. Specific user-visible failures need runtime proof. | Execute same knowledge and analytic follow-ups before and after restart; assert explicit clarification when insufficient structured context survives. |
| Local model failure | `runAgentLoop` and callers have failure and bounded recovery paths; knowledge fallback has scoped admission | Some requests can proceed deterministically or with a partial response; others cannot. | Inject timeout/malformed JSON and verify no unrequested tool, stale context reuse or unsupported completion claim. |

## Recommended contract for redesign

Extend only where measured gaps require it: conversation/turn IDs; actor and role; current topic and explicit patient/consultation scope; resolved entities with provenance; metric, period, population and revision for reusable results; pending clarification or action; uncertainty; expiry and reset semantics. Store the minimum necessary structured state; never persist raw clinical text merely to improve reference resolution. A patient change invalidates patient-scoped references unless reauthorized and explicitly rebound. Follow-up resolution must produce a validated plan, not grant the model a new permission.

## Evidence and remaining work

Focused unit runs passed: `alexa-native-context-retention`, `alexa-patient-clarification`, `alexa-v2-question-dependency`, `alexa-agent-budget` and mixed-composition files, among others. They use controlled fixtures and do not qualify natural French, Arabic or Darija at production scale. Run a blind multi-turn golden set with a deterministic synthetic database oracle, role isolation, restarts, paraphrases and topic shifts; score correct cohort/period and abstention separately from fluency.
