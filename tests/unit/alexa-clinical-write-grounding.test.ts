import {expect,it} from "vitest";
import {groundDraftFieldChanges,groundStopReason,groundTreatmentChanges,resolveTreatmentTarget} from "@/server/alexa/clinical-write-validation";

const treatments=[
 {id:"11111111-1111-4111-8111-111111111111",medication:"Sertraline",status:"active" as const,version:4,dose:"25",doseUnit:"mg",frequency:"une fois par jour",timing:[],instructions:null,startDate:"2026-10-01",endDate:null},
 {id:"22222222-2222-4222-8222-222222222222",medication:"Quetiapine",status:"active" as const,version:2,dose:"50",doseUnit:"mg",frequency:"le soir",timing:["soir"],instructions:null,startDate:"2026-09-01",endDate:null},
];

it("selects the explicitly named current treatment and never guesses between two",()=>{
 expect(resolveTreatmentTarget(treatments,"Sertraline","Modifie le traitement Sertraline de Nadia Test.")).toMatchObject({state:"resolved",treatment:{id:treatments[0]!.id,version:4}});
 expect(resolveTreatmentTarget(treatments,"Sertraline","Modifie mon traitement de Nadia Test.")).toMatchObject({state:"ambiguous"});
 expect(resolveTreatmentTarget(treatments,"Sertraline","Modifie le traitement de Nadia Test.")).toMatchObject({state:"ambiguous"});
});

it("uses a sole current treatment for a generic request but excludes stopped treatments",()=>{
 expect(resolveTreatmentTarget([treatments[0]!],undefined,"Modifie mon traitement de Nadia Test.")).toMatchObject({state:"resolved",treatment:{id:treatments[0]!.id}});
 expect(resolveTreatmentTarget([{...treatments[0]!,status:"stopped"}],undefined,"Arrête mon traitement.")).toMatchObject({state:"missing"});
});

it("accepts only requested treatment values and maps them to the SQL gate keys",()=>{
 expect(groundTreatmentChanges({dose:"50",doseUnit:"mg",frequency:"deux fois par jour"},"Passe la sertraline de 25 mg à 50 mg et prends-la deux fois par jour.")).toEqual({dose:"50",dose_unit:"mg",frequency:"deux fois par jour"});
 expect(()=>groundTreatmentChanges({dose:"25",doseUnit:"mg"},"Passe la sertraline de 25 mg à 50 mg.")).toThrow();
 expect(()=>groundTreatmentChanges({instructions:"au coucher"},"Augmente la sertraline à 50 mg.")).toThrow();
});

it("rejects draft fields or values that were not requested",()=>{
 const variables={motif:"ancien motif",jours:"14"};
 expect(groundDraftFieldChanges({motif:"suivi demandé"},variables,"Remplace le motif par suivi demandé.")).toEqual({motif:"suivi demandé"});
 expect(()=>groundDraftFieldChanges({patient_name:"Nadia Test"},variables,"Remplace le motif par suivi demandé.")).toThrow();
 expect(()=>groundDraftFieldChanges({motif:"autre chose"},variables,"Remplace le motif par suivi demandé.")).toThrow();
});

it("keeps discontinuation reasons optional and grounded in the doctor's words",()=>{
 expect(groundStopReason(undefined,"Arrête la sertraline.")).toBeNull();
 expect(groundStopReason("effets_indesirables","Arrête la sertraline à cause des effets secondaires.")).toBe("effets_indesirables");
 expect(()=>groundStopReason("amelioration","Arrête la sertraline à cause des effets secondaires.")).toThrow();
});
