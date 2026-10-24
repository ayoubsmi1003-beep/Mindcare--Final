import {expect,it} from 'vitest';
import {mainLocalEnvironment} from '../../scripts/lib/alexa-main-profile.mjs';
it('runs the actual local main database and native MiniCPM independently of inherited evaluation settings',()=>{
 const database='postgresql://synthetic:synthetic@127.0.0.1:55441/mindcare';
 const env=mainLocalEnvironment({MINDCARE_DATABASE_URL:database,ALEXA_NATIVE_AGENT_ENABLED:'0',MINDCARE_LIVE_CHECK:'1',ALEXA_LOCAL_MODEL_ROOT:'C:/temporary/evaluation',VOICE_PROVIDER:'local'});
 expect(env).toMatchObject({MINDCARE_DATABASE_URL:database,ALEXA_NATIVE_AGENT_ENABLED:'1',MINDCARE_LIVE_CHECK:'0',NODE_ENV:'production',MC_HTTPS:'0',HOSTNAME:'127.0.0.1',PORT:'3000',VOICE_PROVIDER:'local',ALEXA_DEBUG_NARRATIVE:'0'});
 expect(env.ALEXA_LOCAL_MODEL_ROOT).toBeUndefined();
});
it.each(['postgresql://synthetic@127.0.0.1:55444/alexa_eval_clinical_20261022','postgresql://synthetic@remote.invalid:55441/mindcare','postgresql://synthetic@127.0.0.1:55441/other','postgresql://synthetic@127.0.0.1:55441/mindcare?host=remote.invalid','invalid'])('refuses a different database before starting the main application: %s',MINDCARE_DATABASE_URL=>{
 expect(()=>mainLocalEnvironment({MINDCARE_DATABASE_URL})).toThrow('MainLocalDatabaseRequired');
});
