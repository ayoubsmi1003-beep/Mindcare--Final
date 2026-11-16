import {describe,expect,it} from "vitest";

import {
  buildAutoFillSource,
  buildInitialContent,
  buildInitialVariables,
  parseExplicitDailyFrequency,
  explicitDailyFrequency,
  treatmentValues,
  withTreatmentCount,
  type AutoFillSource,
} from "@/components/documents/document-autofill";
import {dailyFrequency,prescribedDose,setDailyFrequency,setPrescribedDose} from "@/components/documents/prescription-fields";
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
    expect(meds[1]?.attrs?.["posology"]).toBe("2 fois par jour");
  });

  it("préfère la fréquence actuelle et conserve séparément force, dose et instructions",()=>{
    const data=source({
      activeTreatments:[treatment({medicationId:"m1",medicationRaw:"Sertraline 50 mg",inn:"sertraline",strength:"50 mg",dose:"25",doseUnit:"mg",frequency:"1 fois par jour",instructions:"À prendre le soir"})],
      lastPrescription:{id:"p-old",prescribedAt:"2026-10-01T00:00:00Z",isHandwritten:false,practitionerName:null,lignes:[
        {designation:"sertraline 25 mg",brandName:null,dose:"50",frequencyPerDay:2,durationDays:null,instructions:null},
      ]},
    });
    const medication=buildInitialContent("ordonnance",baseContent,data).content.find(node=>node.type==="medication");
    expect(medication?.attrs).toMatchObject({strength:"",posology:"1 fois par jour",instructions:"Dose prescrite : 25 mg\nÀ prendre le soir"});

    const withoutCurrentFrequency=buildInitialContent("ordonnance",baseContent,source({
      activeTreatments:[treatment({medicationId:"m1",medicationRaw:"Sertraline 50 mg",inn:"sertraline",strength:"50 mg",frequency:null})],
      lastPrescription:data.lastPrescription,
    })).content.find(node=>node.type==="medication");
    expect(withoutCurrentFrequency?.attrs?.["posology"]).toBe("");
  });

  it("counts certain intake moments, but never infers a daily schedule from ambiguous instructions",()=>{
    expect(explicitDailyFrequency(treatment({timing:["Matin","Soir"]}),null)).toBe(2);
    expect(explicitDailyFrequency(treatment({timing:["Matin","Midi","Soir"]}),null)).toBe(3);
    expect(explicitDailyFrequency(treatment({dose:"2",doseUnit:"comprimés",timing:["Matin"]}),null)).toBe(1);
    for(const frequency of ["si besoin","une fois par semaine","un jour sur deux","diminution progressive"]){
      expect(explicitDailyFrequency(treatment({frequency,timing:["Matin"]}),null)).toBeNull();
    }
    expect(explicitDailyFrequency(treatment({frequency:"3",timing:["Matin"]}),null)).toBe(3);
    expect(explicitDailyFrequency(treatment({frequency:"matin",instructions:"Chaque dimanche"}),null)).toBeNull();
  });

  it("retains distinct regimens of the same product",()=>{
    const data=source({activeTreatments:[treatment({frequency:"1 fois par jour"}),treatment({frequency:"2 fois par jour"})]});
    expect(buildInitialContent("ordonnance",baseContent,data).content.filter(n=>n.type==="medication")).toHaveLength(2);
  });

  it("keeps known strengths and quantities distinct without repeating product strength",()=>{
    const cases=[
      treatment({medicationRaw:"Produit synthétique",strength:"50 mg",frequency:"2 fois par jour"}),
      treatment({medicationId:"m2",medicationRaw:"Produit synthétique 50 mg",strength:"50 mg",dose:"0,5",doseUnit:"comprimé"}),
      treatment({medicationId:"m3",medicationRaw:"Association 50 mg / 2 mg",strength:"50 mg"}),
      treatment({medicationId:"m4",medicationRaw:"Solution 10 mg/ml",strength:"10 mg/ml"}),
    ];
    const rows=buildInitialContent("ordonnance",baseContent,source({activeTreatments:cases})).content.filter(n=>n.type==="medication");
    expect(rows.map(n=>n.attrs?.["designation"])).toEqual(["Produit synthétique 50 mg","Produit synthétique 50 mg","Association 50 mg / 2 mg","Solution 10 mg/ml"]);
    expect(rows.every(n=>n.attrs?.["strength"]==="")).toBe(true);
    expect(rows[1]?.attrs?.["instructions"]).toContain("0,5 comprimé");
    expect(rows[1]?.attrs?.["posology"]).toBe("");
  });

  it("permet de corriger la dose tout en préservant les instructions et le compte quotidien",()=>{
    const attrs={posology:"1 fois par jour",instructions:"Dose prescrite : 25 mg\nÀ prendre le soir"};
    expect(dailyFrequency(attrs)).toBe("1");
    expect(prescribedDose(attrs)).toBe("25 mg");
    expect(setPrescribedDose(attrs,"50 mg").instructions).toBe("Dose prescrite : 50 mg\nÀ prendre le soir");
    expect(setDailyFrequency(attrs,"2")).toMatchObject({posology:"2 fois par jour",instructions:attrs.instructions});
  });

  it("construit une puce de certificat par traitement actif",()=>{
    const data=source({activeTreatments:[
      treatment({id:"t1",medicationId:"m1",medicationRaw:"A",frequency:"1 fois par jour"}),
      treatment({id:"t2",medicationId:"m2",medicationRaw:"B"}),
      treatment({id:"t3",medicationId:"m3",medicationRaw:"C"}),
    ]});
    const variables=buildInitialVariables("certificat_medical",data);
    expect(treatmentValues(variables)).toEqual(["A 50 mg — 1 fois par jour","B 50 mg","C 50 mg"]);
    const content=withTreatmentCount({type:"doc",content:[{type:"paragraph",content:[{type:"text",text:"Avant"}]},{type:"bulletList",content:[{type:"listItem",content:[{type:"paragraph",content:[{type:"field",attrs:{name:"vars_traitement_1",value:""}}]}]}]}]},3);
    expect(content.content[0]).toMatchObject({type:"paragraph"});
    expect(content.content[1]).toMatchObject({type:"bulletList"});
    expect(content.content[1]?.content).toHaveLength(3);
  });
});

