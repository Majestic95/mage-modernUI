# 0007 — Game stream protocol (WebSocket)

- **Status:** Accepted (planning) — implementation lands as Phase 3
- **Date:** 2026-04-25
- **Deciders:** Austin
- **Supersedes:** —
- **Superseded by:** —
- **Builds on:** [ADR 0001](0001-path-c-strategy.md), [ADR 0002](0002-tech-stack.md), [ADR 0003](0003-embedding-feasibility.md), [ADR 0004](0004-auth-and-sessions.md), [ADR 0006](0006-lobby-and-tables.md)
- **Sets up:** [ADR 0005](0005-game-window-architecture.md) (Phase 5 game window depends on this stream)

---

## Context

After Phase 2 ships, an authenticated client can sit at the lobby, create a table, fill seats, and call `POST /tables/{id}/start` — but nothing happens on screen because the gameplay runs entirely inside the embedded server and pushes state via the `InvokerCallbackHandler` interface, which slice 5 stubbed out as a `NoOpCallbackHandler` ([ADR 0004 D8](0004-auth-and-sessions.md)). Phase 3 fills that gap: a WebSocket per running game, a JSON envelope mapped from `ClientCallback`, and a small set of inbound routes that map to upstream's `sendPlayerAction`/`sendPlayer*` and chat methods.

The hard requirement: turn upstream's session-bound, gzipped, Java-serialized push channel into a versioned, language-neutral, browser-friendly stream that doesn't leak any upstream type onto the wire. That contract is what this ADR locks in. Code lands in Phase 3 slices.

### Investigation findings (2026-04-25 deep reads)

- **`ClientCallback` shape** (`Mage.Common/.../ClientCallback.java`) is a four-field record: `UUID objectId`, `Object data` (the view payload — gzipped via `ZippedObject`/`CompressUtil` for the wire, transparently decompressed in the upstream `CallbackClient`), `ClientCallbackMethod method`, and `int messageId`. The session layer assigns `messageId` atomically (`ReentrantLock` + counter) before each call to `AsynchInvokerCallbackHandler.handleCallbackOneway`. Our handler runs in-process — we read `getData()` directly (already decompressed inside the JVM) and never touch `ZippedObject` on the wire.
- **`ClientCallbackMethod` is a 40-value enum** grouped by `ClientCallbackType` (`MESSAGE`, `TABLE_CHANGE`, `UPDATE`, `DIALOG`, `CLIENT_SIDE_EVENT`). Game-window-relevant subset is ~15 methods; the rest are tournament/draft/replay/chat/personal-message events. Each method's data type is fixed at the call site, not the enum itself — `GAME_UPDATE` always carries `GameView`, `GAME_ASK` always carries `GameClientMessage`, `START_DRAFT` always carries `DraftClientMessage`, etc. Method dispatch on the upstream Swing client uses a switch over the enum (`CallbackClientImpl`) and casts `data` accordingly. We mirror that contract on the wire as a tagged-union JSON envelope.
- **Inbound game-action surface is 6 methods** on `MageServerImpl` (lines 681–836): `sendPlayerAction(PlayerAction, gameId, sessionId, Object)`, `sendPlayerUUID(gameId, sessionId, UUID)`, `sendPlayerString(gameId, sessionId, String)`, `sendPlayerManaType(gameId, playerId, sessionId, ManaType)`, `sendPlayerBoolean(gameId, sessionId, Boolean)`, `sendPlayerInteger(gameId, sessionId, Integer)`. The first is the toggle/state-change channel; the other five are responses to the dialog `ClientCallbackMethod`s (`GAME_TARGET`, `GAME_ASK`, `GAME_GET_AMOUNT`, `GAME_PLAY_MANA`, etc.).
- **`PlayerAction` is a 59-value enum** (`Mage/.../constants/PlayerAction.java`); only ~6 carry non-null `data` (`ROLLBACK_TURNS` carries an int, `REQUEST_AUTO_ANSWER_*` carry a String, the rest are null-data toggles). The enum mixes truly-game-affecting actions (`CONCEDE`, `PASS_PRIORITY_*`, `HOLD_PRIORITY`) with client-only preferences (`MANA_AUTO_PAYMENT_ON`, `CLIENT_DOWNLOAD_SYMBOLS`, `TOGGLE_RECORD_MACRO`). Phase 3 ships only the server-relevant subset; client-only enums are never sent.
- **Chat is a separate dispatch path** (`chatJoin/chatLeave/chatSendMessage` on lines 499–550) keyed by a `chatId` distinct from the `gameId`. `chatFindByGame(gameId)` returns the per-game chat UUID. `CHATMESSAGE` callbacks fire on every joined chat. Phase 3 multiplexes chat onto the same per-game WebSocket so the client doesn't have to manage two connections.
- **Watch is a one-way attachment.** `gameWatchStart(gameId, sessionId)` registers the session as a spectator and the same callback channel delivers `WATCHGAME` then `GAME_INIT`/`GAME_UPDATE` events; `gameWatchStop` detaches. No inbound action surface — spectators only receive. Watch lands as a slice 7-or-later opt-in, but the protocol must permit it from day one.
- **Reconnect after dropped TCP.** Upstream's Swing client sends `CLIENT_RECONNECT` via `PlayerAction`; the session-side `Session.fireCallback` re-emits the latest `GAME_UPDATE` snapshot. Our equivalent is: on WebSocket reconnect, send the last-seen `messageId` in the open frame; server replays from there or sends a fresh full snapshot.

