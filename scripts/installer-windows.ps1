# installer-windows.ps1 — provisionne MindCare sur le poste du cabinet.
#
# ═══ CE QUE CE SCRIPT FAIT, ET CE QU'IL REFUSE DE FAIRE ══════════════════════
#
# Il prépare une base PostgreSQL LOCALE pour MindCare : base, rôles, schéma,
# migrations, mot de passe applicatif. Il ne télécharge rien, ne contacte aucun
# service, et n'ouvre aucun port sur le réseau.
#
# Il REFUSE de continuer si PostgreSQL écoute ailleurs que sur la boucle locale.
# Ce n'est pas une précaution de confort : une base de dossiers psychiatriques
# joignable depuis le réseau du cabinet est exactement ce que la loi 18-07
# interdit, et `docs/SELF-HOST-SETUP.md` §2.3 l'exige déjà pour la variante
# Docker. Le refus est le comportement correct, pas un obstacle à contourner.
#
# ═══ CE QU'IL NE FAIT PAS, DÉLIBÉRÉMENT ═════════════════════════════════════
#
#   · il n'INSTALLE pas PostgreSQL. Une installation de service Windows engage
#     la machine entière ; elle se fait avec l'installateur officiel EDB, une
#     fois, en connaissance de cause. Ce script vérifie qu'elle est là ;
#   · il ne modifie NI `postgresql.conf` NI `pg_hba.conf`. Il les LIT et refuse
#     si la configuration est dangereuse. Réécrire la configuration d'un service
#     que le script n'a pas installé, c'est casser silencieusement autre chose ;
#   · il ne touche à aucune base existante autre que `mindcare`.
#
# ═══ USAGE ══════════════════════════════════════════════════════════════════
#
#   powershell -ExecutionPolicy Bypass -File scripts\installer-windows.ps1 `
#       -PgBin "C:\Program Files\PostgreSQL\17\bin" `
#       -SuperUser postgres
#
# Le mot de passe du superutilisateur est demandé de façon masquée, jamais
# passé en argument : la ligne de commande est visible par tout processus de la
# machine, et elle finit dans l'historique PowerShell.

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$PgBin,
  [string]$SuperUser = "postgres",
  [string]$PgHost = "127.0.0.1",
  [int]$PgPort = 5432,
  [string]$BaseName = "mindcare",
  [string]$SecretsDir = "$env:ProgramData\MindCare"
)

$ErrorActionPreference = "Stop"
$racine = Split-Path -Parent $PSScriptRoot

function Etape($n, $t) { Write-Host "`n$n · $t" -ForegroundColor Cyan }
function Vert($t)      { Write-Host "  OK   $t" -ForegroundColor Green }
function Rouge($t)     { Write-Host "  STOP $t" -ForegroundColor Red }

$psql = Join-Path $PgBin "psql.exe"
if (-not (Test-Path $psql)) {
  Rouge "psql introuvable dans $PgBin."
  Write-Host "  Installer PostgreSQL 15 ou plus recent, puis relancer avec -PgBin."
  exit 1
}

# ── Le mot de passe du superutilisateur, saisi masqué ────────────────────────
$motDePasse = Read-Host -AsSecureString "Mot de passe du role $SuperUser"
$brut = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
  [Runtime.InteropServices.Marshal]::SecureStringToBSTR($motDePasse))
$env:PGPASSWORD = $brut

function SQL($base, $requete) {
  & $psql -h $PgHost -p $PgPort -U $SuperUser -d $base -tAX -v ON_ERROR_STOP=1 -c $requete 2>&1
}
function SQLFichier($base, $fichier) {
  & $psql -h $PgHost -p $PgPort -U $SuperUser -d $base -qX -v ON_ERROR_STOP=1 -f $fichier 2>&1
}

# ── 1 · la base répond ───────────────────────────────────────────────────────
Etape 1 "PostgreSQL repond"
$version = SQL "postgres" "SELECT current_setting('server_version')"
if ($LASTEXITCODE -ne 0) {
  Rouge "connexion impossible : $version"
  exit 1
}
Vert "version $version"

# ── 2 · L'ÉCOUTE EST-ELLE LOCALE ? ───────────────────────────────────────────
# Le contrôle qui décide si l'installation peut continuer.
Etape 2 "l'ecoute est-elle limitee a la boucle locale"
$ecoute = (SQL "postgres" "SELECT current_setting('listen_addresses')").Trim()
Write-Host "  listen_addresses = $ecoute"
if ($ecoute -eq "*" -or $ecoute -eq "0.0.0.0" -or $ecoute -match "0\.0\.0\.0") {
  Rouge "PostgreSQL ecoute sur TOUTES les interfaces."
  Write-Host "  Les dossiers seraient joignables depuis le reseau du cabinet." -ForegroundColor Yellow
  Write-Host "  Corriger dans postgresql.conf :" -ForegroundColor Yellow
  Write-Host "      listen_addresses = 'localhost'" -ForegroundColor Yellow
  Write-Host "  puis redemarrer le service, puis relancer ce script." -ForegroundColor Yellow
  Write-Host ""
  Write-Host "  Ce script ne modifie PAS la configuration d'un service qu'il n'a"
  Write-Host "  pas installe : il pourrait casser un autre usage de cette instance."
  exit 1
}
Vert "ecoute locale"

