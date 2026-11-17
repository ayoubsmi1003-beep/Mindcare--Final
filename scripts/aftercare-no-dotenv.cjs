// Preloaded in every Next worker: qualification must never read local env files.
const { createRequire } = require('node:module');
if (process.env.AFTERCARE_NATIVE_QUALIFICATION !== 'synthetic') throw new Error('Synthetic qualification only');
const resolveFromProject = createRequire(process.cwd() + '/package.json');
const envModule = resolveFromProject.resolve('@next/env', { paths: [resolveFromProject.resolve('next')] });
const original = require(envModule);
require.cache[envModule].exports = { ...original, loadEnvConfig: () => ({ combinedEnv: process.env, parsedEnv: {}, loadedEnvFiles: [] }) };
