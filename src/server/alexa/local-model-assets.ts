import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

export function localAssetLayout(cwd = process.cwd()): { root: string; packaged: boolean } {
  const here = resolve(cwd);
  const packaged = basename(here).toLowerCase() === "serveur" && basename(dirname(here)).toLowerCase() === "resources";
  const configured=packaged?undefined:process.env["ALEXA_LOCAL_MODEL_ROOT"];
  if(configured&&(!isAbsolute(configured)||! /^[A-Za-z]:[\\/]/u.test(configured)))throw new Error("LocalModelAssetAccess");
  return { root: packaged ? join(dirname(here), "alexa", "local-model") : configured?resolve(configured):join(here, ".cache", "alexa", "minicpm"), packaged };
}
interface AssetAccess {
  readonly sid: string; readonly protectedLocation: boolean;
  readonly entries: readonly { owner: string; ancestor?: boolean; volumeRoot?: boolean; rules: readonly { sid: string; allow: boolean; rights: number }[] }[];
}
const SYSTEM = "S-1-5-18", ADMIN = "S-1-5-32-544";
const TRUSTED_INSTALLER = "S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464";
export function assertLocalAssetAccess(value: AssetAccess, packaged: boolean): void {
  const privileged = [SYSTEM, ADMIN, TRUSTED_INSTALLER];
  const system = value.sid === SYSTEM;
  if (!/^S-1-[0-9-]+$/.test(value.sid) || !value.entries.length
    || (system && (!packaged || !value.protectedLocation))) throw new Error("LocalModelAssetAccess");
  const writers = system ? privileged : [...privileged, value.sid];
  for (const entry of value.entries) {
    const unsafe = (entry.ancestor ? entry.volumeRoot ? 0xC0040 : 0xD0150 : 0xD0156)
      | (entry.ancestor && entry.volumeRoot ? 0x10000000 : 0x50000000);
    if (!(system ? privileged : writers).includes(entry.owner)
      || entry.rules.some(rule => rule.allow && (rule.rights & unsafe) !== 0 && !writers.includes(rule.sid)))
      throw new Error("LocalModelAssetAccess");
  }
}
const accessScript = "\n$ErrorActionPreference = 'Stop'\ntry {\n  $assetRoot = [IO.Path]::GetFullPath($env:MINDCARE_MINICPM_ASSET_ROOT)\n  $identitySid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value\n  $programFilesRoot = [Environment]::GetFolderPath('ProgramFiles')\n  $protectedLocation = $assetRoot.StartsWith($programFilesRoot.TrimEnd('\\') + '\\', [StringComparison]::OrdinalIgnoreCase)\n  $paths = [Collections.Generic.List[string]]::new()\n  $paths.Add($assetRoot)\n  foreach ($item in @(Get-ChildItem -LiteralPath $assetRoot -Recurse -Force -ErrorAction Stop)) { $paths.Add($item.FullName) }\n  $ancestor = [IO.DirectoryInfo]::new($assetRoot).Parent\n  while ($null -ne $ancestor) {\n    $item = Get-Item -LiteralPath $ancestor.FullName -Force\n    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'UnsafeAsset' }\n    if ($protectedLocation) { $paths.Add($ancestor.FullName) }\n    $ancestor = $ancestor.Parent\n  }\n  $entries = @()\n  foreach ($assetPath in $paths) {\n    $item = Get-Item -LiteralPath $assetPath -Force\n    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'UnsafeAsset' }\n    $acl = Get-Acl -LiteralPath $assetPath\n    $rules = @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]) | Where-Object { ($_.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -eq 0 } | ForEach-Object {\n      @{ sid=$_.IdentityReference.Value;\n         allow=($_.AccessControlType -eq 'Allow'); rights=[int]$_.FileSystemRights }\n    })\n    $isAncestor = $assetPath -ne $assetRoot -and $assetRoot.StartsWith($assetPath.TrimEnd('\\') + '\\', [StringComparison]::OrdinalIgnoreCase)\n    $entries += @{ owner=$acl.GetOwner([Security.Principal.SecurityIdentifier]).Value; ancestor=$isAncestor; volumeRoot=([IO.Path]::GetPathRoot($assetPath) -eq $assetPath); rules=$rules }\n  }\n  @{ sid=$identitySid; protectedLocation=$protectedLocation; entries=$entries } | ConvertTo-Json -Depth 5 -Compress\n} catch { [Console]::Error.WriteLine('LocalModelAssetAccess'); exit 1 }\n";
export async function readLocalAssetAccess(root: string): Promise<AssetAccess> {
  if (process.platform !== "win32") throw new Error("LocalModelAssetAccess");
  try {
    const { stdout } = await promisify(execFile)("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", accessScript],
      { windowsHide: true, timeout: 15000, maxBuffer: 256000, encoding: "utf8",
        env: { NODE_ENV: "production", SystemRoot: "C:\\Windows", WINDIR: "C:\\Windows", MINDCARE_MINICPM_ASSET_ROOT: root } });
    return JSON.parse(stdout) as AssetAccess;
  } catch { throw new Error("LocalModelAssetAccess"); }
}

export async function verifyLocalAssetAccess(root: string, packaged: boolean): Promise<void> {
  assertLocalAssetAccess(await readLocalAssetAccess(root), packaged);
}

