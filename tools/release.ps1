<#
  release.ps1 - build the exe and publish a Myslik GitHub release.

  Before running, bump the version in THREE places (must match):
    - app.py              APP_VERSION = "X.Y.Z"
    - ui/index.html       .side-ver  ("Myslik X.Y beta")
    - packaging/CHITAT    first line
  Then run:
    powershell -ExecutionPolicy Bypass -File tools\release.ps1 -Version X.Y.Z -Notes "what changed"
    (or -NotesFile path\to\notes.md for a long description)

  It builds the exe (PyInstaller), restores CHITAT.txt, drops test data\,
  zips release\Myslik into a zip, commits+tags+pushes and creates the GitHub
  release with the zip attached. The users' data\ folder is never in the archive.

  NOTE: keep this file ASCII-only (Windows PowerShell 5.1 reads BOM-less .ps1 as ANSI).
#>
param(
  [Parameter(Mandatory = $true)][string]$Version,
  [string]$Notes = "",
  [string]$NotesFile = "",
  [switch]$SkipGit
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$tag = "v$Version"

$gh = "C:\Users\KROLIK\tools\gh\bin\gh.exe"
if (-not (Test-Path $gh)) { $gh = (Get-Command gh -ErrorAction Stop).Source }
$py = ".\.venv\Scripts\python.exe"
if (-not (Test-Path $py)) { throw "python venv not found: $py" }

# 1) APP_VERSION in app.py must match the requested version
$appLine = Select-String -Path "app.py" -Pattern 'APP_VERSION\s*=\s*"([^"]+)"' | Select-Object -First 1
if (-not $appLine) { throw "APP_VERSION not found in app.py" }
$appVer = $appLine.Matches[0].Groups[1].Value
if ($appVer -ne $Version) {
  throw "APP_VERSION in app.py is '$appVer' but release asked for '$Version'. Sync version (app.py / index.html / CHITAT) and retry."
}
Write-Host "== version $Version confirmed ==" -ForegroundColor Cyan

# 2) build the exe
Write-Host "== building exe (PyInstaller) ==" -ForegroundColor Cyan
& $py -m PyInstaller --noconfirm --distpath release --workpath build Myslik.spec
if ($LASTEXITCODE -ne 0) { throw "PyInstaller returned $LASTEXITCODE" }
$dist = "release\Myslik"
if (-not (Test-Path "$dist\Myslik.exe")) { throw "no $dist\Myslik.exe after build" }

# 3) restore the readme (COLLECT --noconfirm wipes the folder), drop test data.
#    The readme has a Cyrillic filename, so a small python helper does the copy
#    (this .ps1 is ASCII-only and cannot reference Unicode paths reliably).
& $py "tools\place_readme.py"
if ($LASTEXITCODE -ne 0) { throw "place_readme.py failed ($LASTEXITCODE)" }
if (Test-Path "$dist\data") { Remove-Item "$dist\data" -Recurse -Force; Write-Host "  removed test data\" }

# 4) zip (Myslik\ contents at archive root, no data\)
$zip = "release\Myslik-$tag.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path "$dist\*" -DestinationPath $zip -Force
$mb = [math]::Round((Get-Item $zip).Length / 1MB, 1)
Write-Host "== archive: $zip ($mb MB) ==" -ForegroundColor Cyan

# 5) git commit (if pending), tag, push
if (-not $SkipGit) {
  git add -A
  $pending = git status --porcelain
  if ($pending) { git commit -m "release: $tag" | Out-Null; Write-Host "  committed release: $tag" }
  $exists = git tag --list $tag
  if (-not $exists) { git tag -a $tag -m "Myslik $Version" }
  git push origin master
  git push origin $tag
  Write-Host "== pushed (master + $tag) ==" -ForegroundColor Cyan
}

# 6) GitHub release
$ghArgs = @("release", "create", $tag, $zip, "--title", "Myslik $Version")
if ($NotesFile) { $ghArgs += @("--notes-file", $NotesFile) }
elseif ($Notes) { $ghArgs += @("--notes", $Notes) }
else { $ghArgs += "--generate-notes" }
& $gh @ghArgs
if ($LASTEXITCODE -ne 0) { throw "gh release create returned $LASTEXITCODE" }
Write-Host "== release $tag published: https://github.com/Krolik5555/myslik/releases/tag/$tag ==" -ForegroundColor Green
