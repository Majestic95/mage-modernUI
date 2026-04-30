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

## 1.22 — 2026-04-29 — Player colorIdentity for halo rendering (slice 70-D)

Adds one additive field — `WebPlayerView.colorIdentity: string[]` —
to drive the PlayerFrame halo per design-system §7.3 / ADR 0011 D5.
Default-safe: older clients ignore the field; older 1.21 servers
omit it and the client falls back to `[]` (neutral team-ring via
`--color-team-neutral`).

ADR 0011 originally targeted schema 1.21 for this field, but slice
72-A (deck-legality wire surface) shipped 1.21 first. The bump is
1.21 → 1.22; the additive contract is unchanged.

### `WebPlayerView` — added `colorIdentity` field

```diff
   "teamId":        null,
+  "colorIdentity": ["W", "U", "B"]
 }
```

List of single-character MTG color codes (`W` / `U` / `B` / `R` /
`G`) representing the union color identity of the player's
commander(s). Empty list for non-commander formats. For partner /
background pairings the list is the union of both commanders'
identities. Order is WUBRG (standard MTG color-pie traversal) so
the wire shape is stable across renders.

### Forward-compat note

A 1.21 client receiving a 1.22 payload ignores `colorIdentity`
silently — the existing PlayerArea has no halo today and will not
notice the extra field. A 1.22 client receiving a 1.21 payload
defaults the field to `[]` via `z.array(z.string()).default([])`,
which renders as the neutral team-ring rather than a wrong color.
No schema-version-mismatch error fires (additive change, minor
bump).

---

## 1.21 — 2026-04-29 — Deck-legality surface (slice 72-A)

Adds the structured deck-validator surface: a new pre-flight endpoint,
a new error code, and an additive `validationErrors` field on the
`WebError` envelope. All changes are additive — older clients ignore
the new field and fall back to displaying `WebError.message` alone.

### New endpoint — `POST /api/decks/validate?deckType=...`

Authed, takes a `WebDeckCardLists` body, returns
`WebDeckValidationResult`:

```json
{
  "schemaVersion": "1.21",
  "valid":         false,
  "partlyLegal":   true,
  "errors": [
    { "errorType":   "DECK_SIZE",
      "group":       "Deck",
      "message":     "Must contain at least 100 cards: has only 60 cards",
      "cardName":    null,
      "partlyLegal": true,
      "synthetic":   false }
  ]
}
```

Always 200 OK — the endpoint succeeded; only the deck failed. Errors
are pre-sorted by upstream's
`DeckValidator.getErrorsListSorted(maxErrors)` (PRIMARY → DECK_SIZE →
BANNED → WRONG_SET → OTHER) and capped at 50 entries with the engine's
overflow sentinel (`OTHER, "...", "and more N error[s]"`) appended when
the cap is hit. The mapper marks the sentinel via `synthetic=true` so
clients render it as a non-clickable footer rather than a real error.

The deck-LEVEL `partlyLegal` field is the rollup: true iff `valid` is
true OR every remaining error has `partlyLegal=true` (today only
`DECK_SIZE` qualifies). This is the boolean to switch on for the
amber "legal once finished" badge vs. red "needs card changes" — do
not re-derive it from `errors[].partlyLegal` client-side.

`deckType` must match a value from `/api/server/state` `deckTypes`.
Unknown deckType → `400 UNKNOWN_DECK_TYPE`. Unparseable deck (cards
missing from the local repository) → `400 INVALID_DECK_FORMAT`. Deck
exceeding 250 line entries → `413 DECK_TOO_LARGE` (CPU-budget cap;
1 MB body cap also applies globally).

### New error code — `DECK_INVALID`

Distinct from existing `UPSTREAM_REJECTED`. Surfaces from the
table-join path when the joining player's deck fails the table's
format validator. Pairs with the new `validationErrors` field below.

### `WebError` — added `validationErrors` field

```diff
 {
   "schemaVersion":    "1.21",
   "code":             "DECK_INVALID",
   "message":          "Deck failed validation for the Commander format.",
+  "validationErrors": [ WebDeckValidationError, ... ]
 }
```

Optional, list-shaped. Present (and non-null) only when
`code == "DECK_INVALID"`. For all other 4xx/5xx paths the field is
absent from the wire — Jackson omits it via `@JsonInclude(NON_NULL)`.
Same `WebDeckValidationError` shape as the pre-flight endpoint, so
clients have one renderer for both surfaces. Note: the join-time
422 surface intentionally does NOT include the deck-level
`partlyLegal` rollup — at table-join the verdict is binary (the
table rejected you), and the per-error `partlyLegal` flag suffices
for any per-row styling.

### Forward-compat note

Older 1.20 clients hitting a 1.21 server: the new `validationErrors`
field is dropped silently (Jackson `FAIL_ON_UNKNOWN_PROPERTIES=false`
is the default), so the existing `message` text is what they render.
The pre-flight endpoint is opt-in — older clients simply don't call
it.

---

## 1.20 — 2026-04-29 — Multiplayer wire shape (slice 69a, ADR 0010 v2)

Adds three additive fields to land the v2 multiplayer wire contract.
All three are default-safe: older fixtures parse cleanly via
`z.default(...)` and any 1.19 server keeps working with a 1.20 client.

Slice 69a ships the **wire shape only**; value population for the two
mapper fields lands in slice 69b alongside the live-game-access
plumbing the mapper needs to read `MatchType` / `Permanent`.

### `WebPlayerView` — added `teamId` field

```diff
   "designationNames": [],
   "commandList":      [],
+  "teamId":           null
 }
```

Team UUID for 2HG / multi-team formats. Null for FFA and 1v1 (each
player a "team of one" is not modeled — null is the no-team sentinel).
Slice 69b populates from `MatchType.getPlayersPerTeam()` + seat-index;
slice 69a always emits null.

### `WebPermanentView` — added `goadingPlayerIds` field

```diff
   "attachedTo":          "",
   "attachedToPermanent": false,
+  "goadingPlayerIds":    []
 }
```