---

## Decisions

### D1. One WebSocket per game session, not multiplexed

Each `gameId` gets its own WebSocket at `/api/games/{gameId}/stream`. Reasons:

- `ClientCallback.objectId` already carries the game UUID for game-scoped events. A multiplexed firehose would re-derive that on every frame.
- Reconnect / disconnect semantics are clean: WS close = leave game; no per-game lifecycle to manage on a shared socket.
- Backpressure isolation: a slow consumer in one game can't block another.
- Phase 6+ may add a separate global notification socket for lobby pushes, but that is **not** Phase 3 scope. Phase 3 lobby still polls `/api/rooms/{id}/tables` every 5 s as today.

The cost: a player in two games at once needs two sockets. That is genuinely rare and the simpler invariant is worth it.

### D2. Authentication — token in URL query param at handshake

`ws://host/api/games/{gameId}/stream?token=<bearer>`. Justification:

- Browsers' native `WebSocket` constructor cannot set custom headers — `Authorization: Bearer` is unreachable from JS.
- Cookies would pull in CSRF concerns we already rejected ([ADR 0004 D1](0004-auth-and-sessions.md)).
- Subprotocol-as-token is a known hack but Javalin's WS handler exposes it cleanly only with extra plumbing and Tauri's WebView2 has known bugs around custom subprotocols.
- Query-string token is logged in access logs, but our access logs aren't sent off-box and the same token is already in `Authorization` headers across every REST call.

The handshake handler:

1. Reads `?token=`, looks up the `WebSession` (same map as `BearerAuthMiddleware`)
2. Reads `{gameId}` from the path, verifies the user is seated **or** is a registered spectator on that game
3. Bumps `expiresAt` (sliding 24 h, same rule as REST)
4. On reject: respond 401/403 during the upgrade — no socket is opened
5. On accept: open the WebSocket, register the per-session `WebSocketCallbackHandler`, replay any missed frames per D8

### D3. Replace `NoOpCallbackHandler` with `WebSocketCallbackHandler`

Slice 5 wired a no-op stub through `SessionManagerImpl.createSession()`. Phase 3 hot-swaps the implementation:

```
WebSession ──(open WS for gameId)──> WebSocketCallbackHandler (per-session, per-WS)
                                          │
                                          │ handleCallbackOneway(ClientCallback)
                                          ▼
                                    DTO mapper (per ClientCallbackMethod)
                                          │
                                          │ JSON envelope
                                          ▼
                                    Javalin WsContext.send(...)
```

