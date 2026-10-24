import {expect,it,vi} from 'vitest';
import {agentExecutor} from '@/server/alexa/agent-tools';
import {agentSchemas} from '@/shared/alexa/agent';
import {scriptedAlexaRpc} from '../helpers/alexa-rpc';
const patient='22222222-2222-4222-8222-222222222222';
const input={text:'Lis les panneaux financiers demandés.',conversationId:'finance-panels',clientTurnId:'11111111-1111-4111-8111-111111111111',appContext:{patientId:null,page:'/finances'}};
const asOf='2026-10-15T12:00:00.000Z';
const source=()=>({du:'2026-10-01',au:'2026-10-31',composition:{revenus_par_type:[{cle:'suivi',libelle:'suivi',montant:5000,nb_seances:3,part_pct:83.3}],charges_par_categorie:[{cle:'loyer',libelle:'loyer',montant:1200,part_pct:100}]},evolution:Array.from({length:6},(_,i)=>({mois_iso:'2026-'+String(i+5).padStart(2,'0'),mois_label:'Mois fictif '+i,revenu:5000+i,charges:1200,resultat_net:3800+i})),calendrier:Array.from({length:31},(_,i)=>({jour_iso:'2026-10-'+String(i+1).padStart(2,'0'),montant:i===14?5000:0,nb_seances:i===14?3:0,a_impaye:i===15})),calendrier_par_type:{types:[{cle:'suivi',libelle:'suivi'},{cle:'autres',libelle:'autres'}],lignes:Array.from({length:31},(_,i)=>[{jour_iso:'2026-10-'+String(i+1).padStart(2,'0'),cle:'suivi',nb:i===14?2:0},{jour_iso:'2026-10-'+String(i+1).padStart(2,'0'),cle:'autres',nb:i===14?1:0}]).flat()},attention:{impayes_total:2000,impayes_count:1,plus_ancien_impaye_jours:15,echeances_a_venir:[{intitule:'Charge fictive',montant:1200,date_echeance:'2026-10-20',jours_restants:5}]}});
function run(mode:string,raw:unknown=source(),offset=0){const rpc=scriptedAlexaRpc(async()=>({ok:true as const,data:[raw]}));return {rpc,result:agentExecutor(input,{rpc},{rpc:vi.fn()})({id:'p',name:'query_finance',args:{partIds:['p'],mode,period:'ce mois',offset}},asOf,[],new AbortController().signal)};}
it.each(['composition','calendar'])('labels SQL payment-row counts rather than claiming distinct consultations: %s',async mode=>{
 const r=await run(mode).result;
 expect(r.text).toContain('3 paiements encaissés');expect(r.text).not.toMatch(/3 séance/iu);
 if(mode==='calendar')expect(r.text).toContain('encore impayés à la date de lecture');
});
it('reads stored financial composition without recalculating percentages or losing categories',async()=>{
 const {result,rpc}=run('composition'),r=await result;expect(r.complete).toBe(true);expect(r.data).toMatchObject({composition:source().composition});expect(r.text).toContain('83.3 %');expect(r.text).toContain('5000 DZD');expect(r.text).toContain('1200 DZD');expect(rpc).toHaveBeenCalledExactlyOnceWith('get_finance_overview',{p_period_start:'2026-10-01',p_period_end:'2026-10-31'});
});
it('labels evolution as the six months ending at database today, not the requested period or frozen task time',async()=>{
 const r=await run('evolution').result;expect(r.complete).toBe(true);expect(r.text).toContain('Six mois');expect(r.text).toContain('date courante de la base');expect(r.data).toHaveProperty('evolution',source().evolution);expect(r.data).not.toHaveProperty('composition');
});
it('pages daily cash and the same days of the SQL grouped type calendar together',async()=>{
 const first=await run('calendar').result,last=await run('calendar',source(),20).result;
 expect(first.status).toBe('partial');expect(first.complete).toBe(false);expect(first.data).toMatchObject({total:31,offset:0,hasMore:true});expect(first.data).toHaveProperty('calendrier_par_type.lignes',source().calendrier_par_type.lignes.slice(0,40));expect(first.text).toContain('5000 DZD');expect(first.text).toContain('autres');
 expect(last.complete).toBe(true);expect(last.data).toMatchObject({total:31,offset:20,hasMore:false});expect(last.data).toHaveProperty('calendrier',source().calendrier.slice(20));expect(last.text).not.toContain('5000 DZD');
});
it('labels attention as all-date debt and only the three displayed upcoming deadlines, anchored to the database clock',async()=>{
 const raw=source();raw.attention.echeances_a_venir=Array.from({length:3},()=>raw.attention.echeances_a_venir[0]!);const r=await run('attention',raw).result;
 expect(r.complete).toBe(false);expect(r.status).toBe('partial');expect(r.text).toContain('trois');expect(r.text).toContain('date courante de la base');expect(r.text).toContain('toutes dates');expect(r.text).toContain('2000 DZD');expect(r.data).toHaveProperty('deadlineLimit',3);
});
it('reports an empty attention panel without inventing future deadlines',async()=>{const raw=source();raw.attention={impayes_total:0,impayes_count:0,plus_ancien_impaye_jours:0,echeances_a_venir:[]};const r=await run('attention',raw).result;expect(r.complete).toBe(true);expect(r.text).toContain('Aucune échéance');expect(r.text).not.toContain('Charge fictive');});
it.each(['composition','evolution','calendar','attention'])('blocks patient/state filters for cabinet %s rather than ignoring them',mode=>{for(const filter of [{patientId:patient},{patientName:'Fictif'},{state:'pending'}])expect(agentSchemas.query_finance.safeParse({partIds:['p'],mode,period:'ce mois',...filter}).success).toBe(false);});
it.each(['composition','evolution','attention'])('rejects an ignored pagination offset for %s',mode=>{expect(agentSchemas.query_finance.safeParse({partIds:['p'],mode,period:'ce mois',offset:20}).success).toBe(false);});
it.each(['composition','evolution','calendar','attention'])('does not turn a denied %s read into zeros',async mode=>{await expect(run(mode,null).result).rejects.toMatchObject({code:'permission'});});
it('rejects mismatched period evidence and malformed money',async()=>{const raw=source();raw.du='2026-09-01';await expect(run('composition',raw).result).rejects.toBeDefined();const invalid=source();invalid.composition.revenus_par_type[0]!.montant=-1;await expect(run('composition',invalid).result).rejects.toBeDefined();});
it('keeps waiting-room status and pagination in one authorized agenda query',async()=>{
 const rpc=scriptedAlexaRpc(async()=>({ok:true as const,data:[{total:23,rows:[],totals:{},complete:true,offset:20}]}));
 const request={...input,text:'Liste les rendez-vous arrivés aujourd’hui, page 2.'};
 const r=await agentExecutor(request,{rpc},{rpc:vi.fn()})({id:'w',name:'query_agenda',args:{partIds:['w'],period:"aujourd'hui",statuses:['arrived'],offset:20}},asOf,[],new AbortController().signal);
 expect(r.data).toMatchObject({total:23,offset:20,hasMore:true});expect(rpc.mock.calls[0]?.[0]).toBe('query_alexa_records');expect(JSON.parse(String(rpc.mock.calls[0]?.[1]?.['p_spec']))).toMatchObject({statuses:['arrived'],offset:20,from:'2026-10-15T00:00:00+01:00',to:'2026-10-16T00:00:00+01:00'});
});

