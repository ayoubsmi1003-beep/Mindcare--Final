import { describe, expect, it } from "vitest";
import { planRequest } from "@/shared/alexa/request-plan";
import { parsePatientMention } from "@/shared/alexa/patient-mention";
import { runAlexa } from "@/server/alexa/orchestrator";
import type { ClinicalContext } from "@/shared/alexa/clinical";
import type { AlexaEvent } from "@/shared/alexa/turn";
import type { DbPort } from "@/services/db/port";

describe("natural consultation quantities", () => {
  it.each([
    ["آخر أربع جلسات", 4], ["آخر أربعة استشارات", 4],
    ["آخر سبع استشارات", 7], ["آخر سبعة جلسات", 7],
    ["آخر جلستين", 2], ["الاستشارتين الأخيرتين", 2],
    ["آخر اثنين جلسات", 2], ["آخر زوج جلسات", 2],
    ["آخر ست جلسات", 6], ["آخر ثماني جلسات", 8],
    ["آخر تسع جلسات", 9], ["آخر إحدى عشرة جلسة", 11],
    ["آخر اثنتي عشرة جلسة", 12], ["آخر ثلاث عشرة جلسة", 13],
    ["آخر خمسة عشر استشارة", 15], ["آخر تسع عشرة جلسة", 19],
    ["آخر ثلاثين جلسة", 30], ["آخر أربعين جلسة", 40],
    ["آخر خمسين جلسة", 50], ["آخر ستين جلسة", 60],
    ["آخر سبعين جلسة", 70], ["آخر ثمانين جلسة", 80],
    ["آخر تسعين جلسة", 90], ["آخر مائة جلسة", 100],
    ["آخر مية جلسات", 100], ["آخر واحد وعشرين جلسة", 21],
    ["آخر اثنين و ثلاثين جلسة", 32], ["آخر أربع وتسعين جلسة", 94],
    ["آخر تسعة وتسعون جلسة", 99], ["آخر ٢٠ جلسة", 20],
    ["آخر ۲۵ استشارة", 25], ["لخّص آخر أَرْبَع جَلَسات", 4],
    ["قارن آخر زوج جلسات", 2], ["آخر vingt-deux consultations", 22],
  ])("passes the requested quantity for %s", (text, count) => {
    expect(planRequest(text, null)).toMatchObject({ intent: "history", count });
  });

  it.each([
    "آخر صفر جلسات", "آخر مئتين جلسة", "آخر ألف جلسة", "آخر عدة جلسات",
    "آخر بضع جلسات", "كل الجلسات", "جميع الاستشارات", "آخر مائة وخمس جلسات",
    "آخر ١٠١ جلسة", "آخر ٠ جلسات", "اعرض آخر مائتي جلسة", "مائة وخمس جلسات",
    "آخر مئتا جلسة", "آخر مائتان جلسة", "آخر ٢٫٥ جلسة", "les -5 dernières consultations", "les 2,5 dernières consultations", "آخر +5 جلسات", "آخر 1/2 جلسة",
  ])("clarifies an unsupported or unspecified quantity instead of reading one: %s", text => {
    expect(planRequest(text, null).intent).toBe("clarify");
  });

  it.each(["آخر جلسة", "آخر استشارة", "آخر جلسة يوم ٢٥/٠٩/٢٠٢٦", "Les notes de la dernière séance"])("does not treat dates or clinical wording as a count: %s", text => {
    expect(planRequest(text, null)).toMatchObject({ intent: "history", count: 1 });
  });
  it.each(["الاستشارتين الأخيرتين", "الجلسة الحالية", "الجلسات السابقة", "آخر سبع استشارات عن النوم", "آخر أربع جلسات تاعو"])("does not treat an Arabic consultation modifier as a patient name: %s", text => {
    expect(parsePatientMention(text)).toEqual({ status: "none" });
  });
});

const patientId = "11111111-1111-4111-8111-111111111111";
const db: Pick<DbPort, "rpc"> = { rpc: async <T>() => ({ ok: true as const, data: [{ id: patientId, first_name: "Synthetic", last_name: "Test" }] as T[] }) };
const knowledge = { rpc: async <T>() => ({ data: null as T | null, error: null }) };
function context(count: number): ClinicalContext {
  return { patientId, consultations: Array.from({ length: count }, (_, index) => ({
    id: `${String(index + 1).padStart(8, "0")}-1111-4111-8111-111111111111`,
    startedAt: new Date(Date.UTC(2026, 0, 20 - index)).toISOString(),
    endedAt: new Date(Date.UTC(2026, 0, 20 - index, 1)).toISOString(), notes: [],
  })), treatments: { current: [], history: [], historyComplete: true }, diagnoses: [], scales: [],
  sourceRevision: "a".repeat(64), coverage: { requested: count, returned: count, complete: true, hasMore: false } };
}

it.each([["آخر أربع جلسات", 4], ["قارن آخر سبع استشارات", 7], ["آخر خمسة عشر استشارة", 15]])("retrieves and cites the complete requested selection for %s", async (text, count) => {
  const events: AlexaEvent[] = [], reads: number[] = [];
  await runAlexa({ text, conversationId: `quantity-${count}`, clientTurnId: patientId, appContext: { patientId, page: "/patients/test" } }, {
    actor: "quantity-unit", db, knowledge,
    build: async (_db, _scope, request) => { reads.push(request.count); return context(request.count); },
    infer: async () => { throw new Error("Clear selections do not need a model"); },
  }, event => events.push(event), new AbortController().signal);
  expect(reads[0]).toBe(count);
  expect(new Set(events.filter(event => event.type === "sentence").flatMap(event => event.sources.map(source => source.id))).size).toBe(count);
  expect(events.at(-1)).toMatchObject({ type: "done", coverage: { requested: count, returned: count } });
});

it.each([["آخر جلستين نادية تجربة", 2], ["آخر سبع استشارات نادية تجربة", 7], ["آخر أربع جلسات تاع نادية تجربة", 4]])("resolves the explicit Arabic patient instead of reading the active dossier: %s", async (text, count) => {
  const selected = "22222222-2222-4222-8222-222222222222", events: AlexaEvent[] = [];
  const calls: { name: string; args: unknown }[] = [], scopes: string[] = [];
  const namedDb: Pick<DbPort, "rpc"> = { rpc: async <T>(name: string, args: unknown) => {
    calls.push({ name, args });
    return { ok: true, data: [{ id: selected, first_name: "نادية", last_name: "تجربة", total_count: 1 }] as T[] };
  } };
  await runAlexa({ text, conversationId: `arabic-name-${count}`, clientTurnId: patientId, appContext: { patientId, page: "/patients/test" } }, {
    actor: "arabic-name-unit", db: namedDb, knowledge,
    build: async (_db, scope, request) => { scopes.push(scope.patientId); return { ...context(request.count), patientId: scope.patientId }; },
    infer: async () => { throw new Error("Clear selections do not need a model"); },
  }, event => events.push(event), new AbortController().signal);
  expect(calls).toEqual([{ name: "search_patients", args: { p_query: "نادية تجربة", p_limit: 10, p_offset: 0 } }, { name: "get_patient", args: { p_id: selected } }]);
  expect(scopes.length).toBeGreaterThan(0);
  expect(scopes.every(id => id === selected)).toBe(true);
  expect(events.at(-1)).toMatchObject({ type: "done", patientId: selected, coverage: { requested: count } });
});
