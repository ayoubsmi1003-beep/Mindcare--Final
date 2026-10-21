import { describe, expect, it } from 'vitest';
import { pgEnv } from '../../scripts/lib/pg-env.mjs';

describe('backup libpq connection environment', () => {
  it('keeps encoded credentials and a Windows certificate path out of command arguments', () => {
    expect(pgEnv('postgresql://doctor:p%40ss%20word@localhost:54333/mindcare?sslmode=verify-full&sslrootcert=C%3A%5CClinic%20Data%5Cca.pem'))
      .toEqual({ PGHOST: 'localhost', PGPORT: '54333', PGDATABASE: 'mindcare', PGUSER: 'doctor',
        PGPASSWORD: 'p@ss word', PGCONNECT_TIMEOUT: '5', PGSSLMODE: 'verify-full', PGSSLROOTCERT: 'C:\\Clinic Data\\ca.pem' });
  });
  it('preserves explicit libpq options rather than silently downgrading TLS', () => {
    expect(pgEnv('postgres://localhost/mindcare?application_name=backup&connect_timeout=10&options=-c%20statement_timeout%3D1000'))
      .toMatchObject({ PGAPPNAME: 'backup', PGCONNECT_TIMEOUT: '10', PGOPTIONS: '-c statement_timeout=1000' });
  });
  it('refuses unsupported connection parameters and non-PostgreSQL URLs', () => {
    expect(() => pgEnv('https://localhost/mindcare')).toThrow(/invalide/);
    expect(() => pgEnv('postgresql://localhost/mindcare?unexpected=1')).toThrow(/non prise en charge/);
  });
});
