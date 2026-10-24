import {expect,it} from 'vitest';
import {calendarDataMatches,calendarPresentationMatches,expectedCalendar} from '../../scripts/lib/alexa-eval-calendar-oracle.mjs';
const query={from:'2026-10-01T00:00:00+01:00',to:'2026-11-01T00:00:00+01:00',offset:0};
it('independently groups cash on collection days and pending flags on creation days with exclusive bounds',()=>{
 const value=expectedCalendar([
  {createdAt:'2026-09-30T09:00:00+01:00',collectedAt:query.from,amount:25,kind:'suivi'},
  {createdAt:query.from,collectedAt:'2026-10-01T09:00:00+01:00',amount:75,kind:'suivi'},
  {createdAt:query.from,collectedAt:query.to,amount:999,kind:null},
  {createdAt:'2026-10-31T23:59:59+01:00',collectedAt:null,amount:40,kind:null},
  {createdAt:'2026-09-30T23:59:59+01:00',collectedAt:null,amount:999,kind:null},
 ],query);
 expect(value.calendrier).toHaveLength(31);
 expect(value.calendrier[0]).toEqual({jour_iso:'2026-10-01',montant:100,nb_seances:2,a_impaye:false});
 expect(value.calendrier[30]?.a_impaye).toBe(true);
 const actual={...value};expect(calendarDataMatches(actual,value)).toBe(true);
 const wrong=structuredClone(actual);wrong.calendrier[0]!.montant++;expect(calendarDataMatches(wrong,value)).toBe(false);
});
it('checks every displayed day, empty-day zeros and explicit continuation',()=>{
 const value=expectedCalendar([],query);
 const text=[`Période du ${value.du} au ${value.au} inclus.`,...Array.from({length:20},(_,i)=>`2026-10-${String(i+1).padStart(2,'0')} — 0 DZD — 0 paiements encaissés`),'Liste partielle : 1–20 / 31.'].join('\n');
 expect(calendarPresentationMatches(text,value)).toBe(true);
 expect(calendarPresentationMatches(text.replace('0 DZD','1 DZD'),value)).toBe(false);
 expect(calendarPresentationMatches(text.replace('Liste partielle : 1–20 / 31.',''),value)).toBe(false);
 expect(calendarPresentationMatches(text.replace('2026-10-01 — 0 DZD — 0 paiements encaissés',''),value)).toBe(false);
});
it('independently retains the top three attached types and groups the rest, including unattached payments',()=>{
 const value=expectedCalendar(['a','b','c','d',null].map(kind=>({createdAt:query.from,collectedAt:query.from,amount:10,kind})),query);
 expect(value.calendrier_par_type.types.map(t=>t.cle)).toEqual(['a','b','c','autres']);
 expect(value.calendrier_par_type.lignes.find(row=>row.jour_iso==='2026-10-01'&&row.cle==='autres')?.nb).toBe(2);
});
