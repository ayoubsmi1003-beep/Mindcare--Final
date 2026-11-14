import {describe,it,expect} from "vitest";
import {setDailyFrequency,dailyFrequency,setMedicationName,confirmSpecialSchedule,setMedicationInstructions} from "@/components/documents/prescription-fields";
describe("two-field prescription entry",()=>{
 it("prints exactly the doctor's daily count without inventing a dose",()=>{const attrs=setDailyFrequency({designation:"Medicine test",posology:"",frequency:"",strength:""},"3");expect(attrs.posology).toBe("3 fois par jour");expect(attrs.frequency).toBe("");expect(attrs.strength).toBe("");expect(dailyFrequency(attrs)).toBe("3");});
 it("keeps frequency missing until a positive whole count is entered",()=>{for(const value of ["","0","-1","1.5","abc"])expect(setDailyFrequency({},value).posology).toBe("");});
 it("preserves clinical instructions when the selected medicine name changes",()=>{
  expect(setMedicationName({source:"catalogue",medicationId:"previous-id",strength:"50 mg",posology:"2 fois par jour",quantity:"60",frequency:"1 comprimé matin et soir",duration:"30 jours",administration:"orale",instructions:"Dose prescrite : 50 mg\nAvec le repas"},"New medicine")).toMatchObject({
   source:"free-text",medicationId:null,designation:"New medicine",strength:"",posology:"2 fois par jour",quantity:"60",frequency:"1 comprimé matin et soir",duration:"30 jours",administration:"orale",instructions:"Dose prescrite : 50 mg\nAvec le repas",
  });
 });
 it("does not erase an existing special schedule when entering a daily count",()=>{
  expect(setDailyFrequency({frequency:"si besoin",instructions:"Avec le repas"},"2").instructions).toContain("si besoin");
 });
 it("does not repeat the same daily frequency in the instructions",()=>{
  expect(setDailyFrequency({frequency:"3",posology:"3 fois par jour"},"2").instructions).toBe("");
 });
 it("requires explicit confirmation of a special schedule and preserves it across JSON persistence",()=>{
  const attrs={frequency:"Un demi-comprimé si besoin",posology:"",instructions:"Maximum deux prises par semaine"};
  const confirmed=confirmSpecialSchedule(attrs,true);
  expect(confirmed).toMatchObject({frequency:"",posology:attrs.frequency,instructions:attrs.instructions});
  const reopened=JSON.parse(JSON.stringify(confirmed));
  expect(dailyFrequency(reopened)).toBe("");
  expect(confirmSpecialSchedule(reopened,false)).toEqual(attrs);
 });
});

it("preserves a confirmed special posology when switching to daily frequency",()=>{
 const confirmed=confirmSpecialSchedule({frequency:"si besoin",instructions:"Avec le repas"},true);
 expect(setDailyFrequency(confirmed,"2").instructions).toContain("si besoin");
});

it("requires renewed confirmation after entering contradictory instructions",()=>{
 const next=setMedicationInstructions({posology:"2 fois par jour",frequency:""},"Chaque dimanche");
 expect(next.posology).toBe("");expect(next.frequency).toBe("2 fois par jour");expect(next.instructions).toBe("Chaque dimanche");
 expect(setDailyFrequency(next,"3").posology).toBe("");
});
