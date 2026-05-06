# ADR 0012 — INFRA-1 self-hosted runtime bundle

**Status:** Accepted
**Date:** 2026-05-06
**Context window:** Slice INFRA-1
**Supersedes:** Operating procedure parts of [`docs/playtest-multiplayer.md`](../playtest-multiplayer.md) — ngrok-based public-deploy ritual

## Context

The XMage fork's WebApi server has been operated via `scripts/playtest-up.sh` since slice ~52 — an interactive Bash orchestrator that boots ngrok, builds the webclient, deploys to Vercel, and then `exec`s `run.sh` to run the JVM in foreground. Pain points after ~50 sessions of use:

1. **ngrok URL rotation silently breaks the live deploy.** Free-tier ngrok URLs change on every restart. The Vercel bundle has the URL baked in at build time, so a tunnel restart leaves the public site pointing at a dead URL with no error path beyond "fetch failed" in the browser console.
2. **JVM only restarts when the operator does.** A crash, OOM, or hang during off-hours means the service stays down until the operator notices.
3. **Bring-up is high-ceremony.** Six manual coordination steps (kill old ngrok, start new ngrok, capture URL, build webclient with URL baked in, vercel deploy, run server with prod CORS) per session.
4. **No status visibility.** "Is the server up?" is answered by trying it.

The user is not yet ready to go public-hosted (see prior conversation 2026-05-06 on legal/IP risk for hosted MTG services), but does want to remove operator toil while staying self-hosted.

## Decision

Ship a self-installing **`mage-stack/`** runtime bundle alongside the existing repo. Three Windows Services managed by NSSM: WebApi JVM, Cloudflare Tunnel connector, and a health-check watchdog. Five PowerShell control commands (`mage-up`, `mage-down`, `mage-status`, `mage-logs`, `mage-redeploy`) plus install/uninstall scripts. Tunnel uses a stable Cloudflare-registered domain (`modern-mage.com`) instead of rotating ngrok URLs.

### Sub-decisions

#### D1 — Folder + Windows Services, not a single .exe

A single `.exe` would have to bundle a JVM, a tunnel binary, and a watchdog — three coordinating processes wrapped in one executable for cosmetic gain. The professional shape for "set it and forget it" Windows server software (Postgres, Elasticsearch, Jenkins) is **a folder + an install script + Windows Services**. Same shape used here.

#### D2 — NSSM (vendored) for service supervision

NSSM is the de-facto Windows tool for wrapping arbitrary processes as Services with auto-restart, log rotation, and clean stop semantics. ~350 KB; trivial to vendor. Alternative was the native `sc.exe` + custom service shim, which is significantly more code.

#### D3 — Cloudflare Tunnel (credentials-file mode), not ngrok

Long-term cost calculus: ngrok paid is $8/mo for a reserved domain. Cloudflare Tunnel is free; the only cost is registering a domain on Cloudflare (~$10/yr at-cost via Cloudflare Registrar). Cloudflare Tunnel also runs natively as a Windows Service, integrates cleanly with NSSM, and doesn't rate-limit non-paid users the way ngrok free does.

The original plan was **token-based** Cloudflare Tunnel with ingress configured via the dashboard. The dashboard UI for public-hostname-to-localhost mapping has been heavily reorganized (multiple Cloudflare One restructures) and is no longer easily reachable in the current dashboard. Pivoted mid-implementation to **credentials-file mode** with ingress declared in a local `cloudflared-config.yml`. This is actually the more robust setup — config lives in the repo, is versioned, and supports multi-hostname trivially. The pivot cost about 30 minutes of dashboard navigation before the call was made.

#### D4 — `cloudflared.exe` downloaded on first install, NSSM vendored

