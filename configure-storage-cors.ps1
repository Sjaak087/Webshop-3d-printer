# Eenmalig uitvoeren op een computer met de Google Cloud CLI (gcloud).
$ErrorActionPreference = "Stop"
$ProjectId = "webshop-3cf70"
$Bucket = "gs://webshop-3cf70.firebasestorage.app"
$CorsFile = Join-Path $PSScriptRoot "cors.json"

if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) {
    throw "Google Cloud CLI (gcloud) is niet gevonden. Installeer de Google Cloud CLI en open daarna een nieuwe PowerShell."
}
if (-not (Test-Path $CorsFile)) {
    throw "cors.json ontbreekt naast dit script: $CorsFile"
}

Write-Host "Controleer de actieve Google Cloud-aanmelding..." -ForegroundColor Cyan
gcloud auth list
if ($LASTEXITCODE -ne 0) { throw "Google Cloud-aanmelding mislukt. Meld eerst aan met: gcloud auth login" }

Write-Host "CORS instellen op $Bucket ..." -ForegroundColor Cyan
gcloud storage buckets update $Bucket "--cors-file=$CorsFile" "--project=$ProjectId"
if ($LASTEXITCODE -ne 0) {
    throw "CORS instellen is mislukt. Controleer of de bucket bestaat en of je account Storage Admin-rechten heeft."
}

Write-Host "Actieve CORS-configuratie ophalen..." -ForegroundColor Cyan
gcloud storage buckets describe $Bucket "--format=yaml(cors_config)" "--project=$ProjectId"
if ($LASTEXITCODE -ne 0) { throw "CORS is ingesteld, maar de controle kon niet worden uitgevoerd." }
Write-Host "Klaar. Vernieuw de webshop en test een nieuwe STL/3MF-upload." -ForegroundColor Green
