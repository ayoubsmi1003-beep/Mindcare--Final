import {it,expect} from 'vitest';import {requiredAlexaMigrations} from '../../scripts/lib/alexa-migrations.mjs';import {clinicalSectionComplete} from '@/server/alexa/clinical-coverage';import {clinicalContextSchema} from '@/shared/alexa/clinical';
it('keeps every unrelated migration required and gates only the three disabled native migrations',()=>{const all=['158_username_login','159_alexa_turn_lifecycle','160_alexa_query_reads','161_alexa_editable_draft_action','162_unrelated'];expect(requiredAlexaMigrations(all,false)).toEqual(['158_username_login','162_unrelated']);expect(requiredAlexaMigrations(all,true)).toEqual(all);});
it('uses requested clinical evidence coverage rather than the existence of older pages',()=>{
 const context=clinicalContextSchema.parse({patientId:'11111111-1111-4111-8111-111111111111',consultations:[],treatments:{current:[],history:[],historyComplete:true},diagnoses:[],scales:[],sourceRevision:'a'.repeat(64),coverage:{requested:5,returned:5,complete:true,hasMore:true}});
 expect(clinicalSectionComplete(context,'history')).toBe(true);expect(clinicalSectionComplete({...context,coverage:{...context.coverage,complete:false,hasMore:false}},'history')).toBe(false);expect(clinicalSectionComplete({...context,coverage:{...context.coverage,complete:false,hasMore:true}},'treatments')).toBe(true);
});


it('keeps the slow-turn lease migration optional with native disabled and required with native enabled',()=>{const versions=['162_alexa_note_pages','163_alexa_slow_turn_lease','163_unrelated'];expect(requiredAlexaMigrations(versions,false)).toEqual(['163_unrelated']);expect(requiredAlexaMigrations(versions,true)).toEqual(versions);});

it('keeps the missing-text correction on the Alexa upgrade boundary', () => {
 const versions=['164_alexa_missing_text','164_unrelated'];
 expect(requiredAlexaMigrations(versions,false)).toEqual(['164_unrelated']);
 expect(requiredAlexaMigrations(versions,true)).toEqual(versions);
});

it('scopes authoritative-read consistency upgrades to native Alexa',()=>{
 const versions=['165_alexa_read_consistency','165_unrelated'];expect(requiredAlexaMigrations(versions,false)).toEqual(['165_unrelated']);expect(requiredAlexaMigrations(versions,true)).toEqual(versions);
});

it('requires the activity-ordered history upgrade only when native Alexa is enabled',()=>{const versions=['166_alexa_history_activity','166_unrelated'];expect(requiredAlexaMigrations(versions,false)).toEqual(['166_unrelated']);expect(requiredAlexaMigrations(versions,true)).toEqual(versions);});

it("requires session summaries independently of native conversational orchestration",()=>{const versions=["167_alexa_session_summary","168_alexa_summary_source_guard","168_unrelated"];expect(requiredAlexaMigrations(versions,false)).toEqual(versions);expect(requiredAlexaMigrations(versions,true)).toEqual(versions);});
