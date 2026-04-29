# AFK timeout cascade — recon

- **Status:** Fix shipped (slice 46 — middleware piggyback + WS keepalive ping).
- **Date:** 2026-04-28
- **Builds on:** [ADR 0004](0004-auth-and-sessions.md) (web auth + upstream session bridge), [ADR 0006](0006-lobby-and-tables.md) (table CRUD), [ADR 0007](0007-game-stream-protocol.md) (stream + slice 38 keepalive), `Mage.Server/.../UserManagerImpl.java` (upstream activity reaper).
- **Scope:** the user-reported "lobby times out, then server refuses to create new tables" cascade. Identifies which timeout fires, what it kills, why slice 38's keepalive does not help, and the smallest viable fix.

---

## TL;DR

The cascade is driven by upstream xmage's user-activity reaper at `Mage.Server/.../UserManagerImpl.java:29`: any `User` whose `lastActivity` is older than **3 minutes** is disconnected with `DisconnectReason.SessionExpired`, and `SessionExpired.isRemoveUserTables == true` (`DisconnectReason.java:15`) so `User.removeUserFromAllTables` (`User.java:518`) runs and the lobby table the user owns is destroyed via `TableController.leaveTable` (`TableController.java:578-582`). Slice 38's WebSocket keepalive does **not** prevent this — the server-side `case "keepalive" -> { /* no-op */ }` (`GameStreamHandler.java:251`, `RoomStreamHandler.java:180`) only resets Jetty's idle timer; nothing in the WebApi calls upstream `MageServerImpl.ping(...)` or `SessionManager.extendUserSession(...)` so `User.lastActivity` is never refreshed for an idle player. The follow-up `POST /api/rooms/{roomId}/tables` then hits `executeWithResult` (`MageServerImpl.java:1195`), which sees `isValidSession(sessionId)` is false because the upstream Session was removed during the disconnect, returns the `negativeResult()` (null `TableView`), and `LobbyService.createTable` (`LobbyService.java:67-70`) maps that to a `422 UPSTREAM_REJECTED — "Server refused to create the table."` The recommended fix is **B (server-side refresh endpoint)** — wire `/api/session/me` (or a dedicated `POST /api/session/refresh`) to call `embedded.server().ping(upstreamSessionId, "")` and have the lobby polling loop call it every ≤120 s. Slice size: **S**.

---

## Layers

### 1. WebApi session

- Token store: `Mage.Server.WebApi/.../auth/WebSessionStore.java:30-31` — sliding **24 h** TTL, **7 d** hard cap. `getAndBump(token)` (`:59-75`) bumps the sliding expiry on every successful resolve.
- Resolver: `AuthService.resolveAndBump` (`AuthService.java:177-182`) is called from two places:
  - HTTP middleware: `BearerAuthMiddleware.java:74` — every authenticated REST hit refreshes WebApi expiry.
  - WS handshake: `GameStreamHandler.java:117`, `RoomStreamHandler.java:98` — refreshes WebApi expiry once at connect time (not periodically; the keepalive frame does **not** route through `resolveAndBump`).
- Sweeper: `AuthService.sweep` (`:250-267`) runs every 60 s. On each evicted entry it calls `silentDisconnect(..., DisconnectReason.SessionExpired)` (`:259`), which **does** touch upstream — but for normal AFK in the lobby, the WebApi side of the token is being bumped continuously by the 5 s `Lobby.tsx` poll (`Lobby.tsx:154`), so this sweep never fires for the AFK user. The WebApi session is **not** the failing layer.

### 2. Upstream session

Two upstream timing systems matter here.

**A. `SessionManagerImpl` itself has no timeout.** The session map (`SessionManagerImpl.java:24`) is only emptied by explicit `disconnect(...)` (`:114-134`); there is no scheduled sweep on it. The session lives until somebody removes it.

**B. `UserManagerImpl` does have one — and it is the killer.** `UserManagerImpl.java:27-30` declares:

```
USER_CONNECTION_TIMEOUTS_CHECK_SECS              = 30
USER_CONNECTION_TIMEOUT_INFORM_AFTER_SECS        = 30
USER_CONNECTION_TIMEOUT_SESSION_EXPIRE_AFTER_SECS = 180   // 3 minutes
USER_CONNECTION_TIMEOUT_REMOVE_FROM_SERVER_SECS  = 480   // 8 minutes
```

