import {describe,expect,it} from "vitest";

import {
  buildAutoFillSource,
  buildInitialContent,
  buildInitialVariables,
  parseExplicitDailyFrequency,
  treatmentValues,
  withTreatmentCount,
  type AutoFillSource,
} from "@/components/documents/document-autofill";
import type {TraitementV2} from "@/services/patients";
import type {DocumentContent} from "@/shared/documents/types";

const TODAY="2026-10-22";

function treatment(overrides:Partial<TraitementV2>={}):TraitementV2{
  return {
    id:"t1",status:"active",dose:null,doseUnit:null,frequency:null,timing:[],instructions:null,
    startDate:"2026-10-01",endDate:null,stoppedAt:null,stoppedReason:null,currentVersion:1,
    createdAt:"2026-10-01T00:00:00Z",updatedAt:null,medicationId:"m1",medicationRaw:"ZOLOFT 50 mg gél",
    brandName:null,form:"gél",strength:"50 mg",inn:"sertraline",...overrides,
  };
}

function source(overrides:Partial<AutoFillSource>={}):AutoFillSource{
  return {
    idDocumentNumber:"113255751",idDocumentIssuer:"Mairie d’Alger",birthDate:"1995-11-10",today:TODAY,
    activeTreatments:[],lastPrescription:null,...overrides,
  };
}

const baseContent:DocumentContent={type:"doc",content:[{type:"paragraph",content:[]}]};

describe("auto-remplissage des documents",()=>{
  it("reprend l’identité, la mairie et la date du dossier",()=>{
    expect(buildInitialVariables("bonne_sante_mentale",source())).toEqual({id_document_number:"113255751",mairie:"Mairie d’Alger"});
    expect(buildInitialVariables("certificat_medical",source())).toMatchObject({date_naissance:"10/11/1995"});
    expect(buildInitialVariables("suivi_medical",source())).toMatchObject({date_debut:"22/10/2026",jours:""});
    expect(buildInitialVariables("justification",source())).toEqual({date_consultation:"22/10/2026"});
  });

  it("laisse vides les valeurs absentes au lieu d’inventer",()=>{
    const variables=buildInitialVariables("bonne_sante_mentale",source({idDocumentNumber:"",idDocumentIssuer:""}));
    expect(variables).toEqual({id_document_number:"",mairie:""});
    expect(buildInitialVariables("certificat_medical",source({birthDate:null}))["date_naissance"]).toBe("");
  });

  it("ne reconnaît que les fréquences quotidiennes explicites",()=>{
    expect(parseExplicitDailyFrequency("2 fois par jour")).toBe(2);
    expect(parseExplicitDailyFrequency("3 prises / jour")).toBe(3);
    expect(parseExplicitDailyFrequency("1/jour")).toBe(1);
    expect(parseExplicitDailyFrequency("matin et soir")).toBeNull();
    expect(parseExplicitDailyFrequency("50 mg")).toBeNull();
    expect(parseExplicitDailyFrequency("")).toBeNull();
  });

  it("déduplique les traitements actifs et ignore les traitements arrêtés",()=>{
    const data=source({activeTreatments:[
      treatment({id:"t1"}),
      treatment({id:"t2",medicationId:"m1"}),
      treatment({id:"t3",status:"stopped",medicationId:"m2",medicationRaw:"AUTRE"}),
    ]});
    expect(treatmentValues(buildInitialVariables("certificat_medical",data))).toEqual(["ZOLOFT 50 mg gél"]);
  });

  it("prépare une ordonnance avec toutes les lignes, sans deviner la fréquence",()=>{
    const data=source({
      activeTreatments:[
        treatment({id:"t1",medicationId:"m1",medicationRaw:"ZOLOFT 50 mg gél",frequency:"2 fois par jour"}),
        treatment({id:"t2",medicationId:"m2",medicationRaw:"LEXOMIL 6 mg",frequency:"matin et soir"}),
      ],
      lastPrescription:{id:"p1",prescribedAt:"2026-10-20T00:00:00Z",isHandwritten:false,practitionerName:null,lignes:[
        {id:"l1",designation:"ZOLOFT 50 mg gél",brandName:null,dose:null,frequencyPerDay:2,durationDays:null,instructions:null},
        {id:"l2",designation:"LEXOMIL 6 mg",brandName:null,dose:null,frequencyPerDay:null,durationDays:null,instructions:null},
      ]},
    });
    const content=buildInitialContent("ordonnance",baseContent,data);
    const meds=content.content.filter(node=>node.type==="medication");
    expect(meds).toHaveLength(2);
    expect(meds[0]?.attrs?.["designation"]).toBe("ZOLOFT 50 mg gél");
    expect(meds[0]?.attrs?.["posology"]).toBe("2 fois par jour");
    expect(meds[1]?.attrs?.["designation"]).toBe("LEXOMIL 6 mg");
    expect(meds[1]?.attrs?.["posology"]).toBe("");
  });

  it("construit une puce de certificat par traitement actif",()=>{
    const data=source({activeTreatments:[
      treatment({id:"t1",medicationId:"m1",medicationRaw:"A",frequency:"1 fois par jour"}),
      treatment({id:"t2",medicationId:"m2",medicationRaw:"B"}),
      treatment({id:"t3",medicationId:"m3",medicationRaw:"C"}),
    ]});
    const variables=buildInitialVariables("certificat_medical",data);
    expect(treatmentValues(variables)).toEqual(["A — 1 fois par jour","B","C"]);
    const content=withTreatmentCount({type:"doc",content:[{type:"paragraph",content:[{type:"text",text:"Avant"}]},{type:"bulletList",content:[{type:"listItem",content:[{type:"paragraph",content:[{type:"field",attrs:{name:"vars_traitement_1",value:""}}]}]}]}]},3);
    expect(content.content[0]).toMatchObject({type:"paragraph"});
    expect(content.content[1]).toMatchObject({type:"bulletList"});
    expect(content.content[1]?.content).toHaveLength(3);
  });
});
