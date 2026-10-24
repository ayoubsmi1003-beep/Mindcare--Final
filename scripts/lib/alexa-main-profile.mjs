/** Keep the local main application independent of evaluation-shell settings. */
export function mainLocalEnvironment(input) {
  let database;
  try { database = new URL(input.MINDCARE_DATABASE_URL); } catch { throw new Error('MainLocalDatabaseRequired'); }
  if (!['postgres:', 'postgresql:'].includes(database.protocol)
    || !['127.0.0.1', 'localhost'].includes(database.hostname)
    || database.port !== '55441' || database.pathname !== '/mindcare' || database.search || database.hash) {
    throw new Error('MainLocalDatabaseRequired');
  }
  const env = { ...input, ALEXA_NATIVE_AGENT_ENABLED: '1', MINDCARE_LIVE_CHECK: '0',
    NODE_ENV: 'production', MC_HTTPS: '0', HOSTNAME: '127.0.0.1', PORT: '3000', ALEXA_DEBUG_NARRATIVE: '0' };
  delete env.ALEXA_LOCAL_MODEL_ROOT;
  return env;
}
