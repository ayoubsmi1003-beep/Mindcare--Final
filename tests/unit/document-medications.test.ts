import {describe,it,expect} from "vitest";
import {setDailyFrequency,dailyFrequency,setMedicationName} from "@/components/documents/prescription-fields";
describe("two-field prescription entry",()=>{
 it("prints exactly the doctor's daily count without inventing a dose",()=>{const attrs=setDailyFrequency({designation:"Medicine test",posology:"",frequency:"",strength:""},"3");expect(attrs.posology).toBe("3 fois par jour");expect(attrs.frequency).toBe("");expect(attrs.strength).toBe("");expect(dailyFrequency(attrs)).toBe("3");});
 it("keeps frequency missing until a positive whole count is entered",()=>{for(const value of ["","0","-1","1.5","abc"])expect(setDailyFrequency({},value).posology).toBe("");});
 it("clears a catalogue binding when the doctor manually changes the medicine name",()=>{expect(setMedicationName({source:"catalogue",medicationId:"previous-id",posology:"2 fois par jour"},"New medicine")).toMatchObject({source:"free-text",medicationId:null,designation:"New medicine",posology:"2 fois par jour"});});
});
