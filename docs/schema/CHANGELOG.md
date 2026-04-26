# JSON wire-format schema changelog

This document tracks every change to the WebApi JSON schema. Every payload
on the wire carries a `"schemaVersion"` field whose value is the current
version below; clients refuse to connect on a major mismatch and warn on
minor mismatches.

## Versioning policy

- **Major bump (1.0 → 2.0):** breaking change. Field removed, type
  changed, semantics changed in a way clients will misinterpret. Clients
  refuse to connect.
- **Minor bump (1.0 → 1.1):** additive change. New optional field, new
  enum value, new endpoint. Clients warn and continue.
- The single source of truth for the constant is
  [`mage.webapi.SchemaVersion#CURRENT`](../../Mage.Server.WebApi/src/main/java/mage/webapi/SchemaVersion.java).
  Bump it in the same commit that lands the schema change and add an
  entry below.

---

## 1.6 — 2026-04-26 — Chat over the game stream (Phase 3 slice 2)

First end-to-end DTO round-trip on the WebSocket protocol from
[ADR 0007](../decisions/0007-game-stream-protocol.md). Adds the
`chatMessage` outbound method (server→client) and the `chatSend`
inbound type (client→server). Existing payloads keep their shape; their
reported `schemaVersion` value bumps to `"1.6"`.

### New outbound method

| `method` | `data` shape | When |
|---|---|---|
| `chatMessage` | `WebChatMessage` | Every upstream `ClientCallbackMethod.CHATMESSAGE` callback the user's session receives |

The `WebSocketCallbackHandler` (Phase 3 slice 1) now decompresses the
upstream `ClientCallback.data`, casts to `mage.view.ChatMessage`, runs
it through `ChatMessageMapper.toDto`, wraps in a `WebStreamFrame`, and
pushes through every registered `WsContext`. Every other
`ClientCallbackMethod` is still dropped — slices 3+ extend.

#### `WebChatMessage` (nested under `data`)

```json
{
  "username":    "alice",
  "message":     "ggwp",
  "time":        "2026-04-26T20:01:00Z",
  "turnInfo":    "T2 — alice's turn",
  "color":       "BLACK",
  "messageType": "TALK",
  "soundToPlay": ""
}
```

| Field | Type | Note |
|---|---|---|
| `username` | string | Speaker; empty for system messages |
| `message` | string | Plain text — webclient HTML-escapes on render |
| `time` | string | ISO-8601 UTC; empty if upstream sent no timestamp |
| `turnInfo` | string | Upstream turn-info text; empty outside game chat |
| `color` | string | Upstream `MessageColor` enum name (`BLACK` / `RED` / `GREEN` / `BLUE` / `ORANGE` / `YELLOW`); empty if null |
| `messageType` | string | Upstream `MessageType` enum name (`USER_INFO` / `STATUS` / `GAME` / `TALK` / `WHISPER_FROM` / `WHISPER_TO`); empty if null |
| `soundToPlay` | string | Upstream `SoundToPlay` enum name; empty if null |

### New inbound type

```json
{ "type": "chatSend", "chatId": "<uuid>", "message": "ggwp" }
```

Routes to upstream `MageServerImpl.chatSendMessage(chatId, username, message)`.
The `username` argument is filled server-side from the authenticated
session so clients cannot spoof. Failure modes (in-band
`streamError` reply on the same socket):

| `streamError.code` | When |
|---|---|
| `BAD_REQUEST` | Missing `chatId` / `message` field, malformed UUID, blank message |
| `UPSTREAM_ERROR` | Upstream threw `MageException` |
| `UPSTREAM_REJECTED` | Upstream rejected (chat not found, user not subscribed, etc.) |

### Known limitations (next slices)

- **Chat is not yet scoped per game.** Slice 2 forwards every chat
  callback the user's session receives to every registered WebSocket
  for that user — so a player in two games at once sees both games'
  chats on both sockets. Slice 3 narrows to the game-chat once
  `gameInit` introduces `WebGameInfo.chatId`.
- **No reconnect via `?since=<messageId>`** (ADR 0007 D8) — slice 3,
  alongside per-game scoping.
- **No per-socket bounded queue / backpressure** (ADR 0007 D10) —
  slice 3+ once high-volume frames flow.
- **No DTO mappers** for `GameView` / `PlayerView` / `CardView` / etc.
  — slices 3-5.

---

## 1.5 — 2026-04-26 — Game stream skeleton (Phase 3 slice 1)

First slice of the WebSocket game-stream protocol described by
[ADR 0007](../decisions/0007-game-stream-protocol.md). Existing payloads
keep their shape; their reported `schemaVersion` value bumps to `"1.5"`.

### New endpoint

```
WS  /api/games/{gameId}/stream?token=<bearer>   server↔client
```

