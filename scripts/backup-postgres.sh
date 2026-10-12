#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
TARGET="${BACKUP_DIR}/hq_marketplace_${TS}.dump"

mkdir -p "${BACKUP_DIR}"
PGPASSWORD="${PGPASSWORD:-postgres}" pg_dump \
  -h "${PGHOST:-localhost}" \
  -p "${PGPORT:-5432}" \
  -U "${PGUSER:-postgres}" \
  -d "${PGDATABASE:-hq_marketplace}" \
  --clean --if-exists --format=custom \
  --file "${TARGET}"

echo "Backup saved to ${TARGET}"
