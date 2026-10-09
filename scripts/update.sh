#!/usr/bin/env bash
# Refresh the raw PR mirror and rebuild docs/data/qgis.json.
set -euo pipefail
cd "$(dirname "$0")/.."
python3 scripts/fetch.py "$@"
python3 scripts/build.py
