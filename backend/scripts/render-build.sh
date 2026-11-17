#!/usr/bin/env bash
set -euo pipefail
predio_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${predio_root}"
python -m pip install -r backend/requirements.txt
bash backend/scripts/install_dwg_converter.sh
