import {afterEach,expect,it,vi} from 'vitest';
import {measureLocalModelPhase} from '@/server/alexa/local-model-timing';
import {assertLocalContextFits} from '@/server/alexa/local-model-protocol';
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks();});
it('records only phase, duration and completion when explicitly enabled',async()=>{
 vi.stubEnv('ALEXA_LOCAL_TIMINGS','1');const log=vi.spyOn(console,'info').mockImplementation(()=>{});
 await expect(measureLocalModelPhase('generation',async()=>{throw Error('private clinical content');})).rejects.toThrow('private clinical content');
 expect(log).toHaveBeenCalledWith('[alexa-local-timing]',{phase:'generation',ms:expect.any(Number),completed:false});
 expect(JSON.stringify(log.mock.calls)).not.toContain('clinical');
});
it('keeps diagnostics disabled and preserves successful results by default',async()=>{
 vi.stubEnv('ALEXA_LOCAL_TIMINGS','0');const log=vi.spyOn(console,'info').mockImplementation(()=>{});
 expect(await measureLocalModelPhase('context',async()=>42)).toBe(42);expect(log).not.toHaveBeenCalled();
});
it('reports exact context counts without logging token IDs or extra fields',()=>{
 vi.stubEnv('ALEXA_LOCAL_TIMINGS','1');const log=vi.spyOn(console,'info').mockImplementation(()=>{});
 assertLocalContextFits({tokens:[9137,9138],note:'private clinical content'},1024);
 expect(log).toHaveBeenCalledWith('[alexa-local-token-budget]',{inputTokens:2,outputTokens:1024,reservedTokens:128,contextTokens:4096});
 expect(JSON.stringify(log.mock.calls)).not.toMatch(/clinical|9137|9138/u);
});
