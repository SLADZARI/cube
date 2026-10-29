#!/bin/bash
# Read-only diagnostics: never changes jobs, images, source, model or services.
set -u
printf '=== STUDIO LOCAL CHECK ===\n'; date '+%Y-%m-%d %H:%M:%S %Z'
printf '\nNODE='; node --version 2>&1 || true
printf 'LOCAL_OLLAMA_BINARY='; if test -x "$HOME/Projects/studio-pilot-local-ollama-v0.32.5/runtime/ollama"; then echo PRESENT; else echo MISSING; fi
for port in 11435 18789 18793; do
  printf '\n=== PORT %s ===\n' "$port"
  if command -v lsof >/dev/null 2>&1; then lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>&1 | tail -n 3 || true; fi
  if test "$port" = 11435; then path=api/version; else path=api/status; fi
  curl -sS --max-time 3 "http://127.0.0.1:$port/$path" 2>&1 | head -c 550 || true
  printf '\n'
done
printf '\n=== INSTALLED STUDIO SHA ===\n'
git -C "$HOME/Projects/studio-pilot-free-local" rev-parse --short HEAD 2>&1 || true
printf '\n=== PREVIEW ERROR LOG (LAST 20 LINES) ===\n'
if test -f "$HOME/.studio-local-ollama-preview.log"; then
  tail -n 20 "$HOME/.studio-local-ollama-preview.log" | cut -c 1-360
else
  echo NO_PREVIEW_LOG
fi
printf '\n=== ENGINE LOG (LAST 12 LINES) ===\n'
if test -f "$HOME/Projects/studio-pilot-local-ollama-v0.32.5/legacy-server.log"; then
  tail -n 12 "$HOME/Projects/studio-pilot-local-ollama-v0.32.5/legacy-server.log" | cut -c 1-360
else
  echo NO_ENGINE_LOG
fi
printf '\n=== CHECK COMPLETE (read-only) ===\n'
