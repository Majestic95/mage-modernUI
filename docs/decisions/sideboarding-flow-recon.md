# Sideboarding flow — end-to-end recon

- **Status:** Recon + post-critique fixes. Modal-key bug and static-timer gap addressed in `SideboardModal.tsx`; the remaining gaps below are scoped for follow-on slices.
- **Date:** 2026-04-28
- **Builds on:** [ADR 0007](0007-game-stream-protocol.md) (stream protocol), [ADR 0008 §1.10](0008-player-interactions.md) (catalog entry, marked "Covered")
- **Schema reference:** [CHANGELOG 1.14](../schema/CHANGELOG.md#114--2026-04-26--sideboard-wire-format) (slice 13)

---

## TL;DR

**YELLOW → GREEN-ish on the highest-severity gap.** The wire format, server endpoint, mapper, store handler, and modal UI are all wired and snapshot-tested. The post-game-1 path surfaces a working SideboardModal that POSTs to the right endpoint and clears on 204.

**Gaps that were real and are now fixed (this slice):**
- **Modal key bug.** `SideboardModal.tsx` keyed on `tableId + ':' + time`. The engine's `futureTimeout.getDelay(SECONDS)` decreases on every reconnect-replay of the SIDEBOARD frame, so the differing `time` value forced a fresh component instance and discarded any in-progress main↔side moves. Fixed by keying on `tableId` only — see §10.1.
- **Static timer.** The header rendered `${pending.time}s remaining` with no countdown and no urgency cue. The user could stare at "179s remaining" for nearly three minutes and get auto-completed without warning. Fixed by deriving an absolute deadline from the wire `time` and ticking via `setInterval`, with red urgency styling under 30 s and a hint about engine auto-submission — see §10.2.

**Gaps still open (lower severity):** `Game.tsx` cleanup `reset()` can clear `pendingSideboard` mid-edit on the autoSideboard auto-complete path (G2, narrow scope per §3.1); reconnect mid-sideboard loses local state if the wire frame's authoritative deck differs from the user's edits (G3); 422 rejection reason isn't surfaced (G4); reconnect may not re-fire (G5); SHOW_USERMESSAGE unmapped (G6); CONSTRUCT out of band (G7).

**Note on the engine timer.** The server schedules a 180 s hard auto-completion (`Match.SIDEBOARD_TIME = 180`, `Match.java:22`); the wire `time` field is sampled from `futureTimeout.getDelay(SECONDS)` so first-dispatch carries `time ≈ 179`. The illustrative `"time": 600` in `docs/schema/CHANGELOG.md` §1.14 is fictional — see §10.3.

---

## 1. Engine path

The single sideboard prompt path. (`Tournament.construct` and `User.ccConstruct` are explicitly out of 1v1 scope per ADR 0008 §1.11 — not covered here.)

### 1.1 Trigger — end of game 1 → match.sideboard()

`Mage.Server/src/main/java/mage/server/TableController.java:811-844` — `endGameAndStartNextGame()`. After `match.endGame()` and the `gameOver` callbacks fire, line 829 checks `match.getGame().getGameType().isSideboardingAllowed()` (`MatchType.java:70`) and if true, calls the private `sideboard()` at line 846.

```
TableController.java:846-869
  private void sideboard() {
      table.sideboard();                     // table state → SIDEBOARDING
      setupTimeout(Match.SIDEBOARD_TIME);    // 180 s hard timeout
      ...
      match.sideboard();                     // blocks until done; see 1.2
      cancelTimeout();
      ...
  }
```

`Match.SIDEBOARD_TIME = 180` is defined at `Mage/src/main/java/mage/game/match/Match.java:22` and is a plain interface constant — not configurable per match.

### 1.2 Engine entry point — `MatchImpl.sideboard()`

`Mage/src/main/java/mage/game/match/MatchImpl.java:325-347`:

```
public void sideboard() {
    ThreadUtils.ensureRunInGameThread();
    for (MatchPlayer player : this.players) {
        if (!player.hasQuit()) {
            if (player.getDeck() != null) {
                player.setSideboarding();
                player.getPlayer().sideboard(this, player.getDeck());
            } ...
        }
    }
    synchronized (this) {
        while (!isDoneSideboarding()) {
            try { this.wait(); } catch (InterruptedException ignore) {}
        }
    }
}
```

Calls each player's `Player.sideboard(match, deck)`. The match thread blocks on `this.wait()` until every non-quit player has called `match.submitDeck(playerId, deck)` which `notifyAll()`s the lock (line 390-392).

### 1.3 Per-player dispatch — `HumanPlayer.sideboard`

`Mage.Server.Plugins/Mage.Player.Human/src/mage/player/human/HumanPlayer.java:2223-2226`:

```
@Override
public void sideboard(Match match, Deck deck) {
    match.fireSideboardEvent(playerId, deck);
}
```

Hands off to `MatchImpl.fireSideboardEvent` at line 374-380, which fires a `TableEvent(EventType.SIDEBOARD, playerId, deck, SIDEBOARD_TIME=180)`. (Note: the event timer slot carries 180 s — the canonical timeout — but this value is **not** what the wire frame eventually carries; see 1.5.)

### 1.4 TableController listener picks up the event

`TableController.java:100-114` — `init()` registers an event listener:

```
case SIDEBOARD:
    sideboard(event.getPlayerId(), event.getDeck());
    break;
```

Routing into `TableController.java:773-783`:

```
private void sideboard(UUID playerId, Deck deck) throws MageException {
    for (Entry<UUID, UUID> entry : userPlayerMap.entrySet()) {
        if (entry.getValue().equals(playerId)) {
            Optional<User> user = managerFactory.userManager().getUser(entry.getKey());
            int remaining = (int) futureTimeout.getDelay(TimeUnit.SECONDS);
            user.ifPresent(user1 -> user1.ccSideboard(deck, table.getId(),
                table.getParentTableId(), remaining, options.isLimited()));
            break;
        }
    }
}
```

`remaining` is read off the timeout future scheduled by `setupTimeout(180)` at `:848` — so on first dispatch `remaining ≈ 179` (called milliseconds after the timeout fires).

### 1.5 Callback fires — `User.ccSideboard`

`Mage.Server/src/main/java/mage/server/User.java:299-306`:

```
public void ccSideboard(final Deck deck, final UUID currentTableId,
                        final UUID parentTableId, final int time, boolean limited) {
    fireCallback(new ClientCallback(
        ClientCallbackMethod.SIDEBOARD,
        currentTableId,                                   // objectId = tableId, NOT gameId
        new TableClientMessage().withDeck(deck)
            .withTable(currentTableId, parentTableId)
            .withTime(time)
            .withFlag(limited)
    ));
    sideboarding.put(currentTableId, deck);              // remembered for reconnect (line 305)
}
```

Two facts that matter for the recon:

1. **`objectId` is the `tableId`, not a `gameId`.** The webclient's per-game WebSocket (`/api/games/{gameId}/stream`) subscribes via gameId. The frame still reaches the client because the broadcast layer fan-outs to *every* registered socket on the user's session — see §2.2.
2. **The reconnect path at `User.java:462-472`** (`reconnect()` reading the `sideboarding` map) re-fires `ccSideboard` for every active sideboarding table when the user reconnects. The webclient does not currently exercise this in the WebApi facade — handlers are constructed at login and reused, no upstream `reconnect()` call exists. Out of scope here; flag for the user-session lifecycle work.

### 1.6 Auto-completion on timeout

`TableController.java:917-936` defines `setupTimeout` / `cancelTimeout` / `autoSideboard`:

```
private synchronized void setupTimeout(int seconds) {
    cancelTimeout();
    if (seconds > 0) {
        futureTimeout = timeoutExecutor.schedule(this::autoSideboard, seconds, TimeUnit.SECONDS);
    }
}

private void autoSideboard() {
    for (MatchPlayer player : match.getPlayers()) {
        if (!player.isDoneSideboarding()) {
            match.submitDeck(player.getPlayer().getId(),
                player.autoCompleteDeck(table.getValidator()));
        }
    }
}
```

If the user does not POST within 180 s, the engine submits `autoCompleteDeck(validator)` for them and resumes. `autoCompleteDeck` is the upstream "use mainboard as-is, ignore sideboard changes" fallback. The user receives no notification that this happened beyond the eventual `startGame` for game 2.

### 1.7 Done — `match.submitDeck` releases the wait

`MatchImpl.java:382-393`:

```
@Override
public void submitDeck(UUID playerId, Deck deck) {
    MatchPlayer player = getPlayer(playerId);
    if (player != null) {
        deck.setName(player.getDeck().getName());
        player.submitDeck(deck);
    }
    synchronized (this) {
        this.notifyAll();
    }
}
```

`MatchPlayer.submitDeck` flips `setDoneSideboarding(true)`, the wait loop in 1.2 exits, `TableController.sideboard()` returns and game 2 starts via `startGame(choosingPlayerId)` at `TableController.java:833`.

### 1.8 ClientCallbackMethod enum

`Mage.Common/src/main/java/mage/interfaces/callback/ClientCallbackMethod.java:30`:

```
SIDEBOARD(ClientCallbackType.TABLE_CHANGE, "sideboard"),
CONSTRUCT(ClientCallbackType.TABLE_CHANGE, "construct"),
```

`SIDEBOARD` is a single enum value; the `code` field (`"sideboard"`) becomes the wire `method` discriminator. There is no separate `gameSideboard` method — sideboard prompts use this single `TABLE_CHANGE` callback regardless of where in the match they fire.

---

## 2. WebApi facade — outbound (engine → client)

### 2.1 Mapper case

`Mage.Server.WebApi/src/main/java/mage/webapi/ws/WebSocketCallbackHandler.java:238`:

```
case SIDEBOARD -> mapSideboard(cc);
```

`mapSideboard` at `:292-306`:

```
private WebStreamFrame mapSideboard(ClientCallback cc) {
    Object data = cc.getData();
    if (!(data instanceof TableClientMessage upstream)) { ... return null; }
    return new WebStreamFrame(
        SchemaVersion.CURRENT,
        "sideboard",                                     // wire method
        cc.getMessageId(),
        cc.getObjectId() == null ? null : cc.getObjectId().toString(),  // tableId
        DeckViewMapper.toSideboardInfo(upstream)
    );
}
```

### 2.2 Broadcast — fan-out to every registered socket

The handler is **per-WebSession** (one per user, registered at login from `AuthService`). The broadcast at `WebSocketCallbackHandler.java:385-408` snapshots `sockets` and `ctx.send(frame)` for every registered `WsContext`. Only `chatMessage` frames are filtered by chatId (`shouldDeliverChat`, `:417-423`); `sideboard` frames go to **all** sockets.

This is what makes the `objectId == tableId, not gameId` discrepancy harmless: the user's open game-1 WebSocket receives the sideboard frame even though the path parameter is gameId, because the fan-out doesn't filter on path.

### 2.3 DTO — `WebSideboardInfo`

`Mage.Server.WebApi/src/main/java/mage/webapi/dto/stream/WebSideboardInfo.java:28-35`:

```java
public record WebSideboardInfo(
    WebDeckView deck,
    String tableId,
    String parentTableId,
    int time,
    boolean limited
) {}
```

Five fields, snapshot-locked by `DeckViewMapperTest.java:80-92`.

### 2.4 Card-name resolution — server-side

`Mage.Server.WebApi/src/main/java/mage/webapi/mapper/DeckViewMapper.java:35-105`. `WebSimpleCardView` carries `(id, name, expansionSetCode, cardNumber, usesVariousArt)`; `name` is resolved server-side via `CardRepository.findCard(setCode, cardNumber)` so the webclient renders without a card-DB round trip. Misses fall back to `"<setCode>:<cardNumber>"`.

### 2.5 Wire JSON shape

```json
{
  "schemaVersion": "1.18",
  "method":        "sideboard",
  "messageId":     1234,
  "objectId":      "<tableId>",
  "data": {
    "deck": {
      "name":      "Mono-green",
      "mainList":  [
        { "id": "...", "name": "Forest", "expansionSetCode": "M21",
          "cardNumber": "281", "usesVariousArt": true },
        ...
      ],
      "sideboard": [ ... ]
    },
    "tableId":       "<tableId>",
    "parentTableId": "",
    "time":          179,
    "limited":       false
  }
}
```

The shape itself was introduced in CHANGELOG 1.14 (slice 13); the `schemaVersion` field carries whatever the global current is at send time (`1.18` as of slice 28, `SchemaVersion.CURRENT`). Every frame stamps the live constant; the *shape* and the *schema version* evolve independently.

---

## 3. WebApi facade — inbound (client → server)

### 3.1 Route

`Mage.Server.WebApi/src/main/java/mage/webapi/server/WebApiServer.java:237-245`:

```java
app.post("/api/tables/{tableId}/deck", ctx -> {
    UUID tableId = parseUuid(ctx.pathParam("tableId"), "tableId");
    WebDeckCardLists req = parseBody(ctx.body(), WebDeckCardLists.class);
    boolean update = "true".equalsIgnoreCase(ctx.queryParam("update"));
    SessionEntry session = sessionFrom(ctx);
    lobbyService.submitDeck(session.upstreamSessionId(), tableId,
            DeckMapper.toUpstream(req), update);
    ctx.status(204);
});
```

REST POST, bearer-authenticated, body shape mirrors the REST table-join wire body (`WebDeckCardLists`). 204 on success.

### 3.2 LobbyService dispatch

`Mage.Server.WebApi/src/main/java/mage/webapi/lobby/LobbyService.java:243-259`:

```java
public void submitDeck(String upstreamSessionId, UUID tableId,
                        DeckCardLists deckList, boolean update) {
    try {
        if (update) {
            embedded.server().deckSave(upstreamSessionId, tableId, deckList);  // autosave
            return;
        }
        boolean ok = embedded.server().deckSubmit(upstreamSessionId, tableId, deckList);
        if (!ok) {
            throw new WebApiException(422, "UPSTREAM_REJECTED",
                "Server refused to accept the deck (table not sideboarding/constructing, "
                    + "deck failed format validation, or player has quit).");
        }
    } catch (MageException ex) {
        throw upstream(update ? "updating deck" : "submitting deck", ex);
    }
}
```

`?update=true` switches dispatch from final submit (`MageServer.deckSubmit` returns `boolean`) to autosave (`MageServer.deckSave` returns `void`). The webclient sends the bare endpoint without `?update=true` (see SideboardModal in §5); autosave is wired on the server but **never called by the webclient today**.

### 3.3 Upstream resolution

`MageServerImpl.deckSubmit` (`Mage.Server/src/main/java/mage/server/MageServerImpl.java:350-368`) → `TableManagerImpl.submitDeck` (`:160`) → `TableController.submitDeck` (`TableController.java:422-482`). The state-check is in `TableController.java:448`:

```java
if (table.getState() != TableState.SIDEBOARDING
        && table.getState() != TableState.CONSTRUCTING) {
    return false;       // wrapped to 422 UPSTREAM_REJECTED in LobbyService
}
```

Format validation (`table.getValidator().validate(deck)`) at `:465-478` returns `false` and surfaces an upstream `User.showUserMessage("Submit deck", <reason>)` — that message rides the existing `SHOW_USERMESSAGE` callback, **not** the response of the POST. The POST returns `false → 422 UPSTREAM_REJECTED` with a generic message; the actual validation reason is on a separate callback the webclient does not currently render. (`SHOW_USERMESSAGE` mapping is itself a gap; check `WebSocketCallbackHandler.mapToFrame` — no case → frame dropped.)

### 3.4 Edge cases handled by upstream

`TableController.submitDeck` lines 434-445 short-circuit when the player has quit (`return true; // so the construct panel closes`), turning that into a 204 even though no deck was submitted. The unit test `WebApiServerTest.submitDeck_unknownTable_returns204` (`:464-477`) locks this contract: missing tables return 204, not 404, so the panel closes cleanly even after the table evaporated.

### 3.5 Error envelope

| Status | Code | When |
|---|---|---|
| 204 | — | Success, OR table no longer exists, OR player already quit |
| 400 | `BAD_REQUEST` | Malformed UUID in path, blank body |
| 401 | `MISSING_TOKEN` | No bearer header |
| 422 | `UPSTREAM_REJECTED` | `deckSubmit` returned false (wrong state, deck-validation failure, etc.) — **no specific reason on the wire**; the user only sees the 422 generic message in the modal |
| 500 | `UPSTREAM_ERROR` | `MageException` from upstream |

---

## 4. Webclient — store

### 4.1 Schema

`webclient/src/api/schemas.ts:213-241`:

```ts
export const webSimpleCardViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  expansionSetCode: z.string(),
  cardNumber: z.string(),
  usesVariousArt: z.boolean(),
});

export const webDeckViewSchema = z.object({
  name: z.string(),
  mainList: z.array(webSimpleCardViewSchema),
  sideboard: z.array(webSimpleCardViewSchema),
});

export const webSideboardInfoSchema = z.object({
  deck: webDeckViewSchema,
  tableId: z.string(),
  parentTableId: z.string(),
  time: z.number(),
  limited: z.boolean(),
});
```

### 4.2 Stream dispatcher

`webclient/src/game/stream.ts:74-75`:

```ts
sideboard: (raw) => webSideboardInfoSchema.parse(raw),
```

Maps the wire `method: "sideboard"` to the validator. Validation failure throws and is caught by the dispatcher's outer try/catch (drops the frame with a console warn).

### 4.3 Store handler

`webclient/src/game/store.ts:309-317`:

```ts
case 'sideboard': {
    const info = validatedData as WebSideboardInfo;
    set({ pendingSideboard: info });
    return true;
}
```

Plus the field declaration (`:189-197`), the initial-state seed (`:243`), and the `clearSideboard: () => set({ pendingSideboard: null })` setter (`:436`).

### 4.4 Reset behavior — load-bearing

`webclient/src/game/store.ts:438`: `reset: () => set(INITIAL)`. The `INITIAL` shape includes `pendingSideboard: null` (`:243`), so `reset()` wipes any pending sideboard. **`Game.tsx:88` calls `reset()` on unmount.** This is the cause of gap G2 below.

---

## 5. Webclient — UI

### 5.1 SideboardModal component

`webclient/src/pages/SideboardModal.tsx`. Two-pane list view (main left, sideboard right), card rows show name + `setCode:cardNumber`, single arrow button per row to move to the other pane.

### 5.2 Submit dispatch

`SideboardModal.tsx:74-96`:

```tsx
const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const body = {
        name: pending.deck.name,
        author: '',
        cards: collapseToCardInfo(mainList),
        sideboard: collapseToCardInfo(sideboard),
    };
    try {
        await request(`/api/tables/${pending.tableId}/deck`, null, {
            token, method: 'POST', body,
        });
    } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Submit failed.');
        setSubmitting(false);
        return;
    }
    clear();      // useGameStore.clearSideboard
};
```

`tableId` comes off the validated wire frame so the modal does not need any external context to know where to POST. **No `?update=true` autosave dispatch** — every state change to the lists is local React state, only the Submit button hits the wire.

### 5.3 Mount points

`webclient/src/App.tsx:120` and `:177`:

```tsx
{activeGameId ? (
    <>
        <Game gameId={activeGameId} onLeave={...} />
        <SideboardModal />     // mounted next to Game
    </>
) : (
    <... lobby ...>
        <SideboardModal />     // also mounted at lobby
    </...>
)}
```

The modal is mounted at App scope (sibling to Game, not inside it) so it survives Game's unmount during the game-1 → game-2 navigation. Test `SideboardModal.test.tsx:166-182` locks "clears `pendingSideboard` on successful submit".

### 5.4 What the modal does **not** do

- **No autosave.** The modal does not POST `?update=true` on each move. If the WebSocket drops mid-edit and the user has to reconnect, the engine's deck snapshot is unchanged from the original prompt; the user's local edits survive the reconnect (since slice-22 modal-key fix; see §10.1) but won't survive a hard reload. (Server-side `deckSave` is wired but unused.)
- **No format-validation feedback.** A 422 from the server surfaces only the generic `UPSTREAM_REJECTED` message; the actual reason (e.g., "Deck has 59 cards, minimum is 60") rides on `SHOW_USERMESSAGE` which is **not** mapped (see §3.3).
- **No "submit empty / done" affordance** for a player who just wants to keep their game-1 mainboard. They have to click Submit; that works fine (the body carries the unchanged lists), but no UI hint says "you can submit without any changes."

The countdown timer that used to be missing here is now live — see §10.2.

---

## 6. End-to-end timing diagram

The happy path, game 1 finishes → game 2 starts. Layers labeled `[E]` engine, `[S]` server facade, `[N]` network, `[C]` webclient, `[U]` user.

```
[E] Match.endGame() — players' wins counted, gameOver fires
    │
    ├─▶ [S] WebSocketCallbackHandler.mapToFrame(GAME_OVER)
    │   [N] frame { method: "gameOver", data: WebGameClientMessage }
    │   [C] store.applyFrame → gameOverPending = true; lastWrapped = ...
    │   [C] GameEndOverlay banner: "Game over — Waiting for the next game…"
    │
[E] TableController.endGameAndStartNextGame:828
    │   if (game.getGameType().isSideboardingAllowed()) sideboard();
    │
[E] TableController.sideboard() (`:846`)
    │   table.sideboard()                  // table state → SIDEBOARDING
    │   setupTimeout(180)                  // futureTimeout schedules autoSideboard
    │   match.sideboard() (`MatchImpl.java:326`)
    │     for each non-quit player:
    │       player.setSideboarding();
    │       player.getPlayer().sideboard(this, deck);
    │
[E] HumanPlayer.sideboard (`:2224`)
    │   match.fireSideboardEvent(playerId, deck)
    │
[E] MatchImpl.fireSideboardEvent (`:374`)
    │   tableEventSource.fire(SIDEBOARD, playerId, deck, 180)
    │
[E] TableController listener (`:104-107`)
    │   sideboard(event.getPlayerId(), event.getDeck())
    │
[E] TableController.sideboard(playerId, deck) (`:773-783`)
    │   remaining = futureTimeout.getDelay(SECONDS)   // ~179
    │   user.ccSideboard(deck, tableId, parentTableId, remaining, isLimited)
    │
[E] User.ccSideboard (`:299-306`)
    │   fireCallback(new ClientCallback(SIDEBOARD, tableId, TableClientMessage{...}))
    │   sideboarding.put(tableId, deck)               // for reconnect
    │
[S] WebSocketCallbackHandler.mapToFrame(SIDEBOARD) (`:238`)
    │   case SIDEBOARD -> mapSideboard(cc)            // returns WebStreamFrame
    │   appendBuffer(frame)                           // ring-buffer for ?since=
    │   broadcast → every registered WsContext (no chatId filter)
    │
[N] frame { method: "sideboard", objectId: tableId,
    │       data: { deck: { name, mainList[], sideboard[] }, tableId,
    │               parentTableId, time: 179, limited: false } }
    │
[C] GameStream.onMessage → DATA_VALIDATORS["sideboard"] → schema parse
[C] store.applyFrame case 'sideboard' → set({ pendingSideboard: info })
[C] React re-renders App; SideboardModal sees pending !== null → mounts
[C] User sees: two panes ("Main (40)", "Sideboard (15)"), arrow buttons, "2:59 remaining" live countdown (red below 30 s)
    │
[U] User clicks 0..N arrows → local React state moves cards between panes
[U] User clicks "Submit deck"
    │
[C] SideboardModal.onSubmit
    │   POST /api/tables/{tableId}/deck
    │   body = { name, author: "", cards: collapse(mainList), sideboard: collapse(sb) }
    │
[N] HTTP POST (bearer auth)
    │
[S] WebApiServer route (`:237-245`)
    │   parseUuid → parseBody(WebDeckCardLists) → DeckMapper.toUpstream(req)
    │   lobbyService.submitDeck(upstreamSessionId, tableId, deckList, update=false)
    │
[S] LobbyService.submitDeck (`:243`)
    │   embedded.server().deckSubmit(upstreamSessionId, tableId, deckList)
    │
[E] MageServerImpl.deckSubmit (`:350`)
    │   → TableManagerImpl.submitDeck (`:160`)
    │   → TableController.submitDeck (`:422`)
    │     state check (TableState.SIDEBOARDING) — passes
    │     Deck.load(deckList) — throws on unknown card → MageException → 500
    │     validator.validate(deck) — false → User.showUserMessage(...)
    │       → SHOW_USERMESSAGE callback fires (NOT mapped → frame dropped)
    │       → returns false → 422 UPSTREAM_REJECTED
    │     OK path → submitDeck(userId, playerId, deck) → match.submitDeck
    │     returns true → 204
    │
[E] MatchImpl.submitDeck (`:382`)
    │   player.submitDeck(deck)              // setDoneSideboarding(true)
    │   synchronized(this) { this.notifyAll(); }
    │
[E] MatchImpl.sideboard()'s wait loop wakes up; isDoneSideboarding() == true → returns
[E] TableController.sideboard()'s match.sideboard() returns; cancelTimeout()
[E] TableController.endGameAndStartNextGame:833 → startGame(choosingPlayerId)
    │
[S/E] Game 2 setup → User.ccGameStarted fires
[S]   WebSocketCallbackHandler.mapToFrame(START_GAME) → frame { method: "startGame" }
[N]   frame delivered to game-1 socket (still open)
[C]   store.applyFrame case 'startGame' → set({ pendingStartGame: info })
[C]   App.tsx subscriber consumes → setActiveGameIdState(info.gameId)
[C]   React re-renders: <Game gameId={game-2-id} /> mounts a fresh stream
[C]   Old Game's useEffect cleanup → stream.close() + reset()
[C]   reset() wipes pendingSideboard, pendingDialog, gameView, etc.
[C]   New stream opens → ?token=...&since=<lastMessageId> may replay any missed frames
[C]   gameInit for game 2 → store.applyFrame → gameOverPending: false (cleared on gameInit)
```

---

## 7. Gap list

### G1. Sideboard timer was static text — FIXED in this slice

**Original symptom:** `WebSideboardInfo.time` is set from `futureTimeout.getDelay(SECONDS)` (`TableController.java:778`). On first dispatch this is `~179` (179.999... s left, floor-truncated). The webclient previously rendered this as `${pending.time}s remaining` with no `useEffect`/`setInterval` decrementing it, so the user saw a frozen string while the server's 180 s hard timeout drained.

**Resolution.** `SideboardModal.tsx` now derives an absolute deadline (`Date.now() + pending.time * 1000`) on every fresh `pending`, ticks a `remaining` state down via `setInterval(1000)`, and renders it as `m:ss remaining`. Below 30 s the display flips to red with a `font-semibold` weight. The header carries a one-line hint that auto-submission will fire at zero. On a reconnect-replay the new frame's `time` is treated as authoritative (re-anchor the deadline) — see §3.2 of the critique-resolved findings.

The CHANGELOG 1.14 example payload of `"time": 600` is fictional; the canonical value is `Match.SIDEBOARD_TIME = 180` and the wire field is sampled at dispatch (~179 first-dispatch, smaller on reconnect replays). See §10.3.

### G2. Game-2 navigation can clear `pendingSideboard` on the autoSideboard path

**Symptom (narrowed per critique §3.1):** `Game.tsx:84-89` cleanup runs `reset()` which wipes the entire game store, including `pendingSideboard`. The race triggers **only on the autoSideboard timeout path**, not on AI-finish-first:

1. The user takes >180 s to submit. `autoSideboard()` (`TableController.java:930-936`) fires `match.submitDeck(humanId, autoCompleteDeck(validator))` for them.
2. `MatchImpl.sideboard()`'s wait loop wakes; game 2 starts via `startGame(choosingPlayerId)`.
3. The `startGame` frame arrives on the still-open game-1 socket. `App.tsx` swaps `activeGameId`, the old `<Game>` unmounts, cleanup runs `reset()`.
4. `reset()` wipes `pendingSideboard`. The user's modal returns null and unmounts mid-edit.

**Why the AI race the original recon feared isn't real.** `ComputerPlayer.sideboard` (`Mage.Server.Plugins/Mage.Player.AI/src/main/java/mage/player/ai/ComputerPlayer.java:977-981`) synchronously calls `match.submitDeck(playerId, deck)` with the unchanged deck. The AI seat is `isDoneSideboarding() == true` immediately, but `MatchImpl.sideboard()`'s wait loop blocks on **all** non-quit players; it doesn't release until the human also submits. So game 2 cannot start while a 1v1-vs-AI human is still picking — there's no race window unless the autoSideboard timeout fires first.

**Adjacent edge case.** If a human opponent quits during sideboarding (`TableController.matchEnd:880` path), the table transitions out of SIDEBOARDING via `closeTable`, not `startGame`. The symptom there is the modal hangs on a stale `pendingSideboard` until the user clicks Submit and the endpoint returns 204 (the missing-table 204 contract; `WebApiServerTest.submitDeck_unknownTable_returns204`).

**Fix:** narrow `reset()` to preserve `pendingSideboard` across gameId swaps, OR move sideboard-clear responsibility into the modal's submit handler exclusively (drop it from `INITIAL`). **Slice S.**

### G3. No autosave; reconnect mid-sideboard loses local state

**Symptom:** the modal keeps main↔side moves in React `useState`. If the WebSocket drops and Game.tsx remounts (or the user reloads), the SideboardModal also remounts and the local lists snap back to whatever the most-recent `pendingSideboard.deck` carries. That snapshot is the **engine's authoritative deck**, which doesn't update from autosave because the webclient never POSTs `?update=true`.

**Fix:** debounce a `?update=true` POST on each move. Server side already supports it (`LobbyService.java:247`). **Slice M** because of the debounce + dedupe + abort-on-final-submit logic.

### G4. 422 rejection reason isn't surfaced to the user

**Symptom:** when `validator.validate(deck)` fails (`TableController.java:465-478`), upstream calls `User.showUserMessage("Submit deck", <multi-line reason>)` and returns `false`. The webclient sees only the 422 with the generic `UPSTREAM_REJECTED` message; the validation reason rides `SHOW_USERMESSAGE` which has **no mapper case** in `WebSocketCallbackHandler` (the `default → null` branch drops it). The modal shows only "Server refused to accept the deck (table not sideboarding/constructing, deck failed format validation, or player has quit)."

**Fix:** map `SHOW_USERMESSAGE` to a wire frame and surface in the modal as an error overlay, OR carry the validation reason as the 422 message body server-side (would need `TableController.submitDeck` to throw a typed exception instead of returning `boolean`). **Slice M** — the broader `SHOW_USERMESSAGE` mapping has consumers beyond sideboarding.

### G5. Reconnect during sideboarding may not re-fire the prompt

**Symptom:** `User.reconnect()` (`User.java:461-471`) iterates `sideboarding` and re-fires `ccSideboard` for every entry. The WebApi facade does not call upstream's `reconnect()` on socket re-attach; the per-WebSession handler is constructed at REST login (slice 5) and stays alive. The `?since=<messageId>` replay at WS reconnect (`GameStreamHandler.java:198-215`) draws from the in-memory ring buffer (capacity 64), which **may** have evicted the SIDEBOARD frame if 64+ frames have flowed since (chat-heavy game, etc.).

**Fix:** on WS connect for a game whose table is in SIDEBOARDING state, server-side check `User.sideboarding.get(tableId)` and synthesize a fresh `sideboard` frame. **Slice S** (server-only, no DTO change).

### G6. SHOW_USERMESSAGE is unmapped (broader gap, surfaces here)

Already noted in G4 — `WebSocketCallbackHandler.mapToFrame` switch has no `SHOW_USERMESSAGE` case. Several upstream paths (`TableController.matchEnd:880`, format-validation feedback, etc.) emit `SHOW_USERMESSAGE` and the user never sees the message. Slice M.

### G7. CONSTRUCT (limited / draft) is fully out of band

`User.ccConstruct` (`User.java:324`) fires the `CONSTRUCT` callback for limited / sealed / draft constructing windows. `WebSocketCallbackHandler.mapToFrame` has **no** `case CONSTRUCT`; ADR 0008 §1.11 explicitly defers this. If anyone tries a draft format end-to-end, the constructing window will deadlock the same way pre-1.14 sideboarding did. Out of scope for the 1v1 sideboard slice; flag for the limited-format ADR.

---

## 8. Resolved questions

### 8.1 `time` field semantics — RESOLVED

The wire value comes from `futureTimeout.getDelay(SECONDS)` at the moment the listener runs (`TableController.java:778`). The interval between `setupTimeout(180)` (`:848`) and the first `getDelay` read is microseconds — the for-loop in `MatchImpl.sideboard` is on the same thread — so first dispatch deterministically carries `time = 179` (179.999... s remaining, floor-truncated to seconds). On reconnect, `User.reconnect()` (`User.java:462-472`) re-fires `ccSideboard` with `controller.getRemainingTime()`, which reads the same future. If 30 s have elapsed the value will be `~149`. So the field is "remaining seconds at server send time", and the webclient correctly treats each fresh frame as the engine's authoritative residual delay (re-anchor the local deadline). A wall-clock `deadlineUtc` field would still be a nice-to-have for clock-skew correctness, but isn't blocking.

### 8.2 AI sideboarding — NOT A RACE

`ComputerPlayer.sideboard` (`Mage.Server.Plugins/Mage.Player.AI/src/main/java/mage/player/ai/ComputerPlayer.java:977-981`) synchronously calls `match.submitDeck(playerId, deck)` with the unchanged prior-game deck. This makes the AI seat `isDoneSideboarding() == true` immediately, but `MatchImpl.sideboard()`'s wait loop blocks on **all** non-quit players — game 2 cannot start while a 1v1-vs-AI human is still picking. The race the original recon flagged for G2 is **not real on the AI-finish-first path**; the only race window is the 180 s autoSideboard timeout (see G2).

### 8.3 `SHOW_USERMESSAGE` carrying validation feedback — DEFERRED

Slice 13 explicitly does not map this callback. The design intent: 422's generic message is sufficient for the slice; validation feedback is a best-effort follow-up. Affects G4/G6 scope; not blocking.

### 8.4 Spectators during sideboarding — CORRECT BY CONSTRUCTION

Per ADR 0007 D12, spectator support is deferred. The SIDEBOARD callback fires once per *seated* player; a spectator's session is not in the per-table-user map (`TableController.sideboard:773`'s `userPlayerMap` filter). The per-WebSession broadcast model means a spectator's session has its own handler and cannot see another user's sideboard frame. No leak.

