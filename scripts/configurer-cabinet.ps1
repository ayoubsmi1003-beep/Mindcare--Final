[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [Parameter(Mandatory = $true)][ValidateSet('Host', 'Client')][string]$Mode,
    [Parameter(Mandatory = $true)][string]$InstallDir,
    [string]$Origin,
    [string]$PublicCertificate,
    [string]$CertificateSha256,
    [string]$InvitationFile,
    [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Test-ClinicOrigin([string]$Value) {
    if ($Value -notmatch '^https://[a-zA-Z0-9.\[\]:-]+/?$') { throw 'Adresse HTTPS du cabinet invalide.' }
    $uri = [Uri]$Value
    if ($uri.Scheme -ne 'https' -or $uri.UserInfo -or $uri.AbsolutePath -ne '/' -or $uri.Query -or $uri.Fragment) { throw 'Une origine HTTPS sans chemin est obligatoire.' }
    $hostName = $uri.DnsSafeHost.Trim('[', ']').ToLowerInvariant()
    $ip = $null
    if ([Net.IPAddress]::TryParse($hostName, [ref]$ip)) {
        $bytes = $ip.GetAddressBytes()
        if ($bytes.Length -eq 4) {
            $local = $bytes[0] -eq 10 -or $bytes[0] -eq 127 -or ($bytes[0] -eq 192 -and $bytes[1] -eq 168) -or ($bytes[0] -eq 172 -and $bytes[1] -ge 16 -and $bytes[1] -le 31)
        } else { $local = [Net.IPAddress]::IsLoopback($ip) -or (($bytes[0] -band 254) -eq 252) }
    } else { $local = $hostName -match '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$' -or $hostName -match '^([a-z0-9-]+\.)+(lan|local|internal)$' -or $hostName -match '^([a-z0-9-]+\.)+home\.arpa$' }
    if (-not $local) { throw 'Utiliser uniquement une adresse locale au cabinet.' }
    return $uri.GetLeftPart([UriPartial]::Authority).TrimEnd('/')
}

function Write-Utf8([string]$File, [string]$Text) { [IO.File]::WriteAllText($File, $Text, [Text.UTF8Encoding]::new($false)) }
function New-ClinicAcl([bool]$Directory, [bool]$PublicRead = $false) {
    if ($Directory) { $acl = [Security.AccessControl.DirectorySecurity]::new() } else { $acl = [Security.AccessControl.FileSecurity]::new() }
    $acl.SetAccessRuleProtection($true, $false)
    $admins = [Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')
    $system = [Security.Principal.SecurityIdentifier]::new('S-1-5-18')
    $acl.SetOwner($admins)
    $inherit = [Security.AccessControl.InheritanceFlags]::None
    if ($Directory) { $inherit = [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit }
    foreach ($sid in @($admins, $system)) { $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid, [Security.AccessControl.FileSystemRights]::FullControl, $inherit, [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Allow)) }
    if ($PublicRead) {
        $users = [Security.Principal.SecurityIdentifier]::new('S-1-5-32-545')
        $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($users, [Security.AccessControl.FileSystemRights]::ReadAndExecute, [Security.AccessControl.InheritanceFlags]::None, [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Allow))
    }
    return $acl
}
function Set-ClinicAcl([string]$Target, [bool]$Directory, [bool]$PublicRead = $false) {
    $acl = New-ClinicAcl $Directory $PublicRead
    if ($Directory) { [IO.Directory]::SetAccessControl($Target, $acl) } else { [IO.File]::SetAccessControl($Target, $acl) }
}
function Test-AdministratorAcl($Acl, [bool]$Ancestor = $false, [bool]$PrivateOnly = $false, [bool]$VolumeRoot = $false) {
    $trusted = @('S-1-5-18', 'S-1-5-32-544', 'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464')
    if ($trusted -notcontains $Acl.GetOwner([Security.Principal.SecurityIdentifier]).Value) { throw 'Propriétaire du dossier ou fichier non contrôlé par l''administrateur.' }
    $unsafe = [Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor [Security.AccessControl.FileSystemRights]::ChangePermissions -bor [Security.AccessControl.FileSystemRights]::TakeOwnership
    # Une racine de volume ne peut pas être renommée/supprimée. Son droit
    # Delete standard ne permet pas de supprimer le dossier Program Files.
    if (-not ($Ancestor -and $VolumeRoot)) { $unsafe = $unsafe -bor [Security.AccessControl.FileSystemRights]::Delete }
    if (-not $Ancestor) { $unsafe = $unsafe -bor [Security.AccessControl.FileSystemRights]::Write }
    foreach ($rule in $Acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
        if ($rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow -or ($rule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly)) { continue }
        if ($trusted -notcontains $rule.IdentityReference.Value -and ($PrivateOnly -or ($rule.FileSystemRights -band $unsafe))) { throw 'Permissions incompatibles: un utilisateur ordinaire peut lire un secret privé ou modifier le code du serveur. Reprise administrateur requise.' }
    }
}
function Get-ClinicTree([string]$Target) {
    $full = [IO.Path]::GetFullPath($Target)
    $ancestor = $full
    while ($ancestor) {
        if ([IO.File]::GetAttributes($ancestor) -band [IO.FileAttributes]::ReparsePoint) { throw 'Lien ou jonction refusé dans les chemins du cabinet.' }
        $parent = [IO.Directory]::GetParent($ancestor)
        $ancestor = $null
        if ($parent) { $ancestor = $parent.FullName }
    }
    $pending = [Collections.Generic.Stack[string]]::new(); $pending.Push($full)
    while ($pending.Count) {
        $current = $pending.Pop()
        $attributes = [IO.File]::GetAttributes($current)
        if ($attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Lien ou jonction refusé dans les fichiers du cabinet.' }
        Write-Output $current
        if ($attributes -band [IO.FileAttributes]::Directory) { foreach ($child in [IO.Directory]::EnumerateFileSystemEntries($current)) { $pending.Push($child) } }
    }
}
function Assert-ClinicInstall([string]$Install) {
    $programFiles = [Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFiles)
    if (-not $programFiles -or -not $Install.StartsWith($programFiles.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Installer MindCare dans Program Files avec les droits administrateur avant de configurer le serveur.' }
    foreach ($file in @(Get-ClinicTree $Install)) {
        if ([IO.Directory]::Exists($file)) { $acl = [IO.Directory]::GetAccessControl($file) } else { $acl = [IO.File]::GetAccessControl($file) }
        Test-AdministratorAcl $acl $false
    }
    $parent = [IO.Directory]::GetParent($Install)
    while ($parent) { Test-AdministratorAcl ([IO.Directory]::GetAccessControl($parent.FullName)) $true $false ($null -eq $parent.Parent); $parent = $parent.Parent }
}
function Assert-SetupPolicy([string]$Policy) {
    if ($Policy -notin @('RemoteSigned', 'AllSigned')) { throw 'Politique PowerShell incompatible. Utiliser une procédure approuvée par l''administrateur (RemoteSigned pour fichiers locaux ou scripts signés AllSigned). Aucune politique Windows ne sera modifiée.' }
}
function Get-CertificateHash([byte[]]$Bytes) {
    $hash = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($hash.ComputeHash($Bytes)).Replace('-', '').ToLowerInvariant() } finally { $hash.Dispose() }
}
function Trust-PublicCertificate([byte[]]$Bytes) {
    $cert = [Security.Cryptography.X509Certificates.X509Certificate2]::new($Bytes)
    $store = [Security.Cryptography.X509Certificates.X509Store]::new('Root', 'LocalMachine')
    try { $store.Open([Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite); $store.Add($cert) } finally { $store.Close(); $cert.Dispose() }
}

$install = (Resolve-Path -LiteralPath $InstallDir).ProviderPath
$resources = Join-Path $install 'resources'
$exeName = 'MindCare OS.exe'
$exe = Join-Path $install $exeName
if (-not (Test-Path -LiteralPath $exe -PathType Leaf) -or -not (Test-Path -LiteralPath (Join-Path $resources 'app.asar') -PathType Leaf)) { throw 'Installation MindCare introuvable dans le dossier indiqué.' }
if ($InvitationFile) {
    if ($Mode -ne 'Host') { throw 'Invitation réservée au PC médecin.' }
    $principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Installation administrateur requise.' }
    Assert-ClinicInstall $install
    $privateFolder = Join-Path $env:ProgramData 'MindCare\private'
    if (-not (Test-Path -LiteralPath (Join-Path $privateFolder 'clinic-server.json'))) { throw 'Cabinet non initialisé.' }
    if ([IO.File]::GetAttributes($InvitationFile) -band [IO.FileAttributes]::ReparsePoint) { throw 'Invitation invalide.' }
    if ((Get-Item -LiteralPath $InvitationFile).Length -gt 512) { throw 'Invitation invalide.' }
    $invite = Get-Content -Raw -LiteralPath $InvitationFile | ConvertFrom-Json
    $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    if ($invite.secret -cnotmatch '^[A-Za-z0-9_-]{24}$' -or $invite.expiresAt -le $now -or $invite.expiresAt -gt ($now + 310000)) { throw 'Invitation invalide.' }
    $target = Join-Path $privateFolder 'clinic-invitation.json'
    Write-Utf8 $target (@{secret=$invite.secret; expiresAt=$invite.expiresAt} | ConvertTo-Json -Compress)
    Set-ClinicAcl $target $false
    return
}
if (-not $Origin -and $Mode -eq 'Host' -and (Test-Path -LiteralPath (Join-Path $env:ProgramData 'MindCare\desktop.json'))) {
    $Origin = (Get-Content -Raw -LiteralPath (Join-Path $env:ProgramData 'MindCare\desktop.json') | ConvertFrom-Json).origin
}
if (-not $Origin) {
    if ($Mode -eq 'Client') { throw 'Indiquer l''adresse HTTPS fournie par le poste Médecin.' }
    $Origin = 'https://' + $env:COMPUTERNAME.ToLowerInvariant() + ':43118'
}
$originValue = Test-ClinicOrigin $Origin
$root = Join-Path $env:ProgramData 'MindCare'
$desktop = Join-Path $root 'desktop.json'
$private = Join-Path $root 'private'
$serverConfig = Join-Path $private 'clinic-server.json'
$publicFile = Join-Path $root 'clinic-public.cer'
$expectedMode = 'host'
if ($Mode -eq 'Client') { $expectedMode = 'client' }
if (Test-Path -LiteralPath $desktop) {
    $existing = Get-Content -Raw -LiteralPath $desktop | ConvertFrom-Json
    if ($existing.version -ne 1 -or $existing.mode -ne $expectedMode -or $existing.origin -ne $originValue) { throw 'Configuration existante différente: faire vérifier le changement par l''administrateur. Aucun fichier n''a été remplacé.' }
} elseif (Test-Path -LiteralPath (Join-Path $root 'data\PG_VERSION')) {
    throw 'Base locale existante: sauvegarde et validation des données requises avant passage au cabinet partagé. Aucune base n''a été modifiée.'
}
if ($Mode -eq 'Host') {
    foreach ($file in @('serveur\server.js', 'pgsql\bin\pg_ctl.exe', 'cabinet\lancer-serveur-cabinet.cmd')) {
        if (-not (Test-Path -LiteralPath (Join-Path $resources $file) -PathType Leaf)) { throw ('Ressource du serveur absente: ' + $file) }
    }
    if ((Test-Path -LiteralPath $desktop) -and -not (Test-Path -LiteralPath $serverConfig)) { throw 'Configuration serveur privée absente: contacter le support.' }
    if (-not (Test-Path -LiteralPath $serverConfig) -and ((Test-Path -LiteralPath (Join-Path $private 'clinic.pfx')) -or (Test-Path -LiteralPath (Join-Path $private 'clinic-pfx-password.dpapi')))) { throw 'Certificat privé préexistant sans configuration: contacter le support. Aucun secret ne sera remplacé.' }
} else {
    if (Test-Path -LiteralPath (Join-Path $root 'data\PG_VERSION')) { throw 'Ce poste contient déjà la base du cabinet. Aucun changement de machine autorisé.' }
    if (-not $PublicCertificate -or $CertificateSha256 -notmatch '^[0-9a-fA-F]{64}$') { throw 'Certificat public et empreinte SHA-256 fournis par le Médecin requis.' }
    $certificateBytes = [IO.File]::ReadAllBytes((Resolve-Path -LiteralPath $PublicCertificate).ProviderPath)
    if ((Get-CertificateHash $certificateBytes) -ne $CertificateSha256.ToLowerInvariant()) { throw 'Empreinte du certificat incorrecte. Aucun certificat n''a été approuvé.' }
    $certificateProbe = [Security.Cryptography.X509Certificates.X509Certificate2]::new($certificateBytes)
    try { if ($certificateProbe.HasPrivateKey -or $certificateProbe.NotAfter -le (Get-Date)) { throw 'Certificat public invalide ou expiré.' } } finally { $certificateProbe.Dispose() }
}
if ($DryRun -or $WhatIfPreference) {
    [pscustomobject]@{ mode = $expectedMode; origin = $originValue; install = $install; desktopConfig = $desktop; dataModified = $false; systemModified = $false; planned = 'Configuration, certificat local et (Médecin) tâche de démarrage + pare-feu privé' } | ConvertTo-Json
    return
}
$principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Ouvrir Windows PowerShell en tant qu''administrateur.' }
if (-not $PSCmdlet.ShouldProcess($originValue, 'Configurer ce poste MindCare et approuver son certificat du cabinet')) { return }
# Le programme installé exécute ce ScriptBlock local; aucune politique modifiée.
Assert-ClinicInstall $install
if (Test-Path -LiteralPath $root) { Test-AdministratorAcl ([IO.Directory]::GetAccessControl($root)) $false; Get-ClinicTree $root | Out-Null }
foreach ($file in @($desktop, $publicFile)) { if (Test-Path -LiteralPath $file) { Test-AdministratorAcl ([IO.File]::GetAccessControl($file)) $false } }
if ($Mode -eq 'Host') {
    $ownedTask = Get-ScheduledTask -TaskName 'MindCare-Clinic-Server' -ErrorAction SilentlyContinue
    if ($ownedTask -and $ownedTask.Description -ne 'Serveur clinique MindCare OS — configuration administrateur') { throw 'Tâche Windows non reconnue.' }
    foreach ($folder in @($private, (Join-Path $root 'data'), (Join-Path $root 'logs'), (Join-Path $root 'backups'))) {
        if (Test-Path -LiteralPath $folder) {
            foreach ($file in @(Get-ClinicTree $folder)) {
                if ([IO.Directory]::Exists($file)) { $acl = [IO.Directory]::GetAccessControl($file) } else { $acl = [IO.File]::GetAccessControl($file) }
                Test-AdministratorAcl $acl $false $true
            }
        }
    }
    $databaseEnv = Join-Path $root 'mindcare.env'
    if (Test-Path -LiteralPath $databaseEnv) { Test-AdministratorAcl ([IO.File]::GetAccessControl($databaseEnv)) $false $true; Set-ClinicAcl $databaseEnv $false }
}
New-Item -ItemType Directory -Force -Path $root | Out-Null
Set-ClinicAcl $root $true $true
if ($Mode -eq 'Host') {
    foreach ($directory in @($private, (Join-Path $root 'logs'), (Join-Path $root 'data'), (Join-Path $root 'backups'))) { New-Item -ItemType Directory -Force -Path $directory | Out-Null; Set-ClinicAcl $directory $true }
    # Refaire les ACL explicites des fichiers existants, après validation préalable.
    foreach ($file in @(Get-ClinicTree $private)) { Set-ClinicAcl $file ([IO.Directory]::Exists($file)) }
    if (-not (Test-Path -LiteralPath $serverConfig)) {
        $certificate = $null
        $rsa = [Security.Cryptography.RSACng]::new(3072)
        $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
        try {
            $request = [Security.Cryptography.X509Certificates.CertificateRequest]::new('CN=MindCare cabinet', $rsa, [Security.Cryptography.HashAlgorithmName]::SHA256, [Security.Cryptography.RSASignaturePadding]::Pkcs1)
            $san = [Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new()
            $serverName = ([Uri]$originValue).DnsSafeHost.Trim('[', ']')
            $address = $null
            if ([Net.IPAddress]::TryParse($serverName, [ref]$address)) { $san.AddIpAddress($address) } else { $san.AddDnsName($serverName) }
            $request.CertificateExtensions.Add($san.Build())
            $request.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($false, $false, 0, $true))
            $oids = [Security.Cryptography.OidCollection]::new(); $oids.Add([Security.Cryptography.Oid]::new('1.3.6.1.5.5.7.3.1')) | Out-Null
            $request.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]::new($oids, $false))
            $certificate = $request.CreateSelfSigned([DateTimeOffset]::Now.AddMinutes(-5), [DateTimeOffset]::Now.AddYears(2))
            $random = New-Object byte[] 32; $rng.GetBytes($random); $password = [Convert]::ToBase64String($random)
            [IO.File]::WriteAllBytes((Join-Path $private 'clinic.pfx'), $certificate.Export([Security.Cryptography.X509Certificates.X509ContentType]::Pfx, $password))
            Add-Type -AssemblyName System.Security
            [IO.File]::WriteAllBytes((Join-Path $private 'clinic-pfx-password.dpapi'), [Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($password), $null, [Security.Cryptography.DataProtectionScope]::LocalMachine))
            [IO.File]::WriteAllBytes($publicFile, $certificate.Export([Security.Cryptography.X509Certificates.X509ContentType]::Cert))
        } finally { if ($null -ne $certificate) { $certificate.Dispose() }; $rsa.Dispose(); $rng.Dispose(); $password = $null }
    }
    foreach ($file in @('clinic.pfx', 'clinic-pfx-password.dpapi')) { if (-not (Test-Path -LiteralPath (Join-Path $private $file))) { throw 'Certificat serveur incomplet: contacter le support sans supprimer la base.' } }
    if (-not (Test-Path -LiteralPath $publicFile)) { throw 'Certificat public du cabinet absent.' }
    foreach ($file in @('clinic.pfx', 'clinic-pfx-password.dpapi')) { Set-ClinicAcl (Join-Path $private $file) $false }
    Set-ClinicAcl $publicFile $false $true
    # Le certificat approuvé doit être exactement celui de la clé privée du serveur.
    Add-Type -AssemblyName System.Security
    $tlsPassword = [Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes((Join-Path $private 'clinic-pfx-password.dpapi')), $null, [Security.Cryptography.DataProtectionScope]::LocalMachine))
    $serverCertificate = [Security.Cryptography.X509Certificates.X509Certificate2]::new([IO.File]::ReadAllBytes((Join-Path $private 'clinic.pfx')), $tlsPassword, [Security.Cryptography.X509Certificates.X509KeyStorageFlags]::EphemeralKeySet)
    try { if ($serverCertificate.NotAfter -le (Get-Date) -or (Get-CertificateHash $serverCertificate.RawData) -ne (Get-CertificateHash ([IO.File]::ReadAllBytes($publicFile)))) { throw 'Le certificat public ne correspond pas au serveur ou est expiré. Aucun certificat approuvé.' } } finally { $serverCertificate.Dispose(); $tlsPassword = $null }
    Trust-PublicCertificate ([IO.File]::ReadAllBytes($publicFile))
    Write-Utf8 $serverConfig (@{ version = 1; origin = $originValue; resourcesDir = $resources } | ConvertTo-Json)
    $identityFile = Join-Path $root 'clinic-identity.json'
    if (-not (Test-Path -LiteralPath $identityFile)) { Write-Utf8 $identityFile (@{id=[Guid]::NewGuid().ToString(); origin=$originValue} | ConvertTo-Json -Compress) }
    Set-ClinicAcl $identityFile $false $true
    if (-not (Test-Path -LiteralPath (Join-Path $private 'runtime.env'))) { Write-Utf8 (Join-Path $private 'runtime.env') "# Configuration serveur facultative; aucune clé requise pour le dossier médical.`r`n# Ne pas activer les fournisseurs cliniques avant leur qualification.`r`n" }
    foreach ($file in @(Get-ClinicTree $private)) { Set-ClinicAcl $file ([IO.Directory]::Exists($file)) }
    $taskName = 'MindCare-Clinic-Server'
    $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($task -and $task.Description -ne 'Serveur clinique MindCare OS — configuration administrateur') { throw 'Tâche Windows existante non reconnue: aucun remplacement autorisé.' }
    $runner = Join-Path $resources 'cabinet\lancer-serveur-cabinet.cmd'
    $arguments = '/d /s /c ""' + $runner + '" "' + $install + '""'
    $commandExe = Join-Path $env:SystemRoot 'System32\cmd.exe'
    $action = New-ScheduledTaskAction -Execute $commandExe -Argument $arguments
    $trigger = @(New-ScheduledTaskTrigger -AtStartup; New-ScheduledTaskTrigger -AtLogOn)
    $settings = New-ScheduledTaskSettingsSet -RestartCount 10 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    $identity = New-ScheduledTaskPrincipal -UserId 'S-1-5-18' -LogonType ServiceAccount -RunLevel Highest
    if ($task -and $task.State -eq 'Running') { Stop-ScheduledTask -TaskName $taskName; Start-Sleep -Seconds 2 }
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $identity -Description 'Serveur clinique MindCare OS — configuration administrateur' -Force | Out-Null
    $ruleName = 'MindCare-Cabinet-HTTPS'
    $rule = Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue
    if ($rule -and $rule.Group -ne 'MindCare OS Clinique') { throw 'Règle pare-feu existante non reconnue.' }
    if ($rule) { Remove-NetFirewallRule -Name $ruleName }
    $port = ([Uri]$originValue).Port
    New-NetFirewallRule -Name $ruleName -DisplayName 'MindCare cabinet HTTPS' -Group 'MindCare OS Clinique' -Direction Inbound -Action Allow -Protocol TCP -LocalPort $port -Profile Any -RemoteAddress LocalSubnet -Program $exe | Out-Null
    $discoveryRule = Get-NetFirewallRule -Name 'MindCare-Cabinet-Discovery' -ErrorAction SilentlyContinue
    if ($discoveryRule -and $discoveryRule.Group -ne 'MindCare OS Clinique') { throw 'Règle de découverte non reconnue.' }
    if ($discoveryRule) { Remove-NetFirewallRule -Name 'MindCare-Cabinet-Discovery' }
    New-NetFirewallRule -Name 'MindCare-Cabinet-Discovery' -DisplayName 'MindCare découverte locale' -Group 'MindCare OS Clinique' -Direction Inbound -Action Allow -Protocol UDP -LocalPort 43119 -Profile Any -RemoteAddress LocalSubnet -Program $exe | Out-Null
} else {
    [IO.File]::WriteAllBytes($publicFile, $certificateBytes)
    Trust-PublicCertificate $certificateBytes
}
Set-ClinicAcl $publicFile $false $true
Write-Utf8 $desktop (@{ version = 1; mode = $expectedMode; origin = $originValue } | ConvertTo-Json)
Set-ClinicAcl $desktop $false $true
if ($Mode -eq 'Host') { Start-ScheduledTask -TaskName 'MindCare-Clinic-Server' }
[pscustomobject]@{ mode = $expectedMode; origin = $originValue; publicCertificate = $publicFile; certificateSha256 = Get-CertificateHash ([IO.File]::ReadAllBytes($publicFile)); next = 'Vérifier les journaux et les comptes; la qualification clinique reste obligatoire.' } | ConvertTo-Json
