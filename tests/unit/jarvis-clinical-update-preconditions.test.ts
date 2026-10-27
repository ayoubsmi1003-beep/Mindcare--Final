import {beforeEach,expect,it,vi} from "vitest";

const mocks=vi.hoisted(()=>({getPatient:vi.fn(),getPatientTreatments:vi.fn(),getTreatmentHistory:vi.fn(),getDraft:vi.fn(),getConsultation:vi.fn()}));
vi.mock("@/services/patients",()=>({getPatient:mocks.getPatient}));
vi.mock("@/services/patient-treatments",()=>({getPatientTreatments:mocks.getPatientTreatments,getTreatmentHistory:mocks.getTreatmentHistory}));
vi.mock("@/services/document-drafts",()=>({getDraft:mocks.getDraft}));
vi.mock("@/services/consultations",()=>({getConsultation:mocks.getConsultation}));

import {capaciteEcriture} from "@/services/jarvis-ecritures";
import {CarteIdentite} from "@/services/jarvis-identite";
import {ok} from "@/services/result";

const patientId="22222222-2222-4222-8222-222222222222",treatmentId="44444444-4444-4444-8444-444444444444",draftId="33333333-3333-4333-8333-333333333333";
const treatment={id:treatmentId,patientId,medicationId:"55555555-5555-4555-8555-555555555555",medicationRaw:"Sertraline",brandName:null,form:null,strength:null,inn:"Sertraline",consultationId:null,previousTreatmentId:null,status:"active" as const,dose:"25",doseUnit:"mg",frequency:"une fois par jour",timing:["matin"],instructions:null,startDate:"2026-10-01",endDate:null,stoppedAt:null,stoppedReason:null,currentVersion:5,createdAt:"2026-10-01T10:00:00Z",updatedAt:"2026-10-26T10:00:00Z"};
const draft={id:draftId,patientId,kind:"certificat_medical" as const,templateId:"66666666-6666-4666-8666-666666666666",templateVersion:2,content:{type:"doc" as const,content:[{type:"paragraph" as const,content:[{type:"field" as const,attrs:{name:"motif",value:"ancien"}}]}]},variables:{motif:"ancien"},revision:4,documentDate:"2026-10-01",rendererVersion:"v2",issuedDocumentId:null,archivedAt:null,title:"Certificat médical",patientName:"Nadia Test"};
const identity=Object.assign(new CarteIdentite(),{rendre:(id:string)=>id===patientId?"Nadia Test":id===treatmentId?"Sertraline":id});

beforeEach(()=>{vi.clearAllMocks();mocks.getPatient.mockResolvedValue(ok({id:patientId}));mocks.getPatientTreatments.mockResolvedValue(ok({actifs:[treatment],enPause:[],arretesRecents:[],totalActifs:1,total:1}));mocks.getDraft.mockResolvedValue(ok(draft));});

it("blocks a treatment proposal when the live version differs from the proposal version",async()=>{
 const capability=capaciteEcriture("update_treatment");expect(capability).not.toBeNull();
 const prepared=await capability!.preparer({patientId,treatmentId,expectedVersion:4,changes:JSON.stringify({dose:"50",dose_unit:"mg"}),consultationId:null},identity);
 expect(prepared.ok).toBe(false);if(!prepared.ok)expect(prepared.error.message).toContain("changé depuis sa lecture");
});

it("blocks a discontinuation proposal when its target version is stale",async()=>{
 const capability=capaciteEcriture("stop_treatment");expect(capability).not.toBeNull();
 const prepared=await capability!.preparer({patientId,treatmentId,expectedVersion:4,reason:null,consultationId:null},identity);
 expect(prepared.ok).toBe(false);if(!prepared.ok)expect(prepared.error.message).toContain("changé depuis sa lecture");
});

it("blocks a draft edit when the editor has advanced its revision",async()=>{
 const capability=capaciteEcriture("update_editable_document_draft");expect(capability).not.toBeNull();
 const prepared=await capability!.preparer({patientId,draftId,documentType:"certificat_medical",expectedRevision:3,changes:JSON.stringify({motif:"nouveau"}),variables:JSON.stringify({motif:"nouveau"}),content:JSON.stringify(draft.content),documentDate:draft.documentDate},identity);
 expect(prepared.ok).toBe(false);if(!prepared.ok)expect(prepared.error.message).toContain("changé depuis sa lecture");
});
