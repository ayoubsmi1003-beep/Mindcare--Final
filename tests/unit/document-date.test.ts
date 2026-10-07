import { describe, it, expect } from "vitest";
import { dateCivilePg } from "@/server/db/pool";
describe("date civile PostgreSQL",()=>{
  it.each(["UTC","Africa/Algiers","America/Los_Angeles"])("keeps birth date unchanged under %s",timezone=>{
    const before=process.env["TZ"];
    try {process.env["TZ"]=timezone;expect(dateCivilePg("2000-01-15")).toBe("2000-01-15");}
    finally {if(before===undefined)delete process.env["TZ"];else process.env["TZ"]=before;}
  });
});
