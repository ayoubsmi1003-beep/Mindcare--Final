import { expect, it, vi } from "vitest";
const {verify}=vi.hoisted(()=>({verify:vi.fn()}));
vi.mock("@/server/alexa/local-model-assets",async original=>({...await original<object>(),verifyLocalAssetAccess:verify}));

it("shares the single inference lease across independently loaded server route modules",async()=>{
 let unblock!:()=>void;const blocked=new Promise<void>(resolve=>{unblock=resolve;});
 verify.mockImplementation(async()=>{await blocked;throw Error("LocalModelIntegrity");});
 const firstModule=await import("@/server/alexa/local-model");
 const first=firstModule.inferLocalText([{role:"user",content:"Bonjour"}],{timeoutMs:5000}).catch((e:Error)=>e.message);
 await vi.waitFor(()=>expect(verify).toHaveBeenCalledTimes(1));
 vi.resetModules();
 const secondModule=await import("@/server/alexa/local-model");
 const second=secondModule.inferLocalText([{role:"user",content:"Bonjour"}],{timeoutMs:5000}).catch((e:Error)=>e.message);
 unblock();
 expect(await second).toBe("LocalModelBusy");
 expect(await first).toBe("LocalModelIntegrity");
 await firstModule.releaseLocalModel();await secondModule.releaseLocalModel();
});
