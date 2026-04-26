# 0006 — Lobby and tables

- **Status:** Accepted (planning) — implementation lands as Phase 2 slice 6
- **Date:** 2026-04-25
- **Deciders:** Austin
- **Supersedes:** —
- **Superseded by:** —
- **Builds on:** [ADR 0001](0001-path-c-strategy.md), [ADR 0002](0002-tech-stack.md), [ADR 0003](0003-embedding-feasibility.md), [ADR 0004](0004-auth-and-sessions.md)

---

## Context

After [ADR 0004](0004-auth-and-sessions.md) ships in slice 5, authenticated clients can hold Bearer tokens but have nowhere to use them. Slice 6 is the lobby + table CRUD that turns a logged-in WebApi client into something that can stand up a playable game (AI opponent, deck, start match) — modulo the actual gameplay stream, which is Phase 3.

This ADR is the contract; code lives in slice 6.

### Investigation findings (deep reads of upstream room/table machinery)

- **Rooms are functionally a singleton.** `GamesRoomManagerImpl.init()` creates exactly one main lobby on server startup. Its UUID is generated fresh each restart and is not persisted. `roomGetAllTables`, `roomGetUsers`, `roomGetFinishedMatches` are upstream-public (no sessionId required), but our middleware still wraps them.
- **`MatchOptions` has 30+ fields**, of which only `gameType`, `deckType`, and `winsNeeded` are truly required. Sensible defaults exist for the rest. (`MatchOptions.java`)
- **Deck submission is client-resident.** `roomJoinTable(sessionId, roomId, tableId, name, PlayerType, skill, DeckCardLists, password)` takes a literal `DeckCardLists`. There is no upstream deck-storage service — deck content lives only on the client until join time. (`MageServerImpl:297`, `DeckCardLists.java`)
- **AI players join via `roomJoinTable` with a different `PlayerType`** (`COMPUTER_MONTE_CARLO`, `COMPUTER_MAD`, or `COMPUTER_DRAFT_BOT`). Server replaces the dummy deck with a generated one. Capped per-table by `maxAiOpponents` config.
- **Lifecycle states are server-driven** — `WAITING → READY_TO_START → STARTING → DUELING → SIDEBOARDING → FINISHED`. Clients can only trigger `startMatch()` (owner-only, only from `READY_TO_START`) and `removeTable()` (owner-only).
- **Boolean returns hide reasons.** `roomJoinTable` and `roomLeaveTableOrTournament` return `boolean`. False on rejection (deck illegal, table full, password wrong, etc.) without preserving the cause — same problem as auth-mode connectUser.

---

## Decisions

### D1. No `/api/rooms` list endpoint

Upstream is a singleton main lobby. A list of length 1 is misleading; clients should `GET /api/server/main-room` to discover the active lobby instead. Tournament rooms or user-rooms are not part of slice 6 (or any current phase).

### D2. All `/api/rooms/*` routes require Bearer auth

Upstream does not require a sessionId on `roomGetAllTables` etc., but our middleware enforces auth on everything outside the public allow-list (per ADR 0004 D9). Anonymous sessions cost nothing (`POST /api/session` with empty body); no UX impact. Simplifies the middleware contract.

### D3. Curated `MatchOptions` wire format — required + common-overrides

The wire-format `WebMatchOptions` exposes:

- **Required:** `gameType`, `deckType`, `winsNeeded`
- **Common, optional:** `tableName` (defaults to `username + "'s table"`), `password` (default `""`), `skillLevel` (default `CASUAL`), `matchTimeLimit` (default `NONE`), `spectatorsAllowed` (default `true`), `rated` (default `false`), `freeMulligans` (default `0`), `mulliganType` (default `GAME_DEFAULT`), `attackOption` (default `LEFT`), `range` (default `ALL`)
- **Deferred** (server-side defaults; not exposed): `customStartLife`/`customStartHandSize`, `edhPowerLevel`, `planeChase`, `perPlayerEmblemCards`, `globalEmblemCards`, `bannedUsers`, `quitRatio`, `minimumRating`, `multiPlayer`, `matchBufferTime`, `rollbackTurnsAllowed`

If a future client needs a deferred field, we expose it then.

### D4. Deck submission — `DeckCardLists` mirrored on the wire

Slice 6 ships with the deck included in the join request body. The wire format mirrors upstream's `DeckCardLists`:

