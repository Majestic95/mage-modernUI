# 0009 — Triggered ability ordering

- **Status:** Accepted (planning) — implementation lands as a Phase 5 sub-slice
- **Date:** 2026-04-27
- **Deciders:** Austin
- **Builds on:** [ADR 0007](0007-game-stream-protocol.md) (stream protocol), [ADR 0008](0008-player-interactions.md) §1.28 (`gameTarget`), §1.29 (`gameChooseAbility`), §3.1 (`uuid` response), §4 (`TRIGGER_AUTO_ORDER_*` action allow-list)
- **Risk register:** addresses [PATH_C_PLAN.md R9](../PATH_C_PLAN.md) ("Triggered ability ordering UI is fundamentally hard")
- **Schema bump:** 1.15 → 1.16 (additive — extend `WebClientMessageOptions`)

---

## Context

When two or more triggered abilities trigger from the same event and the same player controls them, the active player must choose the order they go on the stack (CR 603.3b — "the active player puts all those abilities controlled by that player on the stack in any order they choose"). xmage's engine handles this through `HumanPlayer.chooseTriggeredAbility` (`HumanPlayer.java:1456-1573`); it asks once per pick (the "next on the stack" abstraction — pick which trigger goes on the stack first, then the engine re-asks for the next, etc.), with auto-order short-circuits for triggers the player has tagged as `TRIGGER_AUTO_ORDER_*`.

ADR 0008 §1.29 incorrectly stated that trigger ordering arrives on the wire as `gameChooseAbility`. **This ADR corrects that:** the upstream engine routes the prompt through `GAME_TARGET`, not `GAME_CHOOSE_ABILITY`. The trigger-ordering prompt is therefore already wired (incidentally) on the webclient via the existing `gameTarget` / `TargetDialog` plumbing — but the rendering is broken because `cardsView1` in this case carries `AbilityView` objects, not real cards, and the current `TargetDialog` row reads `c.name` (always `"Ability"`) and `c.typeLine` (always empty) instead of the rule text. The fix is small on the wire, larger on the renderer, and earns a dedicated ADR because R9 is on the risk register and the UX choices warrant explicit deliberation rather than another inline patch on `TargetDialog`.

The same misattribution lives in two more places that slice 26 should clean up while the correction is fresh:

1. **ADR 0008 §1.29's secondary error** — the section also lists `fireGetModeEvent` as a `GAME_CHOOSE_ABILITY` source. That's nearly right but skips a step: `GameImpl.java:3104-3108` shows `fireGetModeEvent` constructs a `PlayerQueryEvent` with `QueryType.CHOOSE_MODE` (not `CHOOSE_ABILITY`), and the `GameController.java:215-216` switch handles `CHOOSE_MODE` by calling its own private `chooseMode(...)` (which then internally calls `getGameSession.chooseAbility(...)` at `:856`). Mode picking does end up on `gameChooseAbility`, but via the controller's funneling, not directly from `fireGetModeEvent`.
2. **`WebAbilityPickerView.java:10-14` javadoc** — claims `gameChooseAbility` fires "when ordering a stack of simultaneously-fired triggers (`chooseTriggeredAbility`)". This is the same wrong attribution as §1.29. Slice 26 must update this javadoc to say "fires for `chooseAbility` (multi-activated permanent) and `chooseMode` (modal-spell mode picker), routed through `CHOOSE_ABILITY` and `CHOOSE_MODE` respectively in the controller switch. Triggered-ability ordering is a distinct path — see ADR 0009 — and arrives on `gameTarget`, not here."

