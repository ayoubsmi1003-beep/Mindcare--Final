// Launched only by the verified fresh native cluster harness; never loads an env file.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
if (process.env.AFTERCARE_NATIVE_QUALIFICATION !== 'synthetic') throw new Error('Synthetic qualification only');
const preload = fileURLToPath(new URL('./aftercare-no-dotenv.cjs', import.meta.url)).replaceAll('\\', '/');
process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS ?? ''} --require "${preload}"`;
const envModule = require.resolve('@next/env', { paths: [require.resolve('next')] });
const nextEnv = require(envModule);
require.cache[envModule].exports = { ...nextEnv, loadEnvConfig: () => ({ combinedEnv: process.env, parsedEnv: {}, loadedEnvFiles: [] }) };
if (process.argv.includes('--build')) {
  await require('next/dist/build').default(process.cwd());
} else {
  const { nextDev } = require('next/dist/cli/next-dev');
  await nextDev({ hostname: '127.0.0.1', port: Number(process.env.AFTERCARE_CLINIC_PORT ?? '3291'), disableSourceMaps: true }, process.cwd());
}