Authentication happens at the WebSocket upgrade via the `?token=` query
parameter — browsers cannot set custom headers on `WebSocket` so the
HTTP `Authorization: Bearer` path is unreachable. Token resolution
shares the same `AuthService.resolveAndBump` logic as REST, including
the sliding 24 h expiry bump.

### Frame envelope (outbound — server to client)

Every frame:

```json
{
  "schemaVersion": "1.5",
  "method":        "streamHello",
  "messageId":     0,
  "objectId":      "550e8400-...",
  "data":          { ... method-specific shape ... }
}
```

`method` is the discriminator; clients exhaustively switch on it.
`messageId` is the upstream session-side monotonic counter (0 for
synthetic frames not bound to an upstream callback). `objectId` is
typically the `gameId` or `chatId`. `data` is method-specific JSON or
`null`.

### Methods shipping in 1.5

| `method` | `data` shape | When |
|---|---|---|
| `streamHello` | `WebStreamHello` (`gameId`, `username`, `mode`) | Once on every successful WebSocket connection |
| `streamError` | `WebStreamError` (`code`, `message`) | In-band error reply for unparseable inbound frames or unsupported `type` values |

Future slices add `gameInit`, `gameUpdate`, `gameAsk`, `gameTarget`,
`chatMessage`, etc. per the table in [ADR 0007 D5](../decisions/0007-game-stream-protocol.md#d5).

### Inbound frames (client to server)

Slice 1 parses the tagged-union envelope (`type` discriminator) but
implements no inbound dispatch yet — every recognized payload type
replies with a `streamError { code: "NOT_IMPLEMENTED" }` frame so the
webclient can light up the bring-up path before its server counterpart
exists. Slice 2 wires `chatSend`; slice 3 wires `playerAction` and
`playerResponse`.

### WebSocket close codes

| Code | When |
|---|---|
| `1000` | Normal close |
| `1003` | Reserved for unsupported inbound `type` once strict mode lands |
| `4001` | Auth failed at upgrade — `?token=` missing, unknown, or expired |
| `4003` | `gameId` malformed (UUID parse failure) |

### Internal — `WebSocketCallbackHandler` replaces `NoOpCallbackHandler`

`AuthService` constructs a per-session `WebSocketCallbackHandler` at
login time, registers it with upstream `SessionManager.createSession`,
and exposes lookup via `handlerFor(upstreamSessionId)`. The slice 5
`NoOpCallbackHandler` is removed.

The handler's `register/unregister(WsContext)` lifecycle is wired in
slice 1 but its `dispatch(ClientCallback)` method is not — every
upstream callback is logged at debug and dropped. Slice 2 adds the
per-method DTO mappers and starts pushing real frames.

### Known limitations (next slices)

- **No game-existence / seat verification** at WS handshake (ADR 0007 D2 step 2).
  Slice 2 hardens once a real game is observable from the WS path.
- **No reconnect via `?since=<messageId>`** (ADR 0007 D8) — slice 2.
- **No per-socket bounded queue / backpressure** (ADR 0007 D10) — slice 2 once frames flow.
- **No inbound dispatch** — slices 2-3 ship `chatSend` / `playerAction` / `playerResponse`.
- **No DTO mappers** for `GameView` / `PlayerView` / `CardView` / etc. — slices 2-5.

---

## 1.4 — 2026-04-25 — Lobby and tables (Phase 2 slice 6)

Adds the lobby + table CRUD layer described by [ADR 0006](../decisions/0006-lobby-and-tables.md).
Existing payloads keep their shape; their reported `schemaVersion`
value bumps to `"1.4"`.

### New endpoints

```
GET    /api/server/main-room                               → WebRoomRef
GET    /api/rooms/{roomId}/tables                          → WebTableListing
POST   /api/rooms/{roomId}/tables                          → WebTable
POST   /api/rooms/{roomId}/tables/{tableId}/join           → 204
POST   /api/rooms/{roomId}/tables/{tableId}/ai             → 204
POST   /api/rooms/{roomId}/tables/{tableId}/start          → 204
DELETE /api/rooms/{roomId}/tables/{tableId}/seat           → 204
```

All require Bearer.

### New DTOs

#### `WebRoomRef` (top-level)

```json
{
  "schemaVersion": "1.4",
  "roomId":        "550e8400-...",
  "chatId":        "660e8400-..."
}
```

#### `WebTableListing` (top-level)

```json
{
  "schemaVersion": "1.4",
  "tables":        [ <WebTable>, ... ]
}
```

#### `WebTable` (top-level on create, nested in listing)

```json
{
  "tableId":           "770e...",
  "tableName":         "alice's table",
  "gameType":          "Two Player Duel",
  "deckType":          "Constructed - Standard",
  "tableState":        "WAITING",
  "createTime":        "2026-04-25T22:30:00Z",
  "controllerName":    "alice",
  "skillLevel":        "CASUAL",
  "isTournament":      false,
  "passworded":        false,
  "spectatorsAllowed": true,
  "rated":             false,
  "limited":           false,
  "seats":             [ <WebSeat>, ... ]
}
```

#### `WebSeat` (nested)

```json
{ "playerName": "alice", "playerType": "HUMAN", "occupied": true }
```

`playerType` is one of `HUMAN`, `COMPUTER_MONTE_CARLO`, `COMPUTER_MAD`,
`COMPUTER_DRAFT_BOT`, or `""` for unoccupied seats.

### Request DTOs

`WebCreateTableRequest`, `WebJoinTableRequest`, `WebAddAiRequest`,
`WebDeckCardLists`, `WebDeckCardInfo` — see [ADR 0006](../decisions/0006-lobby-and-tables.md)
for the full field list.

### New error code

| Status | Code | When |
|---|---|---|
| 422 | `UPSTREAM_REJECTED` | Upstream returned `false` from a join/leave/start/AI call (illegal deck, table full, wrong password, missing seats, wrong table state, etc.) |

Slice 6b will split this into specific codes once the callback-recording
handler from [ADR 0004 D8](../decisions/0004-auth-and-sessions.md) can
read the upstream rejection message.

### Known limitations

- **Owner-only table removal** (`DELETE /api/rooms/{id}/tables/{id}`)
  is deferred to slice 6b. Currently only seat-vacate is supported.
- **Single-table detail, room-users, finished-matches** all deferred.
- **Spectate / watch** deferred (slice 7+ alongside game stream).
- **Tournament tables** out of scope for Phase 2.
- **Per-table chat streaming** lands with the WebSocket layer in Phase 3.

---

## 1.3 — 2026-04-25 — Auth and sessions (Phase 2 slice 5)

Adds the auth layer described by [ADR 0004](../decisions/0004-auth-and-sessions.md).
Existing payloads keep their shape; their reported `schemaVersion` value
bumps to `"1.3"`. **Breaking convention change for error responses:**
4xx/5xx now use a uniform `WebError` envelope across every endpoint
(previously the cards routes used Javalin's default error JSON).

### New endpoints

- `POST /api/session` → `WebSession` (anonymous or authenticated)
- `POST /api/session/admin` → `WebSession` (admin)
- `GET /api/session/me` → `WebSession` (Bearer required)
- `DELETE /api/session` → `204` (Bearer required)

### Auth model

- Bearer token in `Authorization` header
- Opaque UUID tokens, in-memory store
- Sliding 24 h expiry, hard cap 7 d
- Newest-wins on duplicate username (revokes prior tokens)
- All routes outside `{GET /api/version, GET /api/health, POST /api/session, POST /api/session/admin}` require Bearer
- 60 s background sweep evicts expired tokens

### New DTOs

#### `WebSession` (top-level)

```json
{
  "schemaVersion": "1.3",
  "token":         "550e8400-e29b-41d4-a716-446655440000",
  "username":      "alice",
  "isAnonymous":   false,
  "isAdmin":       false,
  "expiresAt":     "2026-04-26T22:30:00Z"
}
```

#### `WebError` (uniform 4xx/5xx envelope)

```json
{
  "schemaVersion": "1.3",
  "code":          "INVALID_CREDENTIALS",
  "message":       "Login failed. Check username and password."
}
```

### Error codes (initial set)

| Status | Code | When |
|---|---|---|
| 400 | `BAD_REQUEST` | Malformed body, missing required query param, invalid limit |
| 401 | `MISSING_TOKEN` | No `Authorization: Bearer` header on protected route |
| 401 | `INVALID_TOKEN` | Token unknown or expired |
| 401 | `INVALID_CREDENTIALS` | Login failed |
| 401 | `INVALID_ADMIN_PASSWORD` | Wrong admin password (after a 3 s delay) |
| 404 | `NOT_FOUND` | Route not registered |
| 500 | `UPSTREAM_ERROR` | Unexpected upstream `MageException` |

### Known limitations (slice 5b candidates)

- **Auth-mode error granularity.** Upstream's `connectUser` returns `boolean`; our slice 5 collapses every login failure to `INVALID_CREDENTIALS`. Distinguishing locked-account → 403, version-mismatch → 412, etc. requires a callback-recording handler that captures upstream error messages. Slice 5b.
- **Rate limiting** on `POST /api/session` and `POST /api/session/admin` — deferred to slice 5b.

### CORS

Default allow-list: `http://localhost:5173`, `http://localhost:4173`, `tauri://localhost`. Override via `XMAGE_CORS_ORIGINS` env var (comma-separated). Empty string disables CORS entirely.

---

## 1.2 — 2026-04-25 — Add `/api/cards` lookup endpoints (Phase 2 slice 4)

Additive change: two new endpoints, two new DTOs. Existing endpoints
unchanged in shape.

### New endpoints

- `GET /api/cards?name=<name>` → `WebCardListing` with 0 or 1 cards
- `GET /api/cards/printings?name=<name>&limit=<N>` → `WebCardListing` with
  up to `N` printings (default `50`, hard cap `200`).

Both endpoints return `400 Bad Request` if the `name` query parameter is
missing. `limit` is clamped to `[1, 200]`; non-integer values return 400.

### New DTOs

#### `WebCardListing` (top-level — carries `schemaVersion`)

```json
{
  "schemaVersion": "1.2",
  "cards":         [ <WebCardInfo>, ... ],
  "truncated":     false
}
```

`truncated` is `true` if and only if the result set hit the `limit`
parameter on `/api/cards/printings`. For `/api/cards` it is always
`false` (single-card endpoint).

#### `WebCardInfo` (nested — no `schemaVersion`)

```json
{
  "name":            "Lightning Bolt",
  "setCode":         "LEA",
  "cardNumber":      "161",
  "manaValue":       1,
  "manaCosts":       ["{R}"],
  "rarity":          "COMMON",
  "types":           ["INSTANT"],
  "subtypes":        [],
  "supertypes":      [],
  "colors":          ["R"],
  "power":           "",
  "toughness":       "",
  "startingLoyalty": "",
  "rules":           ["Lightning Bolt deals 3 damage to any target."]
}
```

`colors` uses single-letter codes (subset of `W`, `U`, `B`, `R`, `G`).
`rarity`, `types`, `supertypes` are upstream enum names (e.g. `COMMON`,
`INSTANT`, `LEGENDARY`).

---

## 1.1 — 2026-04-25 — Add `/api/server/state` (Phase 2 slice 3)

Additive change: new endpoint and new DTO records. Existing endpoints
unchanged in shape; the schemaVersion field they report bumps to
`"1.1"` because that is the global wire-format version.

### New endpoint

- `GET /api/server/state` → `WebServerState`

### New DTOs

#### `WebServerState` (top-level — carries `schemaVersion`)

```json
{
  "schemaVersion":    "1.1",
  "gameTypes":        [ <WebGameType>, ... ],
  "tournamentTypes":  [ <WebTournamentType>, ... ],
  "playerTypes":      [ "Human", "Computer - simple", ... ],
  "deckTypes":        [ "Constructed - Standard", ... ],
  "draftCubes":       [ "Cube - Vintage 2017", ... ],
  "testMode":         false
}
```

#### `WebGameType` (nested — no `schemaVersion`)

```json
{
  "name":            "Two Player Duel",
  "minPlayers":      2,
  "maxPlayers":      2,
  "numTeams":        0,
  "playersPerTeam":  0,
  "useRange":        false,
  "useAttackOption": false
}
```

#### `WebTournamentType` (nested — no `schemaVersion`)

```json
{
  "name":          "Booster Draft",
  "minPlayers":    2,
  "maxPlayers":    8,
  "numBoosters":   3,
  "draft":         true,
  "limited":       true,
  "cubeBooster":   false,
  "elimination":   false,
  "random":        false,
  "reshuffled":    false,
  "richMan":       false,
  "jumpstart":     false
}
```

### Convention

**Top-level response DTOs carry `schemaVersion`. Nested DTOs do not.**
Schema version is a wire-format concept; repeating it on every nested
object would bloat the payload without adding info.

---

## 1.0 — 2026-04-25 — Initial baseline (Phase 2 slice 1)

First slice of the WebApi facade. Two endpoints, two DTOs.

### Endpoints

- `GET /api/version` → `WebVersion`
- `GET /api/health`  → `WebHealth`

### DTOs

#### `WebVersion`

```json
{
  "schemaVersion": "1.0",
  "mageVersion":   "1.4.58-V1",
  "buildTime":     "<jar manifest build-time, may be empty>"
}
```

| Field | Type | Source | Note |
|---|---|---|---|
| `schemaVersion` | string | `mage.webapi.SchemaVersion.CURRENT` | wire-format version |
| `mageVersion` | string | upstream `mage.utils.MageVersion` constants | upstream release identifier |
| `buildTime` | string | upstream jar manifest | empty for developer builds |

#### `WebHealth`

```json
{
  "schemaVersion": "1.0",
  "status":        "ready"
}
```

| Field | Type | Note |
|---|---|---|
| `schemaVersion` | string | wire-format version |
| `status` | string enum | one of `ready`, `starting`, `error` |

### Snapshot policy

Every DTO mapper has a snapshot test under
`Mage.Server.WebApi/src/test/java/mage/webapi/mapper/` that locks the
JSON output shape (field set + types). When the upstream view classes
drift, that test goes red — handle the change deliberately and update
this changelog before bumping the schema version.
