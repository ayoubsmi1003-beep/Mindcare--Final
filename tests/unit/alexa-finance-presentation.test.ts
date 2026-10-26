import {expect,it} from 'vitest';
import {presentAgentResults} from '@/server/alexa/answer-presentation';
import type {AgentResult} from '@/shared/alexa/agent';

const financeResult=(data:unknown):AgentResult=>({callId:'finance',status:'ok',complete:true,text:'raw structured finance values',conditionKeys:[],evidence:[],data});

it('answers a net-result question in one concise French paragraph',()=>{
 const answer=presentAgentResults([financeResult({du:'2026-10-01',au:'2026-10-31',pulse:{resultat_net_periode:-3500}})],'Quel est le résultat net du cabinet pour octobre 2026 ?');
 expect(answer).toHaveLength(1);expect(answer[0]).toContain('résultat net');expect(answer[0]).toContain('3 500 DZD');expect(answer[0]).not.toContain('raw structured');expect(answer[0]).not.toContain('\n');
});

it('summarizes the verified charge categories without dropping their amounts',()=>{
 const answer=presentAgentResults([financeResult({du:'2026-10-01',au:'2026-10-31',composition:{charges_par_categorie:[{cle:'loyer',montant:30000,part_pct:75},{cle:'internet',montant:10000,part_pct:25}]}})],'Comment les charges sont-elles réparties par catégorie en octobre 2026 ?');
 expect(answer).toHaveLength(1);expect(answer[0]).toContain('loyer');expect(answer[0]).toContain('30 000 DZD');expect(answer[0]).toContain('internet');expect(answer[0]).toContain('10 000 DZD');expect(answer[0]).not.toContain('raw structured');
});

it('states the verified all-time outstanding balance directly',()=>{
 const answer=presentAgentResults([financeResult({total:4,rows:[],totals:{pendingDzd:12000,collectedDzd:50000,unpriced:0}})],'Quel solde reste à encaisser, toutes dates confondues ?');
 expect(answer.join(' ')).toContain('12 000 DZD');expect(answer.join(' ')).toMatch(/toutes dates confondues/iu);expect(answer.join(' ')).toMatch(/restant à encaisser|impayés/iu);expect(answer.join(' ')).not.toContain('raw structured');
});

it('answers a missing-tariff consultation count with its requested scope',()=>{
 const answer=presentAgentResults([financeResult({total:10,rows:[],totals:{pendingDzd:0,collectedDzd:50000,unpriced:7}})],'Combien de consultations terminées n’ont pas de tarif ?');
 expect(answer.join(' ')).toContain('7');expect(answer.join(' ')).toMatch(/consultations? terminées sans tarif/iu);expect(answer.join(' ')).not.toContain('raw structured');
});
it('states only the requested verified collected amount in a short paragraph',()=>{
 const answer=presentAgentResults([financeResult({total:4,rows:[],totals:{pendingDzd:0,collectedDzd:12500,unpriced:0}})],'Quel montant représentent les paiements encaissés du 1 octobre 2026 au 31 octobre 2026 ?');
 expect(answer).toHaveLength(1);expect(answer[0]).toMatch(/12\s*500\s*DZD/u);expect(answer[0]).toMatch(/encaiss/u);expect(answer[0]).not.toMatch(/consultation|solde|paiements créés/iu);expect(answer[0]).not.toContain('raw structured');
});
it('reports a verified collected total when no payment rows belong to the selected patient',()=>{
 const answer=presentAgentResults([financeResult({du:'2026-10-01',au:'2026-10-31',total:0,rows:[],totals:{pendingDzd:0,collectedDzd:12500,unpriced:0}})],'Quel montant représentent les paiements encaissés du 1 octobre 2026 au 31 octobre 2026 ?');
 expect(answer).toHaveLength(1);expect(answer[0]).toMatch(/12\s*500\s*DZD/u);expect(answer[0]).toMatch(/encaiss/u);expect(answer[0]).not.toMatch(/aucun paiement/iu);
});
it('answers an empty pending-payment list in one clear French sentence',()=>{
 const answer=presentAgentResults([financeResult({total:0,rows:[],totals:{pendingDzd:0,collectedDzd:0,unpriced:0}})],'Liste les paiements en attente du patient sélectionné en octobre 2026.');
 expect(answer).toHaveLength(1);expect(answer[0]).toMatch(/aucun paiement en attente/iu);expect(answer[0]).not.toContain('raw structured');
});
it('preserves row boundaries for a requested first page of the finance calendar',()=>{
 const text='Période du 2026-10-01 au 2026-10-31 inclus.\n2026-10-01 — 0 DZD — 0 paiements encaissés';
 const result={...financeResult({financeQuery:{mode:'calendar',from:'2026-10-01T00:00:00+01:00',to:'2026-11-01T00:00:00+01:00'}}),status:'partial' as const,complete:false,text};
 expect(presentAgentResults([result],'Affiche la première page du calendrier financier d’octobre 2026.')).toEqual([text]);
});
