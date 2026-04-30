#!/usr/bin/env bash
#
# scripts/playtest-up.sh — boot the xmage multiplayer playtest stack.
#
# Phases (per docs/playtest-multiplayer.md):
#   0. Pre-flight tool checks
#   1. Start ngrok tunnel for the WebApi port, capture public URL
#   2. (Re)deploy webclient to Vercel with the tunnel URL baked in
#   3. Start the WebApi server with the Vercel URL allowlisted in CORS
#
# Tear-down: hit Ctrl-C in the foreground server. ngrok is killed
# via the EXIT trap. Or run scripts/playtest-down.sh from another shell.
#
# Env vars (all optional):
#   JAVA_HOME              — defaults to JAVA_HOME_DEFAULT below
#   XMAGE_WEBAPI_PORT      — server port (default 18080)
#   XMAGE_ADMIN_PASSWORD   — admin password (default playtest-YYYYMMDD)
#   XMAGE_DISCONNECT_TIMEOUT_SEC — disconnect-timer seconds [30..180]
#                                  (default 60; slice 70-H.5)

set -euo pipefail

# --- Config ----------------------------------------------------------
JAVA_HOME_DEFAULT='/c/Program Files/Eclipse Adoptium/jdk-17.0.12.7-hotspot'
WEBAPI_PORT_DEFAULT=18080

REPO_ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
WEBCLIENT_DIR="$REPO_ROOT/webclient"
WEBAPI_DIR="$REPO_ROOT/Mage.Server.WebApi"
STATE_DIR="$REPO_ROOT/.playtest"
mkdir -p "$STATE_DIR"

# --- Helpers ---------------------------------------------------------
log()  { printf '\033[1;36m[playtest]\033[0m %s\n' "$*" >&2; }
warn() { printf '\033[1;33m[playtest WARN]\033[0m %s\n' "$*" >&2; }
err()  { printf '\033[1;31m[playtest ERROR]\033[0m %s\n' "$*" >&2; }

require_tool() {
  if ! command -v "$1" >/dev/null 2>&1; then
    err "Missing required tool on PATH: $1"
    exit 1
  fi
}

# --- 0. Pre-flight ---------------------------------------------------
log "Phase 0 — pre-flight"

require_tool ngrok
require_tool vercel
require_tool mvn
require_tool node
require_tool curl
require_tool git

: "${JAVA_HOME:=$JAVA_HOME_DEFAULT}"
: "${XMAGE_WEBAPI_PORT:=$WEBAPI_PORT_DEFAULT}"
: "${XMAGE_ADMIN_PASSWORD:=playtest-$(date +%Y%m%d)}"

if [[ ! -d "$JAVA_HOME" ]]; then
  err "JAVA_HOME does not exist: $JAVA_HOME"
  err "Set JAVA_HOME or edit JAVA_HOME_DEFAULT in $0."
  exit 1
fi

# Verify Vercel auth
if ! vercel whoami >/dev/null 2>&1; then
  err "Vercel CLI not authenticated. Run: vercel login"
  exit 1
fi

# Verify the webclient is linked to a Vercel project. First-time
# users must run `vercel link` (or `vercel` once interactively)
# before this script can do non-interactive deploys.
if [[ ! -f "$WEBCLIENT_DIR/.vercel/project.json" ]]; then
  err "Webclient is not linked to a Vercel project."
  err ""
  err "First-time setup — run this once interactively, then re-invoke $0:"
  err "    cd $WEBCLIENT_DIR"
  err "    vercel link"
  err ""
  err "Vercel will ask: scope (your account), existing project? (No),"
  err "name (anything, e.g. xmage-playtest), directory (./)."
  exit 1
fi

# Verify ngrok auth
if ! ngrok config check >/dev/null 2>&1; then
  err "ngrok config invalid. Run: ngrok config add-authtoken <your-token>"
  err "Get your token from https://dashboard.ngrok.com/get-started/your-authtoken"
  exit 1
fi

# --- 1. Start ngrok --------------------------------------------------
log "Phase 1 — starting ngrok tunnel for port $XMAGE_WEBAPI_PORT"