UUIDs of players who have goaded this permanent (CR 701.42). Empty
array when not goaded. Slice 69b populates from
`Permanent.getGoadingPlayers()`; slice 69a always emits `[]`. Upstream
`PermanentView` doesn't carry goading info, so the value fill needs the
live `Permanent` via game lookup.

### `WebStreamHello` — added `protocolVersion` field

```diff
   "gameId":          "<game-uuid>",
   "username":        "alice",
-  "mode":            "live"
+  "mode":            "live",
+  "protocolVersion": 2
 }
```

Negotiated handshake contract version. Distinct namespace from
`schemaVersion`: `schemaVersion` is the JSON wire format,
`protocolVersion` is the handshake contract (frame ordering, route
semantics, close-code meanings). New constant
`mage.webapi.ProtocolVersion`: `CURRENT = 2`, `SUPPORTED = {1, 2}`.

Server-side handshake: parses `?protocolVersion=` query param at WS
upgrade. Absent → default to `CURRENT` (lenient backwards-compat for
pre-slice-69b webclients that don't send the param yet). Explicit value
not in `SUPPORTED` → close `4400` with reason
`PROTOCOL_VERSION_UNSUPPORTED:supported=[1, 2]`.

### `dialogClear` envelope (slice 69c)

```
{
  "schemaVersion": "1.20",
  "method":        "dialogClear",
  "messageId":     <triggering-frame-msgid>,
  "objectId":      "<game-uuid>",
  "data":          { "playerId": "<leaver-uuid>", "reason": "PLAYER_LEFT" }
}
```

Synthetic teardown signal emitted when a player leaves the game
(concession, timeout, disconnect). Server detects the
`PlayerView.hasLeft()` 0→1 transition between consecutive
`gameUpdate` / `gameInit` / `gameInform` frames for the same gameId
and synthesizes the frame after the triggering update. Clients
dismiss any open dialog targeting the leaver. Per ADR 0010 v2 D11b:
fire-and-forget UX teardown, not a state-machine transition — if
the engine then re-prompts a different player after the skip, that
arrives as a fresh `gameAsk` / `gameTarget` / `gameSelect` envelope.

`reason` is a short machine-parseable code; v2 emits `"PLAYER_LEFT"`
for any leaver detection. Future v3 may add `"TIMEOUT"` /
`"DISCONNECT"` / `"ELIMINATED"` if upstream surfaces them distinctly.

The frame's `messageId` matches the triggering callback's so the
synthesized frame sits adjacent to the `gameUpdate` in the resume
buffer — reconnect with `?since=N` replays both in order.

### Backwards compatibility

Additive minor bump. Older webclients (1.19 or earlier) keep working
with a 1.20 server — they ignore the new fields and don't send
`protocolVersion` (server defaults to 2). They also harmlessly drop
unknown `dialogClear` frames (per the slice-3 default-handler path,
unknown methods log-and-skip rather than crash). Older servers (1.19
or earlier) keep working with a 1.20 webclient because of the
`z.default(...)` clauses on each new field, and they simply never
emit `dialogClear` (no source for the transition detection).

### Slice provenance

- Slice 69a (2026-04-29): added the three additive *fields*
  (`teamId`, `goadingPlayerIds`, `protocolVersion`) and the WS
  handshake validation. Mapper stub-populated all multiplayer
  fields with null / empty arrays — wire shape only.
- Slice 69c (2026-04-29): plumbed live `Game` access through the
  mapper. Populated `goadingPlayerIds` from
  `Permanent.getGoadingPlayers()`. Added D1 range-of-influence
  filter (drops out-of-range opponents from `gv.players` per
  recipient). Added the `dialogClear` envelope above + the
  `hasLeft` transition detector that emits it.
- `teamId` stays null in v2 per ADR R1 — upstream xmage ships no
  2HG match plugin, so no game produces team-grouped state. The
  wire field is forward-compat for a v3+ ADR if upstream ever
  adds 2HG.

---

## 1.19 — 2026-04-28 — Underlying-card UUID on `WebCardView` (slice 52a)

Adds a `cardId` field to `WebCardView` carrying the underlying
Magic-card UUID. For hand / battlefield / graveyard / exile /
sideboard / library, `cardId` equals `id` — upstream's
`CardView.getId()` for those zones already *is* the
`Card.getId()`. For the **stack**, however, upstream constructs
the view from a `Spell` whose `getId()` is a fresh `SpellAbility`
UUID minted at cast time; `cardId` recovers the underlying
`Spell.getCard().getId()` so a single physical card retains a
stable identifier as it crosses zones (hand → stack →
battlefield/graveyard).

Slice 52a — server-side plumbing only.

### `WebCardView` — added `cardId` field

```diff
   "id":               "<view-uuid>",
+  "cardId":           "<underlying-card-uuid>",
   "name":             "Lightning Bolt",
```

### Motivation

Enables cross-zone Framer Motion `layoutId` animation in the
webclient: the same physical card animates from hand to stack to
graveyard with shared layout because `cardId` is stable across
those transitions, even though `id` is re-issued for the stack
view.

### Backwards compatibility

Additive minor bump. Consumers that ignore the field continue to
work; older fixtures parse cleanly via `z.default('')` on the
webclient side once the Zod schema picks the field up.

### Server impact

- `CardViewMapper` populates `cardId` from
  `Spell.getCard().getId()` when the upstream view is a
  spell-on-stack, and from `CardView.getId()` everywhere else.
- New `StackCardIdHint` / `GameLookup` indirection lets the
  mapper resolve the underlying card without a hard dependency on
  the upstream `Game` object.

---

## 1.18 — 2026-04-27 — Source-label attribution on AbilityView (ADR 0009 slice 28)

Adds `sourceLabel` to `WebCardView`. Empty for ordinary cards;
populated with the source card's name when the upstream view is an
`AbilityView` (i.e. the entry came through the trigger-ordering
or activated-ability path). Lets the renderer surface
"from: ‹Soul Warden›" / "from: ‹Atraxa, Praetors' Voice›" /
"from: ‹Helm of the Host emblem›" attribution beneath each rule.

ADR 0009 slice 28.

### `WebCardView` — added `sourceLabel` field

```diff
   "transformed":     false,
   "secondCardFace":  null,
+  "sourceLabel":     ""
 }
```

Defaults to empty string (additive minor — older fixtures parse
cleanly via `z.default('')` on the webclient).

### Webclient impact

- `OrderTriggersDialog` row chrome shows "from: ‹label›" beneath
  the rule text when `sourceLabel` is present.
- New "Reset all auto-order settings" footer button on the panel
  for discoverability — same dispatch as the per-row menu item but
  always visible.

### Server impact

- `CardViewMapper.toCardDto` adds an `extractSourceLabel` helper
  that detects `AbilityView` and reads `getSourceCard().getName()`
  (the public accessor — `sourceName` is a private field with no
  getter, but the source CardView carries the same name per
  `CardsView.java:140`).

### Non-impact

- `WebPlayerAction` shapes from 1.17 are unchanged.
- `WebClientMessageOptions.isTriggerOrder` from 1.16 unchanged.

---

## 1.17 — 2026-04-27 — Trigger auto-order action data shapes (ADR 0009 slice 27)

Adds per-action `data` shapes for the four `TRIGGER_AUTO_ORDER_*_FIRST/_LAST`
playerAction enum values. Discriminator is the action enum, not the data
shape — server-side `decodeActionData` switches on action and pulls the
right field.

ADR 0009 D5 / slice 27.

### `WebPlayerAction.data` — new accepted shapes

```diff
   "type": "playerAction",
   "action": "TRIGGER_AUTO_ORDER_ABILITY_FIRST",
+  "data":   { "abilityId": "<uuid>" }
 }
```

```diff
   "type": "playerAction",
   "action": "TRIGGER_AUTO_ORDER_NAME_FIRST",
+  "data":   { "ruleText": "When Soul Warden enters..." }
 }
```

`_RESET_ALL` keeps `data: null` (existing default). The `_NAME_*` actions
require the rule text already substituted for `{this}` (engine throws on
unsubstituted strings); the webclient does this client-side mirroring
upstream Swing's `GamePanel.handleTriggerOrderPopupMenuEvent` pattern.

### Webclient impact

- New hamburger menu on each row of `OrderTriggersDialog` opens the
  five `TRIGGER_AUTO_ORDER_*` options.
- Two-step dispatch for `_FIRST` actions: send the action, then send
  `playerResponse{kind:"uuid", value: abilityId}` so the engine
  un-blocks (Swing pattern at `GamePanel.java:3081` / `:3090`).
- `_LAST` and `_RESET_ALL` close the dialog and wait for the engine
  to re-fire.

### Server impact

- `GameStreamHandler.decodeActionData` adds four `case` arms for the
  new action values.
- No DTO changes — `WebPlayerAction.data` was already a free-form
  JSON node; the addition is the *accepted shape*, not the schema.

---

## 1.16 — 2026-04-27 — Trigger-order discriminator (ADR 0009)

Adds an `isTriggerOrder` boolean to `WebClientMessageOptions`. The
flag flips on when upstream's `GameClientMessage.options` carries
`queryType == PlayerQueryEvent.QueryType.PICK_ABILITY` — the
trigger-ordering engine path. The wire frame stays `gameTarget`;
the boolean lets the webclient branch into the dedicated
`OrderTriggersDialog` UI surface (rule text rows, single-shot
click-to-pick) instead of rendering the regular target picker.

ADR 0009 D2 / D3.

### `WebClientMessageOptions` — added `isTriggerOrder` field

```diff
   "specialButton":     "All attack",
+  "isTriggerOrder":    false
 }
```

Defaults to `false` (additive minor — older fixtures parse cleanly
via `z.default(false)` on the webclient).

### Webclient impact

- `interactionMode` gains a new `kind: 'orderTriggers'` discriminant.
- `clickRouter` adds an `orderTriggers` arm; `isBoardClickable`
  returns `false` for that mode (ability rows live in the panel,
  not on the board).
- New `OrderTriggersDialog` component renders rows from
  `cardsView1[id].rules.join(' ')`.

### Server impact

- `WebClientMessageOptions` Java record gains a sixth field.
- `GameViewMapper.extractOptions` reads `source.get("queryType")`
  and compares against `PlayerQueryEvent.QueryType.PICK_ABILITY`.

### Non-impact

- `WebPlayerAction.data` is unchanged in 1.16 — slice 27 of ADR
  0009 will add the `{ abilityId }` shape for `TRIGGER_AUTO_ORDER_*`
  actions and that's a separate schema bump.

---

## 1.15 — 2026-04-26 — Client-message options carrier (audit gap U1 + B4)

Adds a structured `options` carrier on `WebGameClientMessage` so
upstream's free-form `Map<String, Serializable>` reaches the
webclient as a typed, whitelisted projection. Closes ADR 0008
gap U1 (mapper dropped `options`) and consumer #1 = B4 (mulligan
button labels).

