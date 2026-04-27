# 0008 — Player interactions: 1v1 duel matrix

- **Status:** Living document
- **Date:** 2026-04-26 (initial)
- **Deciders:** Austin
- **Builds on:** [ADR 0005](0005-game-window-architecture.md) (game window), [ADR 0006](0006-lobby-and-tables.md) (table CRUD), [ADR 0007](0007-game-stream-protocol.md) (stream protocol)
- **Scope:** 1v1 duel only. Multiplayer / draft / tournament / commander / planechase / archenemy items are catalogued in §1 with one-line "out of 1v1 scope" entries; deep specs land in companion ADRs (planned).

---

## How this doc works

After ~14 slices of webclient/facade work and a play session that surfaced six bugs traceable to dialog frames we hadn't catalogued, this doc enumerates **every** outbound callback the engine fires at a 1v1 player, **every** inbound surface they respond on, and the gestures the user produces. The aim is "no surprises" — when we sit to slice combat or fix a bug, we look up the section instead of re-deriving the contract from upstream sources.

Sections:

* **§1** — outbound callback catalogue, one subsection per `ClientCallbackMethod` value (40 entries; some are out-of-scope one-liners).
* **§2–5** — inbound surfaces: free-priority object click, `playerResponse` dialog answers, `playerAction` toggles + lifecycle, chat / table actions.
* **§6** — cross-cutting frames the user observes but doesn't answer (`gameInit`, `gameUpdate`, `gameInform`, `gameOver`, `endGameInfo`, `chatMessage`).
* **§7** — combat sub-flow walkthrough (the highest-priority unimplemented piece).
* **§8** — mulligan and start-of-game.
* **§9** — end-of-turn cleanup.
* **§10** — targeting taxonomy.
* **§99** — gap summary, sorted by 1v1 impact, with slice-size estimates.

Each callback entry uses a fixed template:

```
### 1.X — UPSTREAM_ENUM_NAME → wire methodName

- Fires:           where in upstream + under what game condition
- Carrier type:    upstream view class
- Wire frame:      method on the WebStreamFrame envelope, or "NOT YET WIRED"
- Wire data shape: WebXxx record fields the renderer sees
- Expected response: kind + sender method + skip-token
- Legal user gestures
- Swing-client UX (reference)
- Current webclient state: Covered / Partial / Gap (+ files)
- Notes
```

Citations use `path:line` so a reviewer can verify in seconds. References to "upstream" are the read-only forks at `F:\xmage\Mage*` (engine + Swing client). References to "facade" are `F:\xmage\Mage.Server.WebApi`. References to "webclient" are `F:\xmage\webclient`.

Wire format references the schema-version-history at `F:\xmage\docs\schema\CHANGELOG.md` (currently 1.14). Where a callback was wired in a specific version, the entry says so.

---

## §1. Outbound callbacks (engine → player)

The 40 values of `ClientCallbackMethod` (`Mage.Common/.../ClientCallbackMethod.java:10`), one entry each. Empty-line entries flagged "out of 1v1 scope" exist for completeness — the catalogue must be exhaustive so we never silently drop a new wire frame in future audits.

### 1.1 — `CHATMESSAGE` → wire `chatMessage`

- **Fires:** any `ChatManager.broadcast`, including system messages, whispers, game-log entries the engine surfaces to the chat (`Mage.Server/.../ChatManager.java`), and player-typed chat. Per-callback type is `MESSAGE`.
- **Carrier type:** `ChatMessage` (`Mage.Common/.../view/ChatMessage.java`).
- **Wire frame:** `chatMessage` (since schema 1.6).
- **Wire data shape:** `WebChatMessage` — `username`, `message`, `time`, `turnInfo`, `color`, `messageType`, `soundToPlay`. The envelope's `objectId` carries the chatId so the per-WsContext chat-scoping filter (`WebSocketCallbackHandler.shouldDeliverChat`, `:411`) can suppress unrelated chats when a game-chat is bound.
- **Expected response:** none (one-way push). Inbound counterpart is the `chatSend` envelope (§5).
- **Legal user gestures:** none — the user only reads.
- **Swing-client UX:** `CallbackClientImpl.java:163-204` — appends to the chat panel keyed by `objectId` (the chatId). Also plays a sound when `soundToPlay` is non-empty.
- **Current webclient state:** **Covered.** `webclient/src/game/store.ts:303` buckets by chatId, capped at 200 messages per bucket. Lobby / Game pages each filter to their bucket.
- **Notes:** upstream message text uses a tiny HTML markup (`<font color=#XXX>…</font>`, `<br>`) for highlighting card names and damage. The webclient renderer (`GameDialog.tsx:534`, `renderUpstreamMarkup`) tokenizes safely (no `dangerouslySetInnerHTML`); chat panel does **not** yet (it HTML-escapes on render — slice TODO, see §99).

### 1.2 — `SHOW_USERMESSAGE` → wire `showUserMessage` (NOT YET WIRED)

- **Fires:** `User.showUserMessage` (`Mage.Server/.../User.java:340`). Called from `MageServerImpl` paths that need to surface a server-side validation failure to one specific user — "you have too many open tables", "your quit ratio exceeds the limit", etc. Also fires from `adminMuteUser` / `adminLockUser`.
- **Carrier type:** `List<String>` of length 2 — `[title, message]` (terse hand-rolled wrapping; not a view class).
- **Wire frame:** **NOT YET WIRED.** No mapper in `WebSocketCallbackHandler.mapToFrame` (`:209`).
- **Wire data shape:** would be `{ title: string, body: string }`.
- **Expected response:** none.
- **Legal user gestures:** dismiss.
- **Swing-client UX:** `CallbackClientImpl.java:398-404` — `JOptionPane.showMessageDialog`.
- **Current webclient state:** **Gap** — fires today during lobby / table operations and the user gets nothing. Common in 1v1 only at table-create / table-join time, not in-game. Slice S.
- **Notes:** out-of-band relative to the game stream. If wired, route through the **room** WS or surface via the existing REST `WebError` path on the call that triggered it.

### 1.3 — `SERVER_MESSAGE` → wire `serverMessage` (NOT YET WIRED)

- **Fires:** `MageServerImpl.adminSendBroadcastMessage` (`:1142`) — admin broadcasts to all users. Carrier is a `ChatMessage` with `MessageColor.RED` (warn) or `MessageColor.BLUE` (info).
- **Wire frame:** NOT YET WIRED.
- **Expected response:** none.
- **Swing-client UX:** `CallbackClientImpl.java:207-212` — modal `showMessageDialog`.
- **Current webclient state:** **Gap.** Out of 1v1 scope at any practical level (admin-only) but should be surfaced as a top-of-screen banner if/when wired. Slice S.

### 1.4 — `JOINED_TABLE` → wire `joinedTable` (NOT YET WIRED)

- **Fires:** `User.ccJoinedTable` (`User.java:267`) when a player successfully sits at a table. Per-callback type is `TABLE_CHANGE`.
- **Carrier type:** `TableClientMessage` with `roomId`, `currentTableId`, `parentTableId`, `flag` (isTournament).
- **Wire frame:** NOT YET WIRED on the game stream.
- **Expected response:** none.
- **Swing-client UX:** `CallbackClientImpl.java:215-218` — opens the table-waiting dialog.
- **Current webclient state:** **Partial.** The webclient does not consume this callback; it instead drives table state via REST polling on `/api/rooms/{id}/tables` (ADR 0007 D11). Sufficient for 1v1 today but means a player who joins via the UI sees a 1–5 second lag before the seat count refreshes. Slice M to wire as a `joinedTable` frame on the room-stream WebSocket.

### 1.5 — `START_TOURNAMENT` → wire `startTournament`

Out of 1v1 scope (multiplayer / tournament). Cataloged: fires from `User.ccTournamentStarted` (`User.java:291`). Companion ADR planned.

### 1.6 — `TOURNAMENT_INIT` → wire `tournamentInit`

Out of 1v1 scope. Upstream `TODO: unused on client` (`ClientCallbackMethod.java:24`). Documented as "explicitly unused upstream" so we don't waste a slice on it.

### 1.7 — `TOURNAMENT_UPDATE` → wire `tournamentUpdate`

Out of 1v1 scope. Same upstream TODO as 1.6.

### 1.8 — `TOURNAMENT_OVER` → wire `tournamentOver`

Out of 1v1 scope. Same upstream TODO as 1.6.

### 1.9 — `START_DRAFT` → wire `startDraft`

Out of 1v1 scope (draft format). Companion ADR planned.

### 1.10 — `SIDEBOARD` → wire `sideboard`

- **Fires:** `User.ccSideboard` (`User.java:299`) when a sideboarded match enters its post-game-1 sideboarding window. **Does fire in 1v1** when the table's match config has `numSeats=2 && winsNeeded≥2` and game 1 has ended.
- **Carrier type:** `TableClientMessage` with `deck` (a `DeckView`), `currentTableId`, `parentTableId`, `time` (timer seconds), `flag` (limited).
- **Wire frame:** `sideboard` (since schema 1.14).
- **Wire data shape:** `WebSideboardInfo` — `deck.{name, mainList[], sideboard[]}`, `tableId`, `parentTableId`, `time`, `limited`. `mainList` / `sideboard` are arrays of `WebSimpleCardView` (`{id, name, expansionSetCode, cardNumber, usesVariousArt}`).
- **Expected response:** `POST /api/tables/{tableId}/deck` (REST, not WS) with a `WebDeckCardLists` body. Optional `?update=true` switches dispatch from final submit to autosave. See §5.
- **Legal user gestures:** drag/click cards between main and sideboard; submit.
- **Swing-client UX:** `CallbackClientImpl.java:425-435` — opens a deck-editor window in `SIDEBOARDING` mode with countdown timer.
- **Current webclient state:** **Covered.** Frame plumbed through `webclient/src/game/store.ts:257` (`pendingSideboard`); `SideboardModal` renders off the state; submit POSTs to the table-deck endpoint.
- **Notes:** carrier `flag` field doubles for two purposes — `false` = sideboarding, `true` = limited-sideboarding (build-then-sideboard). 1v1 constructed only ever sees `false`; treat `true` as out-of-scope per slice 14.

