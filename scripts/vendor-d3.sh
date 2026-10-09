#!/usr/bin/env bash
# Rebuild docs/vendor/d3-force.min.js from upstream UMD builds.
set -euo pipefail
cd "$(dirname "$0")/.."
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
mods=(d3-dispatch@3.0.1 d3-quadtree@3.0.1 d3-timer@3.0.1 d3-selection@3.0.0 d3-drag@3.0.0 d3-force@3.0.0)
{
  echo "/*! Bundled d3 modules for the collaboration graph — vendored so the page"
  echo "    makes no third-party requests at runtime."
  printf '      %s\n' "${mods[*]}"
  echo "    Copyright Mike Bostock. ISC License: https://github.com/d3/d3/blob/main/LICENSE"
  echo "    Rebuild with scripts/vendor-d3.sh */"
  for m in "${mods[@]}"; do
    curl -sS "https://cdn.jsdelivr.net/npm/$m/dist/${m%@*}.min.js" -o "$tmp/${m%@*}.js"
    cat "$tmp/${m%@*}.js"; echo
  done
} > docs/vendor/d3-force.min.js
python3 scripts/stamp.py