### `WebGameClientMessage` — added `options` field

```diff
   "choice":  null,
+  "options": {
+    "leftBtnText":       "Mulligan",
+    "rightBtnText":      "Keep",
+    "possibleAttackers": [],
+    "possibleBlockers":  [],
+    "specialButton":     ""
+  }
 }
```

The field is always present — empty strings / empty lists signal
"upstream did not populate this key". Five fields cover every
GameClientMessage-shaped frame's known consumers in 1v1 duel:

- `leftBtnText` / `rightBtnText` — upstream's
  `"UI.left.btn.text"` / `"UI.right.btn.text"` button-label
  overrides. Mulligan loop populates these as `"Mulligan"` /
  `"Keep"` (`HumanPlayer.java:404-405`); Proliferate /
  Time Travel use `"Done"` for right.
- `possibleAttackers` / `possibleBlockers` — UUID lists for the
  combat declare-attackers / declare-blockers prompts. Populated
  by upstream's `HumanPlayer.selectAttackers` /
  `selectBlockers`. Slice 20 (B1) consumer.
- `specialButton` — text for the `"All attack"` button during
  declare-attackers (slice 20 consumer).

### Closed surface — not a passthrough

Anything outside the whitelist is dropped at the mapper. Adding a
new key = extend the record + bump schema. Don't widen to a
generic `Map<String, ?>` — type safety lives in the carrier
record; webclient's `WebClientMessageOptions` Zod schema mirrors it.

