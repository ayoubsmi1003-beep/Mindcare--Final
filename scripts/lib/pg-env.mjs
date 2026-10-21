/** Keep libpq credentials in the child environment rather than process arguments. */
export function pgEnv(url) {
  const connection = new URL(url);
  if (!['postgresql:', 'postgres:'].includes(connection.protocol)) throw new Error('URL PostgreSQL invalide.');
  const env = {
    PGHOST: connection.hostname,
    PGPORT: connection.port || '5432',
    PGDATABASE: decodeURIComponent(connection.pathname.replace(/^\//, '')),
    PGUSER: decodeURIComponent(connection.username),
    PGPASSWORD: decodeURIComponent(connection.password),
    PGCONNECT_TIMEOUT: '5',
  };
  const options = { sslmode: 'PGSSLMODE', sslcert: 'PGSSLCERT', sslkey: 'PGSSLKEY',
    sslrootcert: 'PGSSLROOTCERT', connect_timeout: 'PGCONNECT_TIMEOUT',
    application_name: 'PGAPPNAME', options: 'PGOPTIONS' };
  for (const [name, value] of connection.searchParams) {
    if (!options[name]) throw new Error('Option PostgreSQL non prise en charge pour la sauvegarde.');
    env[options[name]] = value;
  }
  return env;
}