The per-session `Session` lifetime owns one handler; the handler holds a `Set<WsContext>` keyed by `gameId` so the same upstream session can serve multiple game sockets if a user sits at two tables. When a WebSocket closes, the handler removes its `WsContext` from the set; when the upstream session ends, the handler closes any remaining sockets with a 1000 (normal closure) and a `gameOver`/`disconnect` reason frame.

The handler also captures the periodic `MESSAGE`-type callbacks the slice-5 stub silently drops (`SHOW_USERMESSAGE`, `SERVER_MESSAGE`) and pipes them to the WS as `serverMessage` frames.

### D4. JSON envelope — tagged union keyed by `method`

Every server-to-client frame:

```json
{
  "schemaVersion": "1.5",
  "method":        "gameUpdate",
  "messageId":     1234,
  "objectId":      "550e8400-...",
  "data":          { ... method-specific shape ... }
}
```

| Field | Type | Note |
|---|---|---|
| `schemaVersion` | string | Wire-format version (every frame, not every connection — keeps frames self-contained for replay) |
| `method` | string | `code` field of `ClientCallbackMethod` (the camelCase string upstream already publishes — `gameUpdate`, `gameAsk`, `chatMessage`, etc.) |
| `messageId` | int | Monotonic per-game from the server's atomic counter; survives reconnect |
| `objectId` | string \| null | UUID — typically `gameId`, sometimes `chatId` for chat events; null where upstream sets null |
| `data` | object \| null | Method-specific payload (see D5–D7). `null` for events that carry no data (e.g., `gameRedrawGUI`) |

Discriminator is `method`; clients exhaustively switch on it. Unknown methods are ignored with a warning — additive change is minor-version-safe.

**No upstream gzip on the wire.** WebSocket has its own permessage-deflate extension which Javalin negotiates by default; that does the same work without us hand-rolling `ZippedObject` JSON encoding.

### D5. Method coverage — Phase 3 vs deferred

The 40 enum values land in three groups.

**Phase 3 ships (game-window MVP):**

| `method` | Data DTO | When |
|---|---|---|
| `gameInit` | `WebGameView` | Initial snapshot when game starts or socket opens after game already underway |
| `gameUpdate` | `WebGameView` | State change (any reason) |
| `gameInform` | `WebGameView` (with feedback panel hint) | State change with status text — `GAME_UPDATE_AND_INFORM` |
| `gameInformPersonal` | `WebGameClientMessage` | Personal info (e.g., "you draw a card") |
| `gameError` | `WebGameClientMessage` | Game-side error message |
| `gameAsk` | `WebGameClientMessage` | Yes/no dialog — answered with `WebPlayerResponse.boolean` |
| `gameTarget` | `WebGameClientMessage` | Pick target — answered with `WebPlayerResponse.uuid` |
| `gameSelect` | `WebGameClientMessage` | Pick selectable — answered with `WebPlayerResponse.uuid` |
| `gameChooseAbility` | `WebAbilityPickerView` | Pick ability — answered with `WebPlayerResponse.uuid` |
| `gameChooseChoice` | `WebChoice` | Pick from choice list — answered with `WebPlayerResponse.string` |
| `gameChoosePile` | `WebGameClientMessage` (two pile views) | Pile selection — answered with `WebPlayerResponse.boolean` |
| `gamePlayMana` | `WebGameClientMessage` | Mana payment dialog — answered with `WebPlayerResponse.boolean` |
| `gamePlayXMana` | `WebGameClientMessage` | X-mana value — answered with `WebPlayerResponse.boolean` |
| `gameSelectAmount` | `WebGameClientMessage` (with min/max) | Pick a number — answered with `WebPlayerResponse.integer` |
| `gameSelectMultiAmount` | `WebGameClientMessage` (multi-slot) | Pick several numbers — answered with `WebPlayerResponse.string` (JSON-encoded list) |
| `gameOver` | `WebGameEndView` | Match-game ended |
| `endGameInfo` | `WebGameEndView` | Final post-match summary |
| `startGame` | `WebGameInfo` | Server signals "your game has begun" — triggers webclient nav to game window |
| `chatMessage` | `WebChatMessage` | Per-game and per-table chat |
| `serverMessage` | `WebUserMessage` | Top-level server broadcast |
| `showUserMessage` | `WebUserMessage` | Modal-style user message |
| `gameRedrawGUI` | `null` | Force re-render (client-only event; webclient maps to a no-op) |

