import {expect,it} from 'vitest';
import {createServer} from 'node:net';
import {LOCAL_MODEL_PIN,allocateLoopbackPort} from '@/server/alexa/local-model';
import {ALEXA_CONVERSATION_MODEL} from '@/server/alexa/model-policy';
import {agentCopy} from '@/i18n/alexa-agent';
it('restores the exact verified MiniCPM artifact from the successful historical campaign',()=>{
 expect(ALEXA_CONVERSATION_MODEL).toBe('MiniCPM-V-4_7-1B-Q4_K_M.gguf');
 expect(LOCAL_MODEL_PIN).toMatchObject({model:ALEXA_CONVERSATION_MODEL,runtime:'b11429',sha256:'588c6c94c82f756b86dba35c42ed9ba9ec187d65824eb52f039c347df563e63d'});
 expect(LOCAL_MODEL_PIN.model).toBe('MiniCPM-V-4_7-1B-Q4_K_M.gguf');
 expect(LOCAL_MODEL_PIN).not.toHaveProperty('architecture');
});
it('identifies the selected model in the French user-facing messages',()=>{
 expect(agentCopy.fr.generalSource).toContain('MiniCPM');
 expect(agentCopy.fr.modelUnavailable).not.toContain('Llama');
});
it('allocates a separate available loopback port while another MiniCPM runtime is listening',async()=>{
 const first=await allocateLoopbackPort(),server=createServer();
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(first,'127.0.0.1',resolve);});
 try{
  const second=await allocateLoopbackPort();
  expect(second).not.toBe(first);
  expect(server.address()).toMatchObject({address:'127.0.0.1',port:first});
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
