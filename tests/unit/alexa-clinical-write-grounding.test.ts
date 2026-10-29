import {expect,it} from "vitest";
import {groundDraftFieldChanges,groundStopReason,groundTreatmentChanges,hasExactMedicationCatalogIdentity,resolveTreatmentTarget} from "@/server/alexa/clinical-write-validation";

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

it("does not infer a brand as the identity of a differently named current treatment",()=>{
 const request="Modifie le traitement Zoloft de Nadia Test.";
 expect(resolveTreatmentTarget([treatments[0]!],"Zoloft",request)).toMatchObject({state:"missing"});
 expect(resolveTreatmentTarget([treatments[0]!],undefined,request)).toMatchObject({state:"missing"});
});

it("requires an exact catalogue name and never guesses strength or formulation",()=>{
 const catalogue=[{raw_name:"Sertraline 25 mg, comprimé",inn:"Sertraline",brand_name:"Zoloft"}];
 expect(hasExactMedicationCatalogIdentity("Sertraline",catalogue)).toBe(true);
 expect(hasExactMedicationCatalogIdentity("Zoloft",catalogue)).toBe(true);
 expect(hasExactMedicationCatalogIdentity("Sertralin",catalogue)).toBe(false);
 expect(hasExactMedicationCatalogIdentity("Sertraline 50 mg",catalogue)).toBe(false);
});

it("accepts only requested treatment values and maps them to the SQL gate keys",()=>{
 expect(groundTreatmentChanges({dose:"50",doseUnit:"mg",frequency:"deux fois par jour"},"Passe la sertraline de 25 mg à 50 mg et prends-la deux fois par jour.")).toEqual({dose:"50",dose_unit:"mg",frequency:"deux fois par jour"});
 expect(()=>groundTreatmentChanges({dose:"25",doseUnit:"mg"},"Passe la sertraline de 25 mg à 50 mg.")).toThrow();
 expect(()=>groundTreatmentChanges({instructions:"au coucher"},"Augmente la sertraline à 50 mg.")).toThrow();
});

it("does not reinterpret a tablet strength as the prescribed treatment dose",()=>{
 expect(()=>groundTreatmentChanges({dose:"50",doseUnit:"mg"},"Remplace la Sertraline par un comprimé de 50 mg.")).toThrow("UnrequestedTreatmentDose");
});

it("does not treat a negated missing-dose statement as permission to write a dose",()=>{
 expect(()=>groundTreatmentChanges({dose:"50",doseUnit:"mg"},"La dose quotidienne n'est pas précisée; garde la force de 50 mg du comprimé sans changer le traitement.")).toThrow("UnrequestedTreatmentDose");
});

it("does not treat a negated dose command as permission to write tablet strength",()=>{
 expect(()=>groundTreatmentChanges({dose:"50",doseUnit:"mg"},"Ne change pas la dose; remplace uniquement le comprimé par une unité de 50 mg.")).toThrow("UnrequestedTreatmentDose");
});

it("does not change a treatment dose unit without its numeric dose",()=>{
 expect(()=>groundTreatmentChanges({doseUnit:"g"},"Change uniquement l'unité de la dose en g.")).toThrow("TreatmentDoseUnitRequiresDose");
});

it("does not admit formulation or route as treatment write fields",()=>{
 expect(()=>groundTreatmentChanges({formulation:"solution buvable"},"Change la formulation en solution buvable.")).toThrow();
 expect(()=>groundTreatmentChanges({route:"orale"},"Change la voie d'administration vers la voie orale.")).toThrow();
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
