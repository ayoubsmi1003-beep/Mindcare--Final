# ============================================================================
#  MindCare — installation portable, sans installateur.
#
#  Copie le dossier de l'application vers un emplacement protégé, applique les
#  permissions que le serveur du cabinet exige, crée le raccourci du Bureau et,
#  pour le PC médecin, configure le service une seule fois.
#
#  Il ne touche PAS à %ProgramData%\MindCare : données, base et sauvegardes
#  restent intactes.
#
#  UTILISATION NORMALE : double-cliquez sur Installer-MindCare.cmd.
#  En ligne de commande (PowerShell) :
#    .\Installer-Portable-MindCare.ps1                 # PC accueil
#    .\Installer-Portable-MindCare.ps1 -ConfigureHost  # PC médecin
#    .\Installer-Portable-MindCare.ps1 -Force          # remplacer une version
#
#  Le script demande lui-même l'autorisation Windows s'il n'est pas déjà élevé.
# ============================================================================
[CmdletBinding()]
param(
    [string]$Target = "C:\Program Files\MindCare OS",
    [switch]$Force,
    [switch]$ConfigureHost
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# ── Élévation : on se relance une fois, avec les mêmes arguments ─────────────
$principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    $arguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $PSCommandPath, '-Target', $Target)
    if ($Force) { $arguments += '-Force' }
    if ($ConfigureHost) { $arguments += '-ConfigureHost' }
    Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $arguments | Out-Null
    exit
}

$source = $PSScriptRoot
$executable = Join-Path $source 'MindCare OS.exe'
if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) {
    throw "MindCare OS.exe est absent du dossier du script ($source). Placez ce script DANS le dossier de l'application."
}

# Déjà installé à cet endroit (on relance le script depuis la cible) : on ne
# recopie pas par-dessus le dossier en cours d'utilisation.
$dejaSurPlace = [IO.Path]::GetFullPath($source).TrimEnd('\') -eq [IO.Path]::GetFullPath($Target).TrimEnd('\')
if (-not $dejaSurPlace) {
    if (Test-Path -LiteralPath $Target) {
        if (-not $Force) {
            Write-Host "Le dossier existe déjà : $Target"
            Write-Host "Fermez MindCare, puis relancez avec -Force pour le remplacer."
            Read-Host "Appuyez sur Entrée pour fermer"
            exit 2
        }
    }

    Write-Host "Copie de MindCare vers $Target ..."
    New-Item -ItemType Directory -Force -Path $Target | Out-Null

    # /E : sous-dossiers vides compris. /COPY:DAT : données, attributs, dates.
    # Pas de /COPY:S : les ACL de la source ne sont pas recopiées, le dossier
    # cible reçoit les siennes juste après. /XF : ce script ne se recopie pas.
    $copie = robocopy $source $Target /E /COPY:DAT /DCOPY:DA /R:1 /W:1 /XF 'Installer-Portable-MindCare.ps1' 'Installer-MindCare.cmd' /NFL /NDL /NJH /NJS
    if ($LASTEXITCODE -ge 8) {
        throw "La copie a échoué (robocopy code $LASTEXITCODE). Aucune donnée du cabinet n'a été modifiée."
    }

    Write-Host "Verrouillage des permissions ..."
    # Propriétaire = Administrateurs, puis ACL explicite, identique à ce que
    # Windows met sous Program Files : Administrateurs et SYSTEM en contrôle
    # total, Utilisateurs en LECTURE/EXÉCUTION seulement (sinon un compte
    # ordinaire ne pourrait pas lancer l'application), aucune héritage.
    icacls $Target /setowner '*S-1-5-32-544' /T /C | Out-Null
    icacls $Target /inheritance:r /grant:r '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-545:(OI)(CI)RX' | Out-Null

    # Raccourci du Bureau public : l'application apparaît comme les autres.
    $bureau = [Environment]::GetFolderPath([Environment+SpecialFolder]::CommonDesktopDirectory)
    if ($bureau) {
        $raccourci = Join-Path $bureau 'MindCare OS.lnk'
        $shell = New-Object -ComObject WScript.Shell
        $lien = $shell.CreateShortcut($raccourci)
        $lien.TargetPath = Join-Path $Target 'MindCare OS.exe'
        $lien.WorkingDirectory = $Target
        $lien.IconLocation = (Join-Path $Target 'MindCare OS.exe') + ',0'
        $lien.Description = 'MindCare OS — cabinet'
        $lien.Save()
    }
}

if ($ConfigureHost) {
    $configuration = Join-Path $Target 'resources\cabinet\configurer-cabinet.ps1'
    if (-not (Test-Path -LiteralPath $configuration -PathType Leaf)) {
        throw "Script de configuration absent du paquet : $configuration"
    }
    Write-Host ""
    Write-Host "Configuration de ce PC comme PC medecin (certificat, service, pare-feu) ..."
    & $configuration -Mode Host -InstallDir $Target | Out-Null
    Write-Host "Le service du cabinet est configure et demarre."
}

Write-Host ""
Write-Host "MindCare est pret."
Write-Host "Lancez : $(Join-Path $Target 'MindCare OS.exe')"
if (-not $ConfigureHost) {
    Write-Host "Sur ce poste d'accueil, ouvrez MindCare puis saisissez l'invitation du PC medecin."
}
Start-Sleep -Seconds 2
