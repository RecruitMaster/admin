#!/usr/bin/env bash
set -euo pipefail
umask 077
# Never enable shell tracing: PM2 metadata and dotenv contain private settings.
export NVM_DIR="${NVM_DIR:-/root/.nvm}"
if [[ ! -s "$NVM_DIR/nvm.sh" ]]; then
  echo 'NVM is unavailable; no production files changed.' >&2
  exit 1
fi
set +u
source "$NVM_DIR/nvm.sh"
nvm use 22.21.0 >/dev/null
set -u
exec python3 "$(dirname -- "${BASH_SOURCE[0]}")/deploy-admin.py" "$@"
