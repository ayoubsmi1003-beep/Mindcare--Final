/**
 * Installation automatique depuis un dossier non protégé — premier lancement.
 *
 * ═══ LE PROBLÈME QUE CE MODULE SUPPRIME ═════════════════════════════════════
 *
 * Le serveur du cabinet exige que son dossier ne soit pas modifiable par un
 * compte Windows ordinaire (sinon n'importe quel utilisateur pourrait remplacer
 * le binaire qui lit les dossiers patients). Un dossier copié sur le Bureau,
 * dans le profil ou sur une clé USB ne peut donc pas être configuré — et le
 * refus, quoique correct, obligeait à comprendre puis à refaire une copie.
 *
 * Ici, l'application constate elle-même qu'elle n'est pas au bon endroit,
 * demande l'accord de l'utilisateur, se copie vers `C:\Program Files\MindCare
 * OS` avec les ACL attendues, crée le raccourci du Bureau et se relance. C'est
 * le comportement d'un installeur, sans en être un : aucun registre de
 * désinstallation, aucun service caché, et `%ProgramData%\MindCare` n'est
 * jamais touché.
 *
 * ═══ CE QU'ELLE NE FAIT JAMAIS ══════════════════════════════════════════════
 *
 * · elle ne copie rien sans un accord explicite (boîte Oui/Quitter) ;
 * · elle ne s'auto-élève pas en silence : Windows affiche son autorisation ;
 * · elle ne lance pas l'application avec le jeton administrateur — la nouvelle
 *   instance part par l'Explorateur, donc avec le compte de l'utilisateur ;
 * · elle ne supprime ni ne déplace l'ancienne copie.
 */

import { app, dialog } from "electron";
import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const CIBLE = "C:\\Program Files\\MindCare OS";

/**
 * Un emplacement est « protégé » s'il est sous Program Files, ou s'il est un
 * dossier de premier niveau d'un volume (`C:\MindCare`), que seul un
 * administrateur peut créer. Le script de configuration revérifie ensuite les
 * ACL réelles, fichier par fichier : cette fonction ne fait qu'éviter une
 * invite inutile quand l'application est déjà bien placée.
 */
export function emplacementProtege(install: string): boolean {
  const programFiles = (process.env["ProgramFiles"] ?? "C:\\Program Files").toLowerCase();
  if (install.toLowerCase().startsWith(`${programFiles}\\`)) return true;
  return /^[A-Za-z]:\\[^\\]+$/.test(install);
}

function scriptInstallation(source: string): string {
  const s = source.replaceAll("'", "''");
  return `
$ErrorActionPreference = 'Stop'
$source = '${s}'
$cible  = '${CIBLE.replaceAll("'", "''")}'

Write-Host "Installation de MindCare dans $cible ..."
New-Item -ItemType Directory -Force -Path $cible | Out-Null
$code = (Start-Process -FilePath 'robocopy.exe' -ArgumentList @($source, $cible, '/E', '/COPY:DAT', '/DCOPY:DA', '/R:1', '/W:1') -Wait -PassThru).ExitCode
if ($code -ge 8) { Write-Host "La copie a echoue (robocopy $code)."; Start-Sleep -Seconds 6; exit 1 }

icacls $cible /setowner '*S-1-5-32-544' /T /C | Out-Null
icacls $cible /inheritance:r /grant:r '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-545:(OI)(CI)RX' | Out-Null

$bureau = [Environment]::GetFolderPath('CommonDesktopDirectory')
if ($bureau) {
  $shell = New-Object -ComObject WScript.Shell
  $lien = $shell.CreateShortcut((Join-Path $bureau 'MindCare OS.lnk'))
  $lien.TargetPath = (Join-Path $cible 'MindCare OS.exe')
  $lien.WorkingDirectory = $cible
  $lien.IconLocation = (Join-Path $cible 'MindCare OS.exe') + ',0'
  $lien.Description = 'MindCare OS - cabinet'
  $lien.Save()
}

# Ce PC était-il déjà configuré comme hôte ? Si oui, la tâche Windows doit
# pointer vers le nouveau dossier et le service redémarrer.
$desktop = Join-Path $env:ProgramData 'MindCare\\desktop.json'
if (Test-Path -LiteralPath $desktop) {
  try {
    $configuration = Get-Content -Raw -LiteralPath $desktop | ConvertFrom-Json
    if ($configuration.mode -eq 'host') {
      Write-Host "Mise a jour du service du cabinet ..."
      & (Join-Path $cible 'resources\\cabinet\\configurer-cabinet.ps1') -Mode Host -InstallDir $cible | Out-Null
    }
  } catch {
    Write-Host "Le service du cabinet n'a pas pu etre reconfigurer ; l'application le signalera."
  }
}

# Relance par l'Explorateur : la nouvelle instance garde le compte de
# l'utilisateur, jamais le jeton administrateur de ce script.
Start-Process -FilePath 'explorer.exe' -ArgumentList ('"' + (Join-Path $cible 'MindCare OS.exe') + '"')
exit 0
`;
}

/**
 * Rend `true` quand l'application peut continuer (déjà bien installée), `false`
 * quand elle vient d'être copiée (l'instance courante doit s'arrêter) ou quand
 * l'utilisateur a refusé.
 */
export async function garantirInstallation(): Promise<boolean> {
  if (!app.isPackaged) return true;

  const install = path.dirname(process.execPath);
  if (emplacementProtege(install)) return true;

  const reponse = await dialog.showMessageBox({
    type: "question",
    title: "MindCare OS",
    message: `MindCare doit être installé dans ${CIBLE}.`,
    detail:
      "Cliquez sur Installer : Windows demandera une autorisation, puis l'application sera copiée et relancée. " +
      "Vos données du cabinet ne sont ni déplacées ni modifiées.",
    buttons: ["Installer", "Quitter"],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });
  if (reponse.response !== 0) return false;

  const dossierTemp = app.getPath("temp");
  mkdirSync(dossierTemp, { recursive: true });
  const script = path.join(dossierTemp, `mindcare-install-${Date.now()}.ps1`);
  writeFileSync(script, scriptInstallation(install), "utf8");

  const powershell = path.join(
    process.env["SystemRoot"] ?? "C:\\Windows",
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  const echappe = (valeur: string): string => valeur.replaceAll("'", "''");
  const lancement =
    `$p = Start-Process -FilePath '${echappe(powershell)}' ` +
    `-ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File','${echappe(script)}') ` +
    `-Verb RunAs -Wait -PassThru; exit $p.ExitCode`;

  await new Promise<void>((resoudre) => {
    execFile(
      powershell,
      ["-NoProfile", "-NonInteractive", "-Command", lancement],
      { windowsHide: true, timeout: 30 * 60_000 },
      () => resoudre(),
    );
  });

  return false;
}