# Kill any prior ngrok we left running from a previous invocation
if [[ -f "$STATE_DIR/ngrok.pid" ]]; then
  PRIOR_PID=$(cat "$STATE_DIR/ngrok.pid" 2>/dev/null || true)
  if [[ -n "$PRIOR_PID" ]] && kill -0 "$PRIOR_PID" 2>/dev/null; then
    warn "Killing prior ngrok PID $PRIOR_PID"
    kill "$PRIOR_PID" 2>/dev/null || true
    sleep 1
  fi
fi

# Defensive: if a previous orchestrator's WebApi JVM survived its bash
# wrapper (mvn child outliving parent), the port is still bound and
# the new boot will fail with "Port already in use." Detect via
# netstat and surface the Windows PID + the wmic command to kill it.
# We don't kill automatically — could be a legitimate other JVM the
# operator wants to keep — but tell them exactly what to run.
if PORT_BIND=$(netstat -ano 2>/dev/null \
        | grep ":${XMAGE_WEBAPI_PORT} " \
        | grep LISTENING | awk '{print $5}' | head -1) \
        && [[ -n "$PORT_BIND" ]]; then
  err "Port $XMAGE_WEBAPI_PORT is already bound (PID $PORT_BIND)."
  err "If this is a leftover JVM from a previous orchestrator run, kill it:"
  err "    wmic process where \"ProcessId=$PORT_BIND\" call terminate"
  err "Then re-run $0."
  exit 1
fi

NGROK_LOG="$STATE_DIR/ngrok.log"
ngrok http "$XMAGE_WEBAPI_PORT" --log=stdout >"$NGROK_LOG" 2>&1 &
NGROK_PID=$!
echo "$NGROK_PID" > "$STATE_DIR/ngrok.pid"
log "ngrok PID: $NGROK_PID  (log: $NGROK_LOG)"

# Set up an EXIT trap that kills ngrok when this script exits. The
# WebApi server runs in foreground at the end of this script, so Ctrl-C
# triggers this trap and tears everything down cleanly.
cleanup() {
  log "Tearing down..."
  if kill -0 "$NGROK_PID" 2>/dev/null; then
    log "Stopping ngrok (PID $NGROK_PID)"
    kill "$NGROK_PID" 2>/dev/null || true
  fi
  rm -f "$STATE_DIR/ngrok.pid" "$STATE_DIR/ngrok.url"
}
trap cleanup EXIT

