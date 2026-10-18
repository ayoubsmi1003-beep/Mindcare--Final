import {it,expect} from 'vitest';
import {resolveAgentPeriod} from '@/server/alexa/agent-period';
it.each([
 ['ce mois','2026-10-15T12:00:00Z','2026-10-01','2026-10-31'],
 ['cette semaine','2026-10-15T12:00:00Z','2026-10-12','2026-10-18'],
 ['ce mois','2028-02-29T12:00:00Z','2028-02-01','2028-02-29'],
 ['cette année','2026-12-31T23:30:00Z','2027-01-01','2027-12-31'],
])('freezes %s on the Algiers calendar', (text,anchor,du,au)=>expect(resolveAgentPeriod(text,anchor)).toEqual({type:'plage',du,au}));
it('resolves tomorrow after local midnight and rejects an unknown period',()=>{
 expect(resolveAgentPeriod('demain','2026-10-15T23:30:00Z')).toEqual({type:'jour',jour:'2026-10-17'});
 expect(resolveAgentPeriod('date inventée','2026-10-15T12:00:00Z')).toBeNull();
});


import {explicitAgentPeriod} from '@/server/alexa/agent-period';
it.each(['mois courant','mois en cours','ce mois-ci'])('resolves a current-month paraphrase: %s',period=>{
 expect(resolveAgentPeriod(period,'2026-10-15T12:00:00Z')).toEqual({type:'plage',du:'2026-10-01',au:'2026-10-31'});
 expect(explicitAgentPeriod('Montre les indicateurs financiers du '+period+'.','2026-10-15T12:00:00Z')).toMatchObject({from:'2026-10-01T00:00:00+01:00',to:'2026-11-01T00:00:00+01:00'});
});
it('keeps mixed and qualified periods outside the single whole-month constraint',()=>{
 for(const text of ['Compare ce mois au mois courant.','Montre le début du mois courant.','Les recettes du mois courant avant le 15.'])expect(explicitAgentPeriod(text,'2026-10-15T12:00:00Z')).toBeNull();
});