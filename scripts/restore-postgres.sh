#!/usr/bin/env bash
set -euo pipefail

DUMP_FILE="${1:-}"
if [ -z "${DUMP_FILE}" ]; then
  echo "Usage: $0 /path/to/backup.dump" >&2
  exit 1
fi

PGPASSWORD="${PGPASSWORD:-postgres}" pg_restore \
  -h "${PGHOST:-localhost}" \
  -p "${PGPORT:-5432}" \
  -U "${PGUSER:-postgres}" \
  -d "${PGDATABASE:-hq_marketplace}" \
  --clean --if-exists "${DUMP_FILE}"

echo "Restored ${DUMP_FILE} into ${PGDATABASE:-hq_marketplace}"
