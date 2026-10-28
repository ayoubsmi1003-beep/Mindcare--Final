import { expect, it } from "vitest";
import { localResponse } from "@/server/alexa/local-response";
import { planRequest } from "@/shared/alexa/request-plan";
import { dialogue } from "@/i18n/alexa-dialogue";
import type { ClinicalContext } from "@/shared/alexa/clinical";

function context(complete: boolean, hasMore: boolean): ClinicalContext {
  return { patientId: "11111111-1111-4111-8111-111111111111", sourceRevision: "a".repeat(64),
    consultations: [{ id: "22222222-2222-4222-8222-222222222222", startedAt: "2026-01-01T10:00:00Z", endedAt: "2026-01-01T11:00:00Z", notes: [] }],
    diagnoses: [], scales: [], treatments: { current: [], history: [], historyComplete: true },
    coverage: { requested: 1, returned: 1, complete, hasMore } };
}

it("does not label the requested last consultation incomplete merely because older consultations exist", () => {
  const answer = localResponse(context(true, true), planRequest("dernière consultation", null), []);
  expect(answer.map(item => item.text)).not.toContain(dialogue("fr").partial);
});

it("does not label a complete treatment read partial because consultation notes are missing", () => {
  const answer = localResponse(context(false, true), planRequest("traitement actuel", null), []);
  expect(answer.map(item => item.text)).not.toContain(dialogue("fr").partial);
});

it("answers an empty treatment lookup in a concise natural sentence", () => {
  const answer = localResponse(context(true, true), planRequest("Quels traitements suspendus sont documentés ?", null), []);
  expect(answer.map(item => item.text)).toContain("Je ne trouve aucun traitement correspondant dans le dossier consulté.");
});

it("still declares truncated treatment history and missing requested consultation content", () => {
  const truncated = context(true, false);
  truncated.treatments.historyComplete = false;
  expect(localResponse(truncated, planRequest("traitement actuel", null), []).map(item => item.text)).toContain(dialogue("fr").partial);
  expect(localResponse(context(false, false), planRequest("dernière consultation", null), []).map(item => item.text)).toContain(dialogue("fr").partial);
});

it("summarizes repeated scale results once and keeps unlinked scale results",()=>{
 const olderId="33333333-3333-4333-8333-333333333333",latestId="44444444-4444-4444-8444-444444444444";
 const withScales:ClinicalContext={...context(true,false),consultations:[
  {id:latestId,startedAt:"2026-04-26T09:00:00Z",endedAt:"2026-04-26T10:00:00Z",notes:[]},
  {id:olderId,startedAt:"2025-08-31T09:00:00Z",endedAt:"2025-08-31T10:00:00Z",notes:[]},
 ],scales:[
  {id:"55555555-5555-4555-8555-555555555551",scaleId:"66666666-6666-4666-8666-666666666661",name:"PHQ-9",consultationId:olderId,consultationStartedAt:"2025-08-31T09:00:00Z",administeredAt:"2025-09-02T09:00:00Z",score:16,interpretation:"modérément sévère"},
  {id:"55555555-5555-4555-8555-555555555552",scaleId:"66666666-6666-4666-8666-666666666662",name:"GAD-7",consultationId:olderId,consultationStartedAt:"2025-08-31T09:00:00Z",administeredAt:"2025-09-02T09:00:00Z",score:12,interpretation:"modéré"},
  {id:"55555555-5555-4555-8555-555555555553",scaleId:"66666666-6666-4666-8666-666666666661",name:"PHQ-9",consultationId:latestId,consultationStartedAt:"2026-04-26T09:00:00Z",administeredAt:"2026-04-27T09:00:00Z",score:7,interpretation:"léger"},
  {id:"55555555-5555-4555-8555-555555555554",scaleId:"66666666-6666-4666-8666-666666666662",name:"GAD-7",consultationId:latestId,consultationStartedAt:"2026-04-26T09:00:00Z",administeredAt:"2026-04-27T09:00:00Z",score:4,interpretation:"minime"},
  {id:"55555555-5555-4555-8555-555555555555",scaleId:"66666666-6666-4666-8666-666666666663",name:"Échelle complémentaire",consultationId:null,consultationStartedAt:null,administeredAt:"2026-05-01T09:00:00Z",score:null,interpretation:null},
 ]};
 const events=localResponse(withScales,planRequest("Quelles échelles ont été administrées et dans quelles consultations ?",null),[]);
 const answers=events.map(item=>item.text);
 const output=answers.join(" ");
 expect(answers).toHaveLength(2);
 expect(output).toContain("31 août 2025");expect(output).toContain("26 avr. 2026");
 expect(output).not.toContain("2 septembre 2025");expect(output).not.toContain("27 avril 2026");
 expect(output).toContain("PHQ-9");expect(output).toContain("GAD-7");expect(output).toContain("Échelle complémentaire");
 expect(output).toContain("score 16");expect(output).toContain("score 12");expect(output).toContain("score 7");expect(output).toContain("score 4");
 for(const score of [16,12,7,4])expect(output.match(new RegExp(`score ${score}`,"gu"))).toHaveLength(1);
 expect(answers[0]).toContain("PHQ-9 : consultation du 31 août 2025 : score 16");expect(answers[0]).toContain("consultation du 26 avr. 2026 : score 7");
 expect(answers[0]).toContain("GAD-7 : consultation du 31 août 2025 : score 12");expect(answers[0]).toContain("consultation du 26 avr. 2026 : score 4");
 expect(events[0]?.sources.map(source=>source.id)).toEqual(["55555555-5555-4555-8555-555555555551","55555555-5555-4555-8555-555555555552","55555555-5555-4555-8555-555555555553","55555555-5555-4555-8555-555555555554"]);
 expect(output).not.toMatch(/55555555|33333333|44444444/u);
});
