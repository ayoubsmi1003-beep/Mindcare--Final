# activer-vecteurs-cabinet.ps1 — active l'index vectoriel 768 d'Alexa.
#
#   Ouvrir PowerShell **en tant qu'administrateur**, puis :
#     powershell -ExecutionPolicy Bypass -File scripts\activer-vecteurs-cabinet.ps1
#
# ═══ CE QUE CE SCRIPT FAIT ═══
#   · vérifie qu'il tourne en administrateur (sinon il s'arrête sans rien écrire) ;
#   · vérifie que le modèle e5-base est bien installé sur le poste ;
#   · sauvegarde `runtime.env` avant toute modification ;
#   · ajoute AU PLUS DEUX lignes, et seulement si elles sont absentes :
#         KNOWLEDGE_VECTOR=1
#         KNOWLEDGE_VECTOR_RECETTE=e5-base
#   · relit le fichier pour confirmer, sans jamais afficher son contenu.
#
# ═══ CE QU'IL NE FAIT PAS ═══
#   · Aucune écriture en base, aucun redémarrage de l'application.
#   · Aucune autre variable touchée, aucun secret lu ni affiché.
#   · Aucun changement si les lignes existent déjà (idempotent).
#
# RETOUR ARRIÈRE : supprimer les deux lignes (ou restaurer la sauvegarde
# `runtime.env.bak-<horodatage>`), puis redémarrer MindCare.

[CmdletBinding()]
param(
  [string]$RuntimeEnv = (Join-Path $env:ProgramData 'MindCare\private\runtime.env'),
  [string]$SlugModele = 'e5-base'
)

$ErrorActionPreference = 'Stop'

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "Administrateur requis : ouvrir PowerShell en tant qu'administrateur, puis relancer ce script."
}

if (-not (Test-Path -LiteralPath $RuntimeEnv)) {
  throw "Fichier de configuration serveur introuvable : $RuntimeEnv (application non installée sur ce poste ?)"
}

$modele = Join-Path $env:LOCALAPPDATA "MindCare\modeles\$SlugModele\model.onnx"
if (-not (Test-Path -LiteralPath $modele)) {
  throw "Modèle absent : $modele. Lancer d'abord scripts/telecharger-modele-book.mjs --modele $SlugModele"
}

$souhaitees = [ordered]@{
  'KNOWLEDGE_VECTOR'         = '1'
  'KNOWLEDGE_VECTOR_RECETTE' = $SlugModele
}

$contenu = [IO.File]::ReadAllText($RuntimeEnv)
$existantes = @{}
foreach ($ligne in ($contenu -split "\r?\n")) {
  $nette = $ligne.Trim()
  if ($nette -eq '' -or $nette.StartsWith('#')) { continue }
  $egal = $nette.IndexOf('=')
  if ($egal -lt 1) { continue }
  $existantes[$nette.Substring(0, $egal).Trim()] = $nette.Substring($egal + 1).Trim()
}

$aAjouter = @()
foreach ($cle in $souhaitees.Keys) {
  if (-not $existantes.ContainsKey($cle)) { $aAjouter += "$cle=$($souhaitees[$cle])" }
  elseif ($existantes[$cle] -ne $souhaitees[$cle]) {
    throw "$cle existe déjà avec une AUTRE valeur. Rien n'a été modifié : corriger à la main après sauvegarde."
  }
}

if ($aAjouter.Count -eq 0) {
  Write-Host "Déjà actif : aucune modification."
  exit 0
}

$sauvegarde = "$RuntimeEnv.bak-" + (Get-Date -Format 'yyyyMMdd-HHmmss')
Copy-Item -LiteralPath $RuntimeEnv -Destination $sauvegarde -Force

$separateur = if ($contenu.EndsWith("`n")) { '' } else { "`r`n" }
$ajout = $separateur + ($aAjouter -join "`r`n") + "`r`n"
[IO.File]::AppendAllText($RuntimeEnv, $ajout, (New-Object Text.UTF8Encoding($false)))

# Confirmation SANS afficher le contenu : on relit et on vérifie la présence.
$relu = [IO.File]::ReadAllText($RuntimeEnv)
foreach ($cle in $souhaitees.Keys) {
  $motif = '(?m)^' + [regex]::Escape($cle) + '=' + [regex]::Escape($souhaitees[$cle]) + '\s*$'
  if (-not [regex]::IsMatch($relu, $motif)) { throw "Écriture non confirmée pour $cle. Restaurer $sauvegarde." }
}

Write-Host "Activé : $($aAjouter.Count) ligne(s) ajoutée(s)."
Write-Host "Sauvegarde : $sauvegarde"
Write-Host "Redémarrer MindCare, puis poser une question clinique (le premier appel charge le modèle, ~15-35 s)."