### 1.11 — `CONSTRUCT` → wire `construct`

Out of 1v1 scope (limited / draft constructing). Cataloged: fires from `User.ccConstruct` (`User.java:324`).

### 1.12 — `DRAFT_OVER` → wire `draftOver`

Out of 1v1 scope.

### 1.13 — `DRAFT_INIT` → wire `draftInit`

Out of 1v1 scope.

### 1.14 — `DRAFT_PICK` → wire `draftPick`

Out of 1v1 scope.

### 1.15 — `DRAFT_UPDATE` → wire `draftUpdate`

Out of 1v1 scope.

### 1.16 — `SHOW_TOURNAMENT` → wire `showTournament`

Out of 1v1 scope.

### 1.17 — `WATCHGAME` → wire `watchGame`

Out of 1v1 scope (spectator). Phase-3 ADR 0007 D9 reserves the slot; the `/api/games/{id}/stream` endpoint already serves spectator views read-only. No deep spec until spectator UI ships.

### 1.18 — `VIEW_LIMITED_DECK` → wire `viewLimitedDeck`

Out of 1v1 scope (limited).

### 1.19 — `VIEW_SIDEBOARD` → wire `viewSideboard` (NOT YET WIRED)

- **Fires:** `User.ccViewSideboard` (`User.java:316`) when the controlling player asks to view their own sideboard mid-game (e.g. for Wishes — `Living Wish`, `Burning Wish`, `Glittering Wish` in 1v1 with sideboard access enabled).
- **Carrier type:** `TableClientMessage` with `gameId`, `playerId`.
- **Wire frame:** NOT YET WIRED.
- **Expected response:** none — opens a side window.
- **Swing-client UX:** `CallbackClientImpl.java:445-448` → `viewSideboard` opens a sideboard window via `GamePanel.openSideboardWindow`.
- **Current webclient state:** **Gap.** Only matters in 1v1 if Wish-cards are in the meta the user is testing. Slice M; deferred until the Wish use-case surfaces.

### 1.20 — `USER_REQUEST_DIALOG` → wire `userRequestDialog` (NOT YET WIRED)

- **Fires:** any flow that needs an opt-in confirmation outside the game's own dialog channel — `GameSessionPlayer.requestPermissionToRollbackTurn` (`GameSessionPlayer.java:133`) and `requestPermissionToSeeHandCards` (`:160`) are the two in-game callers. Per-callback type is `DIALOG`.
- **Carrier type:** `UserRequestMessage` (`Mage.Common/.../view/UserRequestMessage.java:13`) — `title`, `message`, `relatedUserId/Name`, `gameId`, `button1Text`/`button1Action` (a `PlayerAction`), `button2Text`/`button2Action`.
- **Wire frame:** NOT YET WIRED.
- **Expected response:** the picked button's `PlayerAction` is sent via `sendPlayerAction`. Cancel = no action.
- **Legal user gestures:** click button 1, click button 2, dismiss.
- **Swing-client UX:** `CallbackClientImpl.java:493-495` → `frame.showUserRequestDialog`. Standard two-button modal.
- **Current webclient state:** **Gap.** In 1v1 it surfaces (a) when the opponent requests rollback (rollback-allowed tables) and (b) when a watcher requests permission to see hands. (a) is rarely encountered against bots; (b) is spectator-only. Slice M with a `userRequestDialog` frame carrying `{title, message, button1: {text, action}, button2: {text, action}}`.

### 1.21 — `GAME_REDRAW_GUI` → wire `gameRedrawGUI` (NOT YET WIRED)

- **Fires:** `CLIENT_SIDE_EVENT` type — emitted by the upstream Swing client itself for layout invalidation (e.g. after scrollbars appear, after resize). Has no game-state semantics.
- **Carrier type:** none (data is `null`).
- **Wire frame:** **intentionally not wired.** Phase-3 facade should drop it; webclient redraws are React's job.
- **Notes:** verifiable at `WebSocketCallbackHandler.mapToFrame` `default → null`. No action needed.

### 1.22 — `START_GAME` → wire `startGame`

