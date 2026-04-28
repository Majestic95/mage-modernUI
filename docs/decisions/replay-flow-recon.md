# Replay flow — end-to-end recon

- **Status:** Implemented as **Option D** (game-log JSON download). See "Decision" below.
- **Date:** 2026-04-28
- **Builds on:** [PATH_C_PLAN.md Phase 5](../PATH_C_PLAN.md) (deliverable: "Game-over screen with replay link"), [ADR 0007](0007-game-stream-protocol.md) D5/D12 (REPLAY_* deferred), [ADR 0008 §1](0008-player-interactions.md) (catalog template), `docs/schema/CHANGELOG.md` (1.18).
- **Scope:** the three sub-features upstream loosely groups under "replay" — (a) saving a finished game so it can be loaded later, (b) loading + step-walking through a saved game, (c) live in-game step-back. Phase 5 only asks for (a) — a download link on the GameEndOverlay.

---

## Decision

**Option D — game-log JSON download.** Not Option A (the recommendation in §5.1 below). After critique review, the smallest *honest and shippable* fix turned out to be a working "Save game log" button on `GameEndOverlay` that exports the existing slice-18 `gameLog` array (`webclient/src/game/store.ts:178`) as a JSON transcript. Same effort as Option A's disabled stub; ships a real artifact instead of a placeholder. The button is labeled "Save game log" (not "Save replay") to set correct expectations — the export is the upstream `gameInform` text-message stream, not a step-through engine replay.

The Phase 5 deliverable is now framed as "Game-over screen with **game-log download**" in `docs/PATH_C_PLAN.md`. Full replay (binary engine state, step-walk playback) remains deferred to Phase 6 with a future ADR — the §1-§4 analysis below stands as the rationale for *why* upstream's `.game` mediation isn't viable.

The critique that drove this change is at the listed evidence below. Stronger evidence than the recon initially captured: a fourth piece of upstream self-classification (`ClientCallbackMethod.java:69` carries `// replay (unsupported)` as the enum-group comment for all four `REPLAY_*` callbacks); concrete code-level bugs (`ReplaySession.next(int)` advances `moves+1` states not `moves`; `ReplayManagerImpl.startReplay/stopReplay/...` NPE if called before a successful `replayGame`); zero automated test coverage anywhere in `Mage.Tests/`; and the last meaningful upstream change to `GameReplay.java` was 2018-06-02 (cosmetic) or 2017-01-09 (refactor) — 7+ years of bit-rot.

---

## Resolved

The three Phase-5-blocking open questions in §9 are resolved by source-level evidence; pinning them here so a future reader doesn't reopen them.

- **Q1 — Does upstream's replay system actually work end-to-end?** **No, with high confidence.** Triangulated from four independent author self-disclosures (`GameImpl.java:158` "replay code, not done"; `GameReplay.java:20` "outdated and not used. TODO: delete"; `ClientCallbackMethod.java:69` `// replay (unsupported)`; `config.xml:22, :52` `(not working correctly yet)`), 7+ years of `GameReplay.java` bit-rot, zero test coverage in `Mage.Tests/`, plus latent code-level bugs (off-by-one in `ReplaySession.next`, NPE-prone session manager). Treat as broken.
- **Q2 — Which `config.xml` does our embedded server actually read at boot?** `../Mage.Server/config/config.xml` by default (per `WebApiMain.java:33` `DEFAULT_CONFIG_PATH`); overridable via the `XMAGE_CONFIG_PATH` env var (`WebApiMain.java:58-61`). Default file has `saveGameActivated="false"` at line 56 — **no replay file production by default**.
- **Q3 — Format opacity?** Confirmed fully opaque. `GameController.saveGame` (`:983-1003`) writes Java `ObjectOutputStream` of `Game` then `GameStates`; `GameReplay.loadGame` (`:59-74`) requires `Main.classLoader` to deserialize. No third-party tool path; only another upstream-class-matched JVM can read it.

The remaining §9 questions (4 alternative log-based replay, 5 retention, 6 `replayAvailable` field) are Phase 6 design work, not Phase 5 blockers.

---

## TL;DR

**Save replay (5a): RED.** Upstream's replay system exists end-to-end (engine `saveState`, `GameController.saveGame`, `ReplayManager`, callback enums, `MageServer` interface methods) but is **gated behind `saveGameActivated="false"` in `config.xml` (default off)** with the upstream comment "(not working correctly yet)" (`Mage.Server/release/config/config.xml:22, :52`) and an explicit "Replay system, outdated and not used. TODO: delete" on the loader (`Mage.Server/.../game/GameReplay.java:20`). On our facade nothing is wired — no routes, no DTO, no mapper, no UI, and the embedded server inherits the same `saveGameActivated="false"` default. Even if we flip the flag, the upstream serialization format is **gzipped Java `ObjectOutputStream` of a `Game` object plus a `GameStates` list** — opaque to anyone but a JVM with the matching upstream classes. It is **not** a portable artifact a webclient can render.

