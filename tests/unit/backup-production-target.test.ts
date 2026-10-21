import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('backup restoration cannot target production', () => {
  it.each([
    ['postgresql://localhost/mindcare', /distincte/],
    ['postgresql://another-host/mindcare_restore', /serveur/],
    ['postgresql://localhost/postgres', /réservée/],
  ])('rejects unsafe target %s before launching pg_dump', (target, reason) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'mindcare-backup-guard-'));
    try {
      const result = spawnSync(process.execPath, ['scripts/sauvegarde.mjs'], {
        cwd: path.resolve(import.meta.dirname, '../..'),
        encoding: 'utf8',
        windowsHide: true,
        env: {
          ...process.env,
          MINDCARE_DATABASE_URL: 'postgresql://localhost/mindcare',
          MINDCARE_ADMIN_DATABASE_URL: 'postgresql://localhost/postgres',
          MINDCARE_RESTORE_TEST_DB: target,
          MINDCARE_BACKUP_PASSPHRASE: 'synthetic-regression-test',
          MINDCARE_BACKUP_DIR: dir,
          PG_DUMP: path.join(dir, 'intentionally-absent-pg-dump.exe'),
        },
      });
      expect(result.status).toBe(1);
      expect(result.stdout + result.stderr).toMatch(reason);
      expect(result.stdout).not.toContain('1 · pg_dump');
    } finally {
      if (path.dirname(path.resolve(dir)) !== path.resolve(tmpdir())) throw new Error('Unsafe test cleanup path');
      rmSync(dir, {recursive: true, force: true});
    }
  });
});