### Consumer #1: mulligan button labels (gap B4)

`YesNoDialog` reads `options.leftBtnText` / `rightBtnText` when
non-empty and renders them in place of the default Yes/No labels.
The mulligan dialog now says "Mulligan" / "Keep" instead of
generic Yes/No, and any future spell with `UI.*.btn.text`
overrides (Proliferate, Time Travel, etc.) gets the right labels
for free.

---

## 1.14 — 2026-04-26 — Sideboard wire format

Adds the `sideboard` callback frame and the deck-submit endpoint —
previously the engine was firing `User.ccSideboard` between games of
a sideboarded match and the webclient was dropping the frame on the
floor (no handler), leaving the user stranded between game 1 and
game 2.

### New `sideboard` frame

Server fires this once per player at the start of each post-game-1
sideboarding window. Carries `WebSideboardInfo`:

```json
{
  "deck":           { "name": "...", "mainList": [...], "sideboard": [...] },
  "tableId":        "uuid",
  "parentTableId":  "uuid | <empty for non-tournament tables>",
  "time":           600,
  "limited":        false
}
```

`mainList` and `sideboard` are arrays of `WebSimpleCardView`:

```json
{
  "id":               "uuid",
  "name":             "Counterspell",
  "expansionSetCode": "ICE",
  "cardNumber":       "61",
  "usesVariousArt":   false
}
```

`name` is resolved server-side via `CardRepository.findCard(setCode,
cardNumber)` so the webclient renders without a card-database round
trip. Lookup misses fall back to `"<set>:<number>"` rather than
breaking the picker.

### New `POST /api/tables/{tableId}/deck` endpoint

Body: `WebDeckCardLists` (the same DTO used at table-join time, so
no new wire shape on the inbound side). Query param `?update=true`
switches dispatch from final submit (`MageServer.deckSubmit`) to
autosave (`MageServer.deckSave`); default (omitted / false) is
final submit.

Returns 204 on success. 422 `UPSTREAM_REJECTED` when the table is
not in a sideboarding/constructing state, the deck fails format
validation, or the player has quit.

---

## 1.13 — 2026-04-26 — Audit tier-3: command-zone wire support

Closes the last tier-3 gap from the architectural review:
* §4 — `WebPlayerView.commandList` was missing; commander, emblem,
  dungeon, and plane objects had no representation on the wire even
  though upstream's `PlayerView.commandObjectList` populates all four.

After this bump, Commander matches surface the actual commander card
in the command zone (rather than vanishing into thin air), and
non-commander formats correctly show emblems from cards like Sorin,
Lord of Innistrad and dungeons from D&D-set effects.

### `WebPlayerView` — added `commandList` field

```diff
   "designationNames": []
+  "commandList":      []
 }
```

The new field is always present (empty list when unused). Forward-
compatible: a 1.12 client parsing 1.13 simply ignores the unknown
field; a 1.13 client parsing 1.12 sees `commandList: []` via Zod's
default. No major bump.

### New `WebCommandObjectView` record

7 fields collapsing the 4 upstream `CommandObjectView` impls
(`CommanderView`, `EmblemView`, `DungeonView`, `PlaneView`) behind a
`kind` discriminator:

```json
{
  "id":               "uuid",
  "kind":             "commander | emblem | dungeon | plane",
  "name":             "Atraxa, Praetors' Voice",
  "expansionSetCode": "C16",
  "imageFileName":    "atraxa-praetors-voice",
  "imageNumber":      1,
  "rules":            ["Flying, vigilance...", "..."]
}
```

Unknown subclasses default to `commander` rather than throwing — keeps
the wire format degrading gracefully if upstream adds a fifth
subclass later.

---

## 1.12 — 2026-04-26 — Audit tier-2: DFC support + 3 deferred dialog frames

Closes the audit-tier-2 gaps from the architectural review:
* §3 — `WebCardView` lacked transform / MDFC back-face data
* §2 — three of the seven prompt types from
  `Mage.Server/.../GameSessionPlayer.java` weren't yet on the wire

After this bump, modal spells (every Charm cycle, Cryptic Command,
mode-of-N picks), X-cost spells (Fireball, Walking Ballista),
multi-ability cards (anything with two activated abilities), and
transform / MDFC cards (every Innistrad / Zendikar Rising onward
double-face card) all have the wire-format support they need.

### `WebCardView` — DFC / MDFC back-face data (19 → 22 fields)

```diff
   "faceDown":         false,
   "counters":         {},
+  "transformable":    false,
+  "transformed":      false,
+  "secondCardFace":   null
```

`transformable` is true when the card has a flippable back face
(transformable cards from Innistrad onward AND modal-DFCs from
Zendikar Rising onward). `transformed` is the current state — false
= front face shown, true = back face shown. `secondCardFace`
recursively carries a `WebCardView` for the back face; recursion is
**capped at one level** — the back face's `secondCardFace` is always
null on the wire. Mirrors upstream's recursive
`mage.view.CardView.secondCardFace` which itself never recurses past
the first back face.

### New outbound methods (3)

| `method` | `data` shape | When |
|---|---|---|
| `gamePlayXMana` | `WebGameClientMessage` | Upstream `GAME_PLAY_XMANA` — X-cost spell payment prompt |
| `gameChooseChoice` | `WebGameClientMessage` (with `choice` field populated) | Upstream `GAME_CHOOSE_CHOICE` — modal-spell / replacement-effect picker |
| `gameChooseAbility` | `WebAbilityPickerView` | Upstream `GAME_CHOOSE_ABILITY` — multi-ability picker; trigger-ordering |

