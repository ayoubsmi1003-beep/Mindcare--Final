import {expect,it} from "vitest";
import {mergeDraftVariableChanges} from "@/server/alexa/document-draft-update";

const draft={
 variables:{motif:"ancienne valeur",jours:"14",date_debut:"20/10/2026"},
 content:{type:"doc" as const,content:[
  {type:"paragraph" as const,content:[{type:"field" as const,attrs:{name:"motif",value:"ancienne valeur"}},{type:"text" as const,text:" texte conservé"}]},
  {type:"paragraph" as const,content:[{type:"field" as const,attrs:{name:"jours",value:"14"}}]},
 ]},
};

it("changes only named existing draft fields and retains the rest of the template",()=>{
 const updated=mergeDraftVariableChanges(draft,{motif:"suivi demandé"});
 expect(updated.variables).toEqual({motif:"suivi demandé",jours:"14",date_debut:"20/10/2026"});
 expect(updated.content.content[0]).toEqual({type:"paragraph",content:[{type:"field",attrs:{name:"motif",value:"suivi demandé"}},{type:"text",text:" texte conservé"}]});
 expect(updated.content.content[1]).toEqual(draft.content.content[1]);
 expect(draft.variables.motif).toBe("ancienne valeur");
});

it("refuses empty or unknown field changes",()=>{
 expect(()=>mergeDraftVariableChanges(draft,{})).toThrow();
 expect(()=>mergeDraftVariableChanges(draft,{patient_name:"inventé"})).toThrow();
});
