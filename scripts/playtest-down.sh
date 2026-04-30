#!/usr/bin/env bash
#
# scripts/playtest-down.sh — tear down a running playtest stack from
# another shell.
#
# Companion to scripts/playtest-up.sh. Up's foreground server traps
# Ctrl-C and cleans up itself; this script is for the case where
# the up shell is wedged or you forgot it was running.

set -euo pipefail

REPO_ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
STATE_DIR="$REPO_ROOT/.playtest"

log()  { printf '\033[1;36m[playtest]\033[0m %s\n' "$*" >&2; }
warn() { printf '\033[1;33m[playtest WARN]\033[0m %s\n' "$*" >&2; }

# Stop ngrok by recorded PID
if [[ -f "$STATE_DIR/ngrok.pid" ]]; then
  PID=$(cat "$STATE_DIR/ngrok.pid")
  if kill -0 "$PID" 2>/dev/null; then
    log "Stopping ngrok PID $PID"
    kill "$PID" 2>/dev/null || true
    sleep 1
    if kill -0 "$PID" 2>/dev/null; then
      warn "ngrok PID $PID didn't stop on SIGTERM; forcing"
      kill -9 "$PID" 2>/dev/null || true
    fi
  else
    warn "Recorded ngrok PID $PID is not alive"
  fi
  rm -f "$STATE_DIR/ngrok.pid" "$STATE_DIR/ngrok.url"
else
  log "No recorded ngrok PID; nothing to stop"
fi

# The WebApi (mvn exec:java) is a foreground process in another
# terminal. We don't try to kill it from here — Ctrl-C in that
# terminal is the canonical stop. Surface a hint:
log ""
log "If the WebApi server is still running in another terminal,"
log "Ctrl-C there. (We don't auto-kill it because that risks"
log "leaving in-progress games + undisposed handlers.)"