- **Fires:** `User.ccGameStarted` (`User.java:275`) when a table moves from `STARTING` to `DUELING`. Both sides of a 1v1 receive this once per game.
- **Carrier type:** `TableClientMessage` with `currentTableId`, `parentTableId`, `gameId`, `playerId` (the recipient's seat ID).
- **Wire frame:** `startGame` (since schema 1.7).
- **Wire data shape:** `WebStartGameInfo` — `tableId`, `gameId`, `playerId`.
- **Expected response:** none — it's a transition signal. Webclient navigates into the game window and opens the per-game WebSocket.
- **Legal user gestures:** none direct.
- **Swing-client UX:** `CallbackClientImpl.java:116-138` — calls `frame.showGame(...)`. Has a reconnect-fix that backfills `firstGameData` when `GAME_INIT` raced ahead of `START_GAME`.
- **Current webclient state:** **Covered.** `webclient/src/game/store.ts:246` stashes into `pendingStartGame`; the App auto-navigates and mounts `Game.tsx`.
- **Notes:** in 1v1 against an AI, the AI's seat fires this same callback but the engine's bot-controller consumes it without webclient involvement.

### 1.23 — `GAME_INIT` → wire `gameInit`

See §6.1.

### 1.24 — `GAME_UPDATE_AND_INFORM` → wire `gameInform`

See §6.3.

### 1.25 — `GAME_INFORM_PERSONAL` → wire `gameInformPersonal`

- **Fires:** `Player.informPlayer` (engine surface, also reachable through ability effects) when an effect needs to reveal something only to the controlling player — e.g. "you scry: [card name]", "you reveal: [card name] from your library". Per-callback type is `MESSAGE`.
- **Carrier type:** `GameClientMessage` carrying only `gameView` + `message`.
- **Wire frame:** `gameInformPersonal` (since schema 1.10).
- **Wire data shape:** `WebGameClientMessage` — `gameView`, `message`. Other fields are zero-defaults.
- **Expected response:** none.
- **Legal user gestures:** dismiss / click OK.
- **Swing-client UX:** `CallbackClientImpl.java:416-422` → modal `showMessageDialog` titled "Game message".
- **Current webclient state:** **Covered.** Renders as a modal `InformDialog` with title "Info" via `GameDialog.tsx:175`.
- **Notes:** **the modal blocks board interaction.** This is fine for one-shot reveals but if upstream fires several in quick succession the user clicks through a chain — verify scrolling reveals (Brainstorm, Sensei's Divining Top) don't pile these up.

### 1.26 — `GAME_ERROR` → wire `gameError`

- **Fires:** any rules-engine path that wants to surface an explicit error to the player (illegal cast, bad target, etc.). Per-callback type is `MESSAGE`.
- **Carrier type:** **bare `String`**, not a `GameClientMessage` (one of two callbacks with a non-uniform shape).
- **Wire frame:** `gameError` (since schema 1.10). The mapper synthesizes a `WebGameClientMessage` with only `message` populated for renderer uniformity (`WebSocketCallbackHandler.mapGameError`, `:319`).
- **Wire data shape:** `WebGameClientMessage { message }`, all other fields zero-defaults.
- **Expected response:** none.
- **Swing-client UX:** `CallbackClientImpl.java:267-269` → `frame.showErrorDialog` — modal red error.
- **Current webclient state:** **Covered.** Renders as `InformDialog` titled "Error" via `GameDialog.tsx:177`.
- **Notes:** in 1v1 this fires **frequently** during click-to-cast bring-up — bad mana payment, illegal target, no priority. The current modal is acceptable for slice 14 but should eventually move to a non-blocking toast (slice S).

### 1.27 — `GAME_UPDATE` → wire `gameUpdate`

See §6.2.

### 1.28 — `GAME_TARGET` → wire `gameTarget`

- **Fires:** `GameSessionPlayer.target` (`:56`) → `Game.fireSelectTargetEvent` (`GameImpl.java:3112`, `:3119`, `:3141`). Comes from any `Player.chooseTarget(...)` upstream call — spell targeting, ability targeting, end-of-turn discard, scry-style "choose a card" prompts. Per-callback type is `DIALOG`.
- **Carrier type:** `GameClientMessage(gameView, options, message, cardsView, targets, required)`.
- **Wire frame:** `gameTarget` (since schema 1.10).
- **Wire data shape:** `WebGameClientMessage` — `gameView`, `message`, `targets[]` (eligible UUIDs), `cardsView1` (eligible cards as a UUID→`WebCardView` map; populated when the prompt is over a card collection like "choose a card from your hand" or "from your graveyard"), `flag` (= `required`; if `false` the player may skip).
- **Expected response:** `playerResponse{kind:"uuid", value:<targetUUID>}` for a pick. Skip (when `flag === false`) sends the all-zeros UUID `00000000-0000-0000-0000-000000000000`.
- **Legal user gestures:**
  - Click a row in the picker (when `cardsView1` is populated).
  - Click an eligible target on the board — permanent / player / hand-card / graveyard-card. (Slice 15 ships clicks on board permanents and players for ID-bearing targets.)
  - Click "Skip" when not required.
- **Swing-client UX:** `CallbackClientImpl.java:282-290` → `GamePanel.pickTarget`. Opens a non-modal `PickTargetDialog` and **simultaneously** marks valid targets on the board (yellow border in the upstream client) so the player can click either. Cmd+click holds priority. The dialog has Skip + OK buttons; Skip sends the zero UUID, OK sends the latest selection.
- **Current webclient state:** **Partial.** `GameDialog.tsx:199` (`TargetDialog`) renders a non-blocking side panel showing eligible cards from `cardsView1`; if `cardsView1` is empty it walks `targets[]` and resolves each to a friendly tuple via `resolveTarget` (`:24`). Board click-to-target is wired for permanents and players (`Game.tsx:235-249`) but **not** for hand-cards / graveyard-cards / exile-cards / stack objects. Skip is wired.
- **Notes:**
  - When the engine asks for a creature *or* player target, both `cardsView1` and `targets[]` are populated; the picker shows cards, the side-panel-resolved players, and the board can click-route either. **Verified working** for damage spells (Lightning Bolt) in slice 15.
  - When the engine asks for "target card in graveyard", `cardsView1` is the graveyard cards. Webclient renders the picker; clicking the graveyard chip on the player area should also dispatch — **gap** today (graveyard chips are display-only).
  - **Multi-target spells** (Cone of Flame, Fiery Confluence) fire `GAME_TARGET` repeatedly, once per target slot. The engine clears `targets` between slots; the dialog's `messageId` changes each time. Webclient handles this correctly because the dialog rerenders on each new `messageId`.
  - **Distinct-target enforcement** is upstream-side: the engine computes `targets[]` excluding already-picked IDs and re-fires `GAME_TARGET`. No webclient logic needed beyond honoring the new list.

### 1.29 — `GAME_CHOOSE_ABILITY` → wire `gameChooseAbility`

- **Fires:** `GameSessionPlayer.chooseAbility` (`:71`) → `Game.fireGetChoiceEvent` (`GameImpl.java:3092`) and `Game.fireGetModeEvent` (`:3104`). Two distinct prompts share this callback shape:
  - **Multi-ability picker** — a permanent has several activated abilities (most planeswalkers, modal artifacts) and the player tapped/clicked to activate; the engine asks which.
  - **Mode picker** — a modal spell (Charm cycle, Cryptic Command "choose two", Decree of Pain) where each mode is presented with its rule text. **Includes ordering of triggered abilities** (when ≥2 trigger simultaneously).
- **Carrier type:** `AbilityPickerView` (the **second** non-uniform callback alongside `GAME_ERROR`) — `gameView`, `objectName`, `abilities` or `modes`, `message`.
- **Wire frame:** `gameChooseAbility` (since schema 1.12).
- **Wire data shape:** `WebAbilityPickerView` — `gameView`, `message`, `choices` (a `LinkedHashMap<UUID, String>` preserving upstream insertion order; UUIDs are ability IDs).
- **Expected response:** `playerResponse{kind:"uuid", value:<abilityUUID>}`.
- **Legal user gestures:** click a row in the picker.
- **Swing-client UX:** `CallbackClientImpl.java:304-311` → `GamePanel.pickAbility`. Modal numbered list (each entry pre-prefixed with its index — see `AbilityPickerView.java:45`).
- **Current webclient state:** **Covered.** `GameDialog.tsx:425` (`AbilityPickerDialog`) — modal list of buttons, each row's label is the upstream-numbered rule text.
- **Notes:**
  - Modal-spell mode picking and trigger-ordering both come through here. The trigger-ordering case fires once per overlapping trigger pair; the player picks "this trigger first", then the engine re-fires for the next pair. **Auto-order toggles** in §4 (`TRIGGER_AUTO_ORDER_*`) suppress these prompts.
  - The labels are pre-numbered upstream (`"1. Activate ability A"`, `"2. Activate ability B"`); the webclient passes them through. If a future redesign wants un-numbered rows, strip the leading `\d+\. ` regex client-side.

### 1.30 — `GAME_CHOOSE_PILE` → wire `gameChoosePile` (NOT YET WIRED)

- **Fires:** `GameSessionPlayer.choosePile` (`:79`) → `Game.fireChoosePileEvent` (`GameImpl.java:3174`). Pile-splitting effects only — Fact or Fiction, Sword of Body and Mind's milling-into-pile interaction, Steam Augury.
- **Carrier type:** `GameClientMessage(gameView, null, message, pile1, pile2)` — two `CardsView`s.
- **Wire frame:** **NOT YET WIRED.** No mapper case.
- **Wire data shape (proposed):** `WebGameClientMessage` extended with a second `cardsView2` field. The `WebGameClientMessage` Java record at `Mage.Server.WebApi/.../dto/stream/WebGameClientMessage.java` already has the field (it mirrors upstream); the mapper just doesn't populate it for this callback path.
- **Expected response:** `playerResponse{kind:"boolean", value:true}` for pile-1, `false` for pile-2 (verified in `PlayerImpl.setResponseBoolean` lookup path; `PickPileDialog` returns true/false to the engine).
- **Swing-client UX:** `Mage.Client/.../dialog/PickPileDialog.java` — modal showing both piles side by side, two buttons.
- **Current webclient state:** **Gap.** Rare in 1v1 (only Fact-or-Fiction-style cards) but blocks if those cards are in the deck. Slice M.
- **Notes:** mapper extension is a one-liner; the renderer needs a new `PilePickerDialog` component showing both pile arrays. Tag it with schema 1.15+ when it lands.

### 1.31 — `GAME_CHOOSE_CHOICE` → wire `gameChooseChoice`

- **Fires:** `GameSessionPlayer.chooseChoice` (`:87`) → `Game.fireChooseChoiceEvent` (`GameImpl.java:3166`). Used for replacement-effect ordering ("which replacement effect applies first?"), counter-type picks ("a +1/+1 or a -1/-1 counter?"), color picks, name-a-card prompts.
- **Carrier type:** `GameClientMessage(gameView, null, choice)` where `choice: Choice` carries `message`, `subMessage`, `choices: Map<String, String>`, `required`.
- **Wire frame:** `gameChooseChoice` (since schema 1.12).
- **Wire data shape:** `WebGameClientMessage` with the `choice: WebChoice` field populated. `WebChoice` = `{message, subMessage, required, choices: Map<key, label>}`.
- **Expected response:** `playerResponse{kind:"string", value:<choiceKey>}`. Skip-when-optional sends the empty string.
- **Legal user gestures:** click a row; click skip when not required.
- **Swing-client UX:** `Mage.Client/.../dialog/PickChoiceDialog.java` — modal with a list, optional sub-message, optional search/sort hints.
- **Current webclient state:** **Covered.** `GameDialog.tsx:358` (`ChoiceDialog`) — modal list of buttons keyed by `choices`. Skip is wired when `required === false`.
- **Notes:**
  - Upstream's `Choice` has additional fields (`isManaColorChoice`, `searchEnabled`, `sortEnabled`, `hintData`) that the wire DTO **does not yet expose** — see CHANGELOG 1.12. For 1v1, the search-enabled flag matters when the prompt is "name a card" (Pithing Needle, Cabal Therapy). The webclient currently shows the full list without a search box; with thousands of card names this is unusable. Slice M to extend `WebChoice` and the renderer.
  - `subMessage` rendered as a smaller tag below the title; verified working in slice 7 dialog tier.

### 1.32 — `GAME_ASK` → wire `gameAsk`

- **Fires:** `GameSessionPlayer.ask` (`:49`) → `Game.fireAskPlayerEvent` (`GameImpl.java:3083`). Catch-all yes/no question — `chooseUse(Outcome, message, source, game)` and friends. **Includes the mulligan prompt** (see §8) and "do you want to pay {1}?" / "do you want to put a counter on…?" / "do you want to draw two cards?" prompts.
- **Carrier type:** `GameClientMessage(gameView, options, message)`.
- **Wire frame:** `gameAsk` (since schema 1.10).
- **Wire data shape:** `WebGameClientMessage` — `gameView`, `message`. `options` is upstream-side metadata that includes button-text overrides (`UI.left.btn.text`, `UI.right.btn.text`); these are **not** mapped onto the wire today (gap).
- **Expected response:** `playerResponse{kind:"boolean", value:true|false}`.
- **Legal user gestures:** click Yes / No.
- **Swing-client UX:** `CallbackClientImpl.java:272-279` → `GamePanel.ask`. Inline two-button feedback panel (not a modal — appears in the always-visible feedback strip).
- **Current webclient state:** **Covered.** `GameDialog.tsx:182` (`YesNoDialog`) — modal with Yes / No buttons. Title hardcoded "Question" except when `dialog.method === 'gamePlayMana'` (sharing the same component).
- **Notes:**
  - Mulligan uses this with `options["UI.left.btn.text"] = "Mulligan"` / `"UI.right.btn.text"] = "Keep"` (`HumanPlayer.java:404`). Webclient shows generic Yes/No today. **The user can't tell which button means "keep" without reading the message** — bug from last play session. Slice S to thread button-text overrides through.
  - **Auto-answer toggles** (`REQUEST_AUTO_ANSWER_*`, see §4) suppress repeat asks of the same prompt.
  - Currently rendered as a backdrop modal, blocking board clicks. For "do you want to pay {1}?" mid-spell-resolution this is correct; for the mulligan loop a modal is fine. For "may you put a creature into play?" type prompts where the player wants to look at the board first, a non-blocking variant might be better. Defer.

### 1.33 — `GAME_SELECT` → wire `gameSelect`

- **Fires:** `GameSessionPlayer.select` (`:65`) → `Game.fireSelectEvent` (`GameImpl.java:3047`). The "free priority — do something" prompt. Also fires for **declare attackers** ("Select attackers") and **declare blockers** ("Select blockers") with extra `options` carrying `POSSIBLE_ATTACKERS`/`POSSIBLE_BLOCKERS` UUID lists (see §7).
- **Carrier type:** `GameClientMessage(gameView, options, message)`.
- **Wire frame:** `gameSelect` (since schema 1.10).
- **Wire data shape:** `WebGameClientMessage` — `gameView`, `message`. **`options` is dropped on the wire** — major gap for combat (see §7 + §99).
- **Expected response:** depends:
  - Free priority: `playerResponse{kind:"uuid", value:<objectId>}` to play/cast/activate a particular object, **or** a `playerAction` (pass-priority modes), **or** boolean `true` from clicking the OK button to pass a single priority window.
  - Declare attackers: `playerResponse{kind:"uuid", value:<attackerId>}` to mark/unmark; click OK / press Enter / send `boolean true` to commit.
  - Declare blockers: same, but blocker IDs.
- **Legal user gestures:**
  - Free priority: click a hand card, click a permanent on the board, press a pass-priority hotkey, click the OK button.
  - Declare attackers: click each creature you want to attack with (toggles), click "All attack" if upstream is providing `SPECIAL_BUTTON: "All attack"`, click OK.
  - Declare blockers: click each blocker, then click the attacker it blocks.
- **Swing-client UX:** `CallbackClientImpl.java:294-301` → `GamePanel.select`. Updates the feedback strip with the message; the **board itself is the input surface** — click-to-cast / click-to-attack / click-to-block. The `options` map carries a "POSSIBLE_ATTACKERS"/"POSSIBLE_BLOCKERS" UUID list which the upstream client uses to highlight legal creatures and to enforce that clicks on illegal creatures get rejected client-side.
- **Current webclient state:** **Partial → Combat gap.**
  - Free priority: **covered** (slice 14). `GameDialog.tsx:89` deliberately renders nothing for `gameSelect`; the player interacts with the board, and click handlers in `Game.tsx:242-249` dispatch via `sendObjectClick`.
  - Declare attackers: **gap.** No combat-aware UI; the "Select attackers" prompt arrives as a normal `gameSelect` and the user has no way to know they're in declare-attackers vs free priority. Click a creature → server interprets as "declare attacker". Server fires `GAME_INFORM` with the new combat group, `gameView.combat[]` updates, but the webclient renders combat groups as static rows (`webGameViewSchema` has `combat`) — **no attacker chips marked, no defender arrows, no "all attack" button**.
  - Declare blockers: **gap.** Same surface; clicking a blocker fires upstream's `selectCombatGroup` flow (`HumanPlayer.java:2072`) which **immediately** fires another `GAME_TARGET` to pick which attacker the blocker blocks. Webclient handles the `GAME_TARGET` follow-up correctly (slice 15) but lacks the visual feedback for "this creature is blocking that one".
- **Notes:**
  - The user has no signal that the engine is asking for a combat decision vs free priority. The `message` text says "Select attackers" / "Select blockers" but it's only on the dialog (which renders nothing for `gameSelect`). **Highest-priority gap** — see §7 + §99 BLOCKING.
  - Upstream's `options` map carries `POSSIBLE_ATTACKERS` / `POSSIBLE_BLOCKERS` UUID lists and `SPECIAL_BUTTON: "All attack"` text. These are dropped at the mapper today — `WebSocketCallbackHandler.mapClientMessage` (`:302`) only forwards `gameView` and `message`. Wire format extension needed (slice L).
  - The **"All attack"** flow uses a special string response: clicking the button sends `playerResponse{kind:"string", value:"special"}`, which `HumanPlayer.java:1799-1822` interprets as "declare every legal attacker against the default defender". 1v1 has only one defender so the default is always the opponent. Slice M to add the button + the string response.

### 1.34 — `GAME_PLAY_MANA` → wire `gamePlayMana`

- **Fires:** `GameSessionPlayer.playMana` (`:95`) → `Game.firePlayManaEvent` (`GameImpl.java:3063`). Fires when an unpaid mana cost remains and auto-payment cannot resolve it — e.g. casting a multicolored spell with conditional mana, or `MANA_AUTO_PAYMENT_OFF` / `_RESTRICTED_*` toggled. The player must manually pay each mana.
- **Carrier type:** `GameClientMessage(gameView, options, message)`.
- **Wire frame:** `gamePlayMana` (since schema 1.10).
- **Wire data shape:** `WebGameClientMessage` — `gameView`, `message` (e.g. `"Pay {1}{R}"`).
- **Expected response:** **two-mode contract**:
  - The expected response is a yes/no `boolean` per upstream's `setResponseBoolean` path (`HumanPlayer.java` logic) — **but the player's actual gesture is to click a mana source** on the battlefield (a tapped land, a mana ability) which dispatches as `playerResponse{kind:"uuid", value:<sourceId>}`. Upstream's `PlayerImpl` correlates: when the response is a UUID, it activates the source's mana ability; when the response is a `boolean false`, it cancels the cast and refunds.
  - Wire-side, the webclient has used `boolean` only for "Yes/No proceed" historically.
- **Legal user gestures:**
  - Click a mana-producing permanent on the battlefield (tap to add mana). UUID response.
  - Click "Cancel" / "No" — boolean false. Upstream rolls back any partial payment.
- **Swing-client UX:** `CallbackClientImpl.java:334-341` → `GamePanel.playMana`. Updates the feedback strip with the cost owed; the **board** is the input — tap your lands. Cancel button on the strip refunds.
- **Current webclient state:** **Gap.** `GameDialog.tsx:153` renders `YesNoDialog` for `gamePlayMana` — wrong. The yes-button does nothing useful (the engine isn't waiting for "yes I want to pay"; it's waiting for a source pick or a cancel). **Verified bug in last play session** — manual mana payment is unusable.
- **Notes:**
  - Slice priority L. Two changes: (a) when a `gamePlayMana` dialog is pending, the modal becomes a side panel with only a Cancel button; (b) battlefield clicks dispatch as UUIDs while it's pending (analogous to slice 15's `gameTarget` handling).
  - The default mana auto-payment is `ON` (engine path doesn't fire `GAME_PLAY_MANA` at all when it can auto-resolve). 1v1 vs AI rarely hits this unless the user toggles `MANA_AUTO_PAYMENT_OFF`. **But it always fires for** payments that need a player-side decision: which color does this hybrid land tap for? which mana is owed by which cost? Conditional mana (Cavern of Souls, Ancient Ziggurat) is a common trigger.

### 1.35 — `GAME_PLAY_XMANA` → wire `gamePlayXMana`

- **Fires:** `GameSessionPlayer.playXMana` (`:102`) → `Game.firePlayXManaEvent` (`GameImpl.java:3071`). The X-cost spell payment loop — Fireball, Walking Ballista, Heliod's Pilgrim. Fires repeatedly until the player commits or cancels.
- **Carrier type:** `GameClientMessage(gameView, null, message)`.
- **Wire frame:** `gamePlayXMana` (since schema 1.12).
- **Wire data shape:** `WebGameClientMessage` — `gameView`, `message` (e.g. `"Pay X mana — current X = 3. Continue paying or cast?"`).
- **Expected response:** `playerResponse{kind:"boolean", value:true|false}` — `true` continues paying (and the player taps another mana source for the next +1 to X), `false` finalizes / cancels.
- **Legal user gestures:** click "More" to keep paying, click "Cast" to commit, click "Cancel" to roll back.
- **Swing-client UX:** `CallbackClientImpl.java:344-351` → `GamePanel.playXMana`. Same feedback-strip + board-input pattern as `GAME_PLAY_MANA`.
- **Current webclient state:** **Partial.** `GameDialog.tsx:154` renders `YesNoDialog` (Yes = continue, No = stop). Functional but the prompt text is engine-default; no explicit "current X = N" indicator.
- **Notes:** like `GAME_PLAY_MANA` this also requires battlefield-click integration to pay the next mana — user clicks a land, engine auto-fires the next `GAME_PLAY_XMANA`. The current modal blocks board clicks; same fix as 1.34.

### 1.36 — `GAME_GET_AMOUNT` → wire `gameSelectAmount`

- **Fires:** `GameSessionPlayer.getAmount` (`:110`) → `Game.fireGetAmountEvent` (`GameImpl.java:3149`). Numeric prompts — divide damage among targets ("how much damage to which target?" — Earthquake-style fires one per target with `min`/`max` carrying the remaining damage), counter amounts, life-payment amounts (Ad Nauseam, Necropotence).
- **Carrier type:** `GameClientMessage(gameView, null, message, min, max)`.
- **Wire frame:** `gameSelectAmount` (since schema 1.10).
- **Wire data shape:** `WebGameClientMessage` — `gameView`, `message`, `min`, `max`.
- **Expected response:** `playerResponse{kind:"integer", value:<n>}` where `min ≤ n ≤ max`.
- **Legal user gestures:** type a number; click +/- if the renderer offers them; submit.
- **Swing-client UX:** `Mage.Client/.../dialog/PickNumberDialog.java` — modal with a number spinner.
- **Current webclient state:** **Covered.** `GameDialog.tsx:322` (`AmountDialog`) — input clamped to `[min, max]`, submit button disabled while invalid.
- **Notes:**
  - Re-keyed on `messageId` so a new dialog re-mounts and `useState` initializer picks up the new defaults (slice 7 fix).
  - **Multi-target damage division** (Cone of Flame: "3 damage to first, 2 to second, 1 to third") chains: `GAME_TARGET` for first → `GAME_GET_AMOUNT` (min=1, max=3) → `GAME_TARGET` for second → `GAME_GET_AMOUNT`. Webclient handles this correctly in slice 7+15.
  - **Damage assignment among multiple blockers** (5/5 attacker blocked by three 1/1s): the engine fires `GAME_GET_AMOUNT` per blocker in attacking-player-chosen order. See §7.4.

### 1.37 — `GAME_GET_MULTI_AMOUNT` → wire `gameSelectMultiAmount` (NOT YET WIRED)

- **Fires:** `GameSessionPlayer.getMultiAmount` (`:118`) → `Game.fireGetMultiAmountEvent` (`GameImpl.java:3157`). Multi-input numeric prompt — used for things like the modern-rules version of damage assignment among blockers in trample, multi-target divide-X spells, and any prompt where the player must allocate a budget of N across M slots.
- **Carrier type:** `GameClientMessage(gameView, options, messages: List<MultiAmountMessage>, min, max)` where each `MultiAmountMessage` carries a per-slot label, default value, and per-slot min/max.
- **Wire frame:** **NOT YET WIRED.** No mapper case.
- **Wire data shape (proposed):** `WebGameClientMessage` extended with a `multiAmount` field carrying the per-slot data.
- **Expected response:** `playerResponse{kind:"string", value:"<csv-of-ints>"}` — upstream parses the comma-separated string back into per-slot integers (verified in `setResponseString` paths).
- **Swing-client UX:** `Mage.Client/.../dialog/PickMultiNumberDialog.java` — modal with N number spinners, total counter at the bottom enforcing the budget.
- **Current webclient state:** **Gap.** Rare in 1v1 but blocks any deck running multi-divide-X spells (Hurricane, Squall Line) or trample blocker assignment with multiple blockers ordered by attacker. Slice M.

### 1.38 — `GAME_OVER` → wire `gameOver`

See §6.4.

### 1.39 — `END_GAME_INFO` → wire `endGameInfo`

See §6.5.

### 1.40 — `REPLAY_GAME` / `REPLAY_INIT` / `REPLAY_UPDATE` / `REPLAY_DONE` → replay frames

Out of 1v1 scope (replay is unsupported per upstream comment, `ClientCallbackMethod.java:69`). Cataloged for completeness; companion ADR planned if/when replay surfaces.

---

## §2. Inbound — free-priority object click

### 2.1 — `sendObjectClick(uuid)`

When the controlling player has priority and **no dialog is pending**, clicking a hand card or a permanent on the battlefield dispatches the object's UUID as a free-priority response. Upstream's `Player.priorityPlay()` loop polls the latest UUID via `Player.getPlayerResponse()` (the response queue mutated by `setResponseUUID`, `PlayerImpl.java:2586`) and interprets:

- **Hand card UUID** → cast the spell (or play the land in a main phase). Engine fires follow-up `GAME_TARGET` for each target slot, then either a `GAME_PLAY_MANA` loop (if auto-payment fails) or auto-pays.
- **Battlefield permanent UUID** → tap-and-activate the permanent's first activated ability. With `USE_FIRST_MANA_ABILITY_ON` toggle, mana abilities are activated; otherwise the engine asks via `GAME_CHOOSE_ABILITY` if the permanent has multiple activated abilities. With `USE_FIRST_MANA_ABILITY_OFF` (default), tapping a Forest auto-fires `{T}: add G`. Clicking a tapped permanent does nothing; clicking a permanent you don't control fires `gameError`.
- **Player UUID** (clicking your own face icon) — opens special-action dialogs in some flows; rare in 1v1.
- **Stack object UUID** — primarily used to view the stack object's details; not a "cast" gesture.

Wire-side, free-priority click and dialog-uuid-response use the same `playerResponse{kind:"uuid"}` envelope. The discriminator is `messageId === 0` for free priority (no correlation needed). `GameStream.sendObjectClick(:333)` hardcodes `messageId: 0`.

### 2.2 — Gesture coverage today

| Gesture | Webclient state | File |
|---|---|---|
| Click hand card | **Covered** (slice 14) | `Game.tsx:541-565` |
| Click battlefield permanent | **Covered** (slice 14) | `Game.tsx:470-510` |
| Click own player area | **Gap** (no special-action UI) | — |
| Click opponent player area | **Covered for targeting only** (slice 15) | `Game.tsx:323-333` |
| Click stack object | **Gap** | — |
| Click graveyard / exile / sideboard chip | **Gap** | — |

The graveyard / exile / sideboard zones render as count-only indicators currently. Clicking-into-zone (popping a card-list view, then clicking a card to select it as a target) is a slice M lift.

---

## §3. Inbound — `playerResponse` (dialog answers)

The five-kind discriminated union per ADR 0007 D6. Validation in `GameStreamHandler.handlePlayerResponse` (`:356`) is strict — `value`'s JSON type must match `kind`'s expected shape (`isTextual` for uuid/string, `isBoolean` for boolean, `isInt` for integer, object-with-fields for manaType). Coercion is **not** allowed (a string `"true"` for `kind:"boolean"` is rejected; hardening fix 2026-04-26).

### 3.1 — `kind: "uuid"`

Upstream method: `MageServerImpl.sendPlayerUUID` → `User.sendPlayerUUID` → `GameManager.sendPlayerUUID` → `GameSessionPlayer.sendPlayerUUID` → `PlayerImpl.setResponseUUID`.

Used by: `gameTarget` (target picks), `gameSelect` (free priority + declare-attackers + declare-blockers), `gameChooseAbility` (ability ID), `gamePlayMana` (mana source pick), free-priority `sendObjectClick`.

Skip token: `00000000-0000-0000-0000-000000000000` (used by `GameDialog.TargetDialog` Skip button at `:274`).

### 3.2 — `kind: "boolean"`

Upstream method: `MageServerImpl.sendPlayerBoolean` → `PlayerImpl.setResponseBoolean`.

Used by: `gameAsk` (yes/no), `gamePlayMana` (cancel), `gamePlayXMana` (continue/stop), `gameChoosePile` (pile-1 = true, pile-2 = false).

### 3.3 — `kind: "integer"`

Upstream method: `MageServerImpl.sendPlayerInteger` → `PlayerImpl.setResponseInteger`.

Used by: `gameSelectAmount`. Also used by upstream's hotkey path (F-key responses encode as integers) but the webclient does not surface F-keys today — pass-priority hotkeys go through `playerAction` instead.

### 3.4 — `kind: "string"`

Upstream method: `MageServerImpl.sendPlayerString` → `PlayerImpl.setResponseString`.

Used by: `gameChooseChoice` (choice key), `gameSelectMultiAmount` (CSV of ints), declare-attackers `"special"` (the "All attack" button), free-text prompts (rare in 1v1).

Skip token: `""` (empty string).

### 3.5 — `kind: "manaType"`

Upstream method: `MageServerImpl.sendPlayerManaType` (signature also takes a `playerId` — the player whose mana pool is being paid from, distinct from the responding player). The wire envelope is `value: { playerId: <uuid>, manaType: <enum> }` per `GameStreamHandler.dispatchManaType` (`:448`).

Used by: hybrid mana payment (`{R/G}` cost, player picks R or G); never fires in 1v1 against an AI unless the user has hybrid spells in their deck and `MANA_AUTO_PAYMENT_OFF`. **Webclient surfaces no UI for this today** — gap (slice S, ManaType pickers piggyback on the `gamePlayMana` redesign).

---

## §4. Inbound — `playerAction` (toggles + lifecycle)

The 59-value `PlayerAction` enum (`Mage/.../constants/PlayerAction.java:9`) split into two halves: 40 server-relevant actions on the wire allow-list (`PlayerActionAllowList.ALLOWED`, `:32`), 19 client-only / debug values silently rejected.

| Action | Allowed | Webclient button | Category |
|---|---|---|---|
| `PASS_PRIORITY_UNTIL_MY_NEXT_TURN` | yes | yes ("To end turn") | pass |
| `PASS_PRIORITY_UNTIL_TURN_END_STEP` | yes | yes ("Pass step") | pass |
| `PASS_PRIORITY_UNTIL_NEXT_MAIN_PHASE` | yes | yes ("To next main") | pass |
| `PASS_PRIORITY_UNTIL_NEXT_TURN` | yes | duplicate of MY_NEXT_TURN above (likely bug — F4 vs F9 distinction lost) | pass |
| `PASS_PRIORITY_UNTIL_NEXT_TURN_SKIP_STACK` | yes | no | pass |
| `PASS_PRIORITY_UNTIL_STACK_RESOLVED` | yes | yes ("Resolve stack") | pass |
| `PASS_PRIORITY_UNTIL_END_STEP_BEFORE_MY_NEXT_TURN` | yes | no | pass |
| `PASS_PRIORITY_CANCEL_ALL_ACTIONS` | yes | yes ("Cancel passes") | pass |
| `TRIGGER_AUTO_ORDER_ABILITY_FIRST` | yes | no | trigger ordering |
| `TRIGGER_AUTO_ORDER_NAME_FIRST` | yes | no | trigger ordering |
| `TRIGGER_AUTO_ORDER_ABILITY_LAST` | yes | no | trigger ordering |
| `TRIGGER_AUTO_ORDER_NAME_LAST` | yes | no | trigger ordering |
| `TRIGGER_AUTO_ORDER_RESET_ALL` | yes | no | trigger ordering |
| `ROLLBACK_TURNS` | yes (with `data: {turns: int}`) | no | lifecycle |
| `UNDO` | yes | no | lifecycle |
| `CONCEDE` | yes | yes ("Concede") | lifecycle |
| `MANA_AUTO_PAYMENT_ON` | yes | no | mana payment |
| `MANA_AUTO_PAYMENT_OFF` | yes | no | mana payment |
| `MANA_AUTO_PAYMENT_RESTRICTED_ON` | yes | no | mana payment |
| `MANA_AUTO_PAYMENT_RESTRICTED_OFF` | yes | no | mana payment |
| `USE_FIRST_MANA_ABILITY_ON` | yes | no | mana payment |
| `USE_FIRST_MANA_ABILITY_OFF` | yes | no | mana payment |
| `RESET_AUTO_SELECT_REPLACEMENT_EFFECTS` | yes | no | replacement effects |
| `REVOKE_PERMISSIONS_TO_SEE_HAND_CARDS` | yes | no | hand-share (spectator) |
| `REQUEST_PERMISSION_TO_SEE_HAND_CARDS` | yes | no | hand-share (spectator) |
| `REQUEST_PERMISSION_TO_ROLLBACK_TURN` | yes | no | rollback |
| `ADD_PERMISSION_TO_SEE_HAND_CARDS` | yes | no | hand-share |
| `ADD_PERMISSION_TO_ROLLBACK_TURN` | yes | no | rollback |
| `DENY_PERMISSION_TO_ROLLBACK_TURN` | yes | no | rollback |
| `PERMISSION_REQUESTS_ALLOWED_ON` | yes | no | rollback / hand-share |
| `PERMISSION_REQUESTS_ALLOWED_OFF` | yes | no | rollback / hand-share |
| `REQUEST_AUTO_ANSWER_ID_YES` | yes (with `data: {text: <id>}`) | no | auto-answer |
| `REQUEST_AUTO_ANSWER_ID_NO` | yes (with `data: {text: <id>}`) | no | auto-answer |
| `REQUEST_AUTO_ANSWER_TEXT_YES` | yes (with `data: {text: <prompt>}`) | no | auto-answer |
| `REQUEST_AUTO_ANSWER_TEXT_NO` | yes (with `data: {text: <prompt>}`) | no | auto-answer |
| `REQUEST_AUTO_ANSWER_RESET_ALL` | yes | no | auto-answer |
| `HOLD_PRIORITY` | yes | no (Cmd+click in upstream client) | priority hold |
| `UNHOLD_PRIORITY` | yes | no | priority hold |
| `VIEW_LIMITED_DECK` | yes | no | sideboard / limited |
| `VIEW_SIDEBOARD` | yes | no | sideboard / limited |
| `CLIENT_DOWNLOAD_SYMBOLS` | **rejected** | n/a | client-only |
| `CLIENT_QUIT_TOURNAMENT` | **rejected** | n/a | client-only |
| `CLIENT_QUIT_DRAFT_TOURNAMENT` | **rejected** | n/a | client-only |
| `CLIENT_CONCEDE_GAME` | **rejected** | n/a (use `CONCEDE` instead) | client-only |
| `CLIENT_CONCEDE_MATCH` | **rejected** | n/a (use `CONCEDE` instead) | client-only |
| `CLIENT_STOP_WATCHING` | **rejected** | n/a | client-only |
| `CLIENT_DISCONNECT_FULL` | **rejected** | n/a | client-only |
| `CLIENT_DISCONNECT_KEEP_GAMES` | **rejected** | n/a | client-only |
| `CLIENT_EXIT_FULL` | **rejected** | n/a | client-only |
| `CLIENT_EXIT_KEEP_GAMES` | **rejected** | n/a | client-only |
| `CLIENT_REMOVE_TABLE` | **rejected** | n/a | client-only |
| `CLIENT_DOWNLOAD_CARD_IMAGES` | **rejected** | n/a | client-only |
| `CLIENT_RECONNECT` | **rejected** | n/a (handled via `?since=` reconnect) | client-only |
| `CLIENT_REPLAY_ACTION` | **rejected** | n/a | client-only |
| `TOGGLE_RECORD_MACRO` | **rejected** | n/a | debug only |

**1v1 implications:**

- The five visible buttons in `ActionPanel.tsx` cover the most-common pass scenarios but **omit `PASS_PRIORITY_UNTIL_NEXT_TURN_SKIP_STACK`** (skip my untap step too — F7 in upstream) and `PASS_PRIORITY_UNTIL_END_STEP_BEFORE_MY_NEXT_TURN` (F11). Slice S to add.
- **Trigger auto-ordering** (5 actions) — without these the user gets prompted for every triggered-ability ordering decision. After the second prompt this feels like a bug. Slice S to add a "remember this order" checkbox to the `gameChooseAbility` modal that fires a `TRIGGER_AUTO_ORDER_*` action.
- **Mana auto-payment toggles** — currently always-on (engine default). User has no UI to turn them off. Acceptable for 1v1 unless the user wants conditional-mana control. Slice M.
- **`USE_FIRST_MANA_ABILITY_OFF`** — without this, clicking any creature with a tap-cost ability fires the *first* listed ability. Click a Birds of Paradise → it taps for green. The user has no way to access the "tap for any color" branch. Slice M.
- **Hand-share / rollback / auto-answer** — all out of 1v1 scope unless the user wants these features. Slice L.
- **`HOLD_PRIORITY` / `UNHOLD_PRIORITY`** — Cmd-click in upstream's client. Without this, the player can't hold priority to stack a second spell with their first (e.g. Lightning Bolt + Lightning Bolt with the second Bolt's response hidden inside the first's resolution window). Slice S in 1v1 because most plays don't need it; slice M for stack-aware play.

---

## §5. Inbound — chat, deck-submit, table actions

### 5.1 — `chatSend` (WS)

```json
{ "type": "chatSend", "chatId": "<uuid>", "message": "ggwp" }
```

Routes to `MageServerImpl.chatSendMessage`. Username filled server-side from the auth session; clients cannot spoof. `chatId` must resolve to a chat the user is subscribed to. Failure modes return in-band `streamError` (`BAD_REQUEST` / `UPSTREAM_REJECTED`).

Webclient: `GameStream.sendChat(:343)`. UI: `ChatPanel` component (live in Lobby/Game pages).

### 5.2 — `POST /api/tables/{tableId}/deck` (REST)

Body: `WebDeckCardLists`. `?update=true` = autosave (`MageServer.deckSave`); default = final submit (`MageServer.deckSubmit`). Returns 204 on success, 422 `UPSTREAM_REJECTED` on validation failure.

The webclient calls this from the sideboarding modal when the user clicks Submit. See §1.10 for the inbound trigger.

### 5.3 — Table CRUD

ADR 0006 surface; out of in-game scope but listed for completeness:

- `POST /api/rooms/{roomId}/tables` — create
- `POST /api/rooms/{roomId}/tables/{tableId}/join` — join seat
- `POST /api/rooms/{roomId}/tables/{tableId}/ai` — fill seat with AI
- `POST /api/rooms/{roomId}/tables/{tableId}/start` — start the match
- `DELETE /api/rooms/{roomId}/tables/{tableId}/seat` — leave seat

These all return 204 on success and surface upstream rejections as 422.

### 5.4 — Match-quit

`MageServerImpl.matchQuit` is invoked by `CONCEDE` upstream as a side effect; we don't need a separate inbound. Watch-stop is out of 1v1 scope.

---

## §6. Cross-cutting — game-state delivery

These callbacks are not "interactions" — they don't ask the player to do anything — but the user observes the consequences. They drive the visible state of the game window.

### 6.1 — `GAME_INIT` → `gameInit`

- **Fires:** once per game per seated player at the very start (after mulligans complete and the first turn begins). Per-callback type is `TABLE_CHANGE`.
- **Carrier type:** `GameView`.
- **Wire frame:** `gameInit` (since schema 1.7).
- **Wire data shape:** `WebGameView` — full game-state snapshot. `players[]`, `myPlayerId`, `myHand`, `stack`, `combat[]`, plus per-player `battlefield`, `graveyard`, `exile`, `sideboard`, `manaPool`, `commandList`, `life`, `wins`, `winsNeeded`, etc.
- **Webclient handling:** `applyFrame` sets `gameView`, clears `pendingDialog` defensively (`store.ts:273`).
- **Notes:** carries the full state regardless of how complex the game is. `WebGameView` flattens `WebPlayerView` for both players; the renderer picks them apart by `myPlayerId`. After reconnect with `?since=`, the server may resend `gameInit` if the buffer was cold.

### 6.2 — `GAME_UPDATE` → `gameUpdate`

- **Fires:** every state change — drawing a card, casting a spell, an effect resolving, life-total change, combat-group formation. Per-callback type is `UPDATE`.
- **Carrier type:** `GameView`.
- **Wire frame:** `gameUpdate` (since schema 1.7).
- **Wire data shape:** `WebGameView`, same as `gameInit`. Server resnapshots the entire view rather than diffing.
- **Webclient handling:** `applyFrame` replaces `gameView`, clears `pendingDialog` (`store.ts:273`). The latter is defensive: if a dialog was pending and a `gameUpdate` flies past, the engine has resolved or canceled it and the dialog is stale.
- **Notes:** type is `UPDATE` which `mustIgnoreOnOutdated` returns true for — `WebSocketCallbackHandler` may drop a `gameUpdate` that arrives out-of-order behind a newer one, but the buffered-frames replay on reconnect protects against missing the latest. There is no diff-format on the wire.

### 6.3 — `GAME_UPDATE_AND_INFORM` → `gameInform`

- **Fires:** state change + a message string the player should see. Per-callback type is `UPDATE`.
- **Carrier type:** `GameClientMessage` with `gameView` + `message`.
- **Wire frame:** `gameInform` (since schema 1.9).
- **Wire data shape:** `WebGameClientMessage` with `gameView` + `message`; other fields zero-defaults.
- **Webclient handling:** `applyFrame` sets `lastWrapped`, updates `gameView` (`store.ts:285`). The message is **rendered in the chat panel** as a game log entry on the upstream Swing client; the webclient currently shows it nowhere. **Gap.**
- **Notes:** big information pipe — all the "Lightning Bolt resolves: alice takes 3 damage", "alice's turn", "Forest enters tapped" log entries the player relies on for "what just happened?". Slice M to render `lastWrapped.message` as a dedicated game-log strip below the chat.

### 6.4 — `GAME_OVER` → `gameOver`

- **Fires:** a single game in the match has ended (1v1 single-game match → game ends = match ends; 1v1 best-of-three → fires three times max). Per-callback type is `TABLE_CHANGE`.
- **Carrier type:** `GameClientMessage`.
- **Wire frame:** `gameOver` (since schema 1.9).
- **Wire data shape:** `WebGameClientMessage` with `gameView` (final state) + `message` (winner text) + `options`.
- **Webclient handling:** stored in `lastWrapped`; `pendingDialog` cleared. The end-of-game banner / overlay is currently a TODO.
- **Notes:** the **message** here is "alice has won the game" or similar; the user relies on it. Show as a big banner at the top of the game window. Slice S.

### 6.5 — `END_GAME_INFO` → `endGameInfo`

- **Fires:** match has ended (final game in the series concluded). Per-callback type is `TABLE_CHANGE`.
- **Carrier type:** `GameEndView`.
- **Wire frame:** `endGameInfo` (since schema 1.9).
- **Wire data shape:** `WebGameEndView` — `gameInfo`, `matchInfo`, `additionalInfo`, `won`, `wins`, `winsNeeded`, `players[]`.
- **Webclient handling:** `gameEnd` set in store; `pendingDialog` cleared. End-of-match summary modal is a TODO.
- **Notes:** in 1v1 single-game this fires immediately after `gameOver`; in best-of-three it fires after the deciding game.

### 6.6 — `chatMessage` (cross-listed)

See §1.1 + §3.

---

## §7. Combat sub-flow (1v1 walkthrough)

Combat is the **single largest block** of unimplemented interaction surface — and the most error-prone because the engine drives it through `gameSelect` (free-priority shape) plus side-effects on `gameView.combat[]`. The lack of explicit "I'm in declare-attackers" signaling is why we hit several combat bugs in the last play session.

### 7.1 — Beginning-of-combat step

- Phase transitions: `PRECOMBAT_MAIN` → `BEGIN_COMBAT`.
- Engine fires a `gameUpdate` reflecting the new step.
- Each player gets priority — engine fires `GAME_SELECT` ("Pass priority").
- No combat-specific prompt yet.
- **Webclient state:** **Covered** (free-priority loop renders the phase indicator; user passes via `ActionPanel`).

### 7.2 — Declare attackers step

- Phase: `COMBAT` / step: `DECLARE_ATTACKERS`.
- Engine calls `Combat.selectAttackers(game)` (`Combat.java:261`) → `Player.selectAttackers(game, attackingPlayerId)` on the active player. `HumanPlayer.selectAttackers` (`HumanPlayer.java:1740`) loops:
  1. Compute `possibleAttackers` (legal attackers per `FilterCreatureForCombat`).
  2. Compute `options` map: `POSSIBLE_ATTACKERS: List<UUID>`, optionally `SPECIAL_BUTTON: "All attack"`.
  3. Fire `game.fireSelectEvent(playerId, "Select attackers", options)` → `GAME_SELECT` callback.
  4. Wait for response. Three response shapes:
     - `string == "special"` → "All attack" — engine declares every legal attacker.
     - UUID of a permanent → toggle attacker (or unselect if already attacking and stack is empty).
     - boolean (from OK button) or integer (F-key) → commit the current attacker set; loop exits.
  5. Per attacker selected, if there are multiple defenders (multiplayer / planeswalker present), fire **another** `GAME_TARGET` to pick the defender.
- **Wire-side state:** `WebGameView.combat[]` is updated as attackers are toggled — each `WebCombatGroupView` carries `defenderId`, `defenderName`, `attackers: { [uuid]: WebPermanentView }`, `blockers`, `blocked`.
- **Webclient state:** **Gap.**
  - Wire format strips `options.POSSIBLE_ATTACKERS` and `SPECIAL_BUTTON` — must be added (slice L).
  - No "All attack" button.
  - No visual marker for "this creature is attacking" beyond what's in `combat[]` (and even that isn't rendered prominently).
  - Clicking a creature sends its UUID as a free-priority click — server interprets correctly, but the player has no signal it worked beyond the next `gameUpdate`.

### 7.3 — Declare blockers step

- Phase: `COMBAT` / step: `DECLARE_BLOCKERS`.
- Engine calls `Combat.selectBlockers(game)` (`Combat.java:651`) → `Player.selectBlockers(source, game, defendingPlayerId)` on each defender (only the non-active 1v1 opponent).
- `HumanPlayer.selectBlockers` (`HumanPlayer.java:2010`) loops:
  1. Compute `possibleBlockers` (legal blockers per `FilterCreatureForCombatBlock`).
  2. Skip prompt entirely if `possibleBlockers` is empty.
  3. Fire `game.fireSelectEvent(playerId, "Select blockers", options)` with `options.POSSIBLE_BLOCKERS: List<UUID>` → `GAME_SELECT` callback.
  4. Wait for response:
     - boolean / integer → commit; loop exits.
     - UUID of a legal blocker → enter `selectCombatGroup(defenderId, blockerId, game)` (`HumanPlayer.java:2072`) which fires **either** an auto-pick (when there's only one attacker the blocker can block) **or** a `TargetAttackingCreature` prompt → `GAME_TARGET` callback to pick which attacker to block.
- **Webclient state:** **Gap.**
  - Same wire-format strip as 7.2.
  - The "click blocker → click attacker it blocks" two-step flow needs explicit board UI: highlight the chosen blocker, then highlight legal attackers, click one to commit.
  - Today the user clicks a blocker, the engine fires `GAME_TARGET`, the side-panel shows the eligible attackers, the user clicks. The flow technically works thanks to slice 15's board-click-targeting **but** there's no visual link between the steps and no confirmation.

### 7.4 — Damage assignment

After blockers are declared, when an attacker is blocked by ≥2 blockers, the **attacking player** chooses the blocker order (which blocker takes damage first) — important for trample, deathtouch, and "lethal-vs-2nd-blocker" calculations. Then for each blocker in order, the engine fires `GAME_GET_AMOUNT(min=N, max=remaining)` where N is the lethal damage to that blocker (or 1 if the attacker has trample-spreads-1+).

- **Engine path:** `Combat.assignDamage(...)` → `Player.assignDamage(...)`. The blocker-order pick fires as a `GAME_TARGET` ("Pick blocker order") and damage assignment fires as `GAME_GET_AMOUNT` per blocker.
- **Webclient state:** `gameTarget` and `gameSelectAmount` are both covered, so the **mechanical** flow works. The user gets a list of blockers, picks one (= position 1), then a number prompt for damage to that blocker, then another list (excluding the picked one) for position 2, etc. Trample damage to the defending player fires as a final `GAME_GET_AMOUNT`.
- **Gap:** no UI affordance making it clear "you're assigning damage to blockers in order"; the prompts are generic.

### 7.5 — End-of-combat step

- Phase: `COMBAT` / step: `END_COMBAT`.
- Each player gets priority (last instant window before postcombat main).
- Engine fires `GAME_SELECT` ("Pass priority").
- **Webclient state:** Covered.

### 7.6 — Combat-step skip toggles

`HumanPlayer.selectAttackers` and `selectBlockers` both honor `userSkipPrioritySteps`:

- `passedAllTurns` (F9), `passedUntilEndStepBeforeMyTurn` (F11) → always skip combat steps.
- `passedTurn` (F4) etc. → skip iff the user-pref `isStopOnDeclareAttackers` is false.

Webclient passes `PASS_PRIORITY_UNTIL_*` actions, but the *user pref* (`isStopOnDeclareAttackers`) is bound to the upstream `UserData` and **not** plumbed through the WebApi today. Default behavior stops on declare-attackers (good for 1v1). If we want to expose a "skip combat" toggle in webclient settings, slice L to wire `UserData` mutations.

---

## §8. Mulligan + start-of-game flow

Walking through what fires, in order, for a fresh 1v1:

1. **Match-start.** `User.ccGameStarted` fires `START_GAME` for both seats. Webclient receives `startGame`, navigates into game window, opens game stream. **§1.22**.
2. **Initial draw.** Engine draws each player's starting hand (7 cards). No callback per-card; the consolidated state arrives in `GAME_INIT`.
3. **Game init snapshot.** `GAME_INIT` fires. `WebGameView` has `myHand` populated. **§6.1**.
4. **Mulligan loop.** `Mulligan.executeMulliganPhase` (`Mulligan.java:25`) runs: starting player decides first.
   - Per player, engine fires `GAME_ASK` with message "Mulligan down to N cards?" or "Mulligan for free, draw another N cards?" + `options["UI.left.btn.text"] = "Mulligan"` / `options["UI.right.btn.text"] = "Keep"` (`HumanPlayer.java:404`). **§1.32**.
   - Player responds with `playerResponse{kind:"boolean", value:true}` to mulligan, `false` to keep.
   - If mulligan, engine reshuffles + re-draws (London mulligan: 7 cards always; player puts back N cards via `GAME_TARGET` over the new hand), fires another `GAME_ASK`.
   - Loop continues until the player keeps.
   - **Webclient state:** **Partial.** Yes/No modal works but says "Question" in the title and offers Yes/No buttons; the player has to read the prompt to know which is mulligan vs keep. **Bug from last session.** Slice S to thread `options.UI.*.btn.text` through (broader fix that helps every `GAME_ASK` with custom button text).
5. **London mulligan put-back.** When a player has mulliganed N times, after the N-th mulligan they put N cards from their hand on the bottom. Engine fires `GAME_TARGET(cardsView=hand, targets=hand-card-UUIDs, required=true)`. Player picks one card per `GAME_TARGET`; engine repeats until N picked.
   - **Webclient state:** **Covered** — same flow as end-of-turn discard (`TargetDialog` walks `cardsView1`).
6. **First draw.** No special callback; just a `gameUpdate`.
7. **First-turn priority.** Phase = `BEGINNING` / step = `UPKEEP`. Engine fires `GAME_SELECT` to whoever has upkeep priority. **§1.33**.
8. From here, the game proceeds turn-by-turn.

---

## §9. End-of-turn cleanup

End step → cleanup step. Active player must discard down to maximum hand size (default 7, modified by Reliquary Tower / Spellbook etc.).

- Engine fires `GAME_TARGET(cardsView=hand, message="Discard a card", required=true)` per excess card.
- Player picks via the target dialog or by clicking the hand-card directly (Cmd+click in upstream; webclient lacks this gesture today).
- Engine repeats until hand is at max size.

**Webclient state:** **Covered.** Slice 13 generalized `TargetDialog` to walk `cardsView1`; end-of-turn discard works identically to mulligan put-back.

**Edge case — "no maximum hand size":** when `maxHandSize` is `Integer.MAX_VALUE` (Reliquary Tower), the engine never fires the prompt. No webclient behavior change needed.

**Edge case — random discard:** "discard at random" doesn't fire a `GAME_TARGET`; engine picks the card itself and fires a `GAME_INFORM_PERSONAL` revealing the discarded card to the player.

---

## §10. Targeting taxonomy

For 1v1 spells/abilities, the kinds of target picks the engine fires (and how each is encoded):

| Kind | `cardsView1` | `targets[]` | Webclient UX | State |
|---|---|---|---|---|
| Single creature on battlefield | empty | populated with permanent UUIDs | side panel walks `targets[]` → resolve via `Game.tsx`'s permanent button → click | **Covered** |
| Single player | empty | populated with playerIds | side panel + click on player area name | **Covered** (slice 15) |
| Single planeswalker (creature-or-PW prompts) | empty | populated | same as creature-on-battlefield | **Covered** |
| Card in graveyard | populated with graveyard cards | (parallel) | TargetDialog picker | **Covered for picker; gap for direct click on graveyard chip** |
| Card in exile | populated with exile cards | (parallel) | TargetDialog picker | **Same as graveyard** |
| Card in hand (own) | populated with own hand | (parallel) | TargetDialog picker | **Covered for picker; gap for hand-card direct click** |
| Card in opponent's hand | populated (revealed) | (parallel) | TargetDialog picker | **Covered for picker; opponent's hand isn't visible on board (only count) so direct-click can't apply** |
| Card on stack (counter target) | empty | populated with stack-object UUIDs | TargetDialog walks `targets[]` → resolves to stack | **Partial** — stack isn't clickable from board |
| X-target spells | (varies; often empty) | populated; engine fires `GAME_TARGET` once per target slot | sequential dialogs | **Covered mechanically; no "1 of 3" indicator** |
| Distinct targets | engine ensures by re-firing with reduced `targets[]` | — | dialog re-renders cleanly | **Covered** |
| "Target a creature you control" / opponent-only / opponent's creature | engine pre-filters `targets[]` | — | renderer is naive — shows whatever the engine sent | **Covered (engine handles legality)** |
| Card with "from a zone you choose" picks | varies | varies | — | **Gap depends on zone** |
| Multi-zone picks (Tinker — sacrifice from battlefield to fetch from library) | engine fires sequential prompts | — | sequential | **Covered mechanically** |
| Mode picks (Charm) | n/a — comes through `GAME_CHOOSE_ABILITY` | — | AbilityPicker | **Covered** |

**Resolution helper (`GameDialog.tsx:24`, `resolveTarget`)** walks every place an ID might appear: `players[]`, `myHand`, every player's `battlefield`, `graveyard`, `exile`, `sideboard`. Falls back to a short-id stub. **Stack objects** are not in this walk yet — slice S.

**Click-routing (`Game.tsx:242-249`)** dispatches to `targetDialog.messageId` only for IDs in `eligibleTargetIds`. Right now permanents and players are wired; hand-cards, graveyard chips, stack objects are not. Click on board → click target dialog rows is the consistent escape hatch.

---

## §99. Gap summary (sorted by 1v1 impact)

Each gap has: ID, severity, one-line description, slice size (S/M/L), acceptance criterion.

### BLOCKING — without these, common 1v1 plays fail or feel broken

- **B1.** Combat-aware UI for declare-attackers / declare-blockers. Slice **L**. **Acceptance:** during `DECLARE_ATTACKERS` step, the user sees a banner "Declare attackers — click creatures to attack with, OK when done"; selected attackers are visually marked; an OK button commits. During `DECLARE_BLOCKERS`, blockers are linked to the attacker they block. Wire-format extension to forward `options.POSSIBLE_ATTACKERS` / `POSSIBLE_BLOCKERS` / `SPECIAL_BUTTON` and bump schema to 1.15+. (§1.33, §7.)
- **B2.** Manual mana payment (`gamePlayMana` + `gamePlayXMana`) — modal currently blocks board clicks; wrong gesture model. Slice **L**. **Acceptance:** when a `gamePlayMana` dialog is pending, render a side-panel with the cost owed + Cancel button; battlefield clicks dispatch as UUIDs to upstream's mana-source path; `gamePlayXMana` shows current X and More/Cast/Cancel. (§1.34, §1.35.)
- **B3.** `gameInform` message rendering. Slice **M**. **Acceptance:** every `gameInform` frame's `message` appears in a game-log strip below the chat. Without this the player has no record of what just happened. (§6.3.)
- **B4.** `gameAsk` button-text overrides. Slice **S**. **Acceptance:** when upstream's `options` carries `UI.left.btn.text` / `UI.right.btn.text`, the wire format forwards them and the modal renders the upstream-provided labels. Mulligan loop becomes intelligible. (§1.32, §8.)
- **B5.** `gameOver` end-of-game banner / `endGameInfo` end-of-match summary. Slice **S**. **Acceptance:** game-end shows a centered banner with `lastWrapped.message`; match-end shows a summary modal reading `gameEnd.{matchInfo, won, wins/winsNeeded}`. Today both are stored in the store but never rendered. (§6.4, §6.5.)

### NEEDED — required for full coverage but rarer in 1v1

- **N1.** `gameChoosePile` wiring — Fact or Fiction-style pile picks. Slice **M**. Mapper extension + `PilePickerDialog` component. Bump schema. (§1.30.)
- **N2.** `gameSelectMultiAmount` wiring — multi-input numeric prompts (Hurricane, trample blocker assignment in some flows). Slice **M**. (§1.37.)
- **N3.** `gameChooseChoice` extended `WebChoice` — `searchEnabled`, `subMessage` already covered, `isManaColorChoice`, `sortEnabled`. Slice **M**. **Acceptance:** "name a card" prompts get a search box. (§1.31.)
- **N4.** Trigger auto-ordering toggles in `gameChooseAbility` modal — checkbox "remember this order". Slice **S**. (§4 trigger ordering category.)
- **N5.** Hand-card / graveyard / exile / stack click-routing for targeting. Slice **M**. **Acceptance:** with a target dialog pending, clicking eligible cards in any of those zones dispatches the target. (§10.)
- **N6.** `userRequestDialog` wiring — rollback-permission, hand-share-permission. Slice **M**. (§1.20.)
- **N7.** `viewSideboard` wiring — Wish-cards. Slice **M**. (§1.19.)
- **N8.** "All attack" button + `string:"special"` response. Slice **M**. Coupled with B1. (§1.33.)
- **N9.** `manaType` discriminator UI for hybrid mana payment. Slice **M**. (§3.5.)
- **N10.** `joinedTable` frame on the room WS to remove REST-poll lag. Slice **M**. (§1.4.)
- **N11.** `showUserMessage` and `serverMessage` modal/banner. Slice **S**. (§1.2, §1.3.)

### NICE — polish, not blocking

- **P1.** Chat-panel HTML markup parsing (currently HTML-escapes; loses upstream's `<font color>` highlights). Slice **S**. Reuse `renderUpstreamMarkup` from `GameDialog.tsx:534`. (§1.1 notes.)
- **P2.** Hold-priority gesture (Cmd+click). Slice **S**. (§4 hold category.)
- **P3.** Mana auto-payment toggles surfaced as user-prefs. Slice **M**. (§4 mana payment category.)
- **P4.** F7 (`PASS_PRIORITY_UNTIL_NEXT_TURN_SKIP_STACK`) and F11 (`PASS_PRIORITY_UNTIL_END_STEP_BEFORE_MY_NEXT_TURN`) buttons. Slice **S**. (§4 pass category.)
- **P5.** Stack-object detail popovers (currently no UI for the stack at all beyond display). Slice **M**.
- **P6.** Visual highlight of legal targets / legal attackers / legal blockers on the board. Slice **M**. Depends on wire-format extension to forward `options.POSSIBLE_*`.
- **P7.** Game-log timestamp + turn-info. Slice **S** as part of B3.
- **P8.** Sound effects for chat / game events. Slice **S**.
- **P9.** Toast (non-modal) replacement for `gameError`. Slice **S**.

### Bugs found in upstream / facade during this audit

- **U1. (facade)** `WebSocketCallbackHandler.mapClientMessage` strips `options` before sending. Combat (§7) and any prompt with `UI.*.btn.text` (§8) lose data. Wire-format issue, not a stand-alone bug.
- **U2. (webclient)** `ActionPanel.tsx` button labeled "To end turn" maps to `PASS_PRIORITY_UNTIL_NEXT_TURN`, but the upstream F4 hotkey maps to `PASS_PRIORITY_UNTIL_MY_NEXT_TURN`. The two are subtly different in multiplayer (irrelevant in 1v1) but the button label is misleading. **Verify** which the user actually wants — `UNTIL_NEXT_TURN` skips through opponent's turn until the active player changes back; `UNTIL_MY_NEXT_TURN` stops at the user's own next untap. For 1v1 they're effectively identical, but consistency matters.
- **U3. (upstream)** `ClientCallbackMethod.java:24` flags `TOURNAMENT_INIT` / `TOURNAMENT_UPDATE` / `TOURNAMENT_OVER` as "unused on client". Confirmed — the Swing client's `default` case in `CallbackClientImpl.java:498` swallows them. We mirror by leaving them off the wire.
- **U4. (facade)** `GameStreamHandler.dispatchManaType` (`:448`) requires the inbound `value` to be `{playerId, manaType}`, but the webclient never sends a `manaType` response and there's no UI to construct one. Surface as part of N9.
- **U5. (webclient)** `Game.tsx:30` `priorityPlayerName === session.username` for "myPriority" check — works in 1v1 but breaks if usernames duplicate or if upstream's `priorityPlayerName` includes a controller hint (`" (as <name>)"` from `GameImpl.getControllingPlayerHint`, `:3037`). Slice S to compare by `playerId` instead.

---

## Top 3 action items the user should consider next

(See §99 BLOCKING for full list; these are the three that pay back fastest.)

1. **B1 — combat UI.** Without this, 50%+ of a typical 1v1 game is invisible to the user. Estimated slice L; can be split into B1a (banner + OK button + click-marks attackers, no wire-format change) and B1b (wire-format extension forwarding `options.POSSIBLE_*`).
2. **B2 — manual mana payment.** Whenever the engine asks the player to pay mana manually (and it does for hybrid lands and X-cost spells), the modal-on-top-of-board model is broken. Slice L; coupled to the same "pending dialog → board is input" pattern as B1.
3. **B4 — `gameAsk` button labels.** One-line wire-format fix unblocks the mulligan UI. Slice S; ship before B1/B2 because it's cheap.

After those three, **B3 (game log)** is the next-highest leverage — it's the single most-asked-for missing affordance ("what just happened?") and unlocks debugging the rest of the audit.