**Phase 3 forwards but does not consume (transit-only DTOs):**

| `method` | Note |
|---|---|
| `joinedTable` | Lobby-side acknowledgement — webclient uses `GET /tables` poll for now, but the frame is forwarded so a future opt-in lobby socket can listen |
| `userRequestDialog` | Cross-user request prompts (rollback turn, see hand) — payload mapped, UI lands in slice 5b or later |

**Deferred (no DTO, frame is dropped with a debug log):**

- All `*_DRAFT_*`, `*_TOURNAMENT_*`, `SIDEBOARD`, `CONSTRUCT`, `VIEW_LIMITED_DECK`, `VIEW_SIDEBOARD`, `WATCHGAME`, `SHOW_TOURNAMENT` — Phase 6/7 feature surface
- All `REPLAY_*` — replay viewer is Phase 7+
- `TOURNAMENT_INIT`, `TOURNAMENT_UPDATE`, `TOURNAMENT_OVER` — already marked unused on upstream client

When deferred features land, the existing tagged-union extends additively (new `method` values + new `data` shapes); minor schema bump per the existing CHANGELOG policy.

### D6. Inbound — two route+DTO pairs, not one

The 6 upstream `sendPlayer*` methods split cleanly into two intents:

**Pair A — `WebPlayerAction` (toggles, state changes, lifecycle):** maps to `sendPlayerAction(PlayerAction, gameId, sessionId, Object)`. Used for everything the player initiates outside of a server-prompted dialog: pass-priority modes, concede, hold/unhold priority, mana auto-payment toggles, rollback turns request, etc.

```json
{
  "type":   "playerAction",
  "action": "PASS_PRIORITY_UNTIL_TURN_END_STEP",
  "data":   null
}
```

`action` is one of the **server-relevant subset** of `PlayerAction` (server enforces the allow-list; client-only enums like `CLIENT_DOWNLOAD_SYMBOLS` are rejected with a 400-equivalent error frame). `data` is null for most actions; for `ROLLBACK_TURNS` it's `{ "turns": <int> }`; for `REQUEST_AUTO_ANSWER_TEXT_*` it's `{ "text": "..." }`. Schema validates per-action.

**Pair B — `WebPlayerResponse` (dialog responses):** maps to one of `sendPlayerUUID/String/Boolean/Integer/ManaType` based on the `kind` discriminator. Used **only** as a response to a server-side `gameAsk`/`gameTarget`/etc. dialog frame. Always carries the `messageId` of the dialog it answers so the server can correlate.

```json
{
  "type":      "playerResponse",
  "messageId": 1234,
  "kind":      "uuid",      // "uuid" | "string" | "boolean" | "integer" | "manaType"
  "value":     "660e8400-..."
}
```

| `kind` | Maps to | Wire `value` type |
|---|---|---|
| `uuid` | `sendPlayerUUID` | string (UUID) |
| `string` | `sendPlayerString` | string |
| `boolean` | `sendPlayerBoolean` | bool |
| `integer` | `sendPlayerInteger` | int |
| `manaType` | `sendPlayerManaType` | string (`ManaType` enum name) |

The `playerId` argument that `sendPlayerManaType` requires is filled server-side from the authenticated session. Client has no business naming it.

**Pair C — chat (`WebChatSend`):** maps to `chatSendMessage(chatId, userName, message)`. Inlined on the same socket because the per-game chat is conceptually part of the game session.

