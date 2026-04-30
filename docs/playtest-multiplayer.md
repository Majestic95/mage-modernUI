# Multiplayer playtest — host a server + connect 3 friends over the internet

> **Last reviewed:** 2026-04-29 on Windows 11. Update this file the same session a step changes.
>
> **Disclaimer.** This is a casual-playtest setup, not a production deployment. No persistence beyond process lifetime, no real auth (anonymous logins / shared admin password), no DDoS hardening beyond the slice-63 socket cap. Tear it down when the session ends.

This doc gets you from a clean checkout to "three friends + you in a 4-player FFA game" in ~30 minutes the first time, ~10 minutes for repeat sessions. It's the canonical setup reference for the v2 modern-UI fork.

---

## Architecture (one paragraph)

Two processes need to run somewhere your friends can reach: (1) the **WebApi server** (Java/Javalin on port `18080` by default — embeds the upstream Mage engine in-process), and (2) the **webclient** (a Vite static-bundle build served at any HTTPS or `http://localhost` URL — this is what your friends open in their browser). Friends only need a browser; they don't run anything locally.

The webclient hits the WebApi server over HTTPS for REST + WSS for game streams. In a casual setup both sides typically run on **your machine** with a tunnel exposing them to the internet. For longer-running playtests use a cloud VPS — see the "Cloud option" section.

---

## Prerequisites

You already have the [dev-setup.md](dev-setup.md) prerequisites (JDK 17+, Maven, Node 22+). For this guide you also need:

- **A way to expose ports to the internet.** Pick one:
  - **ngrok** (recommended for casual playtests) — `https://ngrok.com/download`. Free tier is fine for 4 players. Tunnels both the API + webclient through one ngrok process.
  - **Cloudflare Tunnel** — free, no time-limited URLs (ngrok free tier rotates URLs each session). Slightly more setup.
  - **Home router port-forward + DDNS** — for the most stable URLs. Requires router admin + a free DDNS like duckdns.org.