This ADR also locks in the `TRIGGER_AUTO_ORDER_*` UX (the "remember this order" affordance — gap N4 in ADR 0008 §99) and explicitly defers the planeswalker-style "order ALL N triggers up front" mass-picker (which xmage's engine **does not currently use** — see §6 below).

---

## Investigation findings (2026-04-27 deep reads)

### F1. Engine entry point — `HumanPlayer.chooseTriggeredAbility`

`HumanPlayer.java:1456-1573` is a single method, ~120 lines. Loop structure (uncertain — needs verification on a multi-pick game in slice testing):

1. Drop simulation early-exit (`canCallFeedback`, `:1458`).
2. For each ability, check the four `TRIGGER_AUTO_ORDER_*` short-circuits in priority order:
   - `triggerAutoOrderAbilityFirst` matches by `ability.getOriginalId()` (`:1471-1473`) — return that ability immediately, no prompt.
   - `triggerAutoOrderNameFirst` matches by `rule.equals(...)` against the ability's printed text resolved with the source object's name (`:1474-1478`) — return immediately.
   - `triggerAutoOrderAbilityLast` / `triggerAutoOrderNameLast` add the ability to a "deferred to last" pile (`:1479-1487`).
3. If `autoOrderUse` is on (per-user pref, `getControllingPlayersUserData(game).isAutoOrderTrigger()`) and all remaining abilities have **identical rule text and identical resolved targets** (`:1488-1517`), pick one without prompting.
4. Otherwise, fire the prompt: `game.fireSelectTargetTriggeredAbilityEvent(playerId, "Pick triggered ability (goes to the stack first)", abilitiesWithNoOrderSet)` at `:1548`.
5. `waitForResponse(game)`, then `getFixedResponseUUID(game)` at `:1552` — match against either `ability.getId()` or `ability.getSourceId()` (the latter is for the legacy "click the source permanent" gesture path, gated by `macroTriggeredSelectionFlag` at `:1556`). Return the chosen ability.
6. Unmatched response → loop back to top, re-fire (canRespond gates).

The prompt **only ever asks for ONE ability at a time**. The engine resolves it onto the stack, then re-enters `chooseTriggeredAbility` with the remaining abilities (possibly already shrunk by auto-order rules).

### F2. Wire callback — it's `GAME_TARGET`, not `GAME_CHOOSE_ABILITY`

The fire path:

1. `Game.fireSelectTargetTriggeredAbilityEvent(playerId, message, abilities)` (`Game.java:356`, `GameImpl.java:3136-3138`) calls
2. `playerQueryEventSource.target(playerId, message, abilities)` (`PlayerQueryEventSource.java:77-79`), which fires
3. `PlayerQueryEvent.targetEvent(...)` with `QueryType.PICK_ABILITY` and the abilities list stuffed into the `choices` field (`PlayerQueryEvent.java:192-194`).
4. `GameController.java:193-195` switches on `QueryType.PICK_ABILITY` and calls `target(playerId, message, event.getAbilities(), required, options)`, which builds a `CardsView` from the abilities (`new CardsView(abilities, game)`, see `CardsView.java:66-181`) and calls `getGameSession(playerId).target(message, cardsView, null, required, options)` at `GameController.java:880-885`.
5. `GameSessionPlayer.target(...)` at `GameSessionPlayer.java:56-63` fires `ClientCallback(ClientCallbackMethod.GAME_TARGET, gameId, new GameClientMessage(gameView, options, question, cardsView, /*targets=*/null, /*required=*/true))`.

The disambiguator from `gameTarget`-for-target-pick versus `gameTarget`-for-trigger-order is the upstream `options` map, which carries `queryType: QueryType.PICK_ABILITY` (set at `PlayerQueryEvent.java:88` when the event is constructed, exposed downstream as `options.get("queryType")`). The Swing client consults this exact key at `GamePanel.java:2068-2080` to decide whether to attach the trigger-order context menu.

The `PICK_ABILITY` `QueryType` is **also** used for the ability picker in `chooseAbility` (multi-activated permanent), but that path lands at `CHOOSE_ABILITY` in the controller switch (`GameController.java:205-211`) and routes to `GameSessionPlayer.chooseAbility(...)` → `GAME_CHOOSE_ABILITY`. The two callers share the enum value but split before reaching the wire.

**The list of `ClientCallbackMethod` enum values is in `ClientCallbackMethod.java`; there is no `SELECT_TRIGGERED_ABILITY` enum value.** The decision below extends the wire so the client can recognize the trigger-order intent without sniffing strings.

### F3. Carrier shape — `GameClientMessage` with `cardsView1` of `AbilityView`s

Each `AbilityView` (`AbilityView.java:12-46`) extends `CardView` with two extra fields (`sourceName: String`, `sourceCard: CardView`) and overrides:

- `id` = the ability UUID (the picker response value).
- `name` = literal `"Ability"` — overridden by `setName(...)` to the source object name in some `CardsView` constructor branches (e.g. emblem / dungeon / plane sources at `CardsView.java:111-128`); for normal triggers from a permanent the name stays `"Ability"`.
- `rules` = `[ability.getRule()]` — single-paragraph rule text of the trigger.
- `manaCostLeftStr` = `ability.getManaCostSymbols()` (`AbilityView.java:34`). Typically empty for triggers — pacts and a few odd corner cases (mana-cost-bearing triggered abilities) may populate it; the new `OrderTriggersDialog` simply ignores this field, so the precise contents don't matter for the slice.
- `power` / `toughness` / `loyalty` / `defense` / `cardTypes` / `subTypes` / `superTypes` / `color` are zeroed out.

The current `CardViewMapper` (`Mage.Server.WebApi/.../mapper/CardViewMapper.java`, called from `GameViewMapper.toClientMessage` at `:226`) flattens `AbilityView` to `WebCardView` by inheritance — `name`, `rules`, `id` survive; the AbilityView-specific `sourceName` and `sourceCard` are dropped because `WebCardView` doesn't model them. **Verifying this drop costs nothing in slice 26-substrate testing; if a test fails because a renderer wants `sourceName`, extend `WebCardView` with an optional `sourceLabel` field (additive).**

### F4. `WebClientMessageOptions` — does not yet forward `queryType`

The whitelisted projection in `WebClientMessageOptions` (`WebClientMessageOptions.java:48-60`) covers `leftBtnText` / `rightBtnText` / `possibleAttackers` / `possibleBlockers` / `specialButton`. **It does not forward `queryType`.** This ADR adds a single boolean projection `isTriggerOrder` (D2 below), which the mapper sets to `true` when `options.get("queryType") == QueryType.PICK_ABILITY`.

The same effect could be achieved by message-text matching ("Pick triggered ability"), which is stable for the current `chooseTriggeredAbility` callsite (the literal at `HumanPlayer.java:1548`), but ADR 0008 §99 U1 already established that we prefer structured options to text sniffing. Match the precedent.

### F5. Auto-order whitelist — already on the action allow-list

`PlayerActionAllowList.ALLOWED` includes all five `TRIGGER_AUTO_ORDER_*` actions (`PlayerActionAllowList.java:43-48`). The wire route is `playerAction { action: "TRIGGER_AUTO_ORDER_ABILITY_FIRST", data: { /* see below */ } }`. Upstream's `MageServerImpl.sendPlayerAction(PlayerAction, gameId, sessionId, Object)` carries the per-action data; for trigger auto-order:

- `TRIGGER_AUTO_ORDER_ABILITY_FIRST` / `_ABILITY_LAST` carry the **runtime ability id** (a UUID — `ability.getId()`, not `getOriginalId()`) — see Swing client at `GamePanel.java:3071` (`abilityId = cardViewPopupMenu.getAbility().getId();`) and `:3079-3086` (sends). This UUID is the same value that appears as a `cardsView1` key, since `AbilityView.java:20` populates `this.id = ability.getId()`. The engine receives it and looks up the matching pending trigger to extract `originalId` for storage (`HumanPlayer.java:2820-2829`); that translation happens server-side, not on the wire.
- `TRIGGER_AUTO_ORDER_NAME_FIRST` / `_NAME_LAST` carry the **rule text** (a String) — `GamePanel.java:3087-3098`.
- `TRIGGER_AUTO_ORDER_RESET_ALL` carries `null` — `:3099-3101`.

The Swing client also fires a follow-up `sendPlayerUUID(gameId, abilityId)` after the `_FIRST` actions (`:3081`, `:3090`) so that the engine's current pending trigger pick is resolved with the just-tagged ability — otherwise the engine would still be waiting for a target response. The webclient must mirror this two-step dispatch (D5 below).

### F6. Webclient state today — incidentally rendering, badly

`gameTarget` is fully wired (ADR 0008 §1.28, "Partial → Combat gap"). For trigger ordering the side panel renders, **but** the rows show `c.name = "Ability"` and `c.typeLine = ""` (`GameDialog.tsx:283-296`), so the user sees:

```
[ Ability ]
[ Ability ]
[ Ability ]
```

with no way to distinguish between them. Clicking a row dispatches `playerResponse{kind: "uuid", value: <ability-id>}` correctly and the engine accepts it — but the user can't pick intentionally. **This is functionally broken even though the wire round-trip works.**

Slice 16's `interactionMode.ts` derives `kind: 'target'` for any `gameTarget` frame (`interactionMode.ts:128-141`) — trigger ordering is currently misclassified as a "target a card" interaction. The click router (`clickRouter.ts:88-101`) gates dispatch on `eligibleIds.has(objectId)`, which works because the ability UUIDs are in `cardsView1` keys.

---

## Decisions

### D1. Reuse the `gameTarget` wire frame; add a discriminator field — do not introduce a new method

Two options were considered:

1. **A new `gameChooseTriggeredAbility` method.** Mirror `gameChooseAbility`'s shape — use `WebAbilityPickerView { gameView, message, choices: Map<UUID, String> }` where each choice is a `(ability-id, rule-text)` pair.
2. **Extend `gameTarget`'s carrier with a discriminator** so the renderer can distinguish trigger-order from target-pick.

**Decision: option 2.** Reasons:

- The wire callback **is** `GAME_TARGET`. Forcing a new wire method would require a special case in `WebSocketCallbackHandler.mapToFrame` that sniffs `options.get("queryType")` to remap `GAME_TARGET` to `gameChooseTriggeredAbility`. That's a method-level rewrite that fights the upstream model.
- The webclient `pendingDialog` machinery is already keyed on `dialog.method`. Adding a new method doubles the surface (`gameTarget` and `gameChooseTriggeredAbility` would both need their own `interactionMode` branch, click-router branch, and reconnect-replay handling).
- Option 1 would lose the embedded `WebGameView` snapshot that `gameTarget` carries (the player needs to see the board state to decide ordering). `WebAbilityPickerView` has `gameView`, so it could carry it, but `choices` is `Map<UUID, String>` and we lose the structure of `WebCardView` (manaCostLeftStr, sourceName attribution, etc.). Reusing `cardsView1` keeps every renderer affordance available.
- ADR 0008 §1.29 incorrectly listed trigger ordering as `gameChooseAbility`, and `WebAbilityPickerView.java:10-14`'s javadoc repeats the same misattribution. Fixing the wire to actually mirror those notes would require server work for cosmetic alignment with errors. Better to fix the notes (Context above lists the cleanup).

### D2. Discriminator — extend `WebClientMessageOptions` with `isTriggerOrder: boolean`

Add a sixth field to `WebClientMessageOptions`:

```java
public record WebClientMessageOptions(
    String leftBtnText,
    String rightBtnText,
    List<String> possibleAttackers,
    List<String> possibleBlockers,
    String specialButton,
    boolean isTriggerOrder    // NEW in 1.16
) { ... }
```

`WebClientMessageOptions.EMPTY` becomes `new WebClientMessageOptions("", "", List.of(), List.of(), "", false)`.

`GameViewMapper.extractOptions(...)` (`GameViewMapper.java:274-286`) sets `isTriggerOrder = source.get("queryType") == PlayerQueryEvent.QueryType.PICK_ABILITY`. The mapper imports `PlayerQueryEvent.QueryType` (already on the upstream classpath) — no DTO leak, just an enum reference for a comparison.

This is the same pattern the `possibleAttackers` / `possibleBlockers` decision in 1.15 set up — closed projection, never widen to `Map<String, ?>`.

**Why not a new `WebTriggerOrderInfo` carrier?** Because the only payload is the boolean. Anything richer (per-ability source attribution) lives on `cardsView1[ability-id].rules`/`.name` and is already on the wire.

### D3. Zod schema mirror, schema 1.16

Webclient's `WebClientMessageOptions` Zod schema gets one additive field, `isTriggerOrder: z.boolean().optional().default(false)` (the `.default(false)` lets older test fixtures parse without the field; servers >=1.16 always emit it).

Schema CHANGELOG entry per the 1.15 precedent — `docs/schema/CHANGELOG.md` 1.16 section, additive minor.

### D4. Response shape — unchanged

`playerResponse { kind: "uuid", value: <ability-uuid> }`, exactly the same as a target pick. ADR 0008 §3.1. No skip token (the prompt is always required — `chooseTriggeredAbility` does not surface an optional path).

### D5. `TRIGGER_AUTO_ORDER_*` — `playerAction.data` shape (as shipped)

> **Note (2026-04-27, post-slice-28 reconciliation):** the original D5 prose called for facade-side `{this}` substitution carrying `{ abilityId }` on the wire for `_NAME_*`. The shipped code instead mirrors upstream Swing exactly — substitution is **client-side**, the wire carries `{ ruleText: <substituted> }`. The shipped pattern is correct (no public Game accessor on `GameController` makes facade-side resolution awkward, and `WebCardView.sourceLabel` from slice 28 supplies the source name the client needs). The text below documents what shipped, not the original (now-superseded) plan.

The existing `playerAction` envelope (ADR 0007 D6) carries `data: null` for most actions; for `ROLLBACK_TURNS` it's `{ "turns": <int> }`; for `REQUEST_AUTO_ANSWER_TEXT_*` it's `{ "text": "..." }`. Trigger auto-order ships three data shapes:

- `TRIGGER_AUTO_ORDER_ABILITY_FIRST` / `_ABILITY_LAST` — `data: { "abilityId": "<uuid>" }`. The UUID is the runtime ability id — the same value that appears as a `cardsView1` key (i.e. `AbilityView.id`, populated from `ability.getId()` at `AbilityView.java:20`). Server passes the UUID through to `MageServerImpl.sendPlayerAction(action, gameId, session, abilityId)`. The engine then looks up the matching pending trigger and stores `originalId` itself (`HumanPlayer.java:2820-2829`) — no `originalId` translation on the wire or facade. The facade decode is at `GameStreamHandler.decodeActionData` for `TRIGGER_AUTO_ORDER_ABILITY_*`: parses `{abilityId}` to a `UUID`, returns `null` if malformed.
- `TRIGGER_AUTO_ORDER_NAME_FIRST` / `_NAME_LAST` — `data: { "ruleText": "<client-substituted>" }`. **Substitution happens client-side**, mirroring upstream Swing's pattern at `GamePanel.java:3074-3076`:
  - The webclient prefers `WebCardView.sourceLabel` (slice 28; populated facade-side from `AbilityView.getSourceCard().getName()` in `CardViewMapper`), falls back to `AbilityView.name` (which is the literal `"Ability"` for permanent-sourced triggers — `AbilityView.java:21`), and finally to the literal string `"Ability"`. Implementation: `webclient/src/pages/GameDialog.tsx` `substituteThis(ruleText, sourceLabel, name)`.
  - With `sourceLabel` populated, the substituted rule string matches what `HumanPlayer.java:1474-1476` recomputes via `ability.getRule(sourceObject.getName())`, so the auto-order key compares correctly against future triggers. Slice 28 added `sourceLabel` precisely to make this comparison work — without it, substitution produces `"...Ability..."` which would never match a real trigger source name (the latent bug critique E3 surfaced and slice 28 fixes).
  - Why client-side substitution: (a) simpler facade contract — no need for the inbound handler to reach into `game.getState().getTriggered(playerId)` for source-name lookup; (b) mirrors Swing's pattern exactly, easing future divergence audits; (c) `WebCardView.sourceLabel` already carries the source name through the wire (slice 28), so the webclient has everything it needs without a second round-trip; (d) keeps the facade purely a wire-shape transformer with no game-state access.
  - `HumanPlayer.setTriggerAutoOrder` at `:2843-2845` throws `IllegalArgumentException` if the resolved rule text still contains `{this}`. The substitution function uses `ruleText.replace(/\{this\}/g, ...)` with a non-empty replacement (sourceLabel || name || "Ability"), so the wire never carries an unsubstituted `{this}`.
  - The facade decode at `GameStreamHandler.decodeActionData` for `TRIGGER_AUTO_ORDER_NAME_*` reads `data.ruleText` and forwards the string to `MageServerImpl.sendPlayerAction(action, gameId, session, ruleText)`.
- `TRIGGER_AUTO_ORDER_RESET_ALL` — `data: null`. Fire-and-forget, no follow-up dispatch.

Per-action validation in the inbound handler — schema-validate per-action payload like the rollback / auto-answer cases already do.

**`_FIRST` follow-up:** after firing a `_FIRST` action, the webclient **also** dispatches the ability UUID as the dialog response: `playerResponse { kind: "uuid", value: <ability-id>, messageId: <pending-trigger-order-messageId> }`. This is the upstream Swing client's pattern at `GamePanel.java:3081` / `:3090` — without the second dispatch, the engine remains blocked waiting for a target response after the auto-order rule has been recorded.

**`_LAST` follow-up — confirmed mandatory (slice 27 verification):** after firing a `_LAST` action, the Swing client sends `sendPlayerUUID(gameId, null)` (`:3085`, `:3096`) "to refresh the displayed abilities". Slice 27 critique-driven verification confirmed that **without this nudge the engine deadlocks** — `HumanPlayer.setTriggerAutoOrder` at `:2811-2856` mutates the deferred-last pile but never notifies the response monitor that `chooseTriggeredAbility` waits on at `:1550`. The webclient cannot mirror Swing's call directly because `playerResponse{kind:"uuid"}` requires a JSON string value (`GameStreamHandler.java:463-471` validates `valueNode.isTextual()` then `UUID.fromString(...)` — a JSON `null` fails the textual check; an empty string fails `UUID.fromString`). **Resolution: the facade synthesizes the nudge.** In `GameStreamHandler.handlePlayerAction`, after `embedded.server().sendPlayerAction(...)` succeeds, if the action is `TRIGGER_AUTO_ORDER_*_LAST` the facade calls `embedded.server().sendPlayerUUID(gameId, sessionId, null)`. This synthesizes the no-op nudge upstream-side without a client-visible second wire frame. `_FIRST` actions don't need this — the webclient's two-step dispatch (action then `playerResponse{uuid:abilityId}`) already unblocks the monitor via `setResponseUUID`.

### D6. Interaction mode — new variant, not piggyback on `target`

Slice 16's `interactionMode.ts` discriminates UI surfaces. Add:

```ts
export type InteractionModeOrderTriggers = {
  kind: 'orderTriggers';
  messageId: number;
  abilityIds: Set<string>;
};
```

Rationale for not piggybacking on `target`:

- The renderer needs to switch on this — the row content differs (rule text instead of card name + typeLine), the panel chrome differs (auto-order checkboxes), the click semantics differ (no skip option, no board click-to-target — the abilities don't have a board location to click).
- The click router behavior is **the same** as `target` (single-shot dispatch + `clearDialog`), but the eligible-IDs source is unambiguously `cardsView1` keys (no `targets[]` fallback). Piggybacking would mean the click router has to inspect `dialog.data.options.isTriggerOrder` to decide whether to allow the Skip button. Cleaner with a separate variant.

`deriveInteractionMode` updates: when `dialog.method === 'gameTarget' && dialog.data.options?.isTriggerOrder`, return `kind: 'orderTriggers'` with `abilityIds = new Set(Object.keys(dialog.data.cardsView1))`. Falls through to the existing `kind: 'target'` branch otherwise.

### D7. Click router — new branch, single-shot like `target`

`clickRouter.ts` adds a `case 'orderTriggers':` arm. Behavior identical to `case 'target':` — `sendPlayerResponse(messageId, 'uuid', objectId)` then `clearDialog()`. The eligibility check uses `mode.abilityIds.has(objectId)`.

`isBoardClickable` returns `false` for `orderTriggers`. The abilities are not board objects — clicking a permanent or hand card during this mode should be a no-op, not a click-through to free priority. (The current `target` mode returns `true` for `isBoardClickable` because real targets often live on the board; trigger-order abilities never do.)

### D8. UI pattern — modal panel with rule text rows + auto-order context menu

**Survey of upstream Swing client:** `GamePanel.pickTarget(...)` at `GamePanel.java:2060-2093` — opens a non-modal `ShowCardsDialog` (one large dialog with cards laid out left-to-right) overlaid on the board, with the feedback panel at the bottom of the screen showing "Pick triggered ability (goes to the stack first)". When `popupMenuType == TRIGGER_ORDER`, each card has a right-click menu attached (`prepareCardsDialog` at `:2191-2199`, the menu definition at `:3115-3147`):

- "Put this ability always first on the stack" → `TRIGGER_AUTO_ORDER_ABILITY_FIRST` + send the chosen UUID
- "Put this ability always last on the stack" → `TRIGGER_AUTO_ORDER_ABILITY_LAST`
- "Put all abilities with that rule text always first on the stack" → `TRIGGER_AUTO_ORDER_NAME_FIRST` + send the chosen UUID
- "Put all abilities with that rule text always last on the stack" → `TRIGGER_AUTO_ORDER_NAME_LAST`
- "Reset all order settings for triggered abilities" → `TRIGGER_AUTO_ORDER_RESET_ALL`

Selecting a card without invoking the context menu just picks that ability (a normal click).

**MTGA pattern (well-documented):** a side panel slides in along the right edge of the screen showing each pending trigger as a card-sized row with full rule text and source-card art. The active player numbers them in order by clicking 1, 2, 3, ... or by drag-to-reorder. There is **no auto-order memory** — every multi-trigger event re-prompts. MTGA's design assumes triggers are uncommon enough that the prompt is rare and the user wants to read every one. Source: standard MTGA UX, e.g. the Sorin / Tibalt or Goblin Bombardment pile-on prompts.

**Magic Online (MTGO) pattern (well-documented):** a smaller modal centered on the screen with a numbered list of trigger sources and rule text. The user clicks each one in order; MTGO orders them as picked. MTGO has an "auto-order" option per trigger via a right-click menu identical to Swing's (Swing's pattern was modeled on MTGO, which is unsurprising given xmage's lineage). MTGO also offers "always trigger this first" / "always last" / "always at top" / "always at bottom" toggles per source.

**Recommendation: a side-panel modal with one row per ability, click-to-pick (single-shot — engine re-prompts for the next), with a per-row "more" button (three-dots / hamburger) opening the auto-order context menu.** Reasons:

- **Side panel, not full-screen modal:** the player needs to see the board to make an informed pick (which permanent does the engine think is the source? what's the life total context?). A blocking modal forces them to dismiss to peek and reopen, which is the bug class ADR 0008 §1.32 flagged for `gameAsk`. The existing `gameTarget` panel is also a side panel (`GameDialog.tsx:117-129`) for the same reason — keep the convention.
- **Click-to-pick, single-shot, not drag-to-reorder:** matches the engine model exactly. The engine asks for "next on stack", not "give me the full ordering". Drag-to-reorder would require the renderer to fake a queue and dispatch picks one-at-a-time as the engine re-prompts, which is more code, more rendering state to track, and a worse fit for the auto-order short-circuits (when the engine returns N-1 abilities after the first pick, did the user reorder among them or are they accepting the previous order?).
- **Per-row context menu (hamburger button):** the auto-order toggles are power-user features, not the primary flow. Hiding them behind a per-row "more" button keeps the primary click clean while preserving feature parity. A right-click context menu is unidiomatic on web and breaks on touch / Tauri WebView2; an explicit button is more discoverable.

The panel chrome:

```
┌─────────────────────────────────────┐
│ Pick triggered ability              │
│ (goes to the stack first)           │
├─────────────────────────────────────┤
│ [ When CMC enters, look at top 3 ]  │  ← click row to pick
│   from: Courser of Kruphix      ⋯   │  ← hamburger → auto-order menu
├─────────────────────────────────────┤
│ [ Whenever you cast, draw a card ]  │
│   from: Niv-Mizzet, Parun       ⋯   │
└─────────────────────────────────────┘
```

Each row's text comes from `cardsView1[id].rules.join(" ")`. Source attribution: `cardsView1[id].name` if it's been overridden by `AbilityView.setName(...)` for emblems / planes; else fall back to a "from: ..." subtitle that we'll need to plumb through. **Uncertain — the simplest fix is to extend `WebCardView` with an optional `sourceLabel` field** populated by the mapper from `AbilityView.getSourceCard().getName()`. Slice as a polish task; the slice-1 ship can use just `rules[0]` text and accept a minor UX gap.

### D9. State machine — one prompt per pick, dialog re-mounts on each `messageId`

The engine asks for one ability at a time. After the player picks, the engine returns from `chooseTriggeredAbility`, resolves the chosen ability, and (if more triggers remain) calls `chooseTriggeredAbility` again. Each call generates a fresh `ClientCallback` with a fresh `messageId`.

Wire-side:

1. `gameTarget` arrives, `messageId = M`, `cardsView1` has 3 abilities, `options.isTriggerOrder = true`.
2. User picks ability X. Webclient dispatches `playerResponse { kind: "uuid", value: X, messageId: M }` and calls `clearDialog()`.
3. Engine resolves ability X. Two abilities remain.
4. New `gameTarget` arrives, `messageId = M+1`, `cardsView1` has 2 abilities.
5. Repeat until all abilities are placed.

The dialog component **re-mounts each time** because the `pendingDialog` clears between frames (slice 13 fix — `useState` in `TargetDialog` re-keys on `messageId`). The same fix applies to the new `OrderTriggersDialog`: re-mount, no state preservation.

If the player passes priority before answering: **they cannot.** The trigger-order prompt is mid-resolution-step, after a triggered ability has already gone on the queue but before it goes on the stack. Priority is held by the engine, not the player. `playerAction { action: "PASS_PRIORITY_*" }` while a trigger-order dialog is pending would be rejected by `MageServerImpl` (the engine isn't in a priority window). **Verified by reading `chooseTriggeredAbility` — there is no `passedAllTurns` / `passedTurn` short-circuit in the loop**, only the auto-order short-circuits. The prompt blocks until answered or the player concedes.

### D10. Multiplayer divergence — flag for Phase 6, not Phase 5

In multiplayer the APNAP rule (CR 603.3b) means each player picks the ordering of their own triggers, in turn order. `chooseTriggeredAbility` is already per-player on the engine side; the wire callback already arrives only at the player whose pick it is. **So the wire format does not change for multiplayer.** What changes is the client UX: while one player is picking, the others should see a "waiting on `<player>` to order triggers" indicator (analogous to the existing "Waiting for `<player>`" message via `informOthers` at `GameController.java:914`).

That indicator is part of the broader spectator / multiplayer presence work in Phase 6 and is out of scope for this ADR. **Flagged here so it isn't a surprise:** the slice-1 implementation is a per-recipient panel with no "waiting on opponent" path.

### D11. Schema bumps — 1.15 → 1.16 → 1.17 → 1.18

Three additive minor bumps across the three sub-slices that ship this ADR:

- **1.16 (slice 26)** — `WebClientMessageOptions` gains `isTriggerOrder: boolean` (D2).
- **1.17 (slice 27)** — `WebPlayerAction.data` extended:
  - `{ abilityId: string }` for `TRIGGER_AUTO_ORDER_ABILITY_*` (UUID of the runtime ability — passed through to upstream as a UUID).
  - `{ ruleText: string }` for `TRIGGER_AUTO_ORDER_NAME_*` (the **client-substituted** rule string — slice 28's `sourceLabel` improves the substitution accuracy but the wire shape is set in 1.17).
  - `null` for `TRIGGER_AUTO_ORDER_RESET_ALL` (existing default).
- **1.18 (slice 28)** — `WebCardView` gains optional `sourceLabel: string` (populated facade-side from `AbilityView.getSourceCard().getName()`). Used for two purposes: (a) UI "from: ‹source›" subtitle in the trigger-order panel; (b) accurate `{this}` substitution when the webclient builds the `_NAME_*` `ruleText` payload.

`docs/schema/CHANGELOG.md` 1.16 / 1.17 / 1.18 entries. `SchemaVersion.CURRENT` constant updates each slice.

---

## Slice plan

Three sub-slices. Each ≤2 hours. Sub-slice 1 ships standalone — it produces a working but minimal trigger-order panel, fixing the "Ability / Ability / Ability" bug today.

### Slice 26 — Wire-format extension + minimal panel

- `WebClientMessageOptions.isTriggerOrder` field (D2). Mapper extension. Snapshot test for the new field.
- Schema CHANGELOG 1.16 entry; `SchemaVersion.CURRENT = "1.16"`.
- Webclient Zod schema extension. `interactionMode.ts` new `kind: 'orderTriggers'` variant (D6). `clickRouter.ts` new branch (D7).
- `OrderTriggersDialog` component — side panel, one row per ability, rule text from `cardsView1[id].rules.join(" ")`, click-to-pick. **No auto-order menu yet.**
- Test fixture — JSON with `options.isTriggerOrder = true` and a 2-ability `cardsView1`. Pick a fixture pair whose rule strings **differ** (e.g. Soul Warden + Soul's Attendant ETB triggers, or two distinct upkeep triggers) so the engine's `autoOrderUse` short-circuit at `HumanPlayer.java:1488-1517` doesn't suppress the prompt — see OQ #5 below.
- **Doc/javadoc cleanup:** fix `WebAbilityPickerView.java:10-14` javadoc (drop `chooseTriggeredAbility` from its fires list, point to ADR 0009); add a backlog item to clean up ADR 0008 §1.29 in the same pass (the `fireGetModeEvent`-via-controller-funneling imprecision and the `chooseTriggeredAbility` misattribution).

**Ships standalone.** After this slice, a multi-trigger event in 1v1 against a bot is playable — the user can read the rule text and pick intentionally. Auto-order is missing but every prompt is answerable.

### Slice 27 — Auto-order context menu

- Webclient: per-row hamburger button → menu with the five `TRIGGER_AUTO_ORDER_*` options (D8 chrome).
- `playerAction` `data` shapes per D5 (as shipped):
  - `{ abilityId: string }` for `TRIGGER_AUTO_ORDER_ABILITY_*`.
  - `{ ruleText: string }` for `TRIGGER_AUTO_ORDER_NAME_*` — **client-side `{this}` substitution** in `GameDialog.tsx`'s `substituteThis(...)` mirroring `GamePanel.java:3074-3076`. Substitution prefers slice 28's `sourceLabel` (added in slice 28; slice 27 ships with `name`-fallback only). Without substitution, the engine throws `IllegalArgumentException` at `HumanPlayer.java:2843-2845`.
  - `null` for `TRIGGER_AUTO_ORDER_RESET_ALL`.
- Server-side per-action validation in `GameStreamHandler.decodeActionData`.
- Two-step dispatch: action then `playerResponse{uuid:abilityId}` for the `_FIRST` cases (D5) — unblocks the engine's `waitForResponse` at `HumanPlayer.java:1550`.
- **Facade-side null-UUID nudge for `_LAST` cases** (D5 / OQ #3) — `GameStreamHandler.handlePlayerAction` calls `embedded.server().sendPlayerUUID(gameId, sessionId, null)` after the upstream action dispatch when the action is `TRIGGER_AUTO_ORDER_*_LAST`. Without this the engine deadlocks at `HumanPlayer.java:1550` (verified post-shipping by critique audit; see ADR 0009 live-test plan T27.3).
- Schema bump 1.16 → 1.17.
- Tests: dispatch sequence (action + uuid for `_FIRST`, action + facade nudge for `_LAST`); `{this}`-substitution path with a fixture rule containing `{this}`; `_LAST` no-error dispatch in `GameStreamHandlerTest`.

### Slice 28 — Polish

- `WebCardView.sourceLabel` extension (additive, schema 1.18) — populated facade-side from `AbilityView.getSourceCard().getName()` in `CardViewMapper.java:116-120`. Two consumers:
  1. UI "from: ‹source›" subtitle under each row in the trigger-order panel.
  2. Client-side `{this}` substitution preference in `GameDialog.tsx`'s `substituteThis(...)` — without `sourceLabel`, slice-27's substitution falls back to `AbilityView.name` which is the literal `"Ability"` for permanent-sourced triggers (a known quirk per `AbilityView.java:21`); the resulting "Ability"-substituted key would never match `HumanPlayer.java:1474-1476`'s recomputation. Slice 28 makes the auto-order rule-text feature actually work for permanent-sourced `{this}` triggers.
- "Reset all" footer button at the bottom of the panel (D8 menu's fifth option also lives at bottom-of-panel for discoverability).
- Stretch: "always at top of stack" / "always at bottom" semantics — verify whether xmage maps these to `_FIRST` / `_LAST` or whether MTGO has additional toggles we'd want.
- Slice-26 multiplayer "waiting for `<player>`" indicator (per OQ #10): when the active interactor is the opposing seat (visible from `gameUpdate`'s `priorityPlayerId` / active-prompt context), render a passive banner. Phase-5-relevant, not just Phase-6 — bot-vs-human needs a "bot is picking..." stub even in 1v1 if the bot has multi-triggers (though bots resolve internally without firing this callback, so practically this is a multiplayer-only concern).

---

## Tests

Server (no implementation here, only enumeration):

- **`GameViewMapperTest` — `extractOptions` populates `isTriggerOrder = true`** when input map has `("queryType", QueryType.PICK_ABILITY)`. Negative case: `isTriggerOrder = false` for `QueryType.PICK_TARGET` and for missing key.
- **`WebSocketCallbackHandlerTest` — `GAME_TARGET` callback with abilities in `cardsView`** maps to a `gameTarget` frame whose `data.options.isTriggerOrder = true` and whose `cardsView1` keys equal the ability UUIDs. JSON snapshot.
- **`PlayerActionAllowList` snapshot** unchanged (the five `TRIGGER_AUTO_ORDER_*` are already in the list — `PlayerActionAllowList.java:43-48`).
- **`GameStreamHandler` inbound dispatch test** —
  - `playerAction { action: "TRIGGER_AUTO_ORDER_ABILITY_FIRST", data: { abilityId: "<uuid>" } }` reaches `MageServerImpl.sendPlayerAction(TRIGGER_AUTO_ORDER_ABILITY_FIRST, gameId, sessionId, abilityUuid)` with the runtime UUID as the fourth arg.
  - `playerAction { action: "TRIGGER_AUTO_ORDER_NAME_FIRST", data: { ruleText: "<substituted>" } }` reaches `MageServerImpl.sendPlayerAction(TRIGGER_AUTO_ORDER_NAME_FIRST, gameId, sessionId, ruleText)` with the **already-substituted** string as the fourth arg. The webclient is responsible for substitution (D5); the facade is a pass-through.
  - **`_LAST` actions trigger the synthesized null-UUID nudge** — after `TRIGGER_AUTO_ORDER_ABILITY_LAST` or `TRIGGER_AUTO_ORDER_NAME_LAST` dispatch, the handler also calls `embedded.server().sendPlayerUUID(gameId, sessionId, null)` (Fix 1 / OQ #3). Verified by `GameStreamHandlerTest.playerAction_triggerAutoOrderAbilityLast_synthesizesNullUuidNudge` — asserts no `streamError` is emitted, proving the new branch executes cleanly. Live verification covered by ADR 0009 live-test plan T27.3.
  - Negative: malformed `data` (wrong shape, e.g. `{abilityId: "not-a-uuid"}` for `_ABILITY_*`) → `decodeActionData` returns `null`, upstream call no-ops or rejects.
  - The decode-only contract is locked by `GameStreamHandlerDecodeTest`.

Client (Vitest):

- **`interactionMode.test.ts` — `gameTarget` with `options.isTriggerOrder = true`** derives `kind: 'orderTriggers'` with `abilityIds` populated from `cardsView1` keys. Counter-case: same frame without the flag → `kind: 'target'`.
- **`clickRouter.test.ts` — `kind: 'orderTriggers'` click on an eligible ID** dispatches `playerResponse{ uuid }` then `clearDialog`. Click on ineligible ID → no-op. `isBoardClickable` → false.
- **`GameDialog` render test** — pending-dialog with `gameTarget + isTriggerOrder` renders the new panel (`<ul data-testid="trigger-order-list">` containing per-row `data-testid="trigger-order-row"` buttons) with one row per ability, each row's text containing the rule string. The dialog **container** uses the generic `data-testid="game-dialog"`; the trigger-order-specific testids are scoped to the contents (`trigger-order-list`, `trigger-order-row`, `trigger-order-source`, `trigger-order-menu-button`, `trigger-order-menu`, `trigger-order-menu-item`, `trigger-order-reset-all`). Old `gameTarget` (without `isTriggerOrder`) continues to render the regular `TargetDialog`.
- **Auto-order menu test** — clicking the per-row hamburger opens the menu; clicking "Always first" fires both `playerAction` (with `abilityId`) and `playerResponse{uuid}` in that order.
- **`{this}` substitution test** (slice 27 + 28) — clicking "Always first by rule text" with a `{this}`-bearing rule and a non-empty `sourceLabel` produces a `playerAction { ruleText: "...<sourceLabel>..." }` (no surviving `{this}`). Fallback test: same setup with empty `sourceLabel` produces `"...Ability..."` (the `AbilityView.name` literal — known sub-optimal but never throws).
- **Re-mount test** — successive `gameTarget` frames with different `messageId`s each re-mount the panel; no leaked state from the previous pick.
- **Reconnect / replay test** — the dialog-replay machinery (ADR 0007) is keyed on `dialog.method`. A pending `gameTarget` with `isTriggerOrder = true` should round-trip a disconnect/reconnect: server emits the frame, client disconnects, reconnects, server replays the pending dialog, client lands in `kind: 'orderTriggers'` mode with the same `cardsView1` and `messageId`. No state loss.

---

## Open questions

These are flagged for the critic and for slice-26 in-flight verification.

1. **Mass-trigger / planeswalker ordering — RESOLVED.** No mass-ordering callback exists. `Grep "fireSelectTarget" Mage/src` shows four overloads: three `fireSelectTargetEvent` (which fire `QueryType.PICK_TARGET` for cards / UUIDs / permanents) and a single `fireSelectTargetTriggeredAbilityEvent` (the ability-ordering path covered by this ADR). Likewise `Grep "chooseTriggeredAbility" Mage/src` shows exactly one engine callsite: `GameImpl.java:2350`. Modal-spell mode picking goes through `Game.fireGetModeEvent` (`GameImpl.java:3104`) → `playerQueryEventSource.chooseMode(...)` → `QueryType.CHOOSE_MODE` and lands on `gameChooseAbility` (via `GameController` funneling at `:856`) — that's the modal-spell picker, not a triggered-ability mass-ordering. Verdict: only one trigger-order callback shape exists, and this ADR covers it.
2. **Replacement-effect ordering vs trigger ordering:** `chooseReplacementEffect` (`HumanPlayer.java:518`) wires through `Choice` → `GAME_CHOOSE_CHOICE`, not the trigger-order path. They share the "ordering" semantics but different wire shapes and different dialog UIs. ADR 0008 §1.31 covers this. **No conflict** — but confirm by playing a game with overlapping triggers AND a replacement effect (e.g. lifelink-creature damaging a player with both Soul Warden and a replacement-effect that prevents life gain) to make sure both surfaces fire correctly when interleaved.
3. **`_LAST` action follow-up — RESOLVED (slice 27 verification, 2026-04-27).** Verified via code-trace and slice-27 critique that the engine **does** deadlock without the nudge — `HumanPlayer.setTriggerAutoOrder` at `:2811-2856` mutates the deferred-last pile but never calls `notifyAll()` on the response monitor that `waitForResponse(game)` at `:1550` is blocked on. **Resolution: option (a) — facade-side synthesis.** `GameStreamHandler.handlePlayerAction` detects `TRIGGER_AUTO_ORDER_*_LAST` after the upstream `sendPlayerAction` succeeds and immediately calls `embedded.server().sendPlayerUUID(gameId, sessionId, null)`. This is invisible to the wire (no extra inbound frame from the client) and uses the same upstream method Swing uses (`GamePanel.java:3085`, `:3096`). Tests: `GameStreamHandlerTest.playerAction_triggerAutoOrderAbilityLast_synthesizesNullUuidNudge` asserts no `streamError` is emitted on the dispatch path; live verification covered by ADR 0009 live-test plan T27.3.
4. **`WebCardView.sourceLabel`:** the AbilityView-specific `sourceName` and `sourceCard` fields are dropped today (F3). Slice 26 ships without them and uses `rules[0]` text alone. **Verify** in fixture testing whether this is enough — for emblems and dungeons the rule text doesn't include the source. If a "from: <source>" subtitle is needed, slice 28 polish extends `WebCardView`.
5. **`isAutoOrderTrigger` per-user pref + slice-26 testability:** the engine consults `getControllingPlayersUserData(game).isAutoOrderTrigger()` at `HumanPlayer.java:1465` — when **off**, the same-rule-text-and-targets short-circuit at `:1488-1517` is disabled. This is a UserData pref, **not on `PlayerActionAllowList`**, and not currently plumbed through the WebApi. Default upstream is `true`. **Out of scope for this ADR** (call out as N12-style polish if a player wants identical-trigger prompts). The webclient surfacing of UserData prefs is the same Phase 6 item ADR 0008 §7.6 already flagged for `isStopOnDeclareAttackers`. **Slice-26 implication:** the default (`true`) means many "obvious" multi-trigger setups will **not** prompt — e.g. two `Soul Warden`s on the battlefield triggering on the same creature ETB will auto-pick (identical rule text + identical resolved targets). Slice 26 fixture testing must use **distinct** rule text to actually exercise the prompt path: e.g. Soul Warden + Soul's Attendant (different printed names, different `{this}` substitutions yield different rule strings), or two unrelated upkeep triggers. Otherwise the prompt won't fire and the bug appears "fixed" by accident.
6. **Stack visualization:** ADR 0008 §10 P5 flags "stack-object detail popovers (currently no UI for the stack at all beyond display)" as a polish gap. Trigger ordering benefits from being able to see the stack — knowing what's already there helps decide which trigger to put on next. **Recommend pulling P5 forward** if slice 26 testing shows the user can't reason about the trigger-order pick without it. Out of scope for this ADR; flagged.

---

## References

- [PATH_C_PLAN.md — Phase 5 (`docs/PATH_C_PLAN.md:160`)](../PATH_C_PLAN.md), R9 risk register entry (`:273`)
- [ADR 0007 — Game stream protocol](0007-game-stream-protocol.md) (D6 inbound, D7 DTO firewall)
- [ADR 0008 — Player interactions](0008-player-interactions.md) — §1.28 `gameTarget`, §1.29 `gameChooseAbility` (note: section incorrectly attributes trigger ordering to `gameChooseAbility`; corrected by this ADR), §3.1 `uuid` response, §4 `TRIGGER_AUTO_ORDER_*`, §99 N4
- Upstream `HumanPlayer.chooseTriggeredAbility` — `Mage.Server.Plugins/Mage.Player.Human/src/mage/player/human/HumanPlayer.java:1456-1573`
- Upstream `HumanPlayer.handleTriggerOrderPopupMenuEvent` — Swing client trigger-order context menu `Mage.Client/src/main/java/mage/client/game/GamePanel.java:3067-3147`
- Upstream `Game.fireSelectTargetTriggeredAbilityEvent` — `Mage/src/main/java/mage/game/GameImpl.java:3136-3138`
- Upstream `PlayerQueryEventSource.target(playerId, message, abilities)` — `Mage/src/main/java/mage/game/events/PlayerQueryEventSource.java:77-79`
- Upstream `PlayerQueryEvent.targetEvent(... abilities)` — `Mage/src/main/java/mage/game/events/PlayerQueryEvent.java:192-194` (sets `QueryType.PICK_ABILITY` and `options["queryType"]`)
- Upstream `GameController` controller switch — `Mage.Server/src/main/java/mage/server/game/GameController.java:193-195` (PICK_ABILITY → target), `:880-885` (target builds `CardsView`)
- Upstream `GameSessionPlayer.target` — `Mage.Server/src/main/java/mage/server/game/GameSessionPlayer.java:56-63` (fires `GAME_TARGET`)
- Upstream `CardsView(Collection<? extends Ability>, Game)` — `Mage.Common/src/main/java/mage/view/CardsView.java:66-181`
- Upstream `AbilityView` — `Mage.Common/src/main/java/mage/view/AbilityView.java`
- Upstream `ClientCallbackMethod` (no `SELECT_TRIGGERED_ABILITY` enum) — `Mage.Common/src/main/java/mage/interfaces/callback/ClientCallbackMethod.java`
- Upstream Swing `GamePanel.pickTarget` (TRIGGER_ORDER popup gating) — `Mage.Client/src/main/java/mage/client/game/GamePanel.java:2060-2093`
- Facade mapper — `Mage.Server.WebApi/src/main/java/mage/webapi/mapper/GameViewMapper.java:207-286`
- Facade DTO — `Mage.Server.WebApi/src/main/java/mage/webapi/dto/stream/WebClientMessageOptions.java`
- Facade allow-list — `Mage.Server.WebApi/src/main/java/mage/webapi/ws/PlayerActionAllowList.java:43-48`
- Webclient interaction mode — `webclient/src/game/interactionMode.ts`
- Webclient click router — `webclient/src/game/clickRouter.ts`
- Webclient dialog — `webclient/src/pages/GameDialog.tsx:117-129`, `:256-342` (TargetDialog)
- Schema CHANGELOG — `docs/schema/CHANGELOG.md` (current 1.15; this ADR bumps to 1.16)