### 8.5 The "600" claim — MIS-ATTRIBUTED IN ORIGINAL RECON

ADR 0008 §1.10 does **not** mention `600`. A grep against `docs/decisions/0008-player-interactions.md` returns no matches. The literal `"time": 600` lives only in `docs/schema/CHANGELOG.md` §1.14 line 237 as an illustrative payload example — fictional, never true at runtime since `Match.SIDEBOARD_TIME = 180` is hardcoded and not configurable. The original recon's framing ("ADR 0008 §1.10's `time: 600` example") was a misattribution. **The ADR encodes no specific timer value, so there's nothing to correct in the ADR.** The CHANGELOG entry's example is the inaccurate one; if that file is touched in a future slice it should be corrected to `~179` with an explanatory note.

---

## 9. Validation — what tests cover today

| Layer | Test | Coverage |
|---|---|---|
| Mapper | `DeckViewMapperTest.toSideboardInfo_jsonShape_locksFiveTopFields` | Field set + JSON shape locked |
| Mapper | `DeckViewMapperTest.empty_deck` | Null-safety on empty cards/sideboard |
| Endpoint | `WebApiServerTest.submitDeck_unknownTable_returns204` | Missing-table 204 contract |
| Endpoint | `WebApiServerTest.submitDeck_updateMode_unknownTable_returns204` | `?update=true` 204 contract |
| Endpoint | `WebApiServerTest.submitDeck_malformedTableId_returns400` | UUID validation |
| Endpoint | `WebApiServerTest.submitDeck_blankBody_returns400` | Body validation |
| Endpoint | `WebApiServerTest.submitDeck_missingAuth_returns401` | Auth gate |
| UI | `SideboardModal.test.tsx` (11 cases) | Rendering, list moves, submit shape, 422 rejection, clear-on-success, m:ss countdown ticking, urgency styling under 30 s, in-progress edits persist across SIDEBOARD frame replay (modal-key bug regression) |