```json
{ "type": "chatSend", "chatId": "...", "message": "ggwp" }
```

`userName` is filled server-side from the session. Clients can never spoof.

Two route pairs A/B + C is the right shape. A single-route "everything is `sendPlayerAction`" approach loses type info clients need (no way to tell at decode time what `value` should be); a six-route fan-out leaks upstream's accidental complexity.

### D7. Outbound DTO firewall — hand-written records mirroring upstream views

Per [ADR 0001](0001-path-c-strategy.md) (Path C strategy) and the precedent set by [ADR 0006](0006-lobby-and-tables.md), upstream view classes are **never** serialized to the wire. Phase 3 hand-writes records under `mage.webapi.dto.game.*` for each entry in the table at D5. Mappers convert upstream `GameView`/`PlayerView`/etc. into these records inside the callback handler before any JSON write.

The DTO families to write:

- `WebGameView` — top-level view state (~30 fields from upstream `GameView`, 367 lines: turn, active player, priority player, phase, step, players, stack, exiles, revealed, looked-at, special actions, designations, plane, dungeon, watched-hands)
- `WebPlayerView` — per-player state (~40 fields from upstream `PlayerView`, 326 lines: life, library size, hand, graveyard, command, battlefield, mana pool, counters, attachments, monarch, designations)
- `WebCardView` — single card (full upstream `CardView` is **1626 lines** with deep inheritance; we map only what the renderer needs — see D7a below)
- `WebPermanentView` — battlefield permanent (extends CardView with tapped/flipped/transformed/attacking/blocking/attachment state, 233 lines upstream)
- `WebStackAbilityView` — ability on the stack (163 lines upstream)
- `WebManaPoolView` — per-color mana totals (64 lines upstream)
- `WebCombatGroupView` — attacker + blockers + damage assignment (72 lines upstream)
- `WebGameClientMessage` — dialog payload carrier (150 lines upstream — message text, optional cards-view, optional power-toughness, optional booleans)
- `WebGameEndView` — match results
- `WebAbilityPickerView` — choose-ability dialog
- `WebChoice` — generic choice payload
- `WebChatMessage` — chat fragment with username/color/message
- `WebUserMessage` — server-broadcast popup payload
- `WebGameInfo` — start-game pointer (gameId, chatId, opponent names, your seat)

Snapshot tests for every one of these per slice-1 ([ADR 0001](0001-path-c-strategy.md) precedent — snapshot lock against shape drift).

#### D7a. `WebCardView` — mapper scope

Upstream `CardView` is the single largest leaky surface in the project (1626 lines, 80+ fields, mixed types from Java collections to upstream domain enums). The mapper deliberately drops:

