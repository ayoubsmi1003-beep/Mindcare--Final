import { describe, expect, it } from 'vitest';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chargerConnexionCabinet, chargerAvecReconnexion } from '../../electron/main/connexion-cabinet';

describe('one installer with automatic connection', () => {
  it('reconnects if the host disappears between discovery and page loading', async () => {
    let attempts = 0; let reconnections = 0;
    await chargerAvecReconnexion(async () => { if (++attempts === 1) throw new Error('host stopped'); }, async () => { reconnections++; }, () => false);
    expect(attempts).toBe(2); expect(reconnections).toBe(1);
  });
  it('does not retry after the application closes', async () => {
    let closed = false; let attempts = 0;
    await chargerAvecReconnexion(async () => { attempts++; throw new Error('host stopped'); }, async () => { closed = true; }, () => closed);
    expect(attempts).toBe(1);
  });
  it('a fresh universal installation discovers before any database activity', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'mc-auto-'));
    try { expect(chargerConnexionCabinet(path.join(dir, 'absent.json'), 'clinic-auto')).toEqual({ mode: 'auto' }); }
    finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('ships one product and no canonical patient snapshot to any client', () => {
    const builder = readFileSync(new URL('../../electron-builder.yml', import.meta.url), 'utf8');
    expect(builder).toContain('mindcareDeployment: clinic-auto');
    expect(builder).not.toMatch(/from: resources\/snapshot(?:\r?\n|\/(?:base\.dump|manifest\.json))/);
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    expect(pkg.scripts['build:assistant']).toBeUndefined();
    expect(pkg.scripts['build:desktop']).not.toContain('verifier-instantane');
  });
});