**Load + play replay (5b): RED + L.** Out of Phase 5 scope; called out as deferred in [ADR 0007 D5](0007-game-stream-protocol.md) and [PATH_C_PLAN.md Phase 6](../PATH_C_PLAN.md). Re-rendering an upstream replay through our wire format means subscribing the WebSocket fanout to `REPLAY_INIT/REPLAY_UPDATE/REPLAY_DONE` callbacks, mapping the (untested) replay-side `GameView` into `WebGameView`, and inventing inbound `replayNext/replayPrevious/replaySkipForward` action verbs. Significant work; the engine path is decayed enough that the design pass should also evaluate "ship our own log-based replay" as an alternative.

**Live in-game step-back (5c): YELLOW + M.** Genuinely partly wired: `PlayerAction.ROLLBACK_TURNS` is in our allow-list (`Mage.Server.WebApi/.../PlayerActionAllowList.java:51`) and the engine path runs through the same `saveState` bookmark mechanism (`GameImpl.java:818-823`) regardless of the save-game flag. UI for the consent dialog (`USER_REQUEST_DIALOG`) is the missing piece. Out of scope here; flagged because "save replay" and "rewind" share the `saveState` substrate and a Phase 6 sweep should address them together.

**Headline gap for the deliverable:** there is **no upstream-supported, portable replay file format** we can hot-mirror. The Phase 5 line item "Game-over screen with replay link" was written assuming saved replays exist as a fait accompli; they don't. The smallest fix that is honest with the user is to **stub the button** (disabled-with-tooltip "Replays land in Phase 6") and defer the real work to the Phase 6 parity sweep with a proper design ADR.

**Smallest-fix slice estimate:** **S** for a disabled stub button on the GameEndOverlay. **L** for any real save+download path (engine flag flip + format design + facade route + webclient download UI + storage lifecycle + auth). The Phase 5 deliverable can close with the **S** stub and a documented hand-off to Phase 6, **or** the line item can be re-classed as "deferred to Phase 6" with this ADR as justification.

---

## 1. Engine path — does upstream have replay support?

Three layers, top-down.

### 1.1 Game-level state capture — `GameImpl.saveState`

