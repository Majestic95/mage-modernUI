# Migration: `playtest-up.sh` → `mage-stack/`

Side-by-side guide for retraining muscle memory.

## TL;DR

| Old | New |
| --- | --- |
| `./scripts/playtest-up.sh` (run every session) | Nothing — services are always running |
| `Ctrl-C` in the bash shell | `.\scripts\mage-down.ps1` (only if you want to stop) |
| Re-run `playtest-up.sh` after a code change | `.\scripts\mage-redeploy.ps1` |
| "Is the server up?" → try a request | `.\scripts\mage-status.ps1` |
| ngrok URL changed → public site broken | Doesn't happen — `modern-mage.com` is stable |
| Server crashed at 3am → service down until you wake up | NSSM auto-restarts within 10s |
| Server hung but didn't crash | Watchdog detects + restarts within 90s |

## Old workflow (deprecated)

```bash
# 1. Open a Git Bash shell.
# 2. Pre-flight: ngrok auth, vercel auth, vercel link, mvn, node, etc.
# 3. Run the orchestrator:
./scripts/playtest-up.sh

# Inside, the script:
#   - Kills any prior ngrok PID it tracked
#   - Starts ngrok http 18080, captures the rotating URL
#   - Builds the webclient locally with VITE_XMAGE_WEBAPI_URL = <ngrok URL>
#   - Pushes prebuilt to Vercel
#   - Boots the WebApi JVM (foreground) with XMAGE_PROFILE=prod and a
#     CORS allowlist that includes the new Vercel URL
#
# When done playing:
#   - Ctrl-C in the foreground shell
#   - EXIT trap kills ngrok
```

## New workflow

```powershell
# After install — never need to do anything per session.
# Bring up the machine; services are already running.

# Daily commands:
.\scripts\mage-status.ps1            # is everything up?
.\scripts\mage-redeploy.ps1          # I pulled new code; push it live

# Rare commands:
.\scripts\mage-down.ps1              # take it down
.\scripts\mage-up.ps1                # bring it back
.\scripts\mage-logs.ps1 webapi       # something's wrong; what's the log say
```

## What the new flow replaces

| `playtest-up.sh` step | Replaced by |
| --- | --- |
| Pre-flight checks (ngrok, vercel, mvn, node, etc.) | One-time `install-service.ps1` |
| Kill prior ngrok | N/A — tunnel is a Windows Service, supervised |
| Start ngrok + capture URL | N/A — Cloudflare Tunnel uses stable `modern-mage.com` |
| Local webclient build with URL baked in | One-time Vercel env var (`VITE_XMAGE_WEBAPI_URL=https://modern-mage.com`) — no rebuild needed per session |
| `vercel build --prod` + `vercel deploy --prebuilt --prod` | Standard `vercel deploy` whenever the webclient code changes (unchanged from existing dev practice) |
| Boot WebApi with `XMAGE_PROFILE=prod` + dynamic CORS | NSSM-managed `MageWebApi` service with config-driven env vars |

## Vercel side: what to update once

After `mage-stack/` is installed, set this once in your Vercel project settings (it never changes again):

```
VITE_XMAGE_WEBAPI_URL = https://modern-mage.com
VITE_FEATURE_REDESIGN = true
```

(The empty-string-defaults-to-false footgun on `VITE_FEATURE_REDESIGN` is documented in memory `feedback_vercel_env_redesign_empty.md` — store the literal string `true`, not an empty string.)

After that, Vercel deploys the webclient against the stable URL with no per-session rebuild needed.

## Status of the old scripts

`scripts/playtest-up.sh` and `scripts/playtest-down.sh` get a deprecation header in this slice but are not deleted. Keep them in place during the transition (a couple of weeks) so you have a known-good fallback if `mage-stack/` misbehaves. Slice INFRA-1.1 will delete them once trust is built.

## Rollback

If `mage-stack/` is broken and you need to fall back:

```powershell
.\scripts\mage-down.ps1                           # stop the new stack
```

Then in Git Bash:
```bash
./scripts/playtest-up.sh                          # old flow, unchanged
```

The old flow uses port 18080 with a fresh ngrok URL — same port the new stack uses, so make sure the new stack is fully stopped first.