- Internal counters that aren't player-visible
- Upstream-specific debug metadata
- Source-card pointer chains beyond depth 1 (e.g., `originalCard` → don't recurse)
- Any field that requires an upstream class on the wire (e.g., `Ability` references — replaced with their flattened textual representation, identical to what upstream's renderer does at draw time)

The fields kept are the ones the React renderer actually consumes per [ADR 0005 §O5](0005-game-window-architecture.md) (card detail panel) and the priority A/B animation list (Phase 5.1 fixtures will drive the final field set; the slice-1 mapper ships with a working baseline and grows additively).

### D8. Reconnect — `?since=<messageId>` on handshake

WebSockets reconnect after every transient drop (Wi-Fi blip, laptop sleep, WebView2 navigation glitch). The protocol must survive this without a full state rebuild every time:

- On reconnect, the client sends `?token=...&since=<lastMessageId>` in the upgrade URL
- Server checks if it still has buffered frames `> since` for that game (a small per-game ring buffer of last N=64 frames)
- If yes: replays only the missing frames, then resumes live
- If no (gap too large or buffer evicted): server sends a fresh `gameInit` snapshot followed by live frames

The client treats `gameInit` as authoritative and discards local state when it arrives. `messageId` is global per game (matches upstream's atomic counter) so replay is unambiguous.

This deliberately does not survive a server restart — `messageId` resets and the buffer is empty. That's acceptable; server restart kills the upstream `Game` anyway.

### D9. Heartbeat and timeout

- Server pings every 30 s (Javalin's built-in WS ping).
- Client must respond with pong within 30 s; missing two pongs closes the socket with code 1011 (server error).
- No application-level heartbeat. WebSocket-level pings are enough.
- Idle timeout overall: 10 min with no traffic and no game updates → server closes with 1000. The client reconnects with `?since=` if the game is still active.

### D10. Backpressure — drop oldest non-critical, never block the engine

Game callbacks fire on the upstream event-dispatch thread; if `WsContext.send` blocks because a slow client filled the WS send buffer, the entire game stalls. Mitigation:

- `WebSocketCallbackHandler` writes to a **per-socket bounded queue** (capacity 256 frames)
- A dedicated per-socket sender thread drains the queue
- Queue overflow → drop frames of `ClientCallbackType.UPDATE` (the `gameUpdate` flood). `MESSAGE`/`DIALOG`/`TABLE_CHANGE` types are never dropped; if those overflow, the socket is closed with code 1011 because the client is too far behind to recover.
- After a drop, the next `gameUpdate` becomes a forced full snapshot regardless of upstream — server tags the frame with `"resync": true` so the client knows to discard local diff state.

The engine never blocks. A bad client gets disconnected, not rate-limited.

### D11. Schema bump 1.4 → 1.5

Additive minor — Phase 2 lobby payloads keep their shape; the schema-version constant moves to `"1.5"`. New surfaces:

- WebSocket envelope (D4)
- All DTOs in D7
- Inbound action/response/chat envelopes (D6)

Documented in [`docs/schema/CHANGELOG.md`](../schema/CHANGELOG.md). No major bump because nothing existing changes shape.

### D12. Defer to Phase 3b or later

To keep Phase 3 honest about scope:

- **Spectator mode** (`gameWatchStart` / `gameWatchStop` REST routes + watch-only socket) — protocol permits it (D1), endpoints land in slice 7+
- **Per-table chat** while seated but not yet in-game — the chat envelope (Pair C) supports a `chatId`, so the wire is ready, but the table-chat REST attachment lands with the lobby chat slice
- **Replay viewer** — schemas marked deferred in D5, lands Phase 7+
- **Tournament/draft sockets** — same protocol shape, separate routes (`/api/tournaments/{id}/stream`, `/api/drafts/{id}/stream`) — Phase 6+
- **Lobby-events socket** — Phase 6 polish; lobby still polls `/api/rooms/{id}/tables` in Phase 3
- **Optimistic UI** — explicitly rejected by [ADR 0005 D2](0005-game-window-architecture.md). Server-authoritative round-trip stays, even though it costs ~50 ms per click on LAN.
- **Action permission errors mid-dialog** — Phase 3 ships `gameError` frames, but richer codes (illegal target reason, etc.) wait for slice 3b alongside the callback-recording handler from [ADR 0004 D8](0004-auth-and-sessions.md)

---

## Endpoint surface

```
WS     /api/games/{gameId}/stream?token=<bearer>&since=<messageId?>   server↔client
```

That's the entire Phase 3 endpoint surface. Lobby/table REST routes already exist from [ADR 0006](0006-lobby-and-tables.md); Phase 3 only adds the stream.

---

## Wire format — outbound (server→client)

Every frame:

```json
{
  "schemaVersion": "1.5",
  "method":        "gameUpdate",
  "messageId":     1234,
  "objectId":      "550e8400-...",
  "data":          { /* method-specific */ }
}
```

Method-specific `data` shapes ship with their own JSON example in `docs/schema/CHANGELOG.md` 1.5 entry. Per-DTO fields documented in the slice that adds them.

### Reserved meta-frames

`method: "resync"` — emitted after a backpressure drop (D10); `data: null`. Client discards diff state and waits for the next `gameInit`/`gameUpdate`.

`method: "disconnect"` — emitted before an intentional server-side close; `data: { "reason": "...", "code": 1000 }`. Client should NOT auto-reconnect on this method.

---

## Wire format — inbound (client→server)

```json
// Pair A — initiator action
{ "type": "playerAction", "action": "PASS_PRIORITY_UNTIL_TURN_END_STEP", "data": null }

// Pair B — response to a server dialog
{ "type": "playerResponse", "messageId": 1234, "kind": "uuid", "value": "..." }

// Pair C — chat
{ "type": "chatSend", "chatId": "...", "message": "ggwp" }
```

Discriminator is `type`. Unknown `type` → server closes with 1003 (unsupported data) — strict because the inbound surface is small enough that fuzz traffic should be treated as malicious.

`PlayerAction` allow-list (the server-relevant subset that clients may send) lives in `mage.webapi.PlayerActionAllowList` and snapshot-tests against the upstream enum to surface drift.

---

## Architecture — handler placement

```
            WS upgrade (token, gameId)
                       │
                       ▼
       +----------------------------------+
       | GameStreamHandler (Javalin WS)   |
       |  - validates token + game seat   |
       |  - on connect:                   |
       |     register WsContext on        |
       |     WebSocketCallbackHandler     |
       |     (per-WebSession singleton)   |
       |  - on message:                   |
       |     decode tagged-union envelope |
       |     dispatch to MageServerImpl   |
       |  - on close:                     |
       |     unregister WsContext         |
       +----------------------------------+
                  │
                  │ uses (per-WebSession)
                  ▼
       +----------------------------------+
       | WebSocketCallbackHandler         |   ◄────── replaces NoOpCallbackHandler
       | implements                       |          from slice 5
       |  AsynchInvokerCallbackHandler    |
       |                                  |
       |  handleCallbackOneway(cb):       |
       |    1. select mapper by           |
       |       cb.getMethod()             |
       |    2. mapper(cb.getData())       |
       |       → WebXxx record            |
       |    3. envelope JSON              |
       |    4. enqueue to per-socket      |
       |       bounded queue              |
       +----------------------------------+
                  │
                  │ in-process call
                  ▼
       +----------------------------------+
       | MageServerImpl (embedded)        |
       |  sendPlayerAction / sendPlayerXxx |
       |  chatSendMessage                  |
       +----------------------------------+
```

`WebSocketCallbackHandler` is created when a `WebSession` first opens any WS, and is the one stored in the upstream `Session`'s field for the lifetime of that session. One per WebSession; many sockets register on it.

---

## Error contract additions

Frames already use `gameError` for in-game-rules errors. Protocol-level errors close the socket:

| Close code | When |
|---|---|
| 1000 | Normal close (logout, game ended naturally) |
| 1001 | Going away (server shutdown) |
| 1003 | Unsupported data (unknown inbound `type`, malformed JSON) |
| 1008 | Policy violation (action sent for a game the user is not seated at; client-only `PlayerAction` enum sent) |
| 1011 | Internal error (backpressure overflow on a critical type, mapper exception) |
| 4001 | Auth failed at upgrade — token missing/expired (custom code, surfaced in close reason) |
| 4003 | Forbidden — token valid but user not on this game |
| 4029 | Rate limit (deferred — slice 5b) |

REST `WebError` envelope is unchanged; this table only governs WS close codes.

---

## Validation plan

Phase 3 implementation must satisfy:

- **Snapshot tests** for every DTO in D7 — both top-level and nested. Failure on shape drift, not content.
- **Protocol round-trip test** against the embedded server: open WS, observe `gameInit`, send a `playerAction` (concede), observe `gameOver`, observe socket close.
- **Reconnect test:** drop the socket mid-game, reconnect with `?since=<messageId>`, verify only missing frames replay (not full snapshot) when buffer hot, and verify full `gameInit` when buffer cold.
- **Backpressure test:** install a slow consumer that doesn't drain the bounded queue; verify `gameUpdate` frames drop before `gameAsk` frames; verify the eventual close on critical-type overflow.
- **End-to-end test** that completes a full 1v1-vs-AI game: anon login → main-room → create-table-with-AI → POST /tables/{id}/start → opens WS → `gameInit` arrives → answers every dialog with the correct `WebPlayerResponse` shape (mulligan, target, choose, etc.) until `gameOver`. This is the gate.
- **PlayerAction allow-list** test that snapshot-locks the server-accepted subset and fails when upstream adds a new enum value (forces a deliberate decision).
- **Handshake auth** tests: missing token → 401 at upgrade; valid token but not seated → 403; expired token → 401.
- **CHANGELOG bump** 1.4 → 1.5 in the same commit as the slice-1 protocol skeleton.

A WS test harness under `Mage.Server.WebApi/src/test/java/mage/webapi/ws/` that boots the embedded server, opens a WebSocket against the running Javalin instance, and exposes `awaitFrame(method, timeout)` / `send(envelope)` helpers. Reused across every slice's tests.

If a mapper round-trip reveals an upstream coupling we can't break (e.g., `CardView` field can't be flattened without losing meaning), that mapper's slice pauses and this ADR gets revisited.

---

## Open / deferred decisions

- **WebSocket compression.** Javalin negotiates permessage-deflate by default. No explicit decision needed. Revisit only if a profiling pass shows it hurts CPU more than it saves bandwidth.
- **Frame size cap.** Default Javalin/Jetty WS message limit is generous (~64 MB). Game frames are well under 1 MB even with full battlefield + stack. No cap added in slice 1; revisit if a malicious client tries to OOM us.
- **Per-frame compression of large `WebGameView`** snapshots — punt; permessage-deflate handles it at the WS layer.
- **Stable `messageId` across reconnect after server restart** — out of scope (D8 acknowledges this). Adds persistence requirements for marginal benefit.
- **Multiplexed lobby socket** — Phase 6+ as noted in D1.
- **Latency-budget instrumentation** (server-side timing of mapper + serialize + send) — slice 3b polish task.
- **Macro recording** (`TOGGLE_RECORD_MACRO`) — explicitly not in the allow-list. If anyone wants it, it's a future feature with its own ADR.

---

## References

- [PATH_C_PLAN.md — Phase 3](../PATH_C_PLAN.md)
- [ADR 0001 — Path C strategy](0001-path-c-strategy.md)
- [ADR 0002 — Tech stack](0002-tech-stack.md)
- [ADR 0003 — Embedding feasibility](0003-embedding-feasibility.md)
- [ADR 0004 — Auth and sessions](0004-auth-and-sessions.md) (D8 — replaces `NoOpCallbackHandler`)
- [ADR 0005 — Game window architecture](0005-game-window-architecture.md) (downstream consumer)
- [ADR 0006 — Lobby and tables](0006-lobby-and-tables.md)
- Upstream `ClientCallback` — `Mage.Common/src/main/java/mage/interfaces/callback/ClientCallback.java`
- Upstream `ClientCallbackMethod` (40 values) — `Mage.Common/src/main/java/mage/interfaces/callback/ClientCallbackMethod.java`
- Upstream `AsynchInvokerCallbackHandler` — `Mage.Common/src/main/java/org/jboss/remoting/callback/AsynchInvokerCallbackHandler.java`
- Upstream `Session.fireCallback` — `Mage.Server/src/main/java/mage/server/Session.java`
- Upstream `MageServerImpl` `sendPlayer*` (lines 681–836) — `Mage.Server/src/main/java/mage/server/MageServerImpl.java`
- Upstream `PlayerAction` (59 values) — `Mage/src/main/java/mage/constants/PlayerAction.java`
- Upstream view classes — `Mage.Common/src/main/java/mage/view/`
