# mage-stack — XMage WebApi runtime bundle

A self-installing folder that runs the XMage WebApi server as a set of Windows Services, behind a stable Cloudflare Tunnel, with auto-restart on crash and watchdog-triggered restart on hang.

**One-line summary:** open PowerShell once, run `install-service.ps1`, then forget about it.

---

## Six-command operating manual

After install, your day-to-day surface is six commands. Run them from `F:\xmage\mage-stack\scripts\` (or add that to your PATH).

| Command | What it does |
| --- | --- |
| `.\mage-status.ps1` | Print 3-line dashboard (WebApi / tunnel / watchdog up-or-down + uptime). |
| `.\mage-up.ps1` | Graceful start of all three services. Idempotent. |
| `.\mage-down.ps1` | Graceful stop. Sets the intentional-down sentinel so the watchdog doesn't fight you. |
| `.\mage-redeploy.ps1` | Stop → rebuild WebApi JAR + regenerate classpath → start. ~60s. Use after pulling new code. |
| `.\mage-cors-refresh.ps1` | Re-apply WebApi env vars (CORS, port, profile) from `config.json` onto the running NSSM service + bounce the JVM. ~10s. Use after editing `config.webapi.*` fields without rebuilding the JAR. |
| `.\mage-logs.ps1 [webapi\|tunnel\|watchdog]` | Tail the named service's log. Defaults to webapi. |

---

## First-time install

### Prerequisites

- Windows 10/11 with PowerShell 5.1+ (the default; nothing to install)
- JDK 17+ at `C:\Program Files\Eclipse Adoptium\jdk-17.0.12.7-hotspot` (default; override in `config.json`)
- Maven on PATH (used at install + redeploy time to build the WebApi JAR)
- A Cloudflare account
- A domain registered on Cloudflare (e.g. `modern-mage.com`)
- Admin rights on the machine (NSSM service install requires elevation)

### Install steps

1. **Copy the config template:**
   ```powershell
   Copy-Item config\config.json.template config\config.json
   ```
   Edit `config\config.json` — set your tunnel hostname, your CORS origins, your JDK path if not the default. Comments inline.

2. **Run the installer (elevated PowerShell):**
   ```powershell
   Set-ExecutionPolicy -Scope Process Bypass
   .\scripts\install-service.ps1
   ```
   The installer will:
   - Verify prerequisites (JDK, mvn, admin rights, free port).
   - Download `nssm.exe` (~350 KB) and `cloudflared.exe` (~25 MB) to `bin\` (one-time each; verified post-download by running `--version`).
   - Open your browser for `cloudflared tunnel login` → click "Authorize" → return to PowerShell.
   - Create the Cloudflare Tunnel locally (delete-and-recreate if a same-named one exists in your dashboard).
   - Save tunnel credentials JSON at the path in `config.json`.
   - Build the WebApi JAR + generate the classpath file.
   - Register `MageWebApi`, `MageTunnel`, `MageWatchdog` as Windows Services.
   - Start them and run a health check.

3. **Verify:**
   ```powershell
   .\scripts\mage-status.ps1
   ```
   Expected output:
   ```
   === Mage Stack Status ====================================
   WebApi    (MageWebApi    ) : [up]    PID 4204    uptime 5s
   Tunnel    (MageTunnel    ) : [up]    PID 8916    uptime 5s
   Watchdog  (MageWatchdog  ) : [up]    PID 12044   uptime 5s

     Public URL : https://api.modern-mage.com -> http://localhost:18080
     Health     : 200 OK ({"schemaVersion":"1.x","status":"ready"})
   ```

4. **Smoke-test the public URLs:**
   - `https://api.modern-mage.com/api/health` -> `{"status":"ready",...}` (Cloudflare-tunneled API)
   - `https://modern-mage.com/` -> React app (Vercel-hosted; INFRA-2 subdomain split)
   - `https://xmage-playtest.vercel.app/` -> same React app on Vercel default URL (still works)

---

## What's running where

```
MageWebApi      -> java.exe -cp <classpath> mage.webapi.WebApiMain  (port 18080)
MageTunnel      -> cloudflared.exe tunnel --config <config.yml> run modern-mage
MageWatchdog    -> powershell.exe -File mage-watchdog.ps1            (polls /api/health every 30s)
```

All three are NSSM-managed. NSSM auto-restarts on crash; the watchdog restarts MageWebApi on hang (3 consecutive `/api/health` failures with 5s timeout). NSSM logs go to `logs\<service>.log` with rotation at 10 MB x 5 files.

## Public URL architecture (post-INFRA-2)