# Poll ngrok's local API for the public HTTPS URL. Uses Node (always
# present in this repo) instead of jq (not always installed on Windows).
NGROK_URL=""
for i in $(seq 1 30); do
  if RESPONSE=$(curl -fsS http://localhost:4040/api/tunnels 2>/dev/null); then
    NGROK_URL=$(printf '%s' "$RESPONSE" | node -e '
      let s="";
      process.stdin.on("data", d => s += d);
      process.stdin.on("end", () => {
        try {
          const j = JSON.parse(s);
          const t = (j.tunnels || []).find(
            t => t.public_url && t.public_url.startsWith("https"));
          if (t) console.log(t.public_url);
        } catch (e) { /* not yet ready */ }
      });
    ' 2>/dev/null || true)
    if [[ -n "$NGROK_URL" ]]; then break; fi
  fi
  sleep 1
done

if [[ -z "${NGROK_URL:-}" ]]; then
  err "ngrok tunnel did not come up within 30s. Check $NGROK_LOG"
  exit 1
fi

log "ngrok tunnel: $NGROK_URL"
echo "$NGROK_URL" > "$STATE_DIR/ngrok.url"

# --- 2. Deploy webclient to Vercel -----------------------------------
log "Phase 2 — deploying webclient to Vercel"
log "  VITE_XMAGE_WEBAPI_URL = $NGROK_URL"

cd "$WEBCLIENT_DIR"
VERCEL_LOG="$STATE_DIR/vercel.log"

# Build locally with the env var, then push the prebuilt output to
# Vercel. Vercel's cloud build path doesn't see local env vars
# (they need to be configured server-side via `vercel env add`),
# but the prebuilt path uploads `.vercel/output/` directly so the
# bundle has VITE_XMAGE_WEBAPI_URL baked in correctly.
log "  Building bundle locally with VITE_XMAGE_WEBAPI_URL baked in"
if ! VITE_XMAGE_WEBAPI_URL="$NGROK_URL" npm run build 2>&1 | tail -3; then
  err "Local webclient build failed"
  exit 1
fi

# `vercel build` consumes the local build output and writes
# `.vercel/output/` in the format Vercel expects. Then `vercel
# deploy --prebuilt --prod` uploads that directory.
log "  Wrapping into Vercel build artifact"
if ! VITE_XMAGE_WEBAPI_URL="$NGROK_URL" vercel build --prod --yes 2>&1 | tail -5; then
  err "vercel build failed"
  exit 1
fi

log "  Uploading prebuilt artifact to Vercel"
if ! vercel deploy --prebuilt --prod --yes 2>&1 | tee "$VERCEL_LOG"; then
  err "Vercel deploy failed. See $VERCEL_LOG"
  exit 1
fi

# Extract the project-specific production URL (always present —
# matches `xmage-playtest-<hash>-<scope>.vercel.app`) and the
# stable alias (matches `<project>.vercel.app` only — present when
# the project has a configured alias / production domain).
#
# Alias is preferred for the friend-facing URL because:
#   - Vercel's default deployment protection gates the per-deploy
#     URL with a 401 for non-team-members; the alias is publicly
#     reachable.
#   - The alias is stable across redeploys (a new ngrok URL each
#     session means a new deploy each session, but friends keep
#     bookmarking the same alias).
#
# CORS allowlist on the server includes BOTH so:
#   - If the friend hits the alias (the URL we tell them) → match.
#   - If the friend somehow lands on the per-deploy URL → also match.
VERCEL_URL_PROD=$(grep -Eo 'https://[a-zA-Z0-9-]+-[a-zA-Z0-9-]+-[a-zA-Z0-9-]+\.vercel\.app' "$VERCEL_LOG" | tail -1)
VERCEL_URL_ALIAS=$(grep -E '^Aliased:' "$VERCEL_LOG" | grep -Eo 'https://[a-zA-Z0-9-]+\.vercel\.app' | tail -1)

if [[ -z "$VERCEL_URL_PROD" && -z "$VERCEL_URL_ALIAS" ]]; then
  err "Could not parse any Vercel URL from output. See $VERCEL_LOG"
  exit 1
fi

VERCEL_URL="${VERCEL_URL_ALIAS:-$VERCEL_URL_PROD}"
echo "$VERCEL_URL" > "$STATE_DIR/vercel.url"

# Build the CORS allowlist with both URLs (alias preferred for the
# friend-facing announcement, but include the per-deploy URL too in
# case of redirect or direct-link scenarios).
CORS_ALLOWLIST="$VERCEL_URL,http://localhost:5173,http://localhost:4173"
if [[ -n "$VERCEL_URL_PROD" && "$VERCEL_URL_PROD" != "$VERCEL_URL" ]]; then
  CORS_ALLOWLIST="$VERCEL_URL_PROD,$CORS_ALLOWLIST"
fi

log "Vercel deployment (per-deploy): ${VERCEL_URL_PROD:-<none>}"
log "Vercel deployment (alias):      ${VERCEL_URL_ALIAS:-<none>}"
log "Friend-facing URL:              $VERCEL_URL"

# --- 3. Start the WebApi server --------------------------------------
log "Phase 3 — starting WebApi server (foreground)"

cd "$WEBAPI_DIR"
export JAVA_HOME
export XMAGE_PROFILE=prod
export XMAGE_CORS_ORIGINS="$CORS_ALLOWLIST"
export XMAGE_ADMIN_PASSWORD
export XMAGE_WEBAPI_PORT

# Friend-facing summary
cat <<BANNER >&2

================================================================
  PLAYTEST READY

  Send your friends this URL:
      $VERCEL_URL

  Friends: click "Play as guest" → find your table → Join.

  API tunnel: $NGROK_URL
  Disconnect timer: ${XMAGE_DISCONNECT_TIMEOUT_SEC:-60}s

  Press Ctrl-C here to tear everything down.
================================================================

BANNER

# Delegate to run.sh — owns the canonical mainClass + --add-opens
# JBoss Remoting reflection-access bundle. Reinventing the mvn
# invocation here would skip those flags and the engine's JBoss
# Remoting layer (transitive via mage-server) would crash on JDK
# 17+ class-load.
exec ./run.sh