**Not covered today:**

- Engine-level live test of game 1 → sideboard prompt → submit → game 2 (would need an embedded match harness; the slice 22 `endToEnd_createTableAddAiJoinStart_advancesTableState` test stops at game start).
- Reconnect-during-sideboarding replay end-to-end (G5).
- Timer expiry → autoSideboard → game 2 starts without user submit (G2 race window).
- Spectator interaction with sideboarding (out of scope).

---

## 10. Fixes landed in this slice

### 10.1 Modal-key bug — `key={pending.tableId}` (was: `tableId + ':' + time`)

**The bug.** `SideboardModal.tsx`'s outer wrapper used `key={pending.tableId + ':' + pending.time}` to force a fresh component instance on every fresh frame. Because `time` decreases on every reconnect-replay (`futureTimeout.getDelay(SECONDS)` re-samples on each dispatch), any reconnect mid-edit changed the key and forced React to unmount + remount `SideboardModalImpl`, resetting `useState` and discarding the user's in-progress main↔side moves. Strictly worse than the autosave gap (G3) — it didn't even need a `Game.tsx` remount to trigger.

**The fix.** Key on `tableId` only. A match never has overlapping sideboard windows for the same table, so `tableId` is enough to discriminate between distinct sideboarding sessions, and the modal now persists across reconnects on the same table. The `useState` initializers still capture the engine's authoritative deck on first mount; subsequent frames re-anchor the timer (see §10.2) without disturbing user edits.

