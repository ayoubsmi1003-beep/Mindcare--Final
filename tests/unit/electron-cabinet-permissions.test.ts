import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../scripts/configurer-cabinet.ps1");
function verify(command: string, testDir = ""): string {
  // Execute only named real preflight/ACL functions, never the setup entrypoint.
  const load = `$tokens = $null; $errors = $null; $ast = [Management.Automation.Language.Parser]::ParseFile($env:MINDCARE_TEST_SETUP, [ref]$tokens, [ref]$errors); foreach ($name in @('New-ClinicAcl','Test-AdministratorAcl','Get-ClinicTree','Assert-ClinicInstall','Assert-SetupPolicy')) { $fn = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true); if ($null -eq $fn) { throw ('Missing preflight: ' + $name) }; . ([ScriptBlock]::Create($fn.Extent.Text)) }; `;
  return execFileSync(path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"), ["-NoProfile", "-NonInteractive", "-Command", "$ErrorActionPreference='Stop'; " + load + command], { env: { ...process.env, MINDCARE_TEST_SETUP: script, MINDCARE_TEST_DIR: testDir }, encoding: "utf8", windowsHide: true, timeout: 20_000 });
}
describe.skipIf(process.platform !== "win32")("clinic Windows privilege boundaries (no system mutation)", () => {
  it("private descriptors grant only administrators and SYSTEM and reject an explicit user grant", () => {
    const result = JSON.parse(verify("$acl=New-ClinicAcl $false $false; Test-AdministratorAcl $acl $false; $before=$acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]); $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-5-32-545'),[Security.AccessControl.FileSystemRights]::FullControl,[Security.AccessControl.AccessControlType]::Allow)); $refused=$false; try { Test-AdministratorAcl $acl $false } catch { $refused=$true }; @{sids=@($before | ForEach-Object {$_.IdentityReference.Value}); refused=$refused} | ConvertTo-Json -Compress"));
    expect(result.sids.sort()).toEqual(["S-1-5-18", "S-1-5-32-544"].sort()); expect(result.refused).toBe(true);
  });
  it("ordinary-user ownership is refused even when no write ACE is present", () => {
    expect(verify("$acl=New-ClinicAcl $false $false; $acl.SetOwner([Security.Principal.WindowsIdentity]::GetCurrent().User); try { Test-AdministratorAcl $acl $false; throw 'UNSAFE_ACCEPTED' } catch { if ($_.Exception.Message -eq 'UNSAFE_ACCEPTED') { throw }; [Console]::Write('refused') }")).toBe("refused");
  });
  it("public read permission is refused on a private secret", () => {
    expect(verify("$acl=New-ClinicAcl $false $true; Test-AdministratorAcl $acl $false; try { Test-AdministratorAcl $acl $false $true; throw 'UNSAFE_ACCEPTED' } catch { if ($_.Exception.Message -eq 'UNSAFE_ACCEPTED') { throw }; [Console]::Write('refused') }")).toBe("refused");
  });
  it("allows standard volume-root Delete but rejects child deletion and ancestor rename", () => {
    const result = JSON.parse(verify("$acl=New-ClinicAcl $true $false; $users=[Security.Principal.SecurityIdentifier]::new('S-1-5-11'); $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($users,[Security.AccessControl.FileSystemRights]::Modify,[Security.AccessControl.AccessControlType]::Allow)); Test-AdministratorAcl $acl $true $false $true; $renameRefused=$false; try { Test-AdministratorAcl $acl $true $false $false } catch { $renameRefused=$true }; $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($users,[Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles,[Security.AccessControl.AccessControlType]::Allow)); $childrenRefused=$false; try { Test-AdministratorAcl $acl $true $false $true } catch { $childrenRefused=$true }; @{renameRefused=$renameRefused; childrenRefused=$childrenRefused} | ConvertTo-Json -Compress"));
    expect(result).toEqual({ renameRefused: true, childrenRefused: true });
  });
  it("rejects junctions before traversing a protected tree", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mindcare-acl-"));
    const tree = path.join(dir, "tree"); const outside = path.join(dir, "outside");
    mkdirSync(tree); mkdirSync(outside); symlinkSync(outside, path.join(tree, "redirect"), "junction");
    try { expect(verify("try { Get-ClinicTree $env:MINDCARE_TEST_DIR | Out-Null; throw 'UNSAFE_ACCEPTED' } catch { if ($_.Exception.Message -eq 'UNSAFE_ACCEPTED') { throw }; [Console]::Write('refused') }", tree)).toBe("refused"); }
    finally { rmSync(path.join(tree, "redirect"), { force: true }); rmSync(dir, { recursive: true, force: true }); }
  });
  it("refuses a user-writable custom installation outside Program Files", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mindcare-install-"));
    try { expect(verify("try { Assert-ClinicInstall $env:MINDCARE_TEST_DIR; throw 'UNSAFE_ACCEPTED' } catch { if ($_.Exception.Message -eq 'UNSAFE_ACCEPTED') { throw }; [Console]::Write('refused') }", dir)).toBe("refused"); }
    finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("reports unsupported setup policy without relaxing it", () => {
    expect(verify("Assert-SetupPolicy 'RemoteSigned'; Assert-SetupPolicy 'AllSigned'; try { Assert-SetupPolicy 'Restricted'; throw 'UNSAFE_ACCEPTED' } catch { if ($_.Exception.Message -eq 'UNSAFE_ACCEPTED') { throw }; [Console]::Write('refused') }")).toBe("refused");
  });
});
