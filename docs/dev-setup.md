# Dev Setup — Local build & run

> Captured from the working setup as of 2026-04-25 on Windows 11. Update this file the same session a step changes.

This doc gets a contributor from a fresh clone to a running server + Swing client + first game vs. AI. It's the canonical "is my environment broken?" reference.

---

## Prerequisites

> **Important — dual JDK setup:** build with JDK 17+, but **run upstream Java code with JDK 8.** JBoss Remoting (the network library Xmage uses) relies on pre-module-system reflection that JDK 9+ forbids by default; the client errors with *"Wrong java version"* if launched on JDK 17. Phase 0 ships with this dual-JDK approach. Phase 1 spike will evaluate whether `--add-opens` flags can let us run on a single modern JDK.

| Tool | Required version | Notes |
|---|---|---|
| **Build JDK** | 17+ LTS | JDK 17 currently used (Eclipse Adoptium Temurin). JDK 21 fine. Compiles upstream's Java 8 modules via `--release 8`. Used for `mvn install package` and our future `Mage.Server.WebApi` module. |
| **Runtime JDK** | 8 | JDK 8 (Adoptium Temurin 1.8.0_422 verified). **Required** to launch upstream `mage-server.jar` and `mage-client.jar`. Will revisit in Phase 1. |
| **Maven** | 3.9+ | 3.9.10 verified. Must be on `PATH`. Maven works fine with JDK 17 even when the runtime target is Java 8. |
| **Git** | 2.40+ | Standard. |
| **Disk** | ~5 GB free | ~2 GB for `.m2` Maven cache + build artifacts; the rest for the H2 card DB and image cache. |
| **RAM** | 8 GB minimum | The packaging step (assembly:single) needs at least `MAVEN_OPTS=-Xmx4g` or it OOMs on the client zip. |
| **make** *(optional)* | — | Windows Git Bash does not include `make`. Use the `mvn` commands directly (shown below) or install via WSL/MSYS. The `Makefile` exists but is a thin wrapper. |

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

### 2. Set `JAVA_HOME` per task

The build needs JDK 17+; the runtime needs JDK 8. Set `JAVA_HOME` to the right one before each task.

**For building (JDK 17+):**

Bash (Git Bash on Windows):
```bash
export JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-17.0.12.7-hotspot"
export PATH="$JAVA_HOME/bin:$PATH"
java -version    # confirms 17.x
mvn -version     # confirms Maven sees the same JDK 17
```

PowerShell:
```powershell
$env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-17.0.12.7-hotspot"
$env:PATH = "$env:JAVA_HOME\bin;$env:PATH"
```

**For running (JDK 8):** use a separate terminal or re-export when you switch tasks:

Bash:
```bash
export JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-8.0.422.5-hotspot"
export PATH="$JAVA_HOME/bin:$PATH"
java -version    # confirms 1.8.x
```

PowerShell:
```powershell
$env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-8.0.422.5-hotspot"
$env:PATH = "$env:JAVA_HOME\bin;$env:PATH"
```

(For permanent settings, use System Environment Variables — but per-session is the cleanest way to switch JDKs without polluting the global state.)

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

The equivalent `make build` command exists in the `Makefile` if you have `make` available.

---

## Package the runnable zips

This step produces `mage-server.zip` and `mage-client.zip` via `assembly:single`. **Required:** bump Maven heap or the client assembly OOMs.

```bash
export MAVEN_OPTS="-Xmx4g"
mvn -pl Mage.Server,Mage.Client package assembly:single -DskipTests -B -ntp
```

Outputs:
- `Mage.Server/target/mage-server.zip` (~88 MB)
- `Mage.Client/target/mage-client.zip` (~150 MB)

(The `Makefile` `package` target calls each module separately and copies into `deploy/`. Equivalent if you have `make`.)

---

## Extract and launch

```bash
mkdir -p F:/xmage/deploy/server F:/xmage/deploy/client

cd F:/xmage/deploy/server && unzip -q -o F:/xmage/Mage.Server/target/mage-server.zip
cd F:/xmage/deploy/client && unzip -q -o F:/xmage/Mage.Client/target/mage-client.zip
```

### Launch the server

