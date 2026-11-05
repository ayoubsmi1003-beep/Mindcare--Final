import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";

import { runAgentLoop, clearAgentTask } from "@/server/alexa/agent-loop";
import { agentSchemas, type AgentCall } from "@/shared/alexa/agent";

const patientId = "00000000-0000-4000-8000-000000000001";
const consultationId = "00000000-0000-4000-8000-000000000003";
const corpus = JSON.parse(readFileSync(resolve("tests/eval/alexa-laya-fr-v1.json"), "utf8")) as {
  asOf: string;
  groups: { category: string; family: string; route: string; split: string; utterances: string[] }[];
};

function expectedCalls(family: string, route: string, utterance: string) {
  const call = (name: keyof typeof agentSchemas, args: Record<string, unknown>) => ({ name, args });
  const treatment = call("get_patient_context", { section: "treatments", treatmentState: "active" });
  switch (route) {
    case "general": return [call("answer_general", { question: utterance })];
    case "patient_search": return [call("query_patients", { mode: "list", query: "Testia Alpha" })];
    case "patient_open": return [call("navigate", {
      target: "patient", patientName: family === "change" ? "Testia Bêta" : "Testia Alpha",
    })];
    case "treatments": return [treatment];
    case "stopped_treatments": return [call("get_patient_context", { section: "treatments", treatmentState: "stopped" })];
    case "diagnoses": return [call("get_patient_context", { section: "diagnoses" })];
    case "scales": return [call("get_patient_context", { section: "scales" })];
    case "phone": return [call("get_patient_context", { section: "profile" })];
    case "agenda_today":
    case "agenda_tomorrow": {
      const day = route === "agenda_today" ? 5 : 6;
      return [call("query_agenda", { from: `2026-11-0${day}T00:00:00+01:00`, to: `2026-11-0${day + 1}T00:00:00+01:00` })];
    }
    case "knowledge": return [call("search_knowledge", { query: utterance })];
    case "mixed": return [treatment, call("search_knowledge", { query: "$from_verified_treatments_and_question" })];
    case "prepare_action": return [call("prepare_action", {
      action: family === "pause" ? "pause_treatment" : "resume_treatment", treatmentName: "lithium",
    })];
    case "consultation": return [call("query_consultations", { view: "analysis", consultationId })];
    case "clarify":
    case "unsupported": return [];
    default: throw new Error(`Unannotated route ${route}`);
  }
}

it("records the existing deterministic plan on the French Laya corpus without model or database execution", async () => {
  const report = [];
  const actor = "synthetic-laya-eval";
  for (const group of corpus.groups) {
    for (const [index, text] of group.utterances.entries()) {
      const id = `${group.family}-${index + 1}`;
      const selected = (["C", "F", "G", "H"].includes(group.category) || ["telephone", "change"].includes(group.family))
        && group.family !== "suivi-expire";
      const calls: AgentCall[] = [];
      const expected = expectedCalls(group.family, group.route, text);
      for (const { name, args } of expected) {
        expect(agentSchemas[name].safeParse({ partIds: ["expected"], ...args }).success).toBe(true);
      }
      let requiresModel = false;
      try {
        const result = await runAgentLoop({
          text, conversationId: id, clientTurnId: patientId,
          appContext: { page: "/jarvis", patientId: selected ? patientId : null },
        }, {
          actor, asOf: corpus.asOf,
          infer: async () => { requiresModel = true; throw new Error("Evaluation model intentionally disabled"); },
          execute: async call => {
            calls.push(call);
            return { callId: call.id, status: "error", complete: false, text: "", evidence: [], conditionKeys: [] };
          },
        }, new AbortController().signal);
        report.push({
          id, category: group.category, split: group.split, route: group.route, expected, calls,
          requiresModel, status: result.status,
          historicalReferenceNotExercised: group.category === "H",
          dependentPlanNotExercised: group.route === "mixed",
        });
      } finally {
        clearAgentTask(actor, id);
      }
    }
  }
  expect(report).toHaveLength(320);
  const output = process.env.ALEXA_LAYA_BASELINE_REPORT;
  if (output) writeFileSync(output, JSON.stringify(report, null, 2), { flag: "wx" });
}, 60_000);
