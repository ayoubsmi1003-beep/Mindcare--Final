import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe.skipIf(process.platform !== 'win32')('doctor folder permission repair boundary', () => {
  it('allows only the standard Program Files doctor folder', () => {
    const script = path.resolve('scripts/configurer-cabinet.ps1');
    const command = "$ErrorActionPreference='Stop'; $t=$null; $e=$null; $a=[Management.Automation.Language.Parser]::ParseFile($env:MC_TEST_SCRIPT,[ref]$t,[ref]$e); $f=$a.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Assert-RepairInstallLocation'},$true); if(!$f){throw 'missing repair boundary'}; . ([ScriptBlock]::Create($f.Extent.Text)); Assert-RepairInstallLocation (Join-Path $env:ProgramFiles 'MindCare OS'); try { Assert-RepairInstallLocation (Join-Path $env:TEMP 'MindCare OS'); throw 'unsafe path accepted' } catch { if($_.Exception.Message -eq 'unsafe path accepted'){throw} }; [Console]::Write('ok')";
    const output = execFileSync(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile','-NonInteractive','-Command',command], {env:{...process.env,MC_TEST_SCRIPT:script},encoding:'utf8',windowsHide:true});
    expect(output).toBe('ok');
  });
});