- **An admin password** for the WebApi server. Pick anything; share with friends only if you want them to use admin features (which you don't — anonymous login is enough for playtest).

---

## Step 1 — Boot the WebApi server

From the repo root with `JAVA_HOME` set to JDK 17+:

```bash
export JAVA_HOME='/c/Program Files/Eclipse Adoptium/jdk-17.0.12.7-hotspot'
export PATH="$JAVA_HOME/bin:$PATH"

# REQUIRED for any non-localhost client (friends through a tunnel):
export XMAGE_CORS_ORIGINS='https://your-tunnel-url.ngrok.app,http://localhost:5173'
export XMAGE_PROFILE=prod                 # refuses to start without explicit CORS
export XMAGE_ADMIN_PASSWORD='change-me'   # any non-empty string

# OPTIONAL — defaults shown:
export XMAGE_WEBAPI_PORT=18080
export XMAGE_CONFIG_PATH=../Mage.Server/config/config.xml

cd Mage.Server.WebApi
mvn -q exec:java
```

You should see a final line like:

```
WebApi started — visit http://localhost:18080/api/version
```

**If `XMAGE_PROFILE=prod` refuses to start:** you forgot `XMAGE_CORS_ORIGINS`. Either set it to the friend-facing webclient URL(s) explicitly, or set it to `''` (empty string) to disable CORS entirely (only safe behind a tunnel that you trust — friends connecting through ngrok/CF tunnels usually want CORS enabled).

**Don't kill this terminal** while playing. The WebApi process holds the entire game state in memory; restarting blows away every active table.

---

## Step 2 — Build + serve the webclient

In a **second terminal**, from the repo root:

```bash
cd webclient

# Set the WebApi URL the bundle will hit. Friends' browsers must be
# able to resolve this URL, so use the public tunnel URL, NOT
# http://localhost:18080.
export VITE_XMAGE_WEBAPI_URL='https://your-tunnel-url-api.ngrok.app'

npm run build      # produces dist/
npm run preview    # serves dist/ at http://localhost:4173 (default)
```

`npm run preview` is a Vite static server — fine for playtest. For a longer-running setup, host `dist/` on Vercel / Netlify / Cloudflare Pages and skip the tunnel for the webclient.

---

## Step 3 — Expose both processes to the internet

### Option A — ngrok (fastest)

In a **third terminal**:

```bash
# Tunnel both the WebApi (18080) and the webclient (4173).
# ngrok's `start --all` reads multiple tunnels from ngrok.yml.
# For one-off sessions, run two `ngrok http` commands in separate
# terminals.

ngrok http 18080 --domain=your-api.ngrok.app    # paid plan
# OR for free tier (URL changes each session):
ngrok http 18080
```

In a **fourth terminal**:

```bash
ngrok http 4173 --domain=your-app.ngrok.app
# OR free tier:
ngrok http 4173
```

ngrok prints a `Forwarding https://abc123.ngrok-free.app -> http://localhost:18080` line for each tunnel. Copy both URLs.

**Now restart steps 1 and 2 with the real ngrok URLs:**

- Stop the WebApi (`Ctrl-C`), update `XMAGE_CORS_ORIGINS` to include the webclient ngrok URL, restart.
- Stop the webclient preview (`Ctrl-C`), update `VITE_XMAGE_WEBAPI_URL` to the API ngrok URL, run `npm run build && npm run preview` again.

(Future iteration: use `ngrok.yml` with a stable config and avoid the restart dance.)

### Option B — Cloudflare Tunnel (no rotating URLs on free tier)

```bash
# One-time:
cloudflared tunnel login
cloudflared tunnel create xmage-playtest
# Then in ~/.cloudflared/config.yml add ingress for both 18080 and 4173.
cloudflared tunnel run xmage-playtest
```

Cloudflare gives you a stable `https://xmage-playtest.your-domain.com` URL. Setup is more involved but pays off if you playtest more than once.

### Option C — Home router port-forward + DDNS

1. Forward TCP 18080 + 4173 from your router's WAN to your LAN IP.
2. Sign up for a free DDNS like duckdns.org → get `yourname.duckdns.org`.
3. Set `XMAGE_CORS_ORIGINS=http://yourname.duckdns.org:4173`, etc.
4. Friends visit `http://yourname.duckdns.org:4173` directly.

Caveats: many ISPs block inbound 80/443 + may use CGNAT (no public IP at all). HTTPS requires a real cert (Let's Encrypt + a reverse proxy). Worth it for ongoing setups, overkill for one session.

---

## Step 4 — Friends connect

Send them ONE link: the webclient URL (e.g. `https://abc123.ngrok-free.app`). They:

1. Open the URL in any modern browser (Chrome, Firefox, Safari, Edge — all tested).
2. Click **"Play as guest"** — the client auto-generates a `guest-XXXXXXXX` username and gets an anonymous token. (No real signup; just give them the link.)
3. After that one of you creates a 4-player table; the other three click **Join**.

### Creating a 4-player FFA table

One person creates the table from **Lobby → Create Table**. Pick:

- **Players:** 4
- **Format:** Free-For-All (or Commander, if you want EDH)
- **Slots:** All 4 set to "Open" — friends will click into them after.

Each player picks a deck from the deck library (preloaded with sample decks; or upload your own via the Decks page).

Once all 4 slots filled + decks selected → **Start Game**. The game stream opens; you're playing.

---

## Cloud option — for a longer-running setup

If you want a 24/7 playtest server (e.g. friends in different time zones):

1. **Deploy WebApi to Railway / Fly.io / a $5/mo VPS:**
   - Build with `mvn package` → produces `Mage.Server.WebApi/target/mage-server-webapi-0.0.1-SNAPSHOT.jar` + a `lib/` dir.
   - Run on the host: `JAVA_HOME=... XMAGE_CORS_ORIGINS='https://your-domain' XMAGE_PROFILE=prod XMAGE_ADMIN_PASSWORD='...' java -jar mage-server-webapi-0.0.1-SNAPSHOT.jar` with the same `--add-opens` flags from `dev-setup.md`.
   - Expose port 18080 publicly with TLS (the cloud platform usually handles cert + reverse proxy).

2. **Deploy webclient to Vercel** (recommended — zero config):
   ```bash
   cd webclient
   # Vercel auto-detects Vite; just set VITE_XMAGE_WEBAPI_URL in the
   # Vercel project's env vars to your WebApi URL.
   vercel --prod
   ```

This pattern is what the user's main Capital Engine project uses (see `~/.claude/projects/.../memory/project_deployment.md` for that pattern adapted to xmage).

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `WS upgrade failed: 4001 INVALID_TOKEN` | Token expired or webclient pointing at a different WebApi than the one issued the token | Friends click **Sign out → Play as guest** to re-auth against the current API |
| `WS upgrade failed: 4003 NOT_A_PLAYER_IN_GAME` | Friend joined the lobby but didn't actually take a slot before the game started | They open the table → click an Open slot → pick a deck before host starts |
| `WS upgrade failed: 4008 TOO_MANY_SOCKETS` | Friend left a stale tab open and opened a new one | Close all tabs of the webclient, then re-open one |
| `XMAGE_PROFILE=prod requires XMAGE_CORS_ORIGINS to be explicitly set` | You set `XMAGE_PROFILE=prod` without setting CORS | Either add `export XMAGE_CORS_ORIGINS='https://your-webclient-url'` or unset `XMAGE_PROFILE` to fall back to dev defaults (only safe for localhost-only) |
| Webclient says "API_UNREACHABLE" / blank screen | `VITE_XMAGE_WEBAPI_URL` was wrong or not baked into the bundle | Stop preview, re-export the env var, **`npm run build` again**, then `npm run preview` (Vite bakes env vars at build time, not at preview time) |
| ngrok says "your account is limited to 1 simultaneous tunnel" | Free tier limit | Use Cloudflare Tunnel (option B) or share one tunnel for both with a reverse proxy |
| Disconnected pill shows "Disconnected — waiting for reconnect" forever for a player who left | Slice 70-H ships only the detection signal; the auto-pass-on-timeout is **deferred to slice 70-H.5**. Without auto-pass, a disconnected prompt-holder stalls the game. | Have the disconnected player rejoin (they can — anonymous re-login + reconnect, the engine resumes). If they're permanently gone, the host can `concede` on their behalf via admin (or just restart the table). 70-H.5 will close this gap. |

---

## What's live as of v2 (2026-04-29)

- Path C webclient (React + Vite) over JSON/WebSocket facade
- 1v1 + 4-player FFA + Commander
- Disconnect detection + DISCONNECTED overlay (slice 70-H)
- Reconnect via `?since=` resume-buffer (slice 3+)
- Per-handler 4-socket cap (DoS defense, slice 63)
- Anonymous login + admin login (no real user accounts)

## What's NOT live yet (don't promise these to friends)

- Auto-pass-on-prompt-timeout (slice 70-H.5)
- Spectator mode (slice 71)
- Tournament / draft formats (Path C never reimplemented these)
- Real user accounts + persistence (Path C is intentionally process-scoped)
- Mobile-friendly layout (works in desktop browsers only)

---

## See also

- [Dev setup](dev-setup.md) — local-only flow (you alone, vs AI)
- [ADR 0010 v2 — Multiplayer architecture](decisions/0010-multiplayer-architecture.md) — the design decisions behind disconnect / spectator / RoI / etc.
- [Schema CHANGELOG](schema/CHANGELOG.md) — wire-format version history