**Regression test.** `SideboardModal.test.tsx` — *"persists local main↔side edits across a SIDEBOARD frame replay with smaller time"*. User clicks the move-to-sideboard arrow, then a fresh `pendingSideboard` with the same `tableId` and a smaller `time` is set (simulating reconnect-replay). The pane counts must remain `Main (1)` / `Sideboard (2)`, and the countdown re-anchors to `2:00 remaining`.

### 10.2 Live countdown timer

**The bug.** Header rendered `${pending.time}s remaining` as static text. No `setInterval`. The 180 s engine timeout drained invisibly; at zero `autoSideboard()` fires `match.submitDeck(humanId, autoCompleteDeck(validator))` and the user's unsubmitted edits are lost.

**The fix.**
- Capture an absolute deadline `deadlineMsRef.current = Date.now() + pending.time * 1000` on mount and on every fresh frame (re-anchored when `pending.tableId` or `pending.time` changes).
- Tick a `remaining` state every 1 s via `setInterval`; render as `m:ss` (e.g. `2:45`, `0:35`) for legibility.
- Below 30 s, the countdown's `<span>` flips to `text-red-400 font-semibold` for urgency.
- A small subscript hint reads "Time runs out → engine auto-submits your current main/side configuration." so the user understands the timeout's consequence.
- On reconnect-replay, the new frame's `time` is the engine's authoritative residual delay; the deadline is re-anchored. A small visual jump (e.g. 145 → 149) is correct — the engine timer is the source of truth.