Inbound responses (per [ADR 0007 D6](../decisions/0007-game-stream-protocol.md#d6)):

| Frame method | `playerResponse.kind` | `value` |
|---|---|---|
| `gamePlayXMana` | `boolean` | continue paying / cancel |
| `gameChooseChoice` | `string` | the chosen key from `choice.choices` |
| `gameChooseAbility` | `uuid` | the chosen ability's UUID |

### `WebGameClientMessage` — adds `choice` (7 → 8 fields)

```diff
   "min": 0,
   "max": 0,
   "flag": false,
+  "choice": null
```

`choice: WebChoice | null` — populated only for `gameChooseChoice`
frames; null on every other dialog frame.

### New DTO `WebChoice`

```json
{
  "message":    "Choose one —",
  "subMessage": "",
  "required":   true,
  "choices":    {
    "destroy": "Destroy target creature.",
    "counter": "Counter target spell."
  }
}
```

Narrowed view of upstream `mage.choices.Choice` (4 fields). Flattens
upstream's `getChoices(): Set<String>` + `getKeyChoices(): Map<String,
String>` distinction into a single `Map<String, String>` — when
upstream isn't in key-mode, the mapper synthesizes
`key == label`. Slice 8+ adds the deferred UI hints
(`isManaColorChoice`, `searchEnabled`, `sortEnabled`, `hintData`).

### New DTO `WebAbilityPickerView`

```json
{
  "gameView": { ... },
  "message":  "Choose spell or ability to play",
  "choices":  {
    "<ability-uuid-1>": "1. Activate ability A",
    "<ability-uuid-2>": "2. Activate ability B"
  }
}
```

Mirror of upstream `mage.view.AbilityPickerView` (3 fields). Distinct
from `WebGameClientMessage` because upstream's `AbilityPickerView` is
a separate class; the wire format reflects that. `choices` preserves
upstream's `LinkedHashMap` insertion order so the renderer gets a
stable list.

### Surfaced by

[Architectural review checklist §2 + §3](../decisions/0007-game-stream-protocol.md)
— "happy-path bias" hit on all three deferred dialog frames; "view-
object surface drift" hit on missing DFC fields.

---

## 1.11 — 2026-04-26 — Audit fixes: drop tokenSetCode + add attachedToPermanent

Two tier-1 wire-format fixes from the architectural review of Phase 3:

### `WebCardView` — drop `tokenSetCode` (20 → 19 fields)

Slice 4 introduced `tokenSetCode: String` as if there was an upstream
`getTokenSetCode()` getter, but a search of the upstream tree
(`grep -rn "getTokenSetCode" /f/xmage --include='*.java'`) returns only
our own files. The field has been hardcoded empty since slice 4
shipped — a permanently-empty wire field that promised data we never
wired. Removed in 1.11.

**Token art lookup remains an open problem.** Scryfall serves token
images at `<setcode>t/<num>` (e.g., `m21t/1`) but constructing that
key from upstream requires understanding the relationship between
`expansionSetCode` / `cardNumber` / `imageFileName` / `imageNumber`
on a `PermanentToken`. Slice 7+ research item; reintroduce
`tokenSetCode` (or a renamed equivalent) once the semantics are
firmed up.

### `WebPermanentView` — add `attachedToPermanent: boolean` (10 → 11 fields)

Mirrors upstream `mage.view.PermanentView.attachedToPermanent`
(line 37). Without this, clients couldn't tell whether `attachedTo`
referenced a permanent (Equipment / most Auras) or a player (Aura
curses). Renderers handling attachment lines need this disambiguator.

```diff
   "attachments":         [...],
   "attachedTo":          "<uuid>",
+  "attachedToPermanent": false,
```

`true` when `attachedTo` references a battlefield permanent;
`false` when it's a player UUID **or** when `attachedTo` is empty.

### Surfaced by

[Architectural review checklist §3 + §12 self-checks](../decisions/0007-game-stream-protocol.md)
— "hallucinated upstream internal" pattern hit on `tokenSetCode`;
"happy-path bias" hit on missing `attachedToPermanent`.

---

## 1.10 — 2026-04-26 — Dialog family + inbound playerAction / playerResponse (Phase 3 slice 6)

Phase 3 exit gate. Slice 6 ships the input side of the WebSocket
protocol — the dialog frames the server emits when a human's input is
required, plus the inbound envelopes that carry that input back. After
this bump a 1v1-vs-AI duel is fully drivable end-to-end through the
WebSocket. Existing payloads keep their shape; their reported
`schemaVersion` value bumps to `"1.10"`.

### New outbound dialog methods

All carry the (now-extended) `WebGameClientMessage` payload, except
`gameError` which synthesizes one from the upstream bare-string
payload. Each one corresponds to a specific input kind via the
inbound `playerResponse` envelope.

| `method` | Answered with | When |
|---|---|---|
| `gameAsk` | `playerResponse{kind:"boolean"}` | Yes/no question |
| `gameTarget` | `playerResponse{kind:"uuid"}` | Pick a target — frame carries `cardsView1` (eligible cards) + `targets` (eligible IDs) + `flag` (required) |
| `gameSelect` | `playerResponse{kind:"uuid"}` | Pick a selectable |
| `gamePlayMana` | `playerResponse{kind:"boolean"}` | Mana payment dialog |
| `gameSelectAmount` | `playerResponse{kind:"integer"}` | Pick an integer in `[min, max]` |
| `gameInformPersonal` | (no response) | Personal status text |
| `gameError` | (no response) | Game-rules error text — upstream `GAME_ERROR` carries a bare String, mapper synthesizes a `WebGameClientMessage` with only `message` populated |

### `WebGameClientMessage` — extended shape

```diff
   "gameView":   { ... full WebGameView ... } | null,
   "message":    "Pick a target.",
+  "targets":    ["<uuid>", ...],
+  "cardsView1": { "<uuid>": <WebCardView>, ... },
+  "min":        0,
+  "max":        0,
+  "flag":       false,
```

Slice 5 (`gameInform` / `gameOver`) frames now include the new fields
as defaults (empty list, empty map, 0/0/false) — non-breaking minor
bump because the webclient Zod schema passes through extra fields.

Still deferred (slice 7+): `gameChooseAbility` (needs
`AbilityPickerView`), `gameChooseChoice` (needs `Choice`),
`gameChoosePile` (needs `cardsView2`), `gamePlayXMana`,
`gameSelectMultiAmount` (needs `MultiAmountMessage[]`),
`userRequestDialog`. These are rare in basic vs-AI play.

### New inbound types

#### `playerAction` — toggles, lifecycle, pass-priority modes

```json
{ "type": "playerAction", "action": "PASS_PRIORITY_UNTIL_TURN_END_STEP", "data": null }
```

`action` must be one of the **40-value `PlayerActionAllowList`** —
the server-relevant subset of upstream's 59-value `PlayerAction`
enum. Values rejected from the wire:

- `CLIENT_*` (13 values) — Swing-UI-only enums (download images,
  quit-tournament, exit-app, remove-table, reconnect, replay-action,
  etc.); never sent to the server in upstream's design
- `TOGGLE_RECORD_MACRO` — debug-only

The allow-list is locked by a snapshot test
(`PlayerActionAllowListTest`) — adding an upstream enum value forces
a deliberate include/exclude decision.

`data` is null for most actions. Documented exceptions:

| Action | `data` shape |
|---|---|
| `ROLLBACK_TURNS` | `{"turns": <int>}` or bare int |
| `REQUEST_AUTO_ANSWER_ID_*` / `_TEXT_*` | `{"text": "<id-or-text>"}` or bare string |

Failure modes (in-band `streamError`):

| `code` | When |
|---|---|
| `BAD_REQUEST` | Missing `action` field, unknown enum name |
| `NOT_ALLOWED` | Enum is valid but client-only / off the allow-list |
| `UPSTREAM_ERROR` | Upstream `MageException` |
| `UPSTREAM_REJECTED` | Upstream rejected (no game, wrong phase, etc.) |

#### `playerResponse` — answers a server-side dialog

```json
{ "type": "playerResponse", "messageId": 1234, "kind": "uuid", "value": "<uuid>" }
```

`messageId` echoes the dialog frame this answers (server tracks
correlation upstream-side). `kind` is one of:

| `kind` | Maps to | `value` shape |
|---|---|---|
| `uuid` | `sendPlayerUUID` | string (UUID) |
| `string` | `sendPlayerString` | string |
| `boolean` | `sendPlayerBoolean` | bool |
| `integer` | `sendPlayerInteger` | int |
| `manaType` | `sendPlayerManaType` | `{ "playerId": "<uuid>", "manaType": "<enum>" }` |

`manaType` carries the playerId because `sendPlayerManaType` requires
it upstream-side (the player whose mana pool is being paid from).
Other kinds resolve the source player from the WS session
automatically.

### Phase 3 status

After slice 6, the WebSocket protocol is **feature-complete for the
1v1-vs-AI duel scenario** — the Phase 3 exit gate. The webclient
needs to:

1. Render any `WebGameView` (battlefield + hand + stack + combat — slice 4 + 5)
2. Send `playerAction` for pass-priority + concede
3. Render dialog frames and respond with `playerResponse`

…and a full duel runs end-to-end through the WebSocket. Phase 4 work
on the actual game-window UI now has every wire-format piece it
needs. Slice 7+ adds the deferred dialog frames (multi-amount,
choose-ability, choose-pile) when the renderer surfaces them.

---

## 1.9 — 2026-04-26 — Stack, combat, zone maps, game-end frames (Phase 3 slice 5)

Slice 5 finishes the visible-state contract — every zone the game
window renders is now on the wire. After this bump the webclient has
everything it needs to render any game position; slice 6 ships the
input side (dialog frames + WebPlayerAction / WebPlayerResponse).
Existing payloads keep their shape; their reported `schemaVersion`
value bumps to `"1.9"`.

### New outbound methods

| `method` | `data` shape | When |
|---|---|---|
| `gameInform` | `WebGameClientMessage` | Upstream `GAME_UPDATE_AND_INFORM` — state change with feedback text |
| `gameOver` | `WebGameClientMessage` | Upstream `GAME_OVER` — single game in the match has ended |
| `endGameInfo` | `WebGameEndView` | Upstream `END_GAME_INFO` — match-end summary screen |

### New DTOs

#### `WebCombatGroupView` (nested in `WebGameView.combat`)

```json
{
  "defenderId":   "550e8400-...",
  "defenderName": "alice",
  "attackers":    { "<uuid>": <WebPermanentView>, ... },
  "blockers":     { "<uuid>": <WebPermanentView>, ... },
  "blocked":      false
}
```

The defender is either a player or a planeswalker permanent; upstream
already resolves the display name in either case.

#### `WebGameClientMessage` (nested under `data` for `gameInform` / `gameOver`)

```json
{
  "gameView": { ... full WebGameView ... },
  "message":  "Lightning Bolt resolves: alice takes 3 damage."
}
```

Slice 5 ships the minimal subset. Slice 6 will extend with dialog
fields (`targets`, `min`/`max`, `cardsView1`, `flag`) once the
`gameAsk` / `gameTarget` / `gameSelectAmount` outbound mappings land.

#### `WebGameEndView` (nested under `data` for `endGameInfo`)

```json
{
  "gameInfo":       "You won the game on turn 7.",
  "matchInfo":      "You won the match!",
  "additionalInfo": "",
  "won":            true,
  "wins":           1,
  "winsNeeded":     1,
  "players":        [ <WebPlayerView>, ... ]
}
```

### Updated DTOs

#### `WebGameView` — adds `stack` + `combat`

```diff
   "myPlayerId":     "550e8400-...",
   "myHand":         { ... },
+  "stack":          { "<uuid>": <WebCardView>, ... },
+  "combat":         [ <WebCombatGroupView>, ... ],
   "players":        [ ... ]
```

`stack` is keyed by stack-object UUID. Both spells and stack abilities
serialize as `WebCardView` because upstream's `StackAbilityView`
extends `CardView` and the rules text is captured via
`WebCardView.rules`. Slice 6+ may add a richer `WebStackAbilityView`
if the renderer needs the source-card pointer.

`combat` is empty outside the combat phase.

#### `WebPlayerView` — `graveyardCount` / `exileCount` / `sideboardCount` → maps

```diff
-  "graveyardCount":   0,
-  "exileCount":       0,
-  "sideboardCount":   0,
+  "graveyard":        { "<uuid>": <WebCardView>, ... },
+  "exile":            { "<uuid>": <WebCardView>, ... },
+  "sideboard":        { "<uuid>": <WebCardView>, ... },
```

Insertion order matches upstream's `LinkedHashMap` traversal — top of
the graveyard pile (most recently put there) is the last entry.
`sideboard` is only populated for the controlled player or AI players
(opponents see an empty map).

`libraryCount` / `handCount` remain counts because card content is
private (the controlling player's hand is on `WebGameView.myHand`;
library content remains hidden).

### Known limitations (slice 6+)

- **Dialog family** (`gameAsk` / `gameTarget` / `gameSelect` /
  `gameChooseAbility` / `gameChoosePile` / `gameChooseChoice` /
  `gamePlayMana` / `gamePlayXMana` / `gameSelectAmount` /
  `gameSelectMultiAmount`) — slice 6 ships these alongside
  `WebPlayerAction` / `WebPlayerResponse` inbound envelopes.
- **Shared exile zones** (`GameView.exiles` top-level) — defer until
  the renderer needs them; per-player exile via `WebPlayerView.exile`
  covers the common case.
- **Revealed / looked-at / companion zones** — same.
- **Transform / flip second face** on `WebCardView` — defer.
- **`WebStackAbilityView`** with source-card pointer — defer.

After slice 6 lands the dialog family + inbound dispatch, a 1v1-vs-AI
duel is fully playable end-to-end through the WebSocket — the Phase 3
exit gate.

---

## 1.8 — 2026-04-26 — Battlefield + hand rendering (Phase 3 slice 4)

Slice 4 lands the card-detail mappers — the wire format finally
carries individual cards on permanents and in the controlling player's
hand. The battlefield + hand are the two zones the game window needs
to render before slice 5 fills in stack, exile, graveyard maps, and
combat. Existing payloads keep their shape; their reported
`schemaVersion` value bumps to `"1.8"`.

### New DTOs

#### `WebCardView` (nested)

```json
{
  "id":               "550e8400-...",
  "name":             "Lightning Bolt",
  "displayName":      "Lightning Bolt",
  "expansionSetCode": "LEA",
  "cardNumber":       "161",
  "manaCost":         "{R}",
  "manaValue":        1,
  "typeLine":         "Instant",
  "supertypes":       [],
  "types":            ["INSTANT"],
  "subtypes":         [],
  "colors":           ["R"],
  "rarity":           "COMMON",
  "power":            "",
  "toughness":        "",
  "startingLoyalty":  "",
  "rules":            ["Lightning Bolt deals 3 damage to any target."],
  "faceDown":         false,
  "tokenSetCode":     "",
  "counters":         {}
}
```

20 fields — **deliberately narrowed** from upstream's 1626-LOC
`CardView` per [ADR 0007 D7a](../decisions/0007-game-stream-protocol.md#d7a).
Adding a field is a deliberate decision tracked here. Slice 5 may add
transform/flip second-face data, ability lists, and split-card halves
once the renderer needs them.

| Field | Type | Note |
|---|---|---|
| `id` | string | Card UUID |
| `name` / `displayName` | string | Display differs for face-down, transformed, morph |
| `expansionSetCode` / `cardNumber` | string | Scryfall art lookup keys |
| `manaCost` | string | Rendered (e.g. `"{2}{R}{R}"`) |
| `manaValue` | int | Converted mana cost |
| `typeLine` | string | Rendered type line (supertype — type — subtype) |
| `supertypes` / `types` / `subtypes` | string[] | Upstream enum names + subtype display strings |
| `colors` | string[] | WUBRG single-letter codes |
| `rarity` | string | Upstream `Rarity` enum name |
| `power` / `toughness` / `startingLoyalty` | string | Strings allow `*` / `X` |
| `rules` | string[] | Rules-text paragraphs |
| `faceDown` | bool | Morph / face-down |
| `tokenSetCode` | string | Token art set; empty for non-tokens |
| `counters` | object | `{ "+1/+1": 3 }` — flattened by counter name |

#### `WebPermanentView` (nested in `WebPlayerView.battlefield`)

```json
{
  "card":              { ... WebCardView ... },
  "controllerName":    "alice",
  "tapped":            false,
  "flipped":           false,
  "transformed":       false,
  "phasedIn":          true,
  "summoningSickness": false,
  "damage":            0,
  "attachments":       [],
  "attachedTo":        ""
}
```

Composes a `WebCardView` (Java records can't extend) plus
battlefield-only state. Combat state (`attacking`, `blocking`) and
combat groups are deferred to slice 5.

### Updated DTOs

#### `WebPlayerView` — `battlefieldCount` → `battlefield`

```diff
-  "battlefieldCount": 0,
+  "battlefield":      { "<uuid>": <WebPermanentView>, ... },
```

`battlefield` is keyed by permanent UUID and preserves upstream's
`LinkedHashMap` insertion order. Other zone fields (`graveyardCount`,
`exileCount`, `sideboardCount`) remain counts; slice 5 promotes them
to card-detail maps.

#### `WebGameView` — adds `myPlayerId` + `myHand`

```diff
+  "myPlayerId":     "550e8400-...",
+  "myHand":         { "<uuid>": <WebCardView>, ... },
   "players":        [ ... ]
```

`myPlayerId` identifies which player this snapshot was rendered for
(empty for spectator views — slice 7+). `myHand` contains the
controlling player's hand only; opponents' hands stay as `handCount`
on each `WebPlayerView`. Stack, exile, revealed/looked-at zones, and
combat groups stay deferred to slice 5.

### Known limitations (slice 5)

- **Stack rendering** — `WebGameView.stack` still absent; spells and
  abilities on the stack are not visible to the client.
- **Graveyard / exile / sideboard maps** — still counts, not
  card-detail maps.
- **Combat groups** — `WebCombatGroupView` deferred; webclient cannot
  render attackers + blockers yet.
- **`gameInform` / `gameOver` / `endGameInfo` outbound** — upstream
  callbacks for these still drop in slice 4.
- **Transform / flip second face** — `WebCardView` exposes the front
  face only.

---

## 1.7 — 2026-04-26 — Game lifecycle frames + reconnect (Phase 3 slice 3)

Adds the game lifecycle outbound mappings and the reconnect-via-`?since=`
contract from [ADR 0007 D8](../decisions/0007-game-stream-protocol.md#d8).
Existing payloads keep their shape; their reported `schemaVersion`
value bumps to `"1.7"`.

### New outbound methods

| `method` | `data` shape | When |
|---|---|---|
| `startGame` | `WebStartGameInfo` | Upstream `START_GAME` callback — match has begun, signals the webclient to mount the game window |
| `gameInit` | `WebGameView` | Upstream `GAME_INIT` callback — initial snapshot when the game opens or a new socket attaches |
| `gameUpdate` | `WebGameView` | Upstream `GAME_UPDATE` callback — state change |

### Updated handshake — `?since=<messageId>` reconnect

The WebSocket upgrade URL now accepts an optional `since` query
parameter. On connect, the server replays every buffered frame with
`messageId > since` to the new socket. The buffer is per-`WebSession`
(not per-socket), capped at the last 64 frames. Cold buffer (no
qualifying frames) silently no-ops — the next live frame restores
state.

```
ws://host/api/games/{gameId}/stream?token=<bearer>&since=<int?>
```

`?since=` non-integer → in-band `streamError { code: BAD_REQUEST }`.

### Chat scoping by game

The handler now resolves the game's chatId at WS-connect time via
`MageServerImpl.chatFindByGame(gameId)`. When that lookup succeeds, the
WsContext is bound to that chatId and only `chatMessage` frames whose
`objectId` matches are forwarded. When the game does not exist yet (or
the lookup fails), chat fans out to every socket — same as slice 2.

### `WebStartGameInfo` (nested under `data`)

```json
{
  "tableId":  "550e8400-...",
  "gameId":   "660e8400-...",
  "playerId": "770e8400-..."
}
```

### `WebGameView` (nested under `data`)

```json
{
  "turn":                 3,
  "phase":                "PRECOMBAT_MAIN",
  "step":                 "PRECOMBAT_MAIN",
  "activePlayerName":     "alice",
  "priorityPlayerName":   "alice",
  "special":              false,
  "rollbackTurnsAllowed": true,
  "totalErrorsCount":     0,
  "totalEffectsCount":    412,
  "gameCycle":            87,
  "players":              [ <WebPlayerView>, ... ]
}
```

| Field | Type | Note |
|---|---|---|
| `turn` | int | Current turn number |
| `phase` | string | Upstream `TurnPhase` enum name; empty pre-game |
| `step` | string | Upstream `PhaseStep` enum name; empty pre-game |
| `activePlayerName` | string | Empty between turns |
| `priorityPlayerName` | string | Empty when no one has priority |
| `special` | bool | Special actions available to priority player |
| `rollbackTurnsAllowed` | bool | Match config |
| `totalErrorsCount` | int | Upstream debug counter |
| `totalEffectsCount` | int | Upstream debug counter |
| `gameCycle` | int | applyEffects loop counter; useful for client-side cache invalidation |
| `players` | array | Per-player summaries in seat order |

### `WebPlayerView` (nested under `WebGameView.players[]`)

```json
{
  "playerId":         "770e8400-...",
  "name":             "alice",
  "life":             20,
  "wins":             0,
  "winsNeeded":       1,
  "libraryCount":     53,
  "handCount":        7,
  "graveyardCount":   0,
  "exileCount":       0,
  "sideboardCount":   0,
  "battlefieldCount": 0,
  "manaPool":         { "red": 0, "green": 0, "blue": 0,
                        "white": 0, "black": 0, "colorless": 0 },
  "controlled":       true,
  "isHuman":          true,
  "isActive":         true,
  "hasPriority":      true,
  "hasLeft":          false,
  "monarch":          false,
  "initiative":       false,
  "designationNames": []
}
```

Card-by-card battlefield / graveyard / exile / hand mappings are
**deferred to slice 4** alongside `WebCardView` and
`WebPermanentView` — slice 3 ships zone counts only so the lifecycle
contract can land without the 1626-LOC `CardView` mapper.

### `WebManaPoolView` (nested under `WebPlayerView.manaPool`)

```json
{ "red": 0, "green": 0, "blue": 0, "white": 0, "black": 0, "colorless": 0 }
```

Conditional-mana subtotals are folded into the per-color buckets
upstream-side.

### Known limitations (slice 4+)

- **Card / permanent / stack / combat detail** — slice 4. Slice 3
  carries zone counts only; the actual battlefield, hand, stack, and
  combat-group rendering needs the `WebCardView` / `WebPermanentView`
  / `WebStackAbilityView` mappers.
- **`gameInform`, `gameOver`, `endGameInfo` frames** — slice 4. Their
  upstream callbacks still drop in slice 3.
- **Cold-buffer reconnect** silently no-ops; slice 4 may tag with an
  explicit `resync` marker (ADR D8).
- **Per-socket bounded queue / backpressure** (ADR D10) deferred until
  profiling shows it's needed.

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