A scheduler started in `init()` (`:59`) calls `checkExpired()` every 30 s. For each `User`, it computes `isBadSession = user.isExpired(calSessionExpire.getTime())` (`:208`) — true iff `lastActivity` is older than 3 minutes. When true, `disconnect(user.getId(), DisconnectReason.SessionExpired)` (`:238`) calls `User.onLostConnection` (`User.java:188-219`), which checks `reason.isRemoveUserTables` (true for `SessionExpired`, see `DisconnectReason.java:15`) and runs `removeUserFromAllTables` (`:208`), then `setUserState(UserState.Offline)` and `userManager().removeUser(getId())` (`:210`).

What refreshes `lastActivity`?
- `User.updateLastActivity(pingInfo)` (`User.java:385-391`) — called from `UserManagerImpl.extendUserSession` (`:165-173`), which is called from `SessionManagerImpl.extendUserSession` (`:197`), which is called from `MageServerImpl.ping(sessionId, pingInfo)` (`:438-440`).
- `User.sendPlayerUUID/String/Boolean/Integer/ManaType` (`User.java:361-382`) — set `lastActivity` directly on every game input.
- `Session.connectUser` second-instance path (`Session.java:288`) — niche.

What does **not** refresh it: chat-message sends (no `updateLastActivity` in `ChatManagerImpl.broadcast` `:122-202`), table-list polls (`MageServerImpl.roomGetAllTables` `:384-394` does not even take a sessionId), state polls (`getServerState` does not), or any current WebApi inbound frame.

### 3. Table / match lifecycle