**Tests.**
- *"countdown ticks down as time elapses"* — uses `vi.useFakeTimers()`; after 1 s the value drops from `3:00` to `2:59`, after 59 s to `2:01`.
- *"flips countdown to red urgency styling under 30s"* — at 35 s the styling is normal; advancing 6 s drops to 29 s and the className includes `text-red-400`.
- *"shows m:ss remaining + limited flag in the header"* — replaces the prior static-`300s` assertion; `time: 300` now renders as `5:00 remaining`.

### 10.3 Doc attribution corrections

The original recon claimed "the wire frame carries `time = 600`" and attributed `time: 600` to ADR 0008 §1.10. Both were wrong:

1. The `time: 600` literal is in `docs/schema/CHANGELOG.md` §1.14 line 237 (illustrative payload), not in any ADR. ADR 0008 §1.10 contains no numeric timer value.
2. The actual runtime value is `~179` first-dispatch (sampled from `futureTimeout.getDelay(SECONDS)` at the moment the listener runs; see §3.2-resolved).
3. `User.reconnect` line range is `:462-472` (one-line drift in the original recon).

The recon body (TL;DR, §1.5, §2.5, §8) has been corrected; ADR 0008 itself was not modified because it carried no incorrect claim. If `docs/schema/CHANGELOG.md` is touched in a future slice, line 237's `"time": 600` should be corrected to `"time": 179` with an explanatory note.