```json
{
  "name":      "Mono-Red Burn",
  "author":    "alice",
  "cards":     [ { "cardName": "Lightning Bolt", "setCode": "LEA",
                   "cardNumber": "161", "amount": 4 }, ... ],
  "sideboard": [ ... ]
}
```

`name` and `author` are client-supplied display strings only. `cards` and `sideboard` are required arrays (sideboard may be empty). Each entry maps directly to upstream `DeckCardInfo` — `setCode + cardNumber` is the canonical identifier (matches our [ADR 0002](0002-tech-stack.md) Scryfall art-fetch model).

A separate deck-storage / deck-builder layer is **explicitly deferred** — the webclient (Phase 4) will build decks locally and POST them at join time.

### D5. AI seats — separate endpoint, not a flag on join

Cleaner than overloading `/join` with a `playerType` field. A dedicated `POST /api/rooms/{id}/tables/{tid}/ai` reads `{ playerType: "COMPUTER_MONTE_CARLO" }` and lets the server fill name + dummy deck. Players never have to know that AI seats are joins-with-special-fields. Upstream still calls `roomJoinTable` underneath.

### D6. Leave is `DELETE /seat`, remove is `DELETE /tables/{id}` (owner-only)

Two distinct actions, two distinct paths:

- `DELETE /api/rooms/{id}/tables/{tid}/seat` — vacate **your own** seat. Allowed for anyone seated. Maps to `roomLeaveTableOrTournament`.
- `DELETE /api/rooms/{id}/tables/{tid}` — destroy the entire table. Allowed only for the table owner (or admin). Maps to `TableManager.removeTable(userId, tableId)`.

Slice 6 ships **only the seat leave**. Table removal lands in slice 6b once we wire the owner check explicitly.

### D7. Start match — `POST /tables/{id}/start`

Owner-only. Returns `204 No Content` on success. Maps to `MageServerImpl.matchStart(sessionId, roomId, tableId)`.

### D8. Boolean failure → 422 `UNPROCESSABLE_ENTITY`

When upstream returns `false` from a join/leave/start call without further detail, we respond `422` with `code: "UPSTREAM_REJECTED"`. Slice 6 ships generic; slice 6b adds the callback-recording handler from [ADR 0004](0004-auth-and-sessions.md) D8 to capture upstream error messages and produce richer error codes.

### D9. Schema bump 1.3 → 1.4

Additive minor. Existing payloads keep their shape; new endpoints + new DTOs land. Documented in `docs/schema/CHANGELOG.md`.

### D10. Defer to slice 6b or later

Explicit list of what's **not** in slice 6, to keep scope honest:

- `GET /api/rooms/{id}/users` (online users + capacity)
- `GET /api/rooms/{id}/finished` (finished match list)
- `GET /api/rooms/{id}/tables/{tid}` (single-table detail — listing + filter is enough for now)
- Spectator / watch endpoints
- Tournament-table support
- Table removal (`DELETE /tables/{id}` owner action)
- Richer error codes from upstream-rejection (needs callback-recording handler)
- Per-table chat streaming (Phase 3 alongside game stream)

---

## Endpoint surface

```
GET    /api/server/main-room                                 → WebRoomRef
GET    /api/rooms/{roomId}/tables                            → WebTableListing
POST   /api/rooms/{roomId}/tables                            → WebTable
POST   /api/rooms/{roomId}/tables/{tableId}/join             → 204
POST   /api/rooms/{roomId}/tables/{tableId}/ai               → 204
POST   /api/rooms/{roomId}/tables/{tableId}/start            → 204
DELETE /api/rooms/{roomId}/tables/{tableId}/seat             → 204
```

All require Bearer.

---

## Wire format

### `WebRoomRef` (top-level)

Lightweight discovery payload.

```json
{
  "schemaVersion": "1.4",
  "roomId":        "550e8400-e29b-41d4-a716-446655440000",
  "chatId":        "660e8400-e29b-41d4-a716-446655440000"
}
```