- The destruction path is **owner-leaves-while-WAITING**: `TableController.leaveTable(userId)` (`TableController.java:569-583`) — when the leaving user is the owner (`this.userId.equals(userId)`) and the state is `WAITING` or `READY_TO_START`, it calls `tableManager().removeTable(table.getId())` and the table is gone.
- That path is reached from `User.removeUserFromAllTables` (`User.java:530-535`) — iterates `tables.entrySet()` and calls `tableManager().leaveTable(userId, ...)` for each.
- Independent of the AFK reaper, there is a 10 min health sweep at `MainManagerFactory.java:84` that calls `TableManagerImpl.checkHealth` → `removeOutdatedTables` (`TableManagerImpl.java:424-454`). It only nukes tables that are not `FINISHED` and not `WAITING/READY_TO_START/STARTING` (`TableController.java:1028-1034` returns true for those, so `isMatchTableStillValid` says they're fine). A `WAITING` table sitting on a healthy lobby is **not** killed by this sweep — only by the user-disconnect cascade. So the cascade is unambiguously the 3-min user reaper.

### 4. Keepalive coverage (slice 38)

What slice 38 actually wires:

- Client side: `webclient/src/game/stream.ts:152-159` — `keepaliveTimer` armed at 30 s after the WS opens, sends `{ "type": "keepalive" }` via `socket.send`, re-arms recursively.
- Server side: `case "keepalive" -> { /* no-op — receiving the frame is enough to reset Jetty's idle timer. */ }` at `GameStreamHandler.java:251-254` and `RoomStreamHandler.java:180`. Plus `setIdleTimeout(IDLE_TIMEOUT)` (5 min) in both `onConnect` (`GameStreamHandler.java:101`, `RoomStreamHandler.java:82`).

**Crucially: the keepalive does not route through `AuthService.resolveAndBump` and does not call upstream's `MageServerImpl.ping(...)` or `SessionManager.extendUserSession(...)`.** The WS handshake bumps WebApi-side at connect time (`GameStreamHandler.java:117`, `RoomStreamHandler.java:98`); per-frame inbound traffic does not. A `grep` of `Mage.Server.WebApi/src/main/java` for `ping(` or `extendUserSession` finds nothing — the WebApi never invokes those upstream APIs.

So the keepalive's effect is exactly: **prevents Jetty's 5 min idle close, and nothing else.** It does not protect upstream `User.lastActivity`.

Coverage on the lobby page: `App.tsx:165-170` renders `<Lobby />` and `<LobbyChat />` together when `tab === 'lobby'`. `LobbyChat.tsx:60-65` opens a `GameStream` with `endpoint: 'room'`, so the room WS **is** open for an AFK user sitting on the lobby tab — the keepalive frames are flowing. But because the keepalive is a no-op upstream-side, this does not save the user.

(`Lobby.tsx` itself has no WS; only HTTP polling at `:154`. The original bug-trace hint that "the lobby has no WS" is **inaccurate** — `LobbyChat` mounts alongside it. The hint's *conclusion* — that no upstream-touching keepalive runs — is still correct, but for a different reason: the keepalive is a wire-level no-op, not a missing-WS issue.)

### 5. Inbound endpoint failure

When the user clicks "Create table" after the cascade, `CreateTableModal` posts to `POST /api/rooms/{roomId}/tables` (route registered in `WebApiServer.java`; handler calls `LobbyService.createTable(upstreamSessionId, roomId, options)` `LobbyService.java:64-76`).

Path:

1. `BearerAuthMiddleware.handle` (`:51-82`) — token is still in `WebSessionStore` (24 h sliding), so `resolveAndBump` returns the entry, `session` attribute is set, request is allowed through. **No 401.**
2. `LobbyService.createTable` calls `embedded.server().roomCreateTable(upstreamSessionId, roomId, options)` (`MageServerImpl.java:204-206`) → `executeWithResult("createTable", sessionId, new CreateTableAction(...))` (`MageServerImpl.java:1195-1204`).
3. `executeWithResult` checks `managerFactory.sessionManager().isValidSession(sessionId)` (`SessionManagerImpl.java:182-184` — just `sessions.containsKey(sessionId)`). The upstream Session was removed by the cascade (`SessionManagerImpl.java:133` inside `disconnect`, called from `User.onLostConnection` at `User.java:218`). So `isValidSession` is **false**.
4. `executeWithResult` returns `action.negativeResult()` — for `CreateTableAction` this is null `TableView`.
5. `LobbyService.createTable` sees `view == null` and throws `WebApiException(422, "UPSTREAM_REJECTED", "Server refused to create the table.")` (`LobbyService.java:67-70`).
6. The Javalin exception handler renders that as HTTP **422** with body `{ code: "UPSTREAM_REJECTED", message: "Server refused to create the table." }`.

So the user sees HTTP 422, not 401 — exactly matching the report's "the server refuses to create a new lobby." The session bearer still validates; the failure is buried one layer deeper, in upstream.

### 6. UI behavior on the bug

- `Lobby.tsx:127-167` — table-list poll. On error, sets `error` state and keeps trying every 5 s (`:154`).
- `Lobby.tsx:96-125` — initial foundation load (`/api/server/main-room`, `/api/server/state`). One-shot; failure surfaces as a generic "Failed to load lobby" banner.
- The 422 from create-table surfaces inside `CreateTableModal` (not `Lobby.tsx` directly) as the modal's error text, with no special handling for `UPSTREAM_REJECTED`. The user sees a server-said-no message and no clear path to recovery; logging out + back in is the only way to get a fresh upstream session.
- There is no client-side sign-out-and-re-login on `UPSTREAM_REJECTED` — the WebApi token is still valid so `Authorization: Bearer …` continues to authenticate, but every upstream-touching call (create table, join, start, leave seat, send player input) returns the upstream-side negative result. Effectively the user is in zombie state: WebApi-authenticated, upstream-disconnected.

---

## Reconstructed timing

Assume user `alice` logs in at t=0, creates a `WAITING` 1v1 table, sits on the lobby tab without typing chat, no game open.

| t (mm:ss) | event | source |
|---|---|---|
| 00:00 | `POST /api/session` → `AuthService.login` creates `SessionEntry` (24 h TTL) and upstream `Session` + `User` (`User.lastActivity = now`). | `AuthService.java:90-126`, `User.java:83` |
| 00:00 | Lobby polls `/api/rooms/.../tables` every 5 s; each poll bumps WebApi token (`BearerAuthMiddleware:74`) but does **not** touch upstream. | `Lobby.tsx:154` |
| 00:00 | `LobbyChat` opens room WS; `setIdleTimeout(5min)`, `joinChat` upstream — `User.lastActivity` is **not** updated by `joinChat`. | `LobbyChat.tsx:58-71`, `RoomStreamHandler.java:131-138` |
| 00:30 | First WS keepalive frame; server no-op. Upstream `User.lastActivity` still 00:00. | `stream.ts:314-326`, `RoomStreamHandler.java:180` |
| 00:30, 01:00, 01:30, 02:00, 02:30 | `UserManagerImpl.checkExpired` runs every 30 s. `lastActivity` age < 180 s → no action. | `UserManagerImpl.java:59, :181-265` |
| 03:00 | `lastActivity` age = 180 s. `checkExpired` next tick (between 03:00 and 03:30) finds `isBadSession = true`. | `UserManagerImpl.java:208, :235-239` |
| 03:30 (worst case) | `disconnect(alice.userId, SessionExpired)` → `User.onLostConnection(SessionExpired)` → `removeUserFromAllTables(SessionExpired)` (`User.java:206-210`) → `tableManager.leaveTable(alice, alice's table)` → `TableController.leaveTable` sees alice is owner + state is WAITING → `tableManager.removeTable(...)`. Table disappears from the lobby. Then `setUserState(Offline)`, `removeUser(alice.id)`, `sessionManager.disconnect(alice.upstreamSessionId, ..., false)` (`User.java:212-218`) — upstream `Session` is removed from `SessionManagerImpl.sessions`. | `User.java:188-218`, `TableController.java:569-583`, `TableManagerImpl.removeTable`, `SessionManagerImpl.java:114-134` |
| 03:35 | Next `Lobby.tsx` table-list poll returns the listing without alice's table. (No error — `roomGetAllTables` does not need a session.) The user sees the table vanish. | `MageServerImpl.java:384-394`, `Lobby.tsx:135-156` |
| any later T | alice clicks "Create table". `BearerAuthMiddleware` accepts the token (24 h TTL not yet up). `LobbyService.createTable` calls upstream. `executeWithResult` checks `isValidSession(alice.upstreamSessionId)` — false. Returns `negativeResult()` (null). `LobbyService.createTable` throws `422 UPSTREAM_REJECTED`. UI shows "Server refused to create the table." | `BearerAuthMiddleware.java:74`, `MageServerImpl.java:1195-1204`, `LobbyService.java:67-70` |

The exact moment of cascade is bounded between 03:00 (`lastActivity` age first crosses 180 s) and 03:30 (next reaper tick after that). The 8-min `USER_CONNECTION_TIMEOUT_REMOVE_FROM_SERVER_SECS` (`UserManagerImpl.java:30`) is a separate later step — it removes the `User` from the `users` map even after `Offline`. Not on the critical path here; the table is already gone by 03:30.

---

## Fix candidates

### A. UI-only fallback

Detect `UPSTREAM_REJECTED` (or any 4xx/5xx with code starting "UPSTREAM_") on table-creating / table-joining / start-match calls and on the table-list poll. On detection, force-logout (`POST /api/session` then `DELETE /api/session`) and re-authenticate transparently with the cached username + password (or prompt for re-login if anonymous). Then retry the original action.

- **Pros:** zero server changes. Robust against any future upstream-side timeout we haven't catalogued.
- **Cons:** doesn't fix the underlying cascade — alice's WAITING table is still destroyed silently 3 min into AFK. The user still loses any in-progress table setup; they just don't see a hard error. Doesn't help if the user was about to start a match. Re-login also rotates `upstreamSessionId`, which means any open WS streams (room, game) need to be torn down and reopened — cross-cutting cleanup.
- **Slice size:** **M.** Touching every call site that talks to upstream + a session-recovery flow. Most fragile against the failure mode the user actually complains about ("the game disappears").

### B. Server-side refresh endpoint

Add `POST /api/session/refresh` (or repurpose `GET /api/session/me`) so its handler does:

```java
embedded.server().ping(session.upstreamSessionId(), "");
ctx.json(authService.toDto(entry));
```

`ping` is `MageServerImpl.java:437-440` → `SessionManagerImpl.extendUserSession` → `UserManagerImpl.extendUserSession` → `User.updateLastActivity(null)`. That resets the 3-min reaper.

Have `Lobby.tsx` call the endpoint every ≤120 s (e.g. piggyback on the existing 5 s table-list poll: ping every 24th poll, or run a separate 60 s timer). Same wire-up on `Game.tsx` so AFK players in the priority chair don't get reaped either. Could also wire it into the WS keepalive's server side: change `case "keepalive" -> {}` to extract the session attribute and call `embedded.server().ping(...)`.

- **Pros:** fixes the root cause. One server change + one client change. Doesn't disturb existing upstream contracts (`ping` is the canonical activity-bump). Cheap to test.
- **Cons:** none significant. The ping is a no-op against an already-disconnected session, so it's safe to call on a stale token.
- **Slice size:** **S.** New route handler + lobby ping timer + a couple of unit tests asserting `ping` is called.

### C. Open a Lobby WebSocket

Have `Lobby.tsx` open the room WS itself instead of relying on `LobbyChat`. Same as today's behavior in practice (since `LobbyChat` already mounts), so this changes **nothing observable** unless we also fix the keepalive to bump upstream. If we're fixing the keepalive, that's a slice-B change in disguise.

- **Pros:** none over (B).
- **Cons:** touches WS lifecycle for marginal benefit. Doesn't help users who close the chat panel or have it broken.
- **Slice size:** **M.** Adds another WS to manage; complicates teardown.
- Effectively: this option becomes (B) plus extra moving parts. Reject.

### D. Fix the cascade itself

Several variants:
- **D1.** Make the keepalive call upstream `ping` server-side (as in B's last paragraph). Same effect as (B); single touchpoint; no new endpoint.
- **D2.** Increase `USER_CONNECTION_TIMEOUT_SESSION_EXPIRE_AFTER_SECS` upstream — would require either patching the read-only upstream fork (violates Path C) or finding a configuration override. Inspection of `UserManagerImpl.java:29` shows the value is a `private static final int` — not configurable.
- **D3.** Override `DisconnectReason.SessionExpired` semantics so it doesn't remove tables. Ditto — upstream code change, off-limits under Path C.
- **D4.** Have `AuthService` schedule its own per-session ping every 60 s (server-internal heartbeat). Upstream sees regular activity from every WebApi-tracked session, regardless of client behavior. This is the "make the WebApi keep upstream alive on the user's behalf" approach.

D1 is functionally identical to B's keepalive variant; D4 is the strictest "client never has to think about it" version.

- **Pros (D4):** zero client work. Any open WebApi session stays alive upstream until it's evicted by the WebApi sweeper (24 h sliding TTL or 7 d hard cap). Single sweeper thread does the work for all sessions.
- **Cons (D4):** changes the upstream meaning of "active" — a user with a stale browser tab keeps their `User` and their tables resident on the upstream server until the WebApi sweeper finally evicts. Could leak `User` instances and tables if the WebApi sweep is itself broken (it isn't — see hardening fix on `AuthService.java:204-214`). Makes the "newest-wins" newest-login flow noisier — every refresh actually keeps the prior session warm right up to the WebApi 24 h boundary instead of 3 min upstream.
- **Slice size:** **S** (D4) or **S** (D1).

### Recommended fix

**B + D1 (shipped, with critic's refinements):** wire the existing `case "keepalive"` branches in `GameStreamHandler` and `RoomStreamHandler` to call `embedded.server().ping(session.upstreamSessionId(), null)` as a side-effect, **and** piggyback the HTTP refresh on the existing `BearerAuthMiddleware.handle` so every authed REST hit also bumps upstream `User.lastActivity`.

Reasoning:
- The lobby today does have a WS open via `LobbyChat`, so the keepalive ping alone covers the AFK lobby case.
- The middleware piggyback (chosen over a new `POST /api/session/refresh` route per critic) is one line of code that covers every authed surface — including future tabs (decks, cards, profile, admin) without per-route wiring. Upstream's reaper does not care which tab the user is on; it only cares about `lastActivity`.
- Both share the same server primitive: `embedded.server().ping(upstreamSessionId, null)`. So this is one change with two call sites.
- `pingInfo` is `null`, not `""`, so `User.updateLastActivity` (`:386`) skips the field assignment — no chat banner is appropriate for a server-internal heartbeat.

**Implementation (slice 46):**
- `BearerAuthMiddleware` — constructor now takes `EmbeddedServer`; after a successful `resolveAndBump`, calls `embedded.server().ping(session.upstreamSessionId(), null)` inside a try/catch (RuntimeException → `LOG.debug`, never blocks the request). Wired through from `WebApiServer.start` where the middleware is constructed.
- `GameStreamHandler.handleKeepalive` and `RoomStreamHandler.handleKeepalive` — extract `SessionEntry` from `ATTR_SESSION` and call the same ping. Same try/catch contract.
- Both ping sites carry a JavaDoc comment noting the harmless `Offline → Connected` race in `User.onLostConnection` (between `:209` and `:210`) so future readers do not mistake this for a recovery path.

**Slice size: S.** ~50 lines of Java including tests; 0 lines of TypeScript.

Pre-commit guard: confirmed `MageServerImpl.ping` is safe to call on an already-disconnected upstream session — see "Open question 1 — RESOLVED" below.

Even with this fix, **A (UI-only fallback)** should still ship as a defense-in-depth follow-up: if anything *else* ever destroys the upstream session (server restart, manual admin disconnect, an upstream bug we don't yet know about), the user shouldn't be stuck in zombie state. That follow-up is a separate slice.

Also deferred: a top-level WebApi heartbeat for users on truly idle tabs with no HTTP polling AND no WS open (decks/cards/profile when nothing is being fetched). The middleware piggyback fires on any authed call, so the existing 5 s lobby poll already covers users on the lobby tab; other tabs that issue periodic GETs (e.g. card searches, deck saves) are also covered. The only uncovered surface is "logged in, on a static tab, no clicks for 3+ minutes" — and even that is covered if any background poll exists. Separate slice if a real surface emerges.

---

## Open questions

1. **RESOLVED — Does `MageServerImpl.ping` revive a `User` whose state went to `Offline` but who has not yet hit the 8-min remove-from-server window?** Critic confirmed: `ping` is safe on a removed session (`SessionManagerImpl.extendUserSession` `:197-201` returns `false` via `Optional.orElse(false)` — no NPE, no exception, no side effects). On a `User` whose state is `Offline` but not yet removed, `updateLastActivity` flips `userState = Connected` (`:390`) — but this is harmless: by `User.onLostConnection:217` the user has empty `sessionId`, so `fireCallback` (`:259-265`) gates on `isConnected()` and then `getSession("")` returns `Optional.empty()`, no callback fires. The user is still removed by the in-flight `removeUser` call. So the ping is **never a recovery path**; the fix has to fire **before** the cascade. The middleware piggyback + WS keepalive ping satisfy that — the heartbeat cadence is well below the 180 s reaper threshold (5 s lobby poll + 30 s WS keepalive). Code comments at both ping sites note this race for future readers.
2. **Are there other upstream timers I missed?** I searched for `scheduleAtFixedRate` in `Mage.Server/.../mage/server` and found `UserManagerImpl` (30 s), `MainManagerFactory` (10 min health), and the WebApi's own sweeper. There's also a `USERS_LIST_REFRESH_EXECUTOR` (`UserManagerImpl.java:32, :60`) but it only rebuilds the user-list view — non-destructive. `removeOutdatedTables` (`TableManagerImpl.java:424`) only touches non-WAITING / non-FINISHED tables. I am reasonably confident the 3-min user reaper is the only timer in the cascade chain, but a future ADR should catalogue every upstream scheduled task to be sure.
3. **What pingInfo string should the WebApi send?** Upstream uses it in chat banners ("alice connection problems for N secs") via `informUserOpponents` (`UserManagerImpl.java:228-233`). Empty string is silent — appropriate for a server-internal heartbeat, since the user *is* active (just AFK on a webpage) and we don't want to spam game chats. Spot check: `User.updateLastActivity` (`:385-391`) does `if (pingInfo != null) this.pingInfo = pingInfo;` — null skips the assign, empty string assigns empty. Either is fine; null is more conservative.
4. **What is the right cadence for the heartbeat?** The reaper threshold is 180 s; reaper interval is 30 s. To guarantee the user never crosses 180 s, the heartbeat must fire at most every 150 s (worst-case alignment between heartbeat tick + reaper tick = 150 + 30 = 180 s, just at the edge). Pick 60 s for headroom; 30 s if we want margin against client clock skew. Slice 38's existing 30 s WS keepalive cadence is already in this safe range, so the WS-side change inherits a correct cadence for free.
5. **Multi-instance risk:** if the same user has two browser tabs open both keeping the upstream session alive, does anything break? The upstream `User` is keyed by userId; both tabs share the same upstreamSessionId (one login). Heartbeats are idempotent. No risk.
