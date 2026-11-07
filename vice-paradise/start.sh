#!/usr/bin/env bash
# Vice Paradise launcher for Linux / Ubuntu (and macOS)
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 20.19+ is required. On Ubuntu: sudo apt install nodejs npm  (or use https://nodejs.org)"; exit 1
fi
exec node scripts/launch.mjs "$@"
