#!/bin/bash
# Standalone public preview. Never modifies Nikita's primary Studio on 18789.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
ENGINE="http://127.0.0.1:11435"
APP="http://127.0.0.1:18793"
LEGACY="$HOME/Projects/studio-pilot-local-ollama-v0.32.5/runtime/ollama"
ENGINE_LOG="$HOME/Projects/studio-pilot-local-ollama-v0.32.5/legacy-server.log"
APP_LOG="$HOME/.studio-local-ollama-preview.log"

command -v node >/dev/null || { echo 'PREVIEW_NODE_NOT_INSTALLED: Node.js 22.13+ is required'; exit 2; }
node -e 'const [a,b]=process.versions.node.split(".").map(Number);if(a<22||(a===22&&b<13))process.exit(1)' || { echo 'PREVIEW_NODE_TOO_OLD: Node.js 22.13+ is required'; exit 2; }
command -v curl >/dev/null || { echo 'PREVIEW_CURL_MISSING'; exit 2; }
command -v lsof >/dev/null || { echo 'PREVIEW_LSOF_MISSING'; exit 2; }

# The previous Mac shortcut auto-starts the separate Ollama server. Restart it
# safely on a Mac reboot; never interfere with another process on port 11435.
ENGINE_VERSION="$(curl -fsS --max-time 3 "$ENGINE/api/version" 2>/dev/null || true)"
if [[ "$ENGINE_VERSION" != *'"0.32.5"'* ]]; then
  if lsof -nP -iTCP:11435 -sTCP:LISTEN >/dev/null 2>&1; then
    echo "PREVIEW_WRONG_OLLAMA_VERSION: port 11435 belongs to a service other than Ollama 0.32.5. Not stopping it."
    exit 3
  fi
  if [[ ! -x "$LEGACY" ]]; then
    echo "PREVIEW_LOCAL_OLLAMA_MISSING: $LEGACY"
    echo 'This public source does not bundle or download model weights. Run on the authorized Mac with the existing separate Ollama 0.32.5.'
    exit 3
  fi
  mkdir -p "$(dirname "$ENGINE_LOG")"
  echo 'Starting existing isolated Ollama 0.32.5 on 127.0.0.1:11435...'
  OLLAMA_HOST=127.0.0.1:11435 OLLAMA_MODELS="$HOME/.ollama/models" \
    nohup "$LEGACY" serve >> "$ENGINE_LOG" 2>&1 < /dev/null &
  for i in {1..35}; do
    ENGINE_VERSION="$(curl -fsS --max-time 2 "$ENGINE/api/version" 2>/dev/null || true)"
    if [[ "$ENGINE_VERSION" == *'"0.32.5"'* ]]; then break; fi
    sleep 1
  done
fi
if [[ "$ENGINE_VERSION" != *'"0.32.5"'* ]]; then
  echo 'PREVIEW_OLLAMA_NOT_READY: check the separate 0.32.5 engine log.'
  tail -n 12 "$ENGINE_LOG" 2>/dev/null || true
  exit 3
fi

# Parse the whole model list, not curl | grep -q (can trip curl 23 + pipefail).
TAGS="$(curl -fsS --max-time 8 "$ENGINE/api/tags" 2>/dev/null || true)"
if ! printf '%s' "$TAGS" | node -e '
let s="";process.stdin.setEncoding("utf8");process.stdin.on("data",x=>s+=x);
process.stdin.on("end",()=>{try{const o=JSON.parse(s);if(!(o.models||[]).some(m=>(m.name||m.model)==="x/flux2-klein:4b"))process.exit(1);}catch{process.exit(1)}});
'; then
  echo 'PREVIEW_FLUX_MODEL_MISSING: x/flux2-klein:4b not found in 127.0.0.1:11435/api/tags.'
  echo 'The preview will not download a model or use a paid API automatically.'
  exit 4
fi

APP_STATUS="$(curl -fsS --max-time 2 "$APP/api/status" 2>/dev/null || true)"
if [[ "$APP_STATUS" != *'"storage":"LOCAL_ONLY"'* ]]; then
  if lsof -nP -iTCP:18793 -sTCP:LISTEN >/dev/null 2>&1; then
    echo 'PREVIEW_PORT_18793_BUSY: a different server already uses this port. Nothing was stopped.'
    exit 5
  fi
  if [[ ! -f "$ROOT/pilot/run-preview.mjs" ]]; then
    echo 'PREVIEW_FILES_MISSING: open Terminal in the extracted GitHub ZIP root containing pilot/run-preview.mjs.'
    exit 5
  fi
  echo 'Starting standalone Studio on 127.0.0.1:18793 (separate from primary port 18789)...'
  STUDIO_OLLAMA_URL="$ENGINE" nohup node "$ROOT/pilot/run-preview.mjs" > "$APP_LOG" 2>&1 < /dev/null &
  for i in {1..16}; do
    APP_STATUS="$(curl -fsS --max-time 2 "$APP/api/status" 2>/dev/null || true)"
    if [[ "$APP_STATUS" == *'"storage":"LOCAL_ONLY"'* ]]; then break; fi
    sleep 1
  done
fi
if [[ "$APP_STATUS" != *'"storage":"LOCAL_ONLY"'* ]]; then
  echo 'PREVIEW_STUDIO_START_FAILED: showing the last 35 lines of local startup log:'
  if [[ -f "$APP_LOG" ]]; then tail -n 35 "$APP_LOG"; else echo 'No local startup log was created.'; fi
  exit 6
fi

echo 'STUDIO_LOCAL_PUBLIC_PREVIEW_READY http://127.0.0.1:18793/canvas'
echo 'Main Studio on 127.0.0.1:18789 and its data were not modified.'
open "$APP/canvas"