it("does not attach a single strength to an ambiguous association",()=>{
 const rows=buildInitialContent("ordonnance",baseContent,source({activeTreatments:[treatment({medicationRaw:"Produit A + produit B",strength:"50 mg"})]})).content.filter(n=>n.type==="medication");
 expect(rows[0]?.attrs?.["designation"]).toBe("Produit A + produit B");
});

it("requires review when a numeric frequency conflicts with weekly instructions",()=>{
 const row=buildInitialContent("ordonnance",baseContent,source({activeTreatments:[treatment({frequency:"1",timing:["matin"],instructions:"Chaque dimanche"})]})).content.find(n=>n.type==="medication");
 expect(row?.attrs?.["posology"]).toBe("");
 expect(row?.attrs?.["instructions"]).toContain("Chaque dimanche");
});

it("does not repeat a strength whose spacing differs from the designation",()=>{
 const row=buildInitialContent("ordonnance",baseContent,source({activeTreatments:[treatment({medicationRaw:"Produit synthétique 50mg",strength:"50 mg"})]})).content.find(n=>n.type==="medication");
 expect(row?.attrs?.["designation"]).toBe("Produit synthétique 50mg");
 expect(row?.attrs?.["strength"]).toBe("");
});

it("omits the two redundant strength lines while keeping a distinct prescribed dose",()=>{
 const rows=buildInitialContent("ordonnance",baseContent,source({activeTreatments:[
  treatment({medicationRaw:"Produit synthétique 7,5 mg cp",strength:"7.5 mg",dose:"7.5",doseUnit:"mg",frequency:"2",instructions:"Avec le repas"}),
  treatment({medicationRaw:"Produit synthétique 25 mg gél",strength:"25 mg",dose:"25",doseUnit:"mg",frequency:"2"}),
  treatment({medicationRaw:"Produit synthétique 50 mg",strength:"50 mg",dose:"0,5",doseUnit:"comprimé",instructions:"Le soir"}),
 ]})).content.filter(n=>n.type==="medication");
 expect(rows[0]?.attrs).toMatchObject({strength:"",instructions:"Avec le repas",posology:"2 fois par jour"});
 expect(rows[1]?.attrs).toMatchObject({strength:"",instructions:"",posology:"2 fois par jour"});
 expect(rows[2]?.attrs?.["instructions"]).toBe("Dose prescrite : 0,5 comprimé\nLe soir");
});

it("keeps unitless doses and doses of solutions or associations",()=>{
 const rows=buildInitialContent("ordonnance",baseContent,source({activeTreatments:[
  treatment({medicationRaw:"Gel synthétique 2 %",strength:"2 %",dose:"2",doseUnit:null}),
  treatment({medicationRaw:"Solution synthétique 10 mg/ml",strength:"10 mg/ml",dose:"10",doseUnit:"mg"}),
  treatment({medicationRaw:"Association synthétique 50 mg / 2 mg",strength:"50 mg",dose:"50",doseUnit:"mg"}),
 ]})).content.filter(n=>n.type==="medication");
 expect(rows.map(n=>n.attrs?.["instructions"])).toEqual(["Dose prescrite : 2","Dose prescrite : 10 mg","Dose prescrite : 50 mg"]);
});
