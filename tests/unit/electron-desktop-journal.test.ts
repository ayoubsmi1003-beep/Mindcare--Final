import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { journalDesktop } from '../../electron/main/journal-desktop';
it('rotates bounded technical logs and refuses free-text events', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mindcare-journal-'));
  try {
    journalDesktop(dir, 'HEALTH_OK');
    const file = path.join(dir, 'desktop-lifecycle.jsonl');
    const first = readFileSync(file, 'utf8');
    journalDesktop(dir, 'patient or secret must never appear');
    expect(readFileSync(file, 'utf8')).toBe(first);
    writeFileSync(file, 'x'.repeat(524289));
    journalDesktop(dir, 'WINDOW_CREATED', 1);
    expect(readFileSync(`${file}.1`, 'utf8')).toHaveLength(524289);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ evenement: 'WINDOW_CREATED', valeur: 1, pid: process.pid });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
