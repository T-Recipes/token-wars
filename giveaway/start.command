#!/bin/bash
# Double-click to start Token Wars on a Mac.
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "  Node.js is not installed. Install it from https://nodejs.org (the LTS button), then double-click this file again."
  echo ""
  read -r -p "  Press Enter to close." _
  exit 1
fi
if [ -f giveaway/serve.js ]; then node giveaway/serve.js --open; else node serve.js --open; fi