# ── 3 · la base applicative ──────────────────────────────────────────────────
Etape 3 "base $BaseName"
$existe = (SQL "postgres" "SELECT 1 FROM pg_database WHERE datname = '$BaseName'").Trim()
if ($existe -eq "1") {
  Vert "deja presente (on ne la recree pas)"
} else {
  # ICU fr-DZ : IRRÉVERSIBLE APRÈS COUP. Un cluster cree avec une autre
  # collation trie mal les noms accentues, et `SELF-HOST-SETUP.md` §2.2 precise
  # que la base est alors « a RECREER, pas a migrer ».
  SQL "postgres" "CREATE DATABASE ""$BaseName"" LOCALE_PROVIDER icu ICU_LOCALE 'fr-DZ' TEMPLATE template0 ENCODING 'UTF8'" | Out-Null
  if ($LASTEXITCODE -ne 0) { Rouge "creation impossible"; exit 1 }
  Vert "creee (ICU fr-DZ)"
}

# ── 4 · le socle de compatibilite ────────────────────────────────────────────
Etape 4 "socle de plateforme (000)"
SQLFichier $BaseName (Join-Path $racine "supabase\bootstrap\000_platform_compat.sql") | Out-Null
if ($LASTEXITCODE -ne 0) { Rouge "000 a echoue"; exit 1 }
Vert "schemas auth/extensions, roles, auth.uid()"

# ── 5 · les migrations, dans l'ordre ─────────────────────────────────────────
Etape 5 "migrations"
$migrations = Get-ChildItem (Join-Path $racine "supabase\migrations\*.sql") | Sort-Object Name
$n = 0
foreach ($m in $migrations) {
  SQLFichier $BaseName $m.FullName | Out-Null
  if ($LASTEXITCODE -ne 0) {
    Rouge "$($m.Name) a echoue — installation INTERROMPUE."
    Write-Host "  La base est dans un etat PARTIEL. L'application refusera de servir" -ForegroundColor Yellow
    Write-Host "  des donnees tant que ce n'est pas corrige : c'est voulu." -ForegroundColor Yellow
    exit 1
  }
  $n++
}
Vert "$n migrations appliquees"

# ── 6 · le role applicatif et son mot de passe ───────────────────────────────
Etape 6 "role applicatif"
SQLFichier $BaseName (Join-Path $racine "supabase\bootstrap\010_app_role.sql") | Out-Null
if ($LASTEXITCODE -ne 0) { Rouge "010 a echoue"; exit 1 }

# Le mot de passe est ENGENDRÉ SUR LA MACHINE, jamais transporté, jamais dans
# le depot. 32 octets du generateur cryptographique de Windows.
$octets = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($octets)
$mdpApp = [Convert]::ToBase64String($octets).TrimEnd('=').Replace('/', '_').Replace('+', '-')

SQL $BaseName "ALTER ROLE mindcare_app PASSWORD '$mdpApp'" | Out-Null
if ($LASTEXITCODE -ne 0) { Rouge "pose du mot de passe impossible"; exit 1 }
Vert "mindcare_app cree, mot de passe engendre localement"

# ── 7 · le fichier d'environnement, hors du depot ────────────────────────────
Etape 7 "fichier d'environnement"
New-Item -ItemType Directory -Force -Path $SecretsDir | Out-Null
$env_fichier = Join-Path $SecretsDir "mindcare.env"
$url = "postgresql://mindcare_app:$mdpApp@$PgHost`:$PgPort/$BaseName"
@"
# Engendre par installer-windows.ps1 — NE PAS COMMITER, NE PAS PARTAGER.
MINDCARE_DATABASE_URL=$url
"@ | Set-Content -Path $env_fichier -Encoding UTF8

# Droits restreints : seuls le proprietaire et les administrateurs.
# Sans ceci, tout compte de la machine lirait le mot de passe de la base.
$acl = Get-Acl $env_fichier
$acl.SetAccessRuleProtection($true, $false)
$acl.Access | ForEach-Object { $acl.RemoveAccessRule($_) | Out-Null }
foreach ($qui in @("$env:USERNAME", "BUILTIN\Administrators", "NT AUTHORITY\SYSTEM")) {
  try {
    $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule(
      $qui, "FullControl", "Allow")))
  } catch { }
}
Set-Acl -Path $env_fichier -AclObject $acl
Vert "$env_fichier (acces restreint)"

# ── 8 · verification finale ──────────────────────────────────────────────────
Etape 8 "verification"
$manquantes = (SQL $BaseName @"
SELECT count(*) FROM (
  SELECT unnest(ARRAY[$(($migrations | ForEach-Object { "'" + $_.BaseName + "'" }) -join ',')]) AS v
) t WHERE NOT EXISTS (SELECT 1 FROM app.schema_migrations m WHERE m.version = t.v)
"@).Trim()
if ($manquantes -ne "0") {
  Rouge "$manquantes migration(s) non enregistree(s) — installation INCOMPLETE."
  exit 1
}
Vert "toutes les migrations sont enregistrees"

$env:PGPASSWORD = ""
Write-Host ""
Write-Host "INSTALLATION TERMINEE." -ForegroundColor Green
Write-Host ""
Write-Host "  Demarrer MindCare :"
Write-Host "    `$env:MINDCARE_DATABASE_URL = (Get-Content '$env_fichier' | Select-String 'MINDCARE_DATABASE_URL=').ToString().Split('=',2)[1]"
Write-Host "    pnpm build; pnpm start"
Write-Host ""
Write-Host "  Sauvegarde (avec restauration EPROUVEE) :"
Write-Host "    node scripts\sauvegarde.mjs"
Write-Host ""
Write-Host "  Il reste a creer le compte de la praticienne :"
Write-Host "    bash scripts/compte-praticienne.sh"