```
Friend's browser
        |
        v
https://modern-mage.com/         <-- Vercel-hosted React app (apex; gray cloud at Cloudflare)
        |
        | (XHR + WebSocket calls)
        v
https://api.modern-mage.com/api/* <-- Cloudflare Tunnel (orange cloud, proxied)
        |
        v
localhost:18080                   <-- MageWebApi service on this machine
```

Cloudflare DNS records for `modern-mage.com`:
- Apex `@` -> Vercel A records (e.g. `216.198.79.1`) -- proxy: **DNS only / gray cloud**
- `api` -> CNAME `<tunnel-uuid>.cfargotunnel.com` -- proxy: **Proxied / orange cloud**

The orange/gray distinction is load-bearing. Tunnel CNAMEs require Cloudflare proxy; Vercel apex requires it OFF (double-proxy breaks SSL provisioning + WebSocket).

---

## Common operations

### "I just `git pull`ed; how do I push the new code live?"

```powershell
.\scripts\mage-redeploy.ps1
```

That stops `MageWebApi`, runs `mvn -f Mage.Server.WebApi/pom.xml package -DskipTests`, regenerates the classpath, then starts `MageWebApi`. Tunnel + watchdog stay up the whole time. Total ~60s.

### "The Vercel webclient is showing stale data"

That's not a backend issue — it means the webclient was built against an older API contract. Redeploy the webclient via Vercel's dashboard (or whatever you do today). The backend is unchanged.

### "I want to take the server down for a while"

```powershell
.\scripts\mage-down.ps1
```

This creates `.intentional-down` in the bundle root. The watchdog reads that file and stops trying to restart `MageWebApi` while it's present. `mage-up.ps1` removes it.

### "Something's broken; how do I debug?"

```powershell
.\scripts\mage-logs.ps1 webapi
.\scripts\mage-logs.ps1 tunnel
.\scripts\mage-logs.ps1 watchdog
```

Logs are at `logs\<service>.log` (current) and `logs\<service>.log.1` through `.5` (rotated).

For deeper investigation:
```powershell
nssm.exe status MageWebApi          # is the service registered + state
nssm.exe edit MageWebApi            # GUI editor for service config
Get-Service Mage*                   # Windows-side service view
```

### "I want to uninstall everything"

```powershell
.\scripts\uninstall-service.ps1
```

Stops + unregisters all three services. Leaves the `.secrets/`, the Cloudflare Tunnel itself (still in your CF dashboard), and the domain alone — those are your assets, not the bundle's.

---

## Troubleshooting

### "Set-ExecutionPolicy" error on first run
PowerShell defaults to a Restricted execution policy. Run with `Set-ExecutionPolicy -Scope Process Bypass` before invoking the script. This applies only to the current PowerShell session.

### MageWebApi service won't start
Almost always a config or path issue. Check:
1. `config.json` → `webapi.javaHome` points at a real JDK 17+ install.
2. `config.json` → `webapi.classpathFile` exists (run `mage-redeploy.ps1` to regenerate).
3. Port 18080 isn't already bound (`Get-NetTCPConnection -LocalPort 18080`).
4. `logs\webapi.log` for the actual error.

### MageTunnel service won't start
Usually means the credentials JSON is missing or the cloudflared config is malformed. Check:
1. Path in `config.json` → `tunnel.credentialsFile` exists and is JSON-parseable.
2. `cloudflared-config.yml` was generated (look in `config\`).
3. `logs\tunnel.log` for the actual error.

If you ever need to recreate the tunnel from scratch: `.\scripts\uninstall-service.ps1` → re-run `install-service.ps1`.

### "modern-mage.com isn't resolving"
DNS for the tunnel hostname is set up at install time via `cloudflared tunnel route dns`. If it's broken:
```powershell
cd bin
.\cloudflared.exe tunnel route dns modern-mage modern-mage.com
```

This is idempotent. If DNS is already wired correctly, it returns "Record already exists, skipping."

---

## Architecture decisions

See [`docs/decisions/0012-infra-1-self-hosted-bundle.md`](../docs/decisions/0012-infra-1-self-hosted-bundle.md) for the full rationale on:
- Why a folder + Windows Services and not a single `.exe`.
- Why NSSM and not `sc.exe`.
- Why Cloudflare Tunnel and not paid ngrok.
- Why credentials-file mode and not token-based.
- Why `java.exe + classpath file` and not `mvn exec:java` or a fat JAR.

## Migration from `playtest-up.sh`

See [`MIGRATION.md`](MIGRATION.md) for a side-by-side comparison of the old workflow and the new one.
