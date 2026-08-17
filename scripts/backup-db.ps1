# KaaryaVidhan — Realtime Database backup
# ----------------------------------------
# Dumps the ENTIRE Realtime Database to a timestamped JSON file using the
# Firebase CLI, authenticated as your Firebase login (project Owner), so it can
# read protected nodes like /pins that the security rules hide from clients.
#
# Usage (from anywhere; paths are resolved relative to this script):
#   powershell -ExecutionPolicy Bypass -File scripts\backup-db.ps1
#
# The file lands in  backups\kaarya-YYYYMMDD-HHmmss.json  (git-ignored).
#
# NOTE: the backup contains PIN hashes and all staff data. Keep it somewhere
# safe and never commit it or share it casually.

$ErrorActionPreference = "Stop"

$project  = "kaarya-tracker"
$root     = Split-Path -Parent $PSScriptRoot          # project root (parent of \scripts)
$dir      = Join-Path $root "backups"
New-Item -ItemType Directory -Force -Path $dir | Out-Null

$stamp    = Get-Date -Format "yyyyMMdd-HHmmss"
$out      = Join-Path $dir "kaarya-$stamp.json"

Write-Host "Backing up '$project' Realtime Database ..."
npx firebase database:get / --project $project --pretty --output "$out"

if ((Test-Path $out) -and ((Get-Item $out).Length -gt 2)) {
    $kb = [math]::Round((Get-Item $out).Length / 1KB, 1)
    Write-Host "Done -> $out  ($kb KB)"
    # Quick sanity check: a full (owner) dump should include the protected /pins node.
    if (-not (Select-String -Path $out -Pattern '"pins"' -Quiet)) {
        Write-Warning "The dump has no /pins node. You may not be signed in as an Owner, so protected data was skipped. Run 'npx firebase login' and retry, or use the Console Automated Backups instead."
    }
} else {
    Write-Error "Backup produced no data. Check 'npx firebase login' and your project access."
}
