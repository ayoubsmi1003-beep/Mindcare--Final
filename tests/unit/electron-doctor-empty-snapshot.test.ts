import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe.skipIf(process.platform !== 'win32')('doctor snapshot manifest validation', () => {
  const hash = 'a'.repeat(64);
  const valid = { sha256: hash, patient_count: 0, patients_total_source: 0, fixtures_exclues: 0, counts: { 'app.patients': 0, 'app.consultations': 0, 'app.documents': 0, 'app.profiles': 2, 'auth.users': 2 } };
  const check = (manifest: unknown, expected: boolean, actualHash = hash) => {
    const script = path.resolve('scripts/configurer-cabinet.ps1');
    const command = "$ErrorActionPreference='Stop'; $t=$null; $e=$null; $a=[Management.Automation.Language.Parser]::ParseFile($env:MC_TEST_SCRIPT,[ref]$t,[ref]$e); $f=$a.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Assert-DoctorSnapshotManifest'},$true); if(!$f){throw 'missing snapshot validator'}; . ([ScriptBlock]::Create($f.Extent.Text)); $m=$env:MC_TEST_MANIFEST | ConvertFrom-Json; try { Assert-DoctorSnapshotManifest $m $env:MC_TEST_HASH; $valid=$true } catch { $valid=$false }; if($valid -ne ($env:MC_TEST_EXPECT -eq 'true')){throw 'unexpected validation result'}; [Console]::Write('ok')";
    return execFileSync(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', command], { env: { ...process.env, MC_TEST_SCRIPT: script, MC_TEST_MANIFEST: JSON.stringify(manifest), MC_TEST_HASH: actualHash, MC_TEST_EXPECT: String(expected) }, encoding: 'utf8', windowsHide: true });
  };
  it('accepts a verified empty cabinet with the two expected profiles', () => expect(check(valid, true)).toBe('ok'));
  it('accepts two inactive historical approvers alongside two active accounts', () => {
    const m = { ...valid, active_account_count: 2, inactive_approval_count: 2, counts: { ...valid.counts, 'app.profiles': 4, 'auth.users': 4 } };
    expect(check(m, true)).toBe('ok');
    expect(check({ ...m, active_account_count: 3 }, false)).toBe('ok');
    expect(check({ ...m, counts: { ...m.counts, 'auth.users': 5 } }, false)).toBe('ok');
  });
  it('continues to accept a consistent non-empty snapshot', () => expect(check({ ...valid, patient_count: 1, patients_total_source: 1, counts: { ...valid.counts, 'app.patients': 1 } }, true)).toBe('ok'));
  it('rejects a changed archive, inconsistent patient counts, or clinical documents', () => {
    expect(check(valid, false, 'b'.repeat(64))).toBe('ok');
    expect(check({ ...valid, patients_total_source: 1 }, false)).toBe('ok');
    expect(check({ ...valid, counts: { ...valid.counts, 'app.documents': 1 } }, false)).toBe('ok');
    expect(check({ ...valid, counts: { ...valid.counts, 'app.profiles': 1 } }, false)).toBe('ok');
  });
});
