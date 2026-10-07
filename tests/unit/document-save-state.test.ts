import {describe,it,expect} from "vitest";

import { recoverDraft } from "@/components/documents/document-recovery";

import { saveState } from "@/components/documents/document-save-state";

describe("document save state",()=>{

 it("retains edits made while saving",()=>{let s=saveState({generation:1,edit:1,saved:0,saving:null,conflict:false}, {type:"start",generation:1});s=saveState(s,{type:"edit"});s=saveState(s,{type:"ack",generation:1,edit:1});expect(s.edit).toBe(2);expect(s.saved).toBe(1);});

 it("ignores acknowledgements for another draft generation",()=>{const s={generation:2,edit:3,saved:2,saving:3,conflict:false};expect(saveState(s,{type:"ack",generation:1,edit:3})).toEqual(s);});

 it("keeps unsaved content after failure and freezes conflict",()=>{const s={generation:1,edit:1,saved:0,saving:1,conflict:false};expect(saveState(s,{type:"failure",generation:1}).saved).toBe(0);expect(saveState(s,{type:"conflict",generation:1}).conflict).toBe(true);});

 it("allows only one in-flight write",()=>{const s={generation:1,edit:2,saved:1,saving:2,conflict:false};expect(saveState(s,{type:"start",generation:1})).toEqual(s);});

});



it("conflict recovery keeps local text only after an explicit choice and uses the current revision",()=>{const latest:import("@/shared/documents/types").Draft={id:"a",patientId:"p",kind:"justification",templateId:"t",templateVersion:1,revision:8,content:{type:"doc",content:[]},variables:{v:"server"},documentDate:"2026-10-07",rendererVersion:"v1",issuedDocumentId:null,archivedAt:null,title:"Test",patientName:"Test"}; const local={...latest,revision:7,variables:{v:"local"}};expect(recoverDraft(latest,local,true).variables.v).toBe("local");expect(recoverDraft(latest,local,true).revision).toBe(8);expect(recoverDraft(latest,local,false)).toEqual(latest);});

