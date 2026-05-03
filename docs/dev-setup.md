# Dev Setup — Local build & run

> **Last reviewed:** 2026-04-29 on Windows 11. Update this file the same session a step changes.

This doc gets a contributor from a fresh clone to a running WebApi server + webclient + first game vs. AI in **under 15 minutes** (after the first build, which is slower). It's the canonical "is my environment broken?" reference.

The document is split into two flows:

1. **Path C — WebApi + webclient (the project's main flow).** Use this if you just want to play a game in the new client. Most contributors only ever need this section.
2. **Upstream Swing flow (reference).** Useful for understanding the upstream system, comparing behavior, or debugging issues that may originate upstream.

---

## Prerequisites

> **Single JDK toolchain.** JDK 17+ for build *and* runtime. Phase 1 spike (2026-04-25) confirmed `--add-opens` flags let JBoss Remoting 2.5.4 work on JDK 17+ for both server and client launches; see [ADR 0003](decisions/0003-embedding-feasibility.md). The earlier Phase 0 dual-JDK note is superseded.

| Tool | Required version | Notes |
|---|---|---|
| **JDK** | 17+ LTS | Eclipse Adoptium Temurin 17.0.12+7 verified. JDK 21 fine. Compiles upstream's Java 8 modules via `--release 8`. Runtime needs `--add-opens` flags (see below). |
| **Maven** | 3.9+ | 3.9.10 verified. Must be on `PATH`. |
| **Node** | 22+ | For the webclient. Node 24 currently used in dev; CI pins Node 22 (`.github/workflows/webapi-and-client.yml`). |
| **pnpm** | 10+ | Preferred over npm. Install via `corepack enable && corepack prepare pnpm@latest --activate`. CI pins pnpm 10. |
| **Playwright** | bundled (1.59+) | Dev-time only — runs the slice 62 e2e smoke test. Chromium-only; no other browsers needed. Run `pnpm exec playwright install chromium` once after `pnpm install`. |
| **Git** | 2.40+ | Standard. |
| **Disk** | ~5 GB free | ~2 GB for `.m2` Maven cache + build artifacts; the rest for the H2 card DB and image cache. |
| **RAM** | 8 GB minimum | The packaging step (`assembly:single`) needs at least `MAVEN_OPTS=-Xmx4g` or it OOMs on the client zip. WebApi `mvn exec:java` defaults to `-Xmx2g`. |
| **make** *(optional)* | — | Windows Git Bash does not include `make`. Use the `mvn` commands directly (shown below) or install via WSL/MSYS. |

---

## One-time setup

### 1. Clone

```bash
git clone https://github.com/Majestic95/mage-modernUI.git F:/xmage
cd F:/xmage
```

If you already had upstream cloned and want to retarget:
```bash
git remote rename origin upstream
git remote set-url --push upstream DISABLED_NEVER_PUSH_TO_UPSTREAM
git remote add origin https://github.com/Majestic95/mage-modernUI.git
```

### 2. Set `JAVA_HOME` for the session

Single JDK 17+ for everything.

Bash (Git Bash on Windows):
```bash
export JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-17.0.12.7-hotspot"
export PATH="$JAVA_HOME/bin:$PATH"
java -version    # 17.x
mvn -version     # Maven sees the same JDK 17
```

PowerShell:
```powershell
$env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-17.0.12.7-hotspot"
$env:PATH = "$env:JAVA_HOME\bin;$env:PATH"
```

(For permanent settings, use System Environment Variables — but per-session is enough for dev work. The WebApi `run.sh` auto-falls-back to the Adoptium 17.0.12+7 path if `JAVA_HOME` is unset.)

### `--add-opens` flag bundle for runtime launches

Upstream JBoss Remoting needs these flags on JDK 17+. Re-use as-is for any direct `java -jar mage-{server,client}.jar` invocation:

```
--add-opens java.base/java.io=ALL-UNNAMED
--add-opens java.base/java.lang=ALL-UNNAMED
--add-opens java.base/java.lang.reflect=ALL-UNNAMED
--add-opens java.base/java.util=ALL-UNNAMED
--add-opens java.base/sun.nio.ch=ALL-UNNAMED
--add-opens java.base/java.net=ALL-UNNAMED
--add-opens java.base/sun.security.action=ALL-UNNAMED
```

Already wired into `Mage.Server.WebApi/pom.xml` for Maven test runs (via surefire `<argLine>`) and into `Mage.Server.WebApi/run.sh` (via `MAVEN_OPTS`). Phase 2 will narrow to the minimum set.

### 3. Verify clean working tree

```bash
git status     # should be on `main`, clean
git log --oneline -3
```

---

## Build the project

First build is slow because Maven downloads ~2 GB of dependencies into `~/.m2/repository`. Subsequent builds reuse that cache.

```bash
cd F:/xmage
mvn install package -DskipTests -B -ntp
```

**Wall-clock on a current Windows 11 dev machine:** ~5:15 first build, faster after. Heaviest steps:
- `Mage` (engine) — protobuf code-gen + 3,666 source files, ~30s
- `Mage.Sets` (28k+ card classes) — the slow step; expect 1-3 min
- `Mage.Server.Plugins` aggregator — many small modules

Once the upstream artifacts are installed in `~/.m2`, you typically don't need `mvn install` again unless you pull upstream changes — the WebApi module builds independently.

---

## Path C — WebApi + webclient (main flow)

This is the day-to-day flow. Two long-running processes (WebApi server + Vite dev server), two terminals, total cold-boot ~2 minutes after the first build.

### Run the WebApi server

From `F:/xmage/Mage.Server.WebApi`:

```bash
./run.sh
```

What this does (see `Mage.Server.WebApi/run.sh:1-42`):
- Auto-sets `JAVA_HOME` to Adoptium 17.0.12+7 if unset.
- Applies the full `--add-opens` flag bundle via `MAVEN_OPTS`.
- Runs `mvn exec:java -Dexec.mainClass=mage.webapi.WebApiMain`.
- Listens on **http://localhost:18080** (override via `XMAGE_WEBAPI_PORT`).
- CORS allow-list: `localhost:5173` (Vite dev) and `localhost:4173` (Vite preview). Override via `XMAGE_CORS_ORIGINS`.

**Boot time:**
- ~75s on first boot (`MageServerImpl` bootstrap initialises the H2 card DB).
- ~30s on subsequent boots (DB already populated under `~/.xmage`).

**Health check:**
```bash
curl http://localhost:18080/api/health
# {"status":"ok","schemaVersion":"1.19", ...}
```

### Admin password (`XMAGE_ADMIN_PASSWORD`)

Slice's auditor #4 fix (commit `90962dc4`, 2026-04-29) made admin login **fail-closed by default.** If `XMAGE_ADMIN_PASSWORD` is unset, `EmbeddedServer.boot` generates a random UUID at startup and discards it — admin login is impossible without explicit operator setup. Pre-fix the hardcoded empty string `""` made admin trivially reachable.

For solo-dev work you usually don't need admin at all (guest sessions cover the play flow). To enable admin, set the env var before `./run.sh`:

```bash
export XMAGE_ADMIN_PASSWORD="your-strong-password-here"
./run.sh
```

### Run the webclient (dev)

In a second terminal, from `F:/xmage/webclient`:

```bash
pnpm install                           # first time only
pnpm exec playwright install chromium  # first time only, for e2e tests
pnpm dev
```

What this does:
- Vite dev server on **http://localhost:5173** with HMR.
- The auth token persists in `localStorage` between reloads — you stay logged in across browser refreshes.
- Login as **guest** (blank user/pass on the Login screen) for the fastest path; no registration needed.

### `?variant=<name>` URL knob — layout-variant picker (dev fixture only)

`webclient/src/layoutVariants.ts` defines a runtime variant registry that lets you iterate on multiple layout candidates side-by-side without rebuilds. Today only `'current'` (the existing REDESIGN-mode behavior, byte-for-byte) is registered. Adding a variant = extend the `LAYOUT_VARIANTS` tuple, drop a sibling component file, branch inside the consuming component via `useLayoutVariant()`.

The fixture page (`?game=fixture`) mounts a small `<VariantSwitcher>` button row at the top-right. Clicking a button swaps the variant in React state AND rewrites the URL via `history.replaceState` (so the back button doesn't pollute and a shared link reproduces the chosen variant). Hidden in production builds via `import.meta.env.DEV`.

Example:
```
http://localhost:5173/?game=fixture                    → 'current'
http://localhost:5173/?game=fixture&variant=current    → 'current' (explicit)
```

Unknown variant names fall back to `'current'` and warn once to the console — typo-friendly without spam. The variant param is independent of `?slowmo=N`; combine freely.

### `?slowmo=N` URL knob — animation debugging

`webclient/src/animation/debug.ts` reads a `slowmo` query param at module load. Multiplying it scales every Framer Motion transition by N×, preserving the spring damping ratio so the animation's *shape* stays identical and only the time axis stretches.

Example:
```
http://localhost:5173/?slowmo=4
```

A fuchsia **`SLOWMO 4×`** badge appears in the header to indicate it's active. Useful for inspecting cast/resolve animations frame-by-frame during the per-slice UX audit. Defaults to 1 (no slowdown). Negative or zero values clamp to 1.

### Playing your first game vs. AI

Once both servers are up:

1. Visit **http://localhost:5173** in your browser.
2. **Login screen** — leave user/pass blank and click **Submit**. This grants an anonymous guest session.
3. **Lobby** → click **Create table**. Defaults are pre-filled: AI checkbox checked, `COMPUTER_MAD` AI selected, `wins=1`. Click **Submit**.
4. Wait ~2-3 seconds for the AI to join the table. State transitions to `READY_TO_START`. Click **Start**.
5. **In-game:**
   - Click cards in your hand to cast them (mana auto-pays from your pool when possible).
   - Use **Next Phase** in the `ActionPanel` to advance turn structure.
   - **Concede** is in the `ActionPanel` if you want to end the game early.
6. After concede or natural game end, the **game-end modal** appears with a **Download log** button (JSON transcript of `gameInform` messages, slice 41).

Total time from `git clone` to "I just played a game": ~12 minutes once the first Maven build is cached.

---

## Testing

### Server (`Mage.Server.WebApi`)

```bash
cd F:/xmage/Mage.Server.WebApi
mvn test
```
~60s. **192 tests** as of 2026-04-29 (was 191 pre-cleanup; +1 from auditor #4 admin-disabled-by-default conversion in commit `90962dc4`).

### Webclient — unit tests (Vitest)

```bash
cd F:/xmage/webclient
pnpm test
```
~7s. **416 tests.**

### Webclient — typecheck

```bash
cd F:/xmage/webclient
pnpm typecheck
```
`tsc --noEmit`. Required pre-commit gate.

### Webclient — lint

```bash
cd F:/xmage/webclient
pnpm lint
```

> **Lint currently has 4 pre-existing errors** flagged for slice 56b cleanup (react-refresh exports + set-state-in-effect). CI's lint step is `continue-on-error: true` (`webapi-and-client.yml:97`); typecheck + tests are the gating checks until 56b lands.

### Webclient — Playwright e2e (slice 62)

```bash
cd F:/xmage/webclient
pnpm e2e          # headless
pnpm e2e:headed   # watch the browser drive itself
```

**Both servers must be running first** (WebApi on :18080, Vite on :5173). The Playwright config (`webclient/playwright.config.ts:6-10`) deliberately skips `webServer` auto-start because the WebApi cold boot is ~75s and would dominate iteration time. CI integration with auto-start is queued as slice 62b.

The single smoke test runs login → create table → AI joins → start → concede → game-end-modal in ~45-60s. Chromium-only.

---

## Continuous Integration

GitHub Actions workflow: `.github/workflows/webapi-and-client.yml` (slice 56, commit `f09cc281`).

**Path-filtered:** the workflow only runs when changes touch:
- `Mage.Server.WebApi/**`
- `webclient/**`
- `docs/schema/**`
- The workflow file itself

Upstream-only commits don't waste runner minutes here. Upstream's `maven.yml` runs the full engine build on every push — that's a separate concern.

**Two jobs:**

| Job | Steps | Notes |
|---|---|---|
| **WebApi** | `actions/setup-java@v5` (Temurin 17) → `mvn -DskipTests install` (root) → `mvn test` (`Mage.Server.WebApi`) | Root install populates `~/.m2` so transitive deps resolve on the runner. 15-min timeout. |
| **webclient** | `pnpm/action-setup@v5` (pnpm 10) → `actions/setup-node@v6` (Node 22) → `pnpm install` → `pnpm typecheck` → `pnpm lint` (informational) → `pnpm test` | 10-min timeout. Lint failures don't fail the run (`continue-on-error: true`). |

`concurrency.cancel-in-progress: true` cancels stale runs when a fast follow-up commit lands.

---

## Audit & review cadence

The agentic delivery loop is the project's standard shape — see CLAUDE.md's "Audit & Review Cadence" section for the full rationale. In short:

**Per-slice loop (every non-trivial change):**

1. **Recon** — read-only investigation, file:line citations, scope map.
2. **Builder** — implements per the recon's findings; stages but does not commit.
3. **Critic** — read-only review of the staged diff; numbered findings with severity.
4. **Fixer** — applies blockers/notables; queues nits as follow-up slices.
5. Tests + commit + (server bounce if Java changed).

Trivial slices (≤50 LOC, single file, no architectural impact) can run builder→critic only.

**Periodic sweeps (don't wait for symptoms):**

- **UX audit — every 5-10 slices** that affect layout / animation / `Game.tsx` / `ActionPanel.tsx`. Catches viewport overflow, z-index ladder, narrow-viewport behavior. Use `?slowmo=N` to inspect animations frame-by-frame.
- **SE audit — every 15-20 slices**, or at major milestones. Reviews roadmap drift, file LOC trajectory, test coverage, CI health, dependency hygiene, risk register, architectural smells.
- **Live-test loop** — irreplaceable for "feel" verification; humans notice timing/pacing issues that agents don't.

---

## Common pitfalls

| Symptom | Fix |
|---|---|
| `java: command not found` | `JAVA_HOME` not set or not on `PATH`. Re-run the env exports. |
| Maven uses wrong JDK | `mvn -version` shows the JDK it's actually using. If wrong, `JAVA_HOME` is stale or shadowed. |
| **WebApi: *"JBoss Remoting / InaccessibleObjectException"* / *"Wrong java version"*** | Forgot the `--add-opens` flag bundle. `run.sh` applies it automatically — make sure you're using the script and not invoking `mvn exec:java` directly. |
| **Webclient: *"Server refused to create"*** | AFK timeout cascade — the session expired server-side while idle. Reload the browser tab to get a fresh guest token. |
| **`pnpm lint` fails with 4 errors** | Pre-existing — slice 56b queued for cleanup. Not a regression on your branch unless `pnpm lint` produces *more* errors than baseline. CI's lint step is informational. |
| **Playwright: *"browserType.launch: Executable doesn't exist"*** | Run `pnpm exec playwright install chromium` once after `pnpm install`. |
| **Playwright test times out at the lobby** | Both servers must be running. Check `curl http://localhost:18080/api/health` and that Vite shows the lobby at http://localhost:5173. |
| `OutOfMemoryError: Java heap space` during `assembly:single` | Set `MAVEN_OPTS="-Xmx4g"` before the package command. (Doesn't apply to `run.sh`, which uses `-Xmx2g`.) |
| `BindException` on port 17171 / 18080 / 5173 | Another instance is already running. Find Windows PID via `netstat -ano \| grep ":<port>"` (last column) and terminate via `wmic process where "ProcessId=<PID>" call terminate`. Avoid `taskkill` — it pops a console window. |
| Card images don't show in webclient | Webclient fetches from Scryfall by `setCode + collectorNumber`. First-time hit is a network round-trip; service-worker cache hits afterwards. Check browser DevTools → Network for failed Scryfall requests. |
| **Public Vercel app shows "failed to fetch" after a server restart** | You restarted the WebApi via bare `./run.sh` instead of [`./scripts/playtest-up.sh`](../scripts/playtest-up.sh). `run.sh` boots in dev profile with CORS = `localhost:5173, :4173` only, silently rejecting the Vercel origin (no error in the WebApi log past the dev-default warning). Bring the public stack back up with `./scripts/playtest-up.sh` from the repo root. **Never stop at bare `run.sh`** if the public site needs to stay working — see CLAUDE.md hard constraint #6. |
| **Public Vercel app reachable but every API call fails** | The deployed bundle has the wrong (or empty) `VITE_XMAGE_WEBAPI_URL` baked in. This happens when redeploying via bare `vercel --prod` (cloud build path) instead of `playtest-up.sh`'s prebuilt path — the cloud build doesn't see the local ngrok URL. Re-run `./scripts/playtest-up.sh` to rebuild + redeploy with the URL embedded correctly. |

---

## Upstream Swing flow (reference)

> Below is the original Phase 0 / upstream-Swing-client flow. **Most contributors don't need this** — Path C above replaces the Swing client. Keep this section as a reference for: understanding upstream behavior, debugging issues that may originate upstream, or running the full classic stack for comparison.

### Package the runnable zips

```bash
export MAVEN_OPTS="-Xmx4g"
mvn -pl Mage.Server,Mage.Client package assembly:single -DskipTests -B -ntp
```

Outputs:
- `Mage.Server/target/mage-server.zip` (~88 MB)
- `Mage.Client/target/mage-client.zip` (~150 MB)

### Extract and launch

```bash
mkdir -p F:/xmage/deploy/server F:/xmage/deploy/client

cd F:/xmage/deploy/server && unzip -q -o F:/xmage/Mage.Server/target/mage-server.zip
cd F:/xmage/deploy/client && unzip -q -o F:/xmage/Mage.Client/target/mage-client.zip
```

### Launch the upstream server (Swing-flow)

```bash
cd F:/xmage/deploy/server
java \
  --add-opens java.base/java.io=ALL-UNNAMED \
  --add-opens java.base/java.lang=ALL-UNNAMED \
  --add-opens java.base/java.lang.reflect=ALL-UNNAMED \
  --add-opens java.base/java.util=ALL-UNNAMED \
  --add-opens java.base/sun.nio.ch=ALL-UNNAMED \
  --add-opens java.base/java.net=ALL-UNNAMED \
  --add-opens java.base/sun.security.action=ALL-UNNAMED \
  -Xmx1024m -jar ./lib/mage-server-1.4.58.jar
```

Expected output ends with:
```
INFO  ... Started MAGE server - listening on 0.0.0.0:17171/?serializationtype=java&maxPoolSize=300
```

Default config lives in `F:/xmage/deploy/server/config/config.xml`. It allows anonymous connections by default (`users anon: true`).

### Launch the Swing client

In a second terminal:
```bash
cd F:/xmage/deploy/client
java \
  --add-opens java.base/java.io=ALL-UNNAMED \
  --add-opens java.base/java.lang=ALL-UNNAMED \
  --add-opens java.base/java.lang.reflect=ALL-UNNAMED \
  --add-opens java.base/java.util=ALL-UNNAMED \
  --add-opens java.base/sun.nio.ch=ALL-UNNAMED \
  --add-opens java.base/java.net=ALL-UNNAMED \
  --add-opens java.base/sun.security.action=ALL-UNNAMED \
  -Xmx2000m -Dfile.encoding=UTF-8 -Dsun.jnu.encoding=UTF-8 -Djava.net.preferIPv4Stack=true \
  -jar ./lib/mage-client-1.4.58.jar
```

**First run only:** the client builds its local H2 card database from upstream's per-card Java classes. This takes 1-2 minutes; the window is unresponsive during this time. Subsequent launches are fast (~2-3s).

**Auto-connect target:** if the client has been used on this machine before (even via the official Xmage launcher), it may auto-connect to a public server like `alpha-xmage.net` or `beta.xmage.today` and fail with *"Unable connect to server"* due to a version mismatch with our locally-built v1.4.58. Pin the target to `localhost`:

PowerShell (one-liner):
```powershell
Set-ItemProperty -Path "HKCU:\Software\JavaSoft\Prefs\mage\client" -Name "server/Address" -Value "localhost"
Set-ItemProperty -Path "HKCU:\Software\JavaSoft\Prefs\mage\client" -Name "server/Port"    -Value "17171"
```

(Java's Preferences API stores client config in the Windows registry. The slash in `server/Address` is part of the value name, not a path separator — `reg.exe` rejects it; use PowerShell.)

### First game vs. AI (Swing flow)

1. Connection dialog → server `localhost`, port `17171`, any username, any password (anon allowed).
2. Main lobby → **New Table**.
3. Game type: **Two Player Duel**.
4. Add a **Computer** opponent.
5. Pick decks for both seats from `F:/xmage/deploy/client/sample-decks/`.
6. Start. The AI plays automatically; you take your turns.

### Stopping cleanly

- **Client (Swing or browser):** close the window normally.
- **Servers (upstream or WebApi):** Ctrl+C in the terminal. If backgrounded:
  ```bash
  netstat -ano | grep ":17171" | grep LISTENING   # or :18080 for WebApi
  # take the last column (Windows PID) and:
  wmic process where "ProcessId=<WIN_PID>" call terminate
  ```
  Avoid `taskkill` — it pops a console window on Windows.

---

## Toolchain summary (verified working as of 2026-04-29)

```
JDK            : Eclipse Adoptium Temurin 17.0.12+7 (build + runtime)
Runtime flags  : --add-opens bundle (7 flags) — auto-applied by run.sh
Maven          : Apache Maven 3.9.10
Node           : 22+ (24 in dev; CI pins 22)
pnpm           : 10+
Playwright     : 1.59+ (chromium-only)
Git            : Git for Windows (Git Bash)
OS             : Windows 11 Home 10.0.26200
Heap           : MAVEN_OPTS=-Xmx2g for run.sh; -Xmx4g for assembly:single
First build    : ~5:15 (40 modules, 31,816 card sources, ~2 GB deps download)
WebApi cold    : ~75s first boot; ~30s subsequent
Tests          : 192 server / 416 webclient unit / 1 e2e smoke
```

**Phase 0 outcome:** built, packaged, launched, played one game vs. AI end-to-end (upstream Swing flow).
**Phase 1 outcome:** single-JDK toolchain confirmed via `--add-opens`; embedding feasibility test (7 steps) green — see [ADR 0003](decisions/0003-embedding-feasibility.md).
**Phase 5 status:** functional gate met 2026-04-28. v1.0 closing pass underway — see [PATH_C_PLAN.md](PATH_C_PLAN.md).

---

## Next steps

See [PATH_C_PLAN.md](PATH_C_PLAN.md) for the phased roadmap and the v1.0 closing pass status.
