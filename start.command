#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
command -v node >/dev/null || { echo "Node.js 22+ is required"; exit 2; }
node -e 'if(Number(process.versions.node.split(".")[0])<22)process.exit(1)' || { echo "Node.js 22+ required"; exit 2; }
ENGINE=http://127.0.0.1:11435
APP=http://127.0.0.1:18793
if ! curl -fsS --max-time 3 "$ENGINE/api/version" | grep -q '"0.32.5"'; then
 echo "Start the separately installed Ollama 0.32.5 on 127.0.0.1:11435 before using this preview."
 exit 3
fi
curl -fsS --max-time 3 "$ENGINE/api/tags" | grep -q 'x/flux2-klein:4b' || { echo "Local model x/flux2-klein:4b is missing"; exit 4; }
if ! curl -fsS --max-time 3 "$APP/api/status" >/dev/null 2>&1; then
 command -v lsof >/dev/null || { echo "lsof is required"; exit 5; }
 if lsof -nP -iTCP:18793 -sTCP:LISTEN >/dev/null 2>&1; then echo "Port 18793 occupied, not changing it";exit 6;fi
 STUDIO_OLLAMA_URL="$ENGINE" nohup node "$ROOT/pilot/run-preview.mjs" > "$HOME/.studio-local-ollama-preview.log" 2>&1 < /dev/null &
 for i in 1 2 3 4 5 6 7 8 9 10;do
  if curl -fsS --max-time 2 "$APP/api/status" >/dev/null 2>&1;then break;fi
  sleep 1
 done
fi
curl -fsS --max-time 3 "$APP/api/status" >/dev/null || { echo "See ~/.studio-local-ollama-preview.log";exit 7; }
echo "STUDIO_PUBLIC_PREVIEW_READY $APP/canvas"
open "$APP/canvas"
