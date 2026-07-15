<#
  release.ps1 — собрать exe и опубликовать релиз Мыслика на GitHub.

  Порядок работы:
    1. Обнови версию в ТРЁХ местах вручную (они должны совпадать):
         - app.py            APP_VERSION = "X.Y.Z"
         - ui/index.html     .side-ver  ("Мыслик X.Y beta")
         - packaging/ЧИТАТЬ.txt  первая строка
       и подними ?v=N в ui/index.html, если менялся UI.
    2. Запусти:
         powershell -ExecutionPolicy Bypass -File tools\release.ps1 -Version X.Y.Z -Notes "что нового"
       либо -NotesFile путь\к\notes.md для длинного описания.

  Что делает: собирает exe (PyInstaller), кладёт ЧИТАТЬ.txt, чистит тестовые data\,
  пакует release\Myslik в zip, коммитит+тегирует+пушит и создаёт GitHub-релиз с zip.
  Папку data\ у пользователей обновление не трогает — её в архиве нет.
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

# gh: сначала портативный, потом из PATH
$gh = "C:\Users\KROLIK\tools\gh\bin\gh.exe"
if (-not (Test-Path $gh)) { $gh = (Get-Command gh -ErrorAction Stop).Source }
$py = ".\.venv\Scripts\python.exe"
if (-not (Test-Path $py)) { throw "Не найден $py — создай .venv" }

# 1. версия в app.py должна совпадать с запрошенной
$appLine = Select-String -Path "app.py" -Pattern 'APP_VERSION\s*=\s*"([^"]+)"' | Select-Object -First 1
if (-not $appLine) { throw "APP_VERSION не найден в app.py" }
$appVer = $appLine.Matches[0].Groups[1].Value
if ($appVer -ne $Version) {
  throw "APP_VERSION в app.py = '$appVer', а релиз просишь '$Version'. Синхронизируй версию (app.py / index.html / ЧИТАТЬ.txt) и повтори."
}
Write-Host "== Версия $Version подтверждена ==" -ForegroundColor Cyan

# 2. сборка exe
Write-Host "== Сборка exe (PyInstaller) ==" -ForegroundColor Cyan
& $py -m PyInstaller --noconfirm --distpath release --workpath build Myslik.spec
if ($LASTEXITCODE -ne 0) { throw "PyInstaller вернул код $LASTEXITCODE" }
$dist = "release\Myslik"
if (-not (Test-Path "$dist\Myslik.exe")) { throw "После сборки нет $dist\Myslik.exe" }

# 3. вернуть ЧИТАТЬ.txt (COLLECT --noconfirm стирает папку) и убрать тестовые данные
Copy-Item "packaging\ЧИТАТЬ.txt" "$dist\ЧИТАТЬ.txt" -Force
if (Test-Path "$dist\data") { Remove-Item "$dist\data" -Recurse -Force; Write-Host "  убрал тестовую data\" }

# 4. упаковать (содержимое Myslik\ в корне архива, без data\)
$zip = "release\Myslik-$tag.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path "$dist\*" -DestinationPath $zip -Force
$mb = [math]::Round((Get-Item $zip).Length / 1MB, 1)
Write-Host "== Архив: $zip ($mb МБ) ==" -ForegroundColor Cyan

# 5. git: коммит (если есть что), тег, пуш
if (-not $SkipGit) {
  git add -A
  $pending = git status --porcelain
  if ($pending) { git commit -m "release: $tag" | Out-Null; Write-Host "  коммит release: $tag" }
  $exists = git tag --list $tag
  if (-not $exists) { git tag -a $tag -m "Мыслик $Version" }
  git push origin master
  git push origin $tag
  Write-Host "== Запушено (master + $tag) ==" -ForegroundColor Cyan
}

# 6. GitHub-релиз
$args = @("release", "create", $tag, $zip, "--title", "Мыслик $Version")
if ($NotesFile) { $args += @("--notes-file", $NotesFile) }
elseif ($Notes) { $args += @("--notes", $Notes) }
else { $args += "--generate-notes" }
& $gh @args
if ($LASTEXITCODE -ne 0) { throw "gh release create вернул код $LASTEXITCODE" }
Write-Host "== Релиз $tag опубликован: https://github.com/Krolik5555/myslik/releases/tag/$tag ==" -ForegroundColor Green
