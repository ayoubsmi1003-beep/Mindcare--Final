import {describe,it,expect} from "vitest";
import {setDailyFrequency,dailyFrequency,setMedicationName} from "@/components/documents/prescription-fields";
describe("two-field prescription entry",()=>{
 it("prints exactly the doctor's daily count without inventing a dose",()=>{const attrs=setDailyFrequency({designation:"Medicine test",posology:"",frequency:"",strength:""},"3");expect(attrs.posology).toBe("3 fois par jour");expect(attrs.frequency).toBe("");expect(attrs.strength).toBe("");expect(dailyFrequency(attrs)).toBe("3");});
 it("keeps frequency missing until a positive whole count is entered",()=>{for(const value of ["","0","-1","1.5","abc"])expect(setDailyFrequency({},value).posology).toBe("");});
 it("clears medication-specific fields when the selected medicine name changes",()=>{
  expect(setMedicationName({source:"catalogue",medicationId:"previous-id",strength:"50 mg",posology:"2 fois par jour",quantity:"60",frequency:"1 comprimé matin et soir",duration:"30 jours",administration:"orale",instructions:"Dose prescrite : 50 mg\nAvec le repas"},"New medicine")).toMatchObject({
   source:"free-text",medicationId:null,designation:"New medicine",strength:"",posology:"",quantity:"",frequency:"",duration:"",administration:"",instructions:"",
  });
 });
});
