import {beforeEach,expect,it,vi} from 'vitest';
import type {EtatConversationPublique} from '@/services/conversation';
// Cold module imports can exceed 30 seconds on the qualification PC.
vi.setConfig({testTimeout:120000});
const boundary=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('@/services/db',()=>({db:()=>({rpc:boundary.rpc})}));
vi.mock('@/services/alexa-local',()=>({abonnerPropositionVoixLocale:()=>()=>{},abonnerTourVoixLocale:()=>()=>{},arreterVoixLocale:()=>{}}));
const conversationId='a1000000-0000-4000-8000-000000000001';
const history={conversationId,messages:[{rang:1,role:'humain',contenu:'Combien de patients ?',outil:null,statut:'complet',createdAt:'2026-10-16T12:00:00Z'},{rang:2,role:'jarvis',contenu:'32 patients.',outil:{version:1,events:[{type:'sentence',sources:[]},{type:'done',status:'completed',parts:[{id:'p1',goal:'Compter',conditions:[],dependsOn:[],status:'answered',resultRefs:['c1']}],patientId:null,speechAllowed:false}]},statut:'complet',createdAt:'2026-10-16T12:00:01Z'}]};
beforeEach(()=>{vi.resetModules();boundary.rpc.mockReset();});
async function setup(){const api=await import('@/services/conversation');let state:EtatConversationPublique|undefined;const stop=api.abonnerConversation(s=>{state=s;});return {api,get state(){return state;},stop};}
it('restores the actor-owned conversation on a fresh page before a local ID exists',async()=>{
 boundary.rpc.mockResolvedValue({ok:true,data:[history]});const h=await setup();try{await h.api.chargerHistorique();expect(boundary.rpc).toHaveBeenCalledExactlyOnceWith('get_jarvis_history',{p_limit:50});expect(h.state?.conversationId).toBe(conversationId);expect(h.state?.tours.map(t=>t.texte)).toEqual(['Combien de patients ?','32 patients.']);expect(new Set(h.state?.tours.map(t=>t.id)).size).toBe(2);expect(h.state?.tours[1]?.alexaStatus).toBe('completed');const transport=await import('@/services/alexa-turn');expect(await transport.ensureAlexaConversation()).toBe(conversationId);expect(boundary.rpc).toHaveBeenCalledTimes(1);}finally{h.stop();}
});
it('does not let a history response restore context after an explicit purge',async()=>{
 let resolve!:(value:unknown)=>void;boundary.rpc.mockReturnValue(new Promise(done=>{resolve=done;}));const h=await setup();try{const pending=h.api.chargerHistorique();expect(boundary.rpc).toHaveBeenCalledTimes(1);h.api.purgerContexteSession();resolve({ok:true,data:[history]});await pending;expect(h.state?.tours).toHaveLength(0);expect(h.state?.conversationId).toBeNull();expect(h.state?.chargementHistorique).toBe(false);}finally{h.stop();}
});
it('coalesces concurrent initial history reads and leaves restored turns intact',async()=>{
 let resolve!:(value:unknown)=>void;boundary.rpc.mockReturnValue(new Promise(done=>{resolve=done;}));const h=await setup();try{const first=h.api.chargerHistorique(),second=h.api.chargerHistorique();expect(boundary.rpc).toHaveBeenCalledTimes(1);resolve({ok:true,data:[history]});await Promise.all([first,second]);await h.api.chargerHistorique();expect(boundary.rpc).toHaveBeenCalledTimes(1);expect(h.state?.tours).toHaveLength(2);}finally{h.stop();}
});
it('keeps a fresh empty account empty without creating a conversation',async()=>{
 boundary.rpc.mockResolvedValue({ok:true,data:[{conversationId:null,messages:[]}]});const h=await setup();try{await h.api.chargerHistorique();expect(boundary.rpc).toHaveBeenCalledTimes(1);expect(h.state?.tours).toHaveLength(0);expect(h.state?.conversationId).toBeNull();expect(h.state?.chargementHistorique).toBe(false);}finally{h.stop();}
});
it('reports a history failure while keeping the text workflow available',async()=>{
 boundary.rpc.mockResolvedValue({ok:false,error:{code:'indisponible',message:'Lecture synthétique indisponible'}});const h=await setup();try{await h.api.chargerHistorique();expect(h.state?.erreur?.code).toBe('indisponible');expect(h.state?.chargementHistorique).toBe(false);h.api.changerSaisie('Nouvelle demande');expect(h.state?.saisie).toBe('Nouvelle demande');}finally{h.stop();}
});

it('clears restored messages on session purge and admits only the next actor-owned history',async()=>{
 const nextId='a2000000-0000-4000-8000-000000000001';boundary.rpc.mockResolvedValueOnce({ok:true,data:[history]}).mockResolvedValueOnce({ok:true,data:[{conversationId:nextId,messages:[{rang:1,role:'humain',contenu:'Autre session synthétique',outil:null,statut:'complet',createdAt:'2026-10-16T12:01:00Z'}]}]});const h=await setup();try{await h.api.chargerHistorique();h.api.purgerContexteSession();expect(h.state?.tours).toHaveLength(0);expect(h.state?.conversationId).toBeNull();expect(h.state?.carteEcriture).toBeNull();await h.api.chargerHistorique();expect(boundary.rpc).toHaveBeenCalledTimes(2);expect(h.state?.conversationId).toBe(nextId);expect(h.state?.tours.map(t=>t.texte)).toEqual(['Autre session synthétique']);}finally{h.stop();}
});