> Use **JDK 8** for the runtime (see [Set JAVA_HOME per task](#2-set-java_home-per-task) above).

```bash
cd F:/xmage/deploy/server
java -Xmx1024m -jar ./lib/mage-server-1.4.58.jar
```

Expected output ends with:
```
INFO  ... Started MAGE server - listening on 0.0.0.0:17171/?serializationtype=java&maxPoolSize=300
```

Verify the listener:
```bash
netstat -ano | grep ":17171"
# TCP    0.0.0.0:17171    0.0.0.0:0    LISTENING    <PID>
```

Default config lives in `F:/xmage/deploy/server/config/config.xml`. It allows anonymous connections by default (`users anon: true`), so registration is not required for local play.

### Launch the Swing client

> Use **JDK 8** for the runtime. Launching the client on JDK 17 fails with a *"Wrong java version"* popup (JBoss Remoting reflection issue).

In a second terminal (or backgrounded):
```bash
cd F:/xmage/deploy/client
java -Xmx2000m -Dfile.encoding=UTF-8 -Dsun.jnu.encoding=UTF-8 -Djava.net.preferIPv4Stack=true -jar ./lib/mage-client-1.4.58.jar
```

**First run only:** the client builds its local H2 card database from upstream's per-card Java classes. This takes 1-2 minutes; the window is unresponsive during this time. Subsequent launches are fast (~2-3s).

**Auto-connect target:** if the client has been used on this machine before (even via the official Xmage launcher), it may auto-connect to a public server like `alpha-xmage.net` or `beta.xmage.today` and fail with *"Unable connect to server"* due to a version mismatch with our locally-built v1.4.58. Pin the target to `localhost`:

PowerShell (one-liner):
```powershell
Set-ItemProperty -Path "HKCU:\Software\JavaSoft\Prefs\mage\client" -Name "server/Address" -Value "localhost"
Set-ItemProperty -Path "HKCU:\Software\JavaSoft\Prefs\mage\client" -Name "server/Port"    -Value "17171"
```

(Java's Preferences API stores client config in the Windows registry. The slash in `server/Address` is part of the value name, not a path separator — `reg.exe` rejects it; use PowerShell.)

Card images are not bundled. The first time you see a card, you can either:
- Use the in-client *Download Images* dialog (settings menu) for a bulk fetch, or
- Just play — cards render as text-only without images.

### First game vs. AI

1. Connection dialog → server `localhost`, port `17171`, any username, any password (anon allowed).
2. Main lobby → **New Table**.
3. Game type: **Two Player Duel**.
4. Add a **Computer** opponent.
5. Pick decks for both seats from `F:/xmage/deploy/client/sample-decks/` — championship lists work well (e.g. `2004/2004 Affinity World Championship Deck Aeo Paquette.dck`).
6. Start. The AI plays automatically; you take your turns.

---

## Stopping cleanly

- **Client:** close the window normally. The JVM exits.
- **Server:** Ctrl+C in the terminal where it's running. If backgrounded:
  ```bash
  netstat -ano | grep ":17171" | grep LISTENING
  # take the last column (Windows PID) and:
  wmic process where "ProcessId=<WIN_PID>" call terminate
  ```
  Avoid `taskkill` — it pops a console window on Windows.

---

## Common gotchas

| Symptom | Fix |
|---|---|
| `java: command not found` | `JAVA_HOME` not set or not on `PATH`. Re-run the env exports. |
| Maven uses wrong JDK | `mvn -version` shows the JDK it's actually using. If wrong, `JAVA_HOME` is stale or shadowed. |
| **Client popup: *"Wrong java version - check your client running scripts and params"*** | Runtime is JDK 17 (or newer). Switch `JAVA_HOME` to JDK 8 and relaunch. Root cause is JBoss Remoting reflection rejected by the JDK 9+ module system. |
| **Client logs `InaccessibleObjectException` on `java.io.ObjectOutputStream`** | Same root cause as above — running on JDK 17. Use JDK 8. |
| **Client auto-connects to `alpha-xmage.net` / `beta.xmage.today` and fails with *"Unable connect to server"*** | Cached prefs from a previous Xmage install. Pin to localhost via the PowerShell one-liner under [Launch the Swing client](#launch-the-swing-client). |
| Client logs `JavaFX is not supported by your system. What's new page will be disabled` | Benign. Adoptium JDK 8 doesn't bundle JavaFX. Only the in-client "What's New" page is affected; gameplay is unaffected. |
| `OutOfMemoryError: Java heap space` during `assembly:single` | Set `MAVEN_OPTS="-Xmx4g"` before the package command. |
| `make: command not found` (Windows) | Skip `make`; use the `mvn` commands directly. |
| `BindException` on port 17171 | Another server instance is running. Find Windows PID via `netstat -ano \| grep ":17171"` (last column) and terminate via `wmic process where "ProcessId=<PID>" call terminate`. Avoid `taskkill` — it pops a console window. |
| Client connects but lobby is empty | Server didn't fully start before client connected; restart client. Server must log `Started MAGE server` first. |
| First client launch hangs | DB build in progress; wait 1-2 min. |
| Card images don't show | Expected — images are not bundled. Use in-client *Download Images* or play card-image-less. |

---

## Toolchain summary (verified working as of 2026-04-25)

```
Build JDK    : Eclipse Adoptium Temurin 17.0.12+7
Runtime JDK  : Eclipse Adoptium Temurin 1.8.0_422 (required by JBoss Remoting)
Maven        : Apache Maven 3.9.10
Git          : Git for Windows (Git Bash)
OS           : Windows 11 Home 10.0.26200
Heap         : MAVEN_OPTS=-Xmx4g for packaging step
First build  : ~5:15 (40 modules, 31,816 card sources, ~2 GB deps download)
```

**Phase 0 outcome:** built, packaged, launched, and played one game vs. AI end-to-end. The exit gate is met. Phase 1 begins.

---

## Next steps after Phase 0

See [PATH_C_PLAN.md](PATH_C_PLAN.md) for the phased roadmap. Phase 1 starts as soon as Phase 0's exit gate (one game vs. AI played on the unmodified system) is met.
