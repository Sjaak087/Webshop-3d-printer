# Start de camerabrug + tunnel in een keer. Rechtermuisknop > "Uitvoeren met PowerShell",
# of in PowerShell:  powershell -ExecutionPolicy Bypass -File .\start-camera.ps1
Set-Location -Path $PSScriptRoot

$py = $null
foreach ($c in @("python", "py")) { if (Get-Command $c -ErrorAction SilentlyContinue) { $py = $c; break } }
if (-not $py) { Write-Host "Python is niet gevonden. Installeer Python 3 via https://www.python.org/downloads/ (vink 'Add to PATH' aan)." -ForegroundColor Red; Read-Host "Druk op Enter om te sluiten"; exit 1 }

if (-not (Get-Command cloudflared -ErrorAction SilentlyContinue)) {
    Write-Host "cloudflared ontbreekt. Installeren..." -ForegroundColor Yellow
    winget install --id Cloudflare.cloudflared -e --accept-source-agreements --accept-package-agreements
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
    if (-not (Get-Command cloudflared -ErrorAction SilentlyContinue)) {
        Write-Host "Installatie klaar, maar sluit dit venster en start dit script opnieuw." -ForegroundColor Yellow
        Read-Host "Druk op Enter om te sluiten"; exit 0
    }
}

& $py bambu_cam.py --tunnel
Read-Host "Gestopt. Druk op Enter om te sluiten"