`Mage/src/main/java/mage/game/GameImpl.java:158` declares `private boolean saveGame = false; // replay code, not done` (the upstream author's own annotation). The flag is set externally via `setSaveGame` (`:3941`) and copied between `Game` instances during simulation forks (`:241`).

`saveState(boolean bookmark)` at `:817-824`:

```
public void saveState(boolean bookmark) {
    if (!simulation && gameStates != null) {
        if (bookmark || saveGame) {
            gameStates.save(state);
        }
    }
}
```

`GameStates` (`Mage/src/main/java/mage/game/GameStates.java:13-40`) is a plain `Serializable` `ArrayList<GameState>` with `save`, `rollback(index)`, `remove(index)`, `get(index)`, and `clear`. Two write paths feed it: `saveGame=true` (full replay) and `bookmark=true` (every priority pass; used by `ROLLBACK_TURNS` regardless of the save flag).

So the in-memory state-history list **always** captures bookmarks for rollback, and **additionally** captures full per-step states only when `saveGame` is on.

### 1.2 Server-level persistence — `GameController.saveGame`

`Mage.Server/src/main/java/mage/server/game/GameController.java:983-1003`:

```
public boolean saveGame() {
    OutputStream file = null;
    ObjectOutput output = null;
    OutputStream buffer = null;
    try {
        file = new FileOutputStream("saved/" + game.getId().toString() + ".game");
        buffer = new BufferedOutputStream(file);
        output = new ObjectOutputStream(new GZIPOutputStream(buffer));
        output.writeObject(game);
        output.writeObject(game.getGameStates());
        ...
    }
}
```

**Format:** gzipped Java `ObjectOutputStream` of two objects — the live `Game` instance, then its `GameStates`. **Not JSON, not a custom binary format — Java native serialization.** Filename is `saved/<gameId>.game` relative to the server cwd.

Triggered from `TableController.endGameAndStartNextGame` at `:819-823`:

```
if (managerFactory.configSettings().isSaveGameActivated() && !game.isSimulation()) {
    if (managerFactory.gameManager().saveGame(game.getId())) {
        match.setReplayAvailable(true);
    }
}
```

So a replay file is written **only if** `saveGameActivated="true"` in `config.xml`. Default is `"false"` (`Mage.Server/release/config/config.xml:52`, `Mage.Server/config/config.xml:56`) with the operator-facing comment `saveGameActivated   - allow game save and replay options (not working correctly yet)` at `:22` / `:25` of the same files.

`MatchImpl.cleanUpOnMatchEnd(boolean isSaveGameActivated, boolean isTournament)` at `Mage/src/main/java/mage/game/match/MatchImpl.java:462-469` clears the `getGames()` collection only when `!isSaveGameActivated && !isTournament`, so when the flag is on the in-memory game graph also persists for the lifetime of the `Match`. Tournament matches keep their games regardless.

`Main.deleteSavedGames()` at `Mage.Server/src/main/java/mage/server/Main.java:559-572` blasts `saved/*.game` on every upstream-server startup, invoked from `Main.main()` at `:204` before the game type registry initializes. **No retention policy** beyond "until the server restarts." Important caveat for our embed: this method is package-private and called only from `Main.main()` — `EmbeddedServer.boot()` does not invoke it (verified via `Grep deleteSavedGames` over `Mage.Server.WebApi/src/`, zero matches). Our facade therefore inherits a *different* lifecycle: `.game` files (if we ever produce any) survive across restarts. See §6 for the implication.

### 1.3 Replay viewer — `GameReplay` + `ReplaySession` + `ReplayManager`

`Mage.Server/src/main/java/mage/server/game/GameReplay.java:19-23` opens with `/** Replay system, outdated and not used. TODO: delete */` — the upstream author's own assessment. `loadGame(UUID)` at `:59-74` reverses the save: read `saved/<gameId>.game`, gunzip, deserialize a `Game`, deserialize a `GameStates`, attach.

`ReplaySession` (`Mage.Server/.../game/ReplaySession.java`) wraps a `GameReplay` and pushes `ClientCallback`s with method `REPLAY_INIT`, `REPLAY_UPDATE`, `REPLAY_DONE` carrying upstream `GameView` payloads.

`ReplayManager` (`Mage.Server/src/main/java/mage/server/managers/ReplayManager.java`) is a 7-method interface — `replayGame`, `startReplay`, `stopReplay`, `nextPlay`, `previousPlay`, `skipForward`, `endReplay`. `ReplayManagerImpl` (`Mage.Server/.../game/ReplayManagerImpl.java`) keys sessions by `gameId.toString() + userId.toString()` — a string concat, not a tuple — and stores them in a `ConcurrentHashMap`. No in-memory eviction beyond explicit `endReplay`.

`MainManagerFactory` (`Mage.Server/.../MainManagerFactory.java:54, :118-119`) instantiates and exposes the manager — the embedded server inherits this for free since [ADR 0003](0003-embedding-feasibility.md) routes through `MainManagerFactory` (per `EmbeddedServer.java:87`).

### 1.4 Methods exposed by `MageServer`

`Mage.Common/src/main/java/mage/interfaces/MageServer.java:152-162`:

```
void replayInit(UUID gameId, String sessionId) throws MageException;
void replayStart(UUID gameId, String sessionId) throws MageException;
void replayStop(UUID gameId, String sessionId) throws MageException;
void replayNext(UUID gameId, String sessionId) throws MageException;
void replayPrevious(UUID gameId, String sessionId) throws MageException;
void replaySkipForward(UUID gameId, String sessionId, int moves) throws MageException;
```

Implemented in `MageServerImpl.java:897-967` — six wrapper methods, each `execute(name, sessionId, () -> managerFactory.replayManager().<method>(gameId, userId))`. (`MageServerImpl` is the in-process bean we've already embedded; these methods are callable today from our facade — they are not blocked by the Java-RPC boundary.)

The Swing client's `Replays` interface at `Mage.Common/src/main/java/mage/remote/interfaces/Replays.java:9-22` mirrors the same six methods, and `SessionImpl` (`Mage.Common/src/main/java/mage/remote/SessionImpl.java`) implements them by RPC. The Swing client invokes `replayGame(UUID)` from `TablesPanel.java:483, :504, :2000` (for finished match rows in the lobby — see `MatchesTableModel.java:88` which checks `match.isReplayAvailable()` before exposing a "Replay" cell value). On the callback side, `CallbackClientImpl.java:146-147` handles `REPLAY_GAME` by routing to `MageFrame.replayGame(gameId)` → `GamePane.replayGame` → `GamePanel.replayGame(gameId)` (`Mage.Client/.../game/GamePanel.java:909`) which calls `SessionHandler.startReplay(gameId)` to drive the playback.

### 1.5 Lifecycle summary

| Concern | Upstream reality |
|---|---|
| When does the engine save? | At every `saveState(bookmark)` call when `saveGame=true`; the file write happens at game end via `TableController.endGameAndStartNextGame:820`. |
| Trigger flag | `config.xml@saveGameActivated` (default `false`). `GameController` reads it once at construction (`GameController.java:95`). |
| Format | `ObjectOutputStream` of `Game` then `GameStates`, gzipped. Java-native serialization — **not** portable. |
| File location | `saved/<gameId>.game` relative to server cwd. |
| Granularity | Per-game, **not** per-match. A best-of-3 produces up to three files. |
| Retention | Wiped on every server start (`Main.deleteSavedGames`). No cap, no LRU during a server's lifetime. |
| Per-table accessor | `Match.isReplayAvailable() / setReplayAvailable(boolean)` — **already on the wire** to the Swing client via `MatchView.replayAvailable`. |
| Engine author's own note | "outdated and not used. TODO: delete" on `GameReplay.java:20`; `// replay (unsupported)` enum-group comment on `ClientCallbackMethod.java:69`; "(not working correctly yet)" in `config.xml:22,:52`; `// replay code, not done` on `GameImpl.java:158`. Four independent author self-disclosures. |

**Uncertain:** whether anyone has run the upstream replay system end-to-end successfully in the last 2-3 years. The author tags suggest it bit-rotted. A spike would be: flip the flag, play a 1v1 vs. AI in the Swing client, click "Replay" on the finished match — observe whether it works at all and whether the replayed `GameView`s render coherently. Until that spike runs, treat the entire upstream replay path as **partially-broken-by-author-admission**.

---

## 2. WebApi facade — outbound

### 2.1 Routes today

`Mage.Server.WebApi/src/main/java/mage/webapi/server/WebApiServer.java:141-237` — exhaustive list of the routes our facade exposes:

```
GET    /api/version
GET    /api/health
POST   /api/session
POST   /api/session/admin
GET    /api/session/me
DELETE /api/session
GET    /api/server/state
GET    /api/cards
GET    /api/cards/printings
GET    /api/server/main-room
GET    /api/rooms/{roomId}/tables
POST   /api/rooms/{roomId}/tables
POST   /api/rooms/{roomId}/tables/{tableId}/join
POST   /api/rooms/{roomId}/tables/{tableId}/ai
POST   /api/rooms/{roomId}/tables/{tableId}/start
DELETE /api/rooms/{roomId}/tables/{tableId}/seat
DELETE /api/rooms/{roomId}/tables/{tableId}
POST   /api/tables/{tableId}/deck
WS     /api/games/{gameId}/stream
WS     /api/rooms/{roomId}/stream
```

**No replay routes.** Confirmed via `Grep` for `replay|Replay` across `Mage.Server.WebApi/src/`: only matches are (a) `?since=<n>` reconnect-buffer prose in `GameStreamHandler.java` (the WS frame buffer, a different concept than game replay), (b) `WebStreamFrame` Javadoc noting "captured stream can be replayed against any" client (referring to the JSON transcript, not the upstream `.game` file). Test side likewise — `GameStreamHandlerTest.java` references "replay" only in the reconnect-buffer test names.

### 2.2 Mappers and DTOs

`Mage.Server.WebApi/src/main/java/mage/webapi/dto/` and `mapper/` — no `WebReplayView`, no `replayInit`/`replayUpdate`/`replayDone` handling in `WebSocketCallbackHandler`. The four `REPLAY_*` enum values from `ClientCallbackMethod.java:70-73` are not even in the "deferred but mapped" group; per [ADR 0007 D5](0007-game-stream-protocol.md) they are explicitly in the **dropped-with-debug-log** group ("All `REPLAY_*` — replay viewer is Phase 7+").

### 2.3 Embedded engine surface

The replay manager **is** reachable through the embedded factory: `EmbeddedServer.java:87` constructs a `MainManagerFactory` and `MainManagerFactory.java:54, :118` instantiates and exposes `ReplayManagerImpl`. `MageServerImpl.replayInit/Start/Stop/Next/Previous/SkipForward` are callable in-process. We already embed `MageServerImpl` (per [ADR 0003](0003-embedding-feasibility.md)). **Nothing on our facade calls them.**

`isSaveGameActivated` is **not** referenced anywhere in `Mage.Server.WebApi`. Whatever `config.xml` the embedded server reads at boot is the value we get; the default `release/config/config.xml` has `saveGameActivated="false"` (`:52`), so by default our embedded server **does not write replay files at all**.

**Uncertain:** which `config.xml` the embedded server actually reads at boot. `EmbeddedServer.java:87` constructs `new MainManagerFactory(config)` — needs a follow-up read to confirm the resolution path. Resolution: open `EmbeddedServer.java` and trace the `config` argument origin.

### 2.4 Comprehensive replay surface on our facade today

| Layer | Status |
|---|---|
| HTTP route to fetch a saved replay file | **Absent** |
| HTTP route to list available replays | **Absent** |
| WS frame for `replayInit` / `replayUpdate` / `replayDone` | **Absent** (deferred per [ADR 0007 D5](0007-game-stream-protocol.md)) |
| Inbound action for `replayNext` / `replayPrevious` / `replaySkipForward` | **Absent** |
| `replayAvailable` flag on any DTO (e.g. `WebMatchView`) | **Absent** (we don't even expose `WebMatchView`/match history yet — finished matches aren't part of `GET /api/rooms/{roomId}/tables` today; it lists active tables only) |
| Engine flag `saveGameActivated` toggled on by our embed | **No** — inherits `config.xml` default `false` |

So the facade replay surface today is the empty set.

---

## 3. Webclient

### 3.1 Search results

`Grep` for `replay|Replay` across `webclient/src/`:

- `webclient/src/game/stream.ts:13, :183, :185` — `?since=<lastMessageId>` reconnect buffer prose (different concept).
- `webclient/src/game/store.test.ts` and `webclient/src/pages/SideboardModal.test.tsx` — test-name strings; no replay logic.

**No replay UI, no download link, no "Save Replay" button anywhere in the webclient.**

### 3.2 GameEndOverlay shape today

`webclient/src/pages/Game.tsx:165-238` — two states:

```
function GameEndOverlay({ onLeave }: { onLeave: () => void }) {
  const gameEnd = useGameStore((s) => s.gameEnd);          // WebGameEndView | null
  const gameOverPending = useGameStore((s) => s.gameOverPending);
  const lastWrapped = useGameStore((s) => s.lastWrapped);

  if (gameEnd) {
    return ( /* match-end modal: title, matchInfo, gameInfo, score, additionalInfo, "Back to lobby" */ );
  }
  if (gameOverPending) {
    return ( /* "Game over — Waiting for the next game…" banner */ );
  }
  return null;
}
```

`gameEnd` is a `WebGameEndView` (`Mage.Server.WebApi/src/main/java/mage/webapi/dto/stream/WebGameEndView.java`) with seven fields: `gameInfo`, `matchInfo`, `additionalInfo`, `won`, `wins`, `winsNeeded`, `players`. **No `gameId`, no `tableId`, no `replayAvailable`.**

The component's parent `Game` (`Game.tsx:47`) has `gameId: string` as a prop and threads it into the `GameStream` constructor (`Game.tsx:59`). To wire a replay button we'd either prop-drill `gameId` into `GameEndOverlay` or read it from a store slice. The store carries `lastMessageId` and stream connection state but not the `gameId` (the `GameStream` instance owns it). `Lobby.tsx` opens the game by passing `gameId` from the table-start response — so `gameId` is ambient at the parent level.

### 3.3 Where the link slots in

The natural placement is the modal-state branch (`Game.tsx:170-213`), between the score line at `:193-198` and the "Back to lobby" button at `:202-210`. The button row at `:202` already has `flex justify-center`; adding a sibling button to the left of "Back to lobby" is one JSX change.

---

## 4. Three-tier classification

### 4a. Save replay (download a file from a finished game) — **RED**

Why RED and not YELLOW:

1. **Engine doesn't auto-save by default.** `saveGameActivated="false"` is shipped in both `release/config/config.xml:52` and `config/config.xml:56` with the operator-warning comment "(not working correctly yet)". Our embedded server inherits this default. No replay file exists to serve until we deliberately flip the flag.
2. **The format is hostile to a webclient.** Java `ObjectOutputStream` of upstream classes is not a portable artifact — re-rendering it requires another JVM running the same upstream version. Serving the raw bytes from `saved/<gameId>.game` is technically possible, but the only consumer is **another Xmage Java server**, not the React webclient. That fails the spirit of "Game-over screen with replay link" (the user expectation is "I click and I get something I can re-watch").
3. **Upstream's own author marked the loader "outdated and not used. TODO: delete"** (`Mage.Server/.../game/GameReplay.java:20`). Wiring it up commits us to maintaining a bit-rotted dependency.

To upgrade this from RED to YELLOW we'd need to (a) flip the flag in our embedded `config.xml`, (b) confirm save/load actually works against current upstream (uncertain — see §1.5), (c) decide whether to mediate the `.game` file through a "load + render to JSON transcript" facade or invent our own log-based replay, (d) design retention and auth.

To upgrade YELLOW → GREEN we'd build the chosen mediation.

### 4b. Load + play replay (file → game-window step-through) — **RED + L**

Out of Phase 5 scope. Out of Phase 6 scope per [PATH_C_PLAN.md Phase 6](../PATH_C_PLAN.md) line "Replays — read replay format, render game state over time" and [ADR 0007 D5](0007-game-stream-protocol.md) "All `REPLAY_*` — replay viewer is Phase 7+". The work breakdown: subscribe `WebSocketCallbackHandler` to `REPLAY_INIT/UPDATE/DONE`, map the replay-side `GameView` to `WebGameView` (likely the same mapper, but the replay-side `GameView` is constructed with two nulls — `new GameView(state, game, null, null)` per `ReplaySession.java:30, :66` — so it lacks the per-player viewpoint). New inbound DTOs (`replayNext`, `replayPrevious`, `replaySkipForward`). New `/api/replays/{gameId}/stream` WS route or piggy-back on `/api/games/{gameId}/stream` with a mode flag. Then a webclient "Replays" tab to list and pick. **L by any honest estimate.**

### 4c. Live in-game step-back (rewind during a game) — **YELLOW + M**

`PlayerAction.ROLLBACK_TURNS` is in our allow-list at `Mage.Server.WebApi/src/main/java/mage/webapi/ws/PlayerActionAllowList.java:51`. The engine path is independent of `saveGameActivated` — `GameImpl.saveState(:818-823)` records a bookmark when either `bookmark || saveGame`, and `GameStates.rollback(int)` (`GameStates.java:31-40`) is the engine entry point.

Two missing pieces: (i) opponent-consent dialog handling — `ROLLBACK_TURNS` triggers an upstream `USER_REQUEST_DIALOG` callback (per [ADR 0008 §1](0008-player-interactions.md) entry 1.4-ish neighborhood; not yet in the §1 catalog as a fully-cataloged entry) which our store wraps but doesn't surface as a confirmation modal, (ii) a "rewind 1 / 2 / 3 turns" UI affordance that emits `playerAction { action: "ROLLBACK_TURNS", data: { turns: <n> } }` per [ADR 0007 D6 Pair A](0007-game-stream-protocol.md). **M.**

Overlap with 4a: both depend on `saveState`. The *full-replay* path needs `saveGame=true` plus a portable format; the *rollback* path only needs the bookmark fork which is already on. So 4c can ship today without touching 4a.

---

## 5. Smallest-fix proposal

Given §4a is RED and the Phase 5 deliverable says "replay link" — two honest options. Pick one in the design pass; both close the Phase 5 line item.

### 5.1 Option A — disabled stub button (recommended for closing Phase 5)

A visible "Save replay" button on `GameEndOverlay`, `disabled` with a `title` tooltip "Replay export lands in Phase 6". Closes the Phase 5 line item ("game-over screen *with* replay link" — the link exists, just disabled). Surfaces the future feature to the user. Zero schema impact, zero server work.

**Sketch:**

```tsx
// webclient/src/pages/Game.tsx, between :198 and :202
<div className="flex justify-center gap-3 pt-2">
  <button
    type="button"
    disabled
    title="Replay export lands in Phase 6"
    className="px-5 py-2 rounded bg-zinc-800 text-zinc-500 font-medium cursor-not-allowed"
  >
    Save replay
  </button>
  <button
    type="button"
    onClick={onLeave}
    className="px-5 py-2 rounded bg-fuchsia-600 hover:bg-fuchsia-500 text-white font-medium"
  >
    Back to lobby
  </button>
</div>
```

**Slice size: S** (< 30 min: edit + snapshot test update + commit).

### 5.2 Option B — punt the line item to Phase 6

Re-class "Game-over screen with replay link" as deferred. Update [PATH_C_PLAN.md Phase 5](../PATH_C_PLAN.md) checklist to strike-through the line and add a Phase 6 line "Replay save+download". Update [ADR 0007 D12](0007-game-stream-protocol.md) deferred list to explicitly note "save replay" alongside "replay viewer". This recon doc is the justification.

**Slice size: S** (doc updates only).

### 5.3 Option C — real save+download (for Phase 6 scoping)

If the design pass argues we should ship something real, the smallest viable shape is:

1. **Engine flag flip.** Embed-side `config.xml` sets `saveGameActivated="true"`. (Or, since the embedded factory takes a `Config`, override via `EmbeddedServer.java` so we don't fork the upstream config XML.)
2. **Server route:**

   ```
   GET /api/games/{gameId}/replay
   ```

   Streams the file at `saved/<gameId>.game` with `Content-Type: application/octet-stream`, `Content-Disposition: attachment; filename="xmage-<gameId>.game"`. 404 if absent. 403 if the requester isn't a participant of the originating match (see §7).
3. **Schema impact:** **none** — UI hits the URL on click and handles 404 with a graceful "Replay file not available" toast.
4. **UI:** the same JSX as 5.1 but with a real `<a href={`/api/games/${gameId}/replay?token=${token}`} download>` in place of the disabled button. Token in query param matches the WS-handshake convention from [ADR 0007 D2](0007-game-stream-protocol.md) (browsers can't set headers on plain anchor downloads).

**But:** the `.game` file is unrenderable by the webclient. Option C ships "you can save a binary blob that works only with another Xmage Java server" — useful for power users, mostly invisible to the modal user. The UX promise of a "replay link" is not delivered. That's why 5.1 / 5.2 are stronger choices for closing Phase 5.

**Slice size: L.** Not because the route is hard (S on its own) but because the thinking around format / mediation / lifecycle / test surface compounds.

---

## 6. Storage / lifecycle

| Concern | Upstream | Our facade |
|---|---|---|
| Where files live | `saved/<gameId>.game` relative to the server cwd (`GameController.java:988`) | Inherited as-is by the embedded server; no mediation today |
| Per what unit | Per-game (one file per game-of-the-match) | Same |
| Match-level aggregation | `MatchView.replayAvailable` flag set after the **first** game-save succeeds (`TableController.java:821`); a best-of-3 gives up to three files all keyed by their own gameId | Same — but we don't expose `MatchView` to the webclient yet |
| Retention | Wiped on every server start (`Main.deleteSavedGames`, `Main.java:204, :559-572`); no in-flight cap | **Different — our facade does NOT run `deleteSavedGames`.** `Main.deleteSavedGames` is package-private and invoked only from `Main.main()` at `:204`; our `EmbeddedServer.boot()` (per `EmbeddedServer.java:71-96`) runs an abbreviated bootstrap that never calls it. `Grep deleteSavedGames` over `Mage.Server.WebApi` returns zero matches. Net effect: any `.game` files we produce **survive across restarts**, with no upstream wipe-on-boot safety net. If we ever flip `saveGameActivated="true"`, we own retention design ourselves. |
| Re-download window | While the server stays up. The `saved/` directory holds files for the lifetime of the JVM | Same |
| Hot-mirror vs. stream-from-upstream | N/A — single process | We can stream directly from `saved/<gameId>.game` since we're in-process |

For the modal use case ("user just finished a game, wants to keep it") the retention is fine — the file exists for as long as the user is in the same session. Re-download after closing the modal works as long as we surface the gameId somewhere reachable (history page, "Recent games" link) — neither exists today.

**Open question:** Do we want a `GET /api/replays` listing endpoint? Out of scope for the Phase 5 deliverable; would be a Phase 6 addition with its own DTO.

---

## 7. Auth

Upstream's `MageServerImpl.replayInit/Start/...` (`MageServerImpl.java:897-967`) takes a `sessionId` and resolves to a userId via `sessionManager().getSession(sessionId)`. **No participant-only check.** Any authenticated user can call `replayGame(gameId)` for any gameId — there is no upstream ACL on replays. The Swing client gates access at the **lobby UI** level (only finished matches the user could see show a Replay button via `MatchesTableModel.java:88`), not at the server.

For our facade:

- **Reuse `BearerAuthMiddleware`** (already on every `/api/...` route per `WebApiServer.java:109`) for any GET-replay route. Token-in-query-string for the `<a download>` flow per [ADR 0004 D1](0004-auth-and-sessions.md) precedent (cookies rejected; query param for browser download links is the same trade-off as the WS handshake).
- **Add a participant check** that upstream lacks — restrict to users whose userId is in `userPlayerMap` of the originating `TableController`, or the `Match.players` list. Not enforced upstream, so we can't piggy-back on an existing predicate; needs a small server helper. Punt to the Option C design ADR.
- **Spectator access** is a separate question. Upstream's policy is "anyone with the gameId" (since the Swing client is the only gatekeeper). For a public host we'd want stricter; for self-hosted playtests we can mirror upstream and revisit.

---

## 8. Schema impact

**None for any of the three options:**

- Option A (disabled stub): no wire change.
- Option B (defer): doc-only.
- Option C (real save+download): the route returns binary, not JSON, so it doesn't carry a `schemaVersion`. The UI handles 404 instead of reading a `replayAvailable` boolean off `WebGameEndView`. **Optional add-on:** if we want the button enabled/disabled state to be authoritative rather than discovered-on-click, add `replayAvailable: boolean` to `WebGameEndView` and bump 1.18 → 1.19 minor (additive). Defaults to `false` so older fixtures parse cleanly. Not required for a working button.

---

## 9. Open questions

1. ~~**Does upstream's replay system actually work end-to-end on current master?**~~ **Resolved — see "Resolved" section above. NO, with high confidence (4 self-disclosures, 7+ years of `GameReplay.java` bit-rot, zero test coverage, code-level bugs in `ReplaySession.next` off-by-one and NPE-prone `ReplayManagerImpl`).** Original note retained for context: the author's "outdated and not used" note (`GameReplay.java:20`) and the "(not working correctly yet)" config comment (`config.xml:22, :52`) suggested no.
2. **Which `config.xml` does our embedded server actually read at boot?** `EmbeddedServer.java:87` constructs `new MainManagerFactory(config)` from a `config` argument. **Resolution:** read `EmbeddedServer.java` end-to-end and the call site that constructs it (`WebApiMain`). One file, ~5 minutes.
3. **Should we keep the Phase 5 "Game-over screen with replay link" deliverable as written, or rewrite it given the upstream reality?** This recon argues "rewrite" — the line item was likely written assuming saved replays exist as a fait accompli. **Resolution:** decision in the post-recon design pass; this doc is input.
4. **Is there appetite to build our own log-based replay format** (a JSON transcript of WS frames, replayed by re-feeding them into the store) **as an alternative to mediating the upstream `.game` file?** A frame log would be portable, renderable, naturally bounded by the wire vocabulary we already maintain, and immune to upstream's "outdated" rot. Cost: server-side recording infrastructure during the live game, schema changes to flag a "this is a replay" stream. **Resolution:** Phase 6 design ADR.
5. **Storage retention.** Upstream wipes on restart; for our facade do we want longer retention (per-user replay history, auto-evict at N MB / N games)? **Resolution:** Phase 6 design ADR.
6. **Do we need `replayAvailable` on `WebGameEndView` for the disabled-stub option?** Probably not — if we go with Option A the button is unconditionally disabled. If we ever go with Option C the button can attempt the GET and fall back to a toast. **Resolution:** decide alongside the option choice.

---

## 10. Cross-references

- [PATH_C_PLAN.md Phase 5 line "Game-over screen with replay link"](../PATH_C_PLAN.md) — this doc closes that line one of three ways.
- [PATH_C_PLAN.md Phase 6 line "Replays — read replay format, render game state over time"](../PATH_C_PLAN.md) — where the real work lives.
- [ADR 0007 D5](0007-game-stream-protocol.md) — `REPLAY_*` callbacks deferred (dropped with debug log).
- [ADR 0007 D12](0007-game-stream-protocol.md) — "Replay viewer — schemas marked deferred in D5, lands Phase 7+".
- [ADR 0008 §1](0008-player-interactions.md) — catalog template (this doc mirrors the structure).
- `docs/schema/CHANGELOG.md` — current 1.18; no bump needed for Option A or B.

## 11. Source-of-truth file:line index

Engine:

- `Mage/src/main/java/mage/game/GameImpl.java:158` — `saveGame` flag declaration with author note "replay code, not done"
- `Mage/src/main/java/mage/game/GameImpl.java:817-824` — `saveState`
- `Mage/src/main/java/mage/game/GameImpl.java:3941-3942` — `setSaveGame`
- `Mage/src/main/java/mage/game/GameStates.java:13-60` — full file
- `Mage/src/main/java/mage/game/match/MatchImpl.java:45-50, :452-469` — `replayAvailable` field + cleanup
- `Mage/src/main/java/mage/game/match/Match.java:90-92` — interface accessors

Server:

- `Mage.Server/src/main/java/mage/server/Main.java:204, :259, :559-572` — startup wipe + log
- `Mage.Server/src/main/java/mage/server/TableController.java:819-823` — gate + write trigger
- `Mage.Server/src/main/java/mage/server/TableController.java:913` — `cleanUpOnMatchEnd` flag forwarding
- `Mage.Server/src/main/java/mage/server/game/GameController.java:95` — wires `setSaveGame` from config
- `Mage.Server/src/main/java/mage/server/game/GameController.java:983-1003` — `saveGame()` write
- `Mage.Server/src/main/java/mage/server/game/GameReplay.java:1-75` — full file ("outdated and not used. TODO: delete" annotation at `:20`)
- `Mage.Server/src/main/java/mage/server/game/ReplaySession.java:1-72` — full file
- `Mage.Server/src/main/java/mage/server/game/ReplayManagerImpl.java:1-58` — full file
- `Mage.Server/src/main/java/mage/server/managers/ReplayManager.java:1-19` — full interface
- `Mage.Server/src/main/java/mage/server/MageServerImpl.java:897-967` — six replay RPC methods
- `Mage.Server/src/main/java/mage/server/User.java:356-358` — `ccReplayGame`
- `Mage.Server/src/main/java/mage/server/MainManagerFactory.java:54, :118-119` — wiring
- `Mage.Server/release/config/config.xml:22, :52` — `saveGameActivated="false"` + author comment
- `Mage.Server/config/config.xml:25, :56` — same in dev config

Common / view:

- `Mage.Common/src/main/java/mage/interfaces/MageServer.java:152-162` — replay method declarations
- `Mage.Common/src/main/java/mage/interfaces/callback/ClientCallbackMethod.java:69-73` — `// replay (unsupported)` enum group
- `Mage.Common/src/main/java/mage/remote/interfaces/Replays.java:1-22` — full RPC interface
- `Mage.Common/src/main/java/mage/view/MatchView.java:33, :94, :132, :176-178` — `replayAvailable`

Swing client (reference):

- `Mage.Client/src/main/java/mage/client/remote/CallbackClientImpl.java:146-147, :221-237` — REPLAY_* dispatch
- `Mage.Client/src/main/java/mage/client/MageFrame.java:838-842` — frame entry
- `Mage.Client/src/main/java/mage/client/game/GamePane.java:62-67` — pane entry
- `Mage.Client/src/main/java/mage/client/game/GamePanel.java:909-929` — panel entry
- `Mage.Client/src/main/java/mage/client/SessionHandler.java:349-350` — session bridge
- `Mage.Client/src/main/java/mage/client/table/TablesPanel.java:481-484, :500-510, :2000` — Replay menu actions
- `Mage.Client/src/main/java/mage/client/table/MatchesTableModel.java:88` — `isReplayAvailable` UI gate

Facade (our code):

- `Mage.Server.WebApi/src/main/java/mage/webapi/server/WebApiServer.java:141-237` — every route (no replay)
- `Mage.Server.WebApi/src/main/java/mage/webapi/ws/PlayerActionAllowList.java:51` — `ROLLBACK_TURNS` allowed (different feature, see §4c)
- `Mage.Server.WebApi/src/main/java/mage/webapi/dto/stream/WebGameEndView.java:1-40` — current GameEnd DTO (no replay fields)
- `Mage.Server.WebApi/src/main/java/mage/webapi/embed/EmbeddedServer.java:87` — `MainManagerFactory` instantiation
- `Mage.Server.WebApi/src/main/java/mage/webapi/SchemaVersion.java:17` — `CURRENT = "1.18"`

Webclient:

- `webclient/src/pages/Game.tsx:47-90` — Game component, owns gameId
- `webclient/src/pages/Game.tsx:141, :165-238` — GameEndOverlay
- `webclient/src/game/store.ts:133, :238, :393-398` — `gameEnd` store slice