it('recognizes the actual PostgreSQL adapter empty-array representation of a denied finance gate',async()=>{const rpc=scriptedAlexaRpc(async()=>({ok:true as const,data:[]}));await expect(agentExecutor(input,{rpc},{rpc:vi.fn()})({id:'p',name:'query_finance',args:{partIds:['p'],mode:'composition',period:'ce mois'}},asOf,[],new AbortController().signal)).rejects.toMatchObject({code:'permission'});});

it('renders French financial type labels while retaining exact SQL identifiers in evidence data',async()=>{
 const raw=source();raw.composition.revenus_par_type[0]!.cle='__non_rattache__';raw.composition.revenus_par_type[0]!.libelle='__non_rattache__';raw.calendrier_par_type.types[0]!.cle='__non_rattache__';raw.calendrier_par_type.types[0]!.libelle='__non_rattache__';for(const line of raw.calendrier_par_type.lignes)if(line.cle==='suivi')line.cle='__non_rattache__';
 for(const mode of ['composition','calendar']){const r=await run(mode,raw).result;expect(r.text).toContain('Paiement sans rendez-vous lié');expect(r.text).not.toContain('Séance non rattachée');expect(r.text).not.toContain('__non_rattache__');expect(JSON.stringify(r.data)).toContain('__non_rattache__');}
});
