import { describe,it,expect } from "vitest";

import { parseDraftResponse,parsePreviewResponse,parseIssuedResponse,issueDraft } from "@/services/document-drafts";

const draft={id:"d3000000-0000-4000-8000-000000000001",patientId:"d2000000-0000-4000-8000-000000000001",kind:"justification",templateId:"d4000000-0000-4000-8000-000000000001",templateVersion:3,content:{type:"doc",content:[]},variables:{date_consultation:"07/10/2026"},revision:2,documentDate:"2026-10-07",rendererVersion:"v1",issuedDocumentId:null,archivedAt:null,title:"Justification",patientName:"Synthetic Test"};

describe("document service response boundary",()=>{

 it("keeps civil date and exact edited content",()=>{expect(parseDraftResponse(draft)).toEqual(draft);});

 it("rejects unknown document types and unsafe persisted content",()=>{expect(()=>parseDraftResponse({...draft,kind:"unknown"})).toThrow();expect(()=>parseDraftResponse({...draft,content:{type:"doc",content:[{type:"script"}]}})).toThrow();});

 it("refuses timestamps pretending to be civil dates",()=>{expect(()=>parseDraftResponse({...draft,documentDate:"2026-10-06T23:00:00Z"})).toThrow();});

 it("keeps readiness reasons and exact preview revision",()=>{

  const preview={draftId:draft.id,revision:2,rendererVersion:"v1",contentHash:"a".repeat(64),identityVersion:"b".repeat(64),html:"<p>Texte</p>",content:draft.content,readiness:{canIssue:false,reasons:["patient-sex-missing"]}};

  expect(parsePreviewResponse(preview)).toEqual(preview);expect(()=>parsePreviewResponse({...preview,readiness:{canIssue:false,reasons:["raw-sql-error"]}})).toThrow();

 });

 it("coerces SQL revision but requires a real issued number and canonical pages",()=>{

  const issued={documentId:draft.id,draftId:draft.id,revision:"2",contentHash:"a".repeat(64),rendererVersion:"v1",html:"<article></article>",manifest:{rendererVersion:"v1",contentHash:"b".repeat(64),revision:2,pages:[[{path:[0],from:0,to:1}]]},docNumber:"DOC-2026-00001"};

  expect(parseIssuedResponse(issued).revision).toBe(2);expect(()=>parseIssuedResponse({...issued,docNumber:""})).toThrow();

 });

});



it("returns a safe Result for an invalid manifest instead of throwing",async()=>{const result=await issueDraft({draftId:draft.id,revision:2,contentHash:"a".repeat(64),identityVersion:"b".repeat(64),rendererVersion:"v1",html:"",content:{type:"doc",content:[]},readiness:{canIssue:true,reasons:[]}},{rendererVersion:"v1",contentHash:"a".repeat(64),pages:[]});expect(result.ok).toBe(false);});