NSSM is ~350 KB; cloudflared is ~25 MB. Vendoring NSSM is trivial; vendoring cloudflared would inflate the repo materially without benefit (Cloudflare's release URL is stable and we verify the SHA256 at download time).

#### D5 — JVM launched via `java.exe @jvm-args.txt -cp @classpath.txt`, not `mvn exec:java`

The existing `run.sh` invokes `mvn exec:java` — fine for foreground dev but a bad fit for an NSSM-supervised service: maven cold-start adds ~5-10s per restart, and the NSSM → mvn → java process chain is hard to PID-track or stop cleanly. Two alternatives considered:

- **Build a fat JAR** (maven-shade or maven-assembly plugin in `Mage.Server.WebApi/pom.xml`). Requires editing the WebApi pom — outside the slice scope ("nothing outside `mage-stack/` gets edited").
- **Wrapper script that invokes mvn** — preserves scope but inherits the slow-startup + PID-tracking issues.

Chosen: at install time, run `mvn dependency:build-classpath -Dmdep.outputFile=mage-stack/config/classpath.txt`. NSSM launches `java.exe` directly with that classpath file. `mage-redeploy` regenerates the classpath after rebuilding. This keeps scope locked AND gives the operations win.

#### D6 — Watchdog as a third service, not embedded in NSSM

NSSM detects process crashes natively but not process-still-running-but-hung scenarios — Java in particular can lock up without dying (deadlocked thread holding the event loop). A third "MageWatchdog" service polls `/api/health` (already exists at [`WebApiServer.java:283`](../../Mage.Server.WebApi/src/main/java/mage/webapi/server/WebApiServer.java#L283)) every 30s and forces a restart of MageWebApi after 3 consecutive failures. Watchdog respects an `.intentional-down` sentinel file so `mage-down` doesn't fight it.

## Consequences

### Positive

- **Zero per-session bring-up.** After install, all three services start on Windows boot.
- **Self-healing.** Crashes recover automatically (NSSM); hangs recover within 90s (watchdog).
- **Stable public URL.** `https://modern-mage.com` no longer rotates. `VITE_XMAGE_WEBAPI_URL` becomes a one-time Vercel env var, not a per-deploy rebuild.
- **Versioned ingress config.** `cloudflared-config.yml` lives in the repo (template only — the substituted version is gitignored because it contains the tunnel UUID).
- **Status visibility.** `mage status` returns a 3-line health board.

### Negative

- **Adds two new dependencies** (NSSM, cloudflared) to the operator's mental model.
- **Existing `playtest-up.sh` becomes deprecated** but is left in place for a transition period (see slice follow-up).
- **`config.json` per-machine.** Paths like `JAVA_HOME` and the WebApi JAR location are absolute Windows paths; not directly portable to other machines or Linux. Acceptable for a single-developer fork.
- **JVM stop is forceful.** NSSM's `AppStopMethodSkip` configuration lets it skip console-Ctrl-C and go straight to TerminateProcess after a 10s grace window. Java doesn't expose a clean shutdown handler that survives `TerminateProcess`, so unsaved in-memory game state is lost on any restart. Acceptable: in-memory state is already lost on every JVM restart today.

### Future directions

- **INFRA-2 (queued):** Linux/macOS service equivalents for cross-platform support.
- **INFRA-3 (queued):** Public uptime monitoring (UptimeRobot or similar) — only needed if/when the user decides to publicly host.
- **INFRA-4 (queued):** Auto-pull upstream card updates via a scheduled task. Today the operator runs this manually.
- **Eventual:** Replace `mage-redeploy`'s `mvn dependency:build-classpath` step with a fat JAR if the WebApi pom is ever edited for other reasons. The classpath approach is correct but feels less canonical than `java -jar`.

## Implementation reference

- Bundle root: [`mage-stack/`](../../mage-stack/)
- Operating manual: [`mage-stack/README.md`](../../mage-stack/README.md)
- Migration guide: [`mage-stack/MIGRATION.md`](../../mage-stack/MIGRATION.md)
- Critic-pass row: [`docs/decisions/critic-pass-log.md`](critic-pass-log.md)