---

## 11. References

- [ADR 0007 — Game stream protocol](0007-game-stream-protocol.md)
- [ADR 0008 §1.10 — sideboard catalog entry](0008-player-interactions.md)
- [Schema CHANGELOG 1.14 — Sideboard wire format](../schema/CHANGELOG.md)
- Engine: `Mage.Server/src/main/java/mage/server/User.java:299-306` (`ccSideboard`)
- Engine: `Mage.Server/src/main/java/mage/server/TableController.java:773-783` (private `sideboard(playerId, deck)`)
- Engine: `Mage.Server/src/main/java/mage/server/TableController.java:846-869` (private `sideboard()` with timeout)
- Engine: `Mage.Server/src/main/java/mage/server/TableController.java:917-936` (`setupTimeout` / `autoSideboard`)
- Engine: `Mage/src/main/java/mage/game/match/MatchImpl.java:325-393` (sideboard / submitDeck / waiting loop)
- Engine: `Mage/src/main/java/mage/game/match/Match.java:22` (`SIDEBOARD_TIME = 180`)
- Engine: `Mage.Server.Plugins/Mage.Player.Human/src/mage/player/human/HumanPlayer.java:2223-2226` (`HumanPlayer.sideboard`)
- Facade: `Mage.Server.WebApi/src/main/java/mage/webapi/ws/WebSocketCallbackHandler.java:238,292-306` (mapper case)
- Facade: `Mage.Server.WebApi/src/main/java/mage/webapi/dto/stream/WebSideboardInfo.java`
- Facade: `Mage.Server.WebApi/src/main/java/mage/webapi/mapper/DeckViewMapper.java`
- Facade: `Mage.Server.WebApi/src/main/java/mage/webapi/server/WebApiServer.java:237-245` (`POST /api/tables/{tableId}/deck`)
- Facade: `Mage.Server.WebApi/src/main/java/mage/webapi/lobby/LobbyService.java:243-259`
- Webclient: `webclient/src/api/schemas.ts:213-241` (Zod schemas)
- Webclient: `webclient/src/game/stream.ts:74-75` (validator dispatch)
- Webclient: `webclient/src/game/store.ts:189-197,243,309-317,436` (state field, init, handler, clear)
- Webclient: `webclient/src/pages/SideboardModal.tsx`
- Webclient: `webclient/src/App.tsx:120,177` (mount points)
- Webclient: `webclient/src/pages/Game.tsx:84-89` (cleanup → `reset()`)
