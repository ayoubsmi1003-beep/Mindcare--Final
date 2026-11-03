import { expect, it } from 'vitest';
import { postgresProcessEnvironment } from '../../electron/main/pg-cluster';

it('forces UTF-8 for packaged PostgreSQL commands regardless of the inherited Windows code page', () => {
  const result = postgresProcessEnvironment({ PGCLIENTENCODING: 'WIN1252', PGHOST: '127.0.0.1' });
  expect(result.PGCLIENTENCODING).toBe('UTF8');
  expect(result.PGHOST).toBe('127.0.0.1');
});
