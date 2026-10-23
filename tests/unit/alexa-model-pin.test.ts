import {expect,it} from 'vitest';
import {LOCAL_MODEL_PIN} from '@/server/alexa/local-model';
import {ALEXA_CONVERSATION_MODEL} from '@/server/alexa/model-policy';
import {agentCopy} from '@/i18n/alexa-agent';
it('restores the exact verified MiniCPM artifact from the successful historical campaign',()=>{
 expect(ALEXA_CONVERSATION_MODEL).toBe('MiniCPM-V-4_7-1B-Q4_K_M.gguf');
 expect(LOCAL_MODEL_PIN).toMatchObject({model:ALEXA_CONVERSATION_MODEL,architecture:'qwen35',runtime:'b11429',sha256:'588c6c94c82f756b86dba35c42ed9ba9ec187d65824eb52f039c347df563e63d'});
});
it('identifies the selected model in the French user-facing messages',()=>{
 expect(agentCopy.fr.generalSource).toContain('MiniCPM');
 expect(agentCopy.fr.modelUnavailable).not.toContain('Llama');
});