### `WebTable` (nested inside listings; also returned standalone from create)

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
  "seats":             [ { "playerName": "alice", "playerType": "HUMAN", "occupied": true },
                         { "playerName": "",      "playerType": "",      "occupied": false } ]
}
```

### `WebTableListing` (top-level)

```json
{
  "schemaVersion": "1.4",
  "tables":        [ <WebTable>, ... ]
}
```

### `WebSeat` (nested inside `WebTable.seats`)

```json
{
  "playerName": "alice",
  "playerType": "HUMAN",
  "occupied":   true
}
```

`playerType` is one of `HUMAN`, `COMPUTER_MONTE_CARLO`, `COMPUTER_MAD`, `COMPUTER_DRAFT_BOT`. Empty string when seat is unoccupied.

### `WebCreateTableRequest`

```json
{
  "gameType":          "Two Player Duel",   // required
  "deckType":          "Constructed - Standard", // required
  "winsNeeded":        1,                   // required
  "tableName":         "alice's table",     // optional, default "<username>'s table"
  "password":          "",                  // optional
  "skillLevel":        "CASUAL",            // optional, enum
  "matchTimeLimit":    "NONE",              // optional, enum
  "spectatorsAllowed": true,                // optional
  "rated":             false,               // optional
  "freeMulligans":     0,                   // optional
  "mulliganType":      "GAME_DEFAULT",      // optional, enum
  "attackOption":      "LEFT",              // optional, enum
  "range":             "ALL"                // optional, enum
}
```

### `WebJoinTableRequest`

```json
{
  "name":     "alice",                  // optional, defaults to authenticated username
  "password": "",                       // optional
  "skill":    1,                        // optional, default 1
  "deck": {
    "name":      "Mono-Red Burn",
    "author":    "alice",
    "cards":     [ { "cardName": "...", "setCode": "...", "cardNumber": "...", "amount": 4 }, ... ],
    "sideboard": [ ... ]
  }
}
```

### `WebAddAiRequest`

```json
{
  "playerType": "COMPUTER_MONTE_CARLO"  // required, enum from PlayerType
}
```

Server fills name + dummy deck. The created seat reflects the AI's name in the next `WebTableListing` poll.

---

## Error contract additions

| Status | Code | When |
|---|---|---|
| 400 | `BAD_REQUEST` | Missing required field, invalid enum value, malformed deck |
| 401 | `MISSING_TOKEN` / `INVALID_TOKEN` | (existing) |
| 403 | `NOT_TABLE_OWNER` | Non-owner tries to start the match |
| 404 | `NOT_FOUND` | (existing — also fires for unknown roomId/tableId) |
| 422 | `UPSTREAM_REJECTED` | Upstream returned false (illegal deck, table full, wrong password, etc.) |
| 500 | `UPSTREAM_ERROR` | Unexpected `MageException` |

Slice 6b refinement: split `UPSTREAM_REJECTED` into specific codes once the callback-recording handler can read the upstream rejection message.

---

## Validation plan

Slice 6 implementation must satisfy:

- Integration tests against an embedded server covering happy path + every error-contract row for every endpoint
- Snapshot tests for `WebTable`, `WebTableListing`, `WebRoomRef` JSON shapes
- A single end-to-end test that: logs in (anon), discovers main-room, creates a table, adds an AI opponent, joins itself with a deck, starts the match — and verifies `tableState` advances past `WAITING`
- The CHANGELOG bump and existing snapshot tests still pass with `schemaVersion = "1.3"` becoming `"1.4"` for previously-existing endpoints (constant pickup)

Build a representative test deck (ten basic Forests + ten basic Mountains + a few playable creatures) once and reuse across tests.

---

## References

- [ADR 0001 — Path C strategy](0001-path-c-strategy.md)
- [ADR 0002 — Tech stack](0002-tech-stack.md)
- [ADR 0004 — Auth and sessions](0004-auth-and-sessions.md)
- Upstream `GamesRoomManagerImpl` — `Mage.Server/src/main/java/mage/server/game/GamesRoomManagerImpl.java`
- Upstream `GamesRoomImpl` — `Mage.Server/src/main/java/mage/server/game/GamesRoomImpl.java`
- Upstream `TableManagerImpl` — `Mage.Server/src/main/java/mage/server/TableManagerImpl.java`
- Upstream `MatchOptions` — `Mage/src/main/java/mage/game/match/MatchOptions.java`
- Upstream `DeckCardLists` / `DeckCardInfo` — `Mage/src/main/java/mage/cards/decks/`
- Upstream `TableState` enum — `Mage/src/main/java/mage/constants/TableState.java`
- Upstream `PlayerType` enum — `Mage/src/main/java/mage/players/PlayerType.java`
- Upstream `TableView` — `Mage.Common/src/main/java/mage/view/TableView.java`
