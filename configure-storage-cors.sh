#!/usr/bin/env bash
set -euo pipefail
PROJECT_ID="webshop-3cf70"
BUCKET="gs://webshop-3cf70.firebasestorage.app"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CORS_FILE="$SCRIPT_DIR/cors.json"

command -v gcloud >/dev/null 2>&1 || { echo "Google Cloud CLI (gcloud) is niet geïnstalleerd." >&2; exit 1; }
test -f "$CORS_FILE" || { echo "cors.json ontbreekt naast dit script." >&2; exit 1; }

echo "Controleer de Google Cloud-aanmelding..."
gcloud auth list
echo "CORS instellen op $BUCKET ..."
gcloud storage buckets update "$BUCKET" "--cors-file=$CORS_FILE" "--project=$PROJECT_ID"
echo "Actieve CORS-configuratie:"
gcloud storage buckets describe "$BUCKET" --format="yaml(cors_config)" "--project=$PROJECT_ID"
echo "Klaar. Vernieuw de webshop en test een nieuwe STL/3MF-upload."
