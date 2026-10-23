import {afterEach,expect,it,vi} from 'vitest';
const capture=vi.hoisted(()=>{const configs:unknown[]=[];return {configs};});
vi.mock('pg',()=>({Pool:vi.fn(function(options:unknown){capture.configs.push(options);return {on:vi.fn(),end:vi.fn().mockResolvedValue(undefined)};}),types:{setTypeParser:vi.fn()}}));
import {obtenirPool,fermerPool} from '@/server/db/pool';
afterEach(async()=>{await fermerPool();vi.unstubAllEnvs();vi.clearAllMocks();capture.configs.length=0;});
function options(value?:string){
  vi.stubEnv('MINDCARE_DATABASE_URL','postgres://evaluation@127.0.0.1:55444/alexa_eval_connection_timeout');
  vi.stubEnv('MINDCARE_DATABASE_CONNECT_TIMEOUT_MS',value);
  obtenirPool();return capture.configs.at(-1);
}
it('allows a bounded longer connection wait on a slow evaluation computer without enlarging the pool',()=>{
  expect(options('30000')).toMatchObject({connectionTimeoutMillis:30000,max:10,min:1});
});
it.each([undefined,'','0','-1','NaN','Infinity','60001'])('retains the five-second default for invalid connection wait %s',value=>{
  expect(options(value)).toMatchObject({connectionTimeoutMillis:5000});
});
