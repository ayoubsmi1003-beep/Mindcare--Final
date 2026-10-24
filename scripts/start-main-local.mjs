import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mainLocalEnvironment } from './lib/alexa-main-profile.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
const env = mainLocalEnvironment(process.env);
let child;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child?.kill(signal));
async function run(args) {
  await new Promise((resolve, reject) => {
    child = spawn(process.execPath, args, { cwd: root, env, stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`MainLocalProcessFailed:${code}`)));
  });
}
await run(['scripts/garde-origine.mjs']);
await run(['scripts/verifier-base.mjs']);
await run(['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '3000']);
