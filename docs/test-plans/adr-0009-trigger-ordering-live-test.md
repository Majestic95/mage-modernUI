# ADR 0009 trigger-ordering — live test plan (slices 26 + 27 + 28)

- **Status:** Active. Execute manually after each slice merges; full sweep after slice 28.
- **Scope:** Wire-format `isTriggerOrder` discriminator (slice 26), per-row hamburger menu with `TRIGGER_AUTO_ORDER_*` actions and two-step `_FIRST` dispatch + facade-side null-UUID nudge for `_LAST` (slice 27), `sourceLabel` "from: ‹source›" attribution and standalone Reset-all footer (slice 28).
- **Design source:** [`docs/decisions/0009-triggered-ability-ordering.md`](../decisions/0009-triggered-ability-ordering.md).
- **Schema target:** 1.18 (`SchemaVersion.java:17`). Slice 26 bumped to 1.16; slice 27 to 1.17 (added the `_NAME_*` `ruleText` payload shape); slice 28 to 1.18 (added `WebCardView.sourceLabel`). All three slices ship together for these tests; verify the running server reports 1.18 — older builds will fail T28.1 silently and T27.4 substitution accuracy.
- **Critique audit:** This plan was rewritten 2026-04-27 in response to the audit at [`adr-0009-trigger-ordering-live-test-CRITIQUE.md`](adr-0009-trigger-ordering-live-test-CRITIQUE.md). Every E* / M* item the critique raised has been incorporated.

This plan is a checklist for the project owner. Every command is verbatim runnable in Git Bash on Windows. Engine behavior claims cite `file:line`. Where source reading wasn't enough to be certain, the step is marked `UNCERTAIN — verify`.

---

## 0. Pre-flight

### 0.1 Services up

```bash
curl -s http://localhost:18080/api/health
# Expect: {"schemaVersion":"1.18","status":"ready"}

curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5173/
# Expect: 200
```

**M3 — schema version is load-bearing:** if `schemaVersion` is **not** `1.18`, halt. Slice 28 ships `WebCardView.sourceLabel` in 1.18; older builds (1.17 = slice 27 only) emit no `sourceLabel` and T28.1 will silently fail (the `from: ‹source›` subtitle never renders), and T27.4's `{this}` substitution will fall back to the literal `"Ability"` instead of the source name. Rebuild before continuing: `cd F:/xmage/Mage.Server.WebApi && bash run.sh` after a fresh `mvn -pl Mage.Server.WebApi -am install -DskipTests -B -ntp`.

If either fails:

- **Server (port 18080) down** — `cd F:/xmage/Mage.Server.WebApi && bash run.sh`. Wait for `Starting WebApi on http://localhost:18080`. The script sets `JAVA_HOME` and the `--add-opens` bundle (`Mage.Server.WebApi/run.sh:18-32`).
- **Vite (port 5173) down** — `cd F:/xmage/webclient && npm run dev`. Wait for `Local: http://localhost:5173/`.
- **Port 18080 taken by a stale process** — `netstat -ano | grep ":18080 " | grep LISTENING` → take the last column (Windows PID) → `wmic process where "ProcessId=<WIN_PID>" call terminate`. Do not use `taskkill`.

### 0.2 Get an anonymous bearer token (used for the deck-resolution sanity check)

```bash
TOKEN=$(curl -s -X POST -H "Content-Type: application/json" -d '{}' http://localhost:18080/api/session | python -c "import sys,json;print(json.load(sys.stdin)['token'])")
echo "TOKEN=$TOKEN"
```

The empty body produces an anon session (`WebSessionRequest.empty()` at `WebApiServer.java:291-296`).

### 0.3 Card-DB sanity check — every card in §1.1 resolves

The test deck below names exactly six non-basic cards. **`/api/cards` returns HTTP 200 with `{"cards": []}` for unknown card names** (`CardInfoMapper.single(null)` at `CardInfoMapper.java:28-31` returns an empty `WebCardListing`; `WebApiServer.java:164-167` `ctx.json(...)` always emits 200). A status-code check has zero discriminating power. Inspect the body and assert `cards.length > 0`.

```bash
for card in "Soul Warden" "Soul's Attendant" "Suture Priest" "Essence Warden" "Llanowar Elves"; do
  body=$(curl -s -H "Authorization: Bearer $TOKEN" \
    --get --data-urlencode "name=$card" "http://localhost:18080/api/cards")
  n=$(echo "$body" | python -c "import sys,json;print(len(json.load(sys.stdin).get('cards',[])))")
  if [ "$n" = "0" ]; then
    echo "MISS: $card"
  else
    echo "OK:   $card"
  fi
done
```

The response shape is `WebCardListing { schemaVersion, cards: [...], truncated }` (`WebCardListing.java:13-18`); the script counts `cards`.

If any card misses, the local card DB is incomplete (rare; `Mage.Sets` should ship every card in `Mage.Sets/src/mage/cards/`). Halt and rebuild: `cd F:/xmage && mvn -pl Mage.Sets install -DskipTests -B -ntp`. Basic lands (Plains, Forest) live at `Mage/src/main/java/mage/cards/basiclands/` and are always present.

---

## 1. Test deck design

### 1.1 Why this deck

The slice-26 fix is invisible unless the engine **actually fires the trigger-order prompt**. Two engine quirks suppress it:

1. **`autoOrderUse` short-circuit** (`HumanPlayer.java:1488-1517`, default `true` per `UserData.isAutoOrderTrigger()` at `Mage/src/main/java/mage/players/net/UserData.java:226`): if every pending trigger has identical resolved targets and identical resolved rule text, the engine picks one without prompting. The deck must produce triggers with **distinct rule text after `{this}` substitution** for the workhorse setup, **and** a pair with identical rule strings for the negative test (T26.4).
2. **Controller-of-trigger gates the prompt** (E7 fix): `chooseTriggeredAbility` is invoked per-player on the player who **controls** the triggers — `HumanPlayer.java:1456` is per-`HumanPlayer` instance. APNAP (CR 603.3b) determines the **order** in which players each pick when multiple players have triggers; it doesn't gate the prompt itself. To get a UI prompt, both relevant trigger sources must enter under **your** control. The AI's own triggers resolve internally on its `HumanPlayer`'s server side and never produce a UI prompt for you.

### 1.2 Trigger pile design

Five distinct ETB-life-gain triggers, all "Whenever **another** creature enters". Note: xmage's renderer (`EntersBattlefieldAllTriggeredAbility.makeTriggerPhrase()` at `:75-82`) emits the literal phrase `"Whenever another creature enters, "` — **without "the battlefield"**, despite that being the printed-card text. The wire ships what xmage renders, not what's on the card.

| Card | Cost | `optional` | Rendered rule (post-`{this}` substitution) |
|---|---|---|---|
| Soul Warden | `{W}` | `false` | Whenever another creature enters, you gain 1 life. |
| Soul's Attendant | `{W}` | `true` | Whenever another creature enters, you may gain 1 life. |
| Essence Warden | `{G}` | `false` | Whenever another creature enters, you gain 1 life. |
| Auriok Champion | `{W}{W}` | `true` | Whenever another creature enters, you may gain 1 life. |
| Suture Priest | `{1}{W}` | `true` (multiple) | (1) Whenever another creature you control enters, you may gain 1 life. (2) Whenever a creature an opponent controls enters, you may have that player lose 1 life. |

Source rule text verified against:

- `SoulWarden.java:36-37` — `EntersBattlefieldAllTriggeredAbility(new GainLifeEffect(1), filter)` — defaults to `optional=false`.
- `SoulsAttendant.java:36-37` — same constructor with `optional=true` overload (or via filter+optional sig — see source).
- `EssenceWarden.java:36` — `EntersBattlefieldAllTriggeredAbility(Zone.BATTLEFIELD, new GainLifeEffect(1), filter, false)`.
- `AuriokChampion.java:42` — `EntersBattlefieldAllTriggeredAbility(Zone.BATTLEFIELD, new GainLifeEffect(1), filter, true)`. **The `true` final arg is the optional flag** — `TriggeredAbilityImpl.getRule()` at `:325-340` then prepends `"may "` after `"you "`. **Auriok Champion's rule matches Soul's Attendant, NOT Soul Warden** (critique E1). Use Soul Warden + Essence Warden for the identical-rule negative test.
- `SuturePriest.java:36-41` — two trigger paths, structurally distinct from the wardens (T28.1 source-attribution variety).

**Why this composition (revised per critique E1):**

- **Workhorse (T26.1-T26.3, T27.1-T27.5, T28.*):** Soul Warden + Soul's Attendant both on board, then a third creature ETBs → 2 distinct rule strings (`you gain 1 life` vs `you may gain 1 life`) → `autoOrderUse` does NOT short-circuit → prompt fires.
- **Negative auto-order short-circuit test (T26.4):** Soul Warden + **Essence Warden** both on board, then a third creature ETBs → 2 identical rule strings (both `optional=false`, both render `"Whenever another creature enters, you gain 1 life."`) and identical resolved targets → `autoOrderUse` DOES short-circuit → no prompt. Auriok Champion is **not** identical to Soul Warden; the original plan was wrong.
- **Optional-pair alternative for T26.4 if Essence Warden misses 0.3:** Soul's Attendant + Auriok Champion (both `optional=true`, both render `"...you may gain 1 life."`) also gives an identical pair.
- Suture Priest contributes a structurally different ETB rule for T28.1 source-attribution variety.

### 1.3 Paste-ready deck (60 cards)

```
4 Soul Warden
4 Soul's Attendant
4 Essence Warden
4 Suture Priest
3 Auriok Champion
4 Llanowar Elves
14 Plains
13 Forest
10 Snow-Covered Plains
```

Total: 60. No sideboard. Llanowar Elves is filler for casting curve and provides additional ETB events that fire all four wardens at once. Mana base is wide intentionally so any opening hand can cast at least one trigger creature on turn 1-2.

If `Snow-Covered Plains` misses the 0.3 sanity check, replace with `4 Plains` (basic-land duplicates collapse server-side). The deck only needs to be format-legal in **Constructed - Freeform Unlimited**, the webclient default (`CreateTableModal.tsx:38-41`).

---

## 2. Setup steps

### 2.1 Browser session

1. Open `http://localhost:5173/` in Chrome or Edge. Open DevTools (`F12`), pin **Network** and **Console** tabs.
2. Click **Sign in anonymously**. Username will look like `guest-ab12cd`.
3. Confirm session in DevTools → Application → Local Storage → `xmage:auth` has a token UUID.

### 2.2 Import the deck

1. **Decks** tab → name field "Trigger Pile" → paste the §1.3 block into the textarea → **Import**.
2. Expect: deck appears in the saved-decks list with count `60`. **No** "Could not find these cards in the server DB" error (`Decks.tsx:49-57`). If you see one, fix it before proceeding — the test cannot run without all cards resolved.

### 2.3 Create the table

1. **Lobby** → **Create table**.
2. Form values:
   - Game type: **Two Player Duel**
   - Deck format: **Constructed - Freeform Unlimited** (default)
   - Wins needed: 1
   - Add AI: ON
   - AI type: **Computer — Mad** (em-dash, U+2014; literal label at `CreateTableModal.tsx:254`. MCTS has a known crash — use Mad.)
   - Deck (your seat): **Trigger Pile**
   - Deck (AI seat): **Trigger Pile** (reuse — the AI seat needs a deck, any deck will do)
3. **Create** → **Join** → **Start match**.

### 2.4 First-turn shape

1. When prompted "Choose starting player", **pick yourself**. **You need both wardens under YOUR control so the engine prompts your client** (per E7 fix). The AI's own triggers resolve internally on its server-side `HumanPlayer` and never surface a UI prompt; APNAP only governs the order in which each player picks for their own triggers.
2. **Mulligan** until your opening hand has **at least two of {Soul Warden, Soul's Attendant, Essence Warden, Auriok Champion}** plus enough lands. The free-mulligan default (`freeMulligans=0`) means each mulligan costs a card — you can afford 2-3 mulligans before the 7-card hand is too small.

The trigger pile only fires once you have 2+ qualifying creatures in play **and** a third creature ETBs. Practical sequence: turn 1 play land + Soul Warden, turn 2 play land + Soul's Attendant (this triggers the existing Soul Warden — single trigger, no prompt yet), turn 3 play land + Llanowar Elves or another creature → both Soul Warden and Soul's Attendant trigger on the same ETB → **prompt fires**.

**M1 — controller-agnostic triggers fire on AI ETBs too:** Soul Warden / Soul's Attendant / Essence Warden read "Whenever **another** creature enters" — no controller restriction. The AI playing a creature **will** trigger your wardens, producing a prompt during the AI's turn. If you're mid-action when this happens, **don't panic** — answer the prompt as the engine intends (CR 603.3b — you choose the order of your own triggers regardless of whose turn it is). Suture Priest's trigger (1) is "you control" gated, but its trigger (2) fires on opponent-control ETBs. This is normal behavior; the test plan implicitly assumes you're prepared for it.

---

## 3. Test cases

Each case: **Setup** (in-game state needed), **Action** (what to do), **Expected**, **Fallback diagnosis** (where to look if expected doesn't match).

The "messageId" referenced below is the integer field on every `gameTarget` envelope; visible in DevTools → Network → WS → Messages → frame body → `messageId`.

### Slice 26 — wire format + minimal panel

#### T26.1 — Trigger-order panel renders with the correct chrome

- **Setup:** Soul Warden and Soul's Attendant both in play under your control. Cast Llanowar Elves (or any other creature).
- **Action:** Pass priority through the resulting triggered-ability stage.
- **Expected:**
  - Side panel slides in (right-edge, identical chrome to the existing `TargetDialog` per ADR 0009 D8).
  - Header reads `Pick triggered ability (goes to the stack first)` (literal at `HumanPlayer.java:1548`).
  - Two rows visible.
  - DOM (E5 fix): the per-row list root has `data-testid="trigger-order-list"` (the `<ul>` at `GameDialog.tsx:453`). Each row button has `data-testid="trigger-order-row"` and `data-ability-id=<uuid>`. The dialog **container** uses the generic `data-testid="game-dialog"` — the panel-specific testids are on inner elements. There is no `data-testid="trigger-order-dialog"` (the original plan claimed this; it was never shipped — see critique E5).
  - **No Skip button** (E10) — `chooseTriggeredAbility` does not surface an optional path (ADR 0009 D4 / D7); the panel deliberately omits the chrome that other dialog modes have. If you compare to `TargetDialog`, the missing Skip is by design.
- **Fallback:**
  - No panel at all → check WS frames for a `gameTarget` envelope. If absent, the engine short-circuited (probably `autoOrderUse` — verify both creatures' rule text differs). If present but panel hidden, the discriminator didn't reach the renderer — check `data.options.isTriggerOrder` is `true` in the frame.
  - Panel renders but it's the old `TargetDialog` (with hand/board card slots, no rule text) → `interactionMode.ts` didn't switch on `isTriggerOrder`. Verify schema 1.18 is on the wire (frame's top-level `schemaVersion`).

#### T26.2 — Each row shows distinct rule text from `cardsView1[id].rules`

**M2 — establish ground truth before reading the UI:** open DevTools → Network → WS → click the inbound `gameTarget` frame, copy the literal `cardsView1[<id>].rules[0]` string for each ability. Use those copied strings as the expected text. xmage renders ETB triggers as `"Whenever another creature enters, ..."` — **no "the battlefield"** — per `EntersBattlefieldAllTriggeredAbility.makeTriggerPhrase()` at `:75-82`. Don't expect printed-card text.

- **Setup:** Same as T26.1 — panel open with 2 rows.
- **Action:** Read the visible rule text on each row.
- **Expected (E4 fix — relaxed to substring match against xmage's rendering):**
  - Row 1: contains `Whenever another creature enters` and `you gain 1 life` (Soul Warden — `optional=false`).
  - Row 2: contains `Whenever another creature enters` and `you may gain 1 life` (Soul's Attendant — `optional=true`; "may" is prepended by `TriggeredAbilityImpl.getRule()` at `:325-340`).
  - **NOT** "Ability" / "Ability" (the bug slice 26 fixes; ADR 0009 F6).
  - Order of rows is not specified by the spec (engine ordering is non-deterministic per `chooseTriggeredAbility` loop).
- **Fallback:**
  - Rows show `Ability` / `Ability` → the renderer is reading `c.name` instead of `c.rules`. Check `OrderTriggersDialog` source.
  - One row shows rule text, the other shows `Ability` → `cardsView1` is correct but a single row is hitting a fallback path. Inspect the frame body for that ability's `rules` array.
  - Text contains "the battlefield" → the engine's renderer changed; update this expected line to match the new wire.

#### T26.3 — Click-to-pick → engine resolves → re-prompts (state machine D9)

- **Setup:** Same as T26.1 — panel open with 2 rows.
- **Action:** Click row 1.
- **Expected:**
  1. WS outbound frame: `playerResponse { kind: "uuid", value: <row1-id>, messageId: M }`.
  2. Panel closes immediately (`clearDialog()`).
  3. Within ~500ms a new `gameTarget` arrives with `messageId: M+1` (or higher), `cardsView1` has **1** ability remaining.
  4. ADR 0009 D9 says when only 1 ability remains, the engine returns it without re-prompting (`HumanPlayer.java:1521-1524` short-circuits at one-element). **UNCERTAIN — verify:** with exactly 2 starting triggers, after picking one the engine may auto-resolve the last and skip the second prompt. Watch the WS frames; if a second `gameTarget` arrives, panel re-mounts with 1 row and clicking it closes the panel for good. If no second `gameTarget` arrives, the stack just shows both abilities resolved in your picked order — that is also correct.
- **Fallback:**
  - No outbound `playerResponse` after click → check `clickRouter.ts` `case 'orderTriggers':` exists.
  - Outbound fires but panel doesn't close → `clearDialog()` not called in the `orderTriggers` arm.
  - Outbound fires, panel closes, but no follow-up frame and the game freezes → engine didn't accept the response. Check server log for `BAD_REQUEST` / `IllegalStateException`.

#### T26.4 — Auto-order short-circuit suppresses the prompt (negative test, E1 fix)

- **Setup:** **Soul Warden + Essence Warden** both in play under your control. Both are `optional=false` and produce identical rendered rule strings (`"Whenever another creature enters, you gain 1 life."`). (Auriok Champion is **not** equivalent to Soul Warden — it's `optional=true` and renders with "may"; see §1.2 critique-E1 footnote.)
- **Action:** Cast a creature (e.g. Llanowar Elves) so both trigger.
- **Expected:** **No** `gameTarget` frame arrives that would render the trigger-order panel. The engine short-circuits at `HumanPlayer.java:1488-1517` because both rules resolve to identical strings and identical targets. Both triggers go on the stack in engine-determined order; no UI prompt appears. This confirms the slice-26 panel doesn't appear spuriously when the engine wouldn't normally fire it.
- **Fallback:** A panel does appear → either the `autoOrderUse` UserData pref defaults to `false` on this build (it shouldn't — see ADR 0009 OQ #5), or the rule strings actually differ (uncommon — the optional flag is the usual culprit; verify both source cards have `optional=false` constructor args).

### Slice 27 — auto-order context menu

#### T27.1 — Hamburger button toggles a 5-item menu

- **Setup:** Trigger-order panel open with 2+ rows.
- **Action:** Click the hamburger (`⋯`) button on row 1.
- **Expected:**
  - Menu opens with exactly 5 items (matches `GamePanel.java:3115-3147` upstream and ADR 0009 D8):
    1. `Always put this ability first on the stack`
    2. `Always put this ability last on the stack`
    3. `Always put abilities with this rule text first on the stack`
    4. `Always put abilities with this rule text last on the stack`
    5. `Reset all order settings for triggered abilities`
  - **Esc** key closes the menu.
  - Click outside the menu (e.g. on the panel header) closes it.
  - Re-clicking the same hamburger toggles it closed.
- **Fallback:** Menu missing items → check the action enum list in the slice-27 component matches `PlayerActionAllowList.java:43-48`. Esc not closing → keyboard listener not wired.

#### T27.2 — `_ABILITY_FIRST` fires both `playerAction` and `playerResponse{uuid}` (two-step dispatch)

- **Setup:** Panel open with 2+ rows. DevTools → Network → WS, "Messages" pinned, filter cleared.
- **Action:** Open hamburger on row 1 → click `Always put this ability first on the stack`.
- **Expected (in WS frame order):**
  1. **Outbound:** `playerAction { action: "TRIGGER_AUTO_ORDER_ABILITY_FIRST", data: { abilityId: "<row1-uuid>" } }`. The UUID is the same string as the row's DOM `data-ability-id` attribute (and matches a key in the latest inbound `gameTarget`'s `cardsView1`).
  2. **Outbound:** `playerResponse { kind: "uuid", value: "<row1-uuid>", messageId: <current-prompt-messageId> }`. Without this second frame the engine remains blocked (ADR 0009 D5; upstream Swing pattern at `GamePanel.java:3081`).
  3. **Inbound:** the engine resolves row 1's ability and either re-prompts (1 row left) or returns to gameplay (auto-resolves the singleton).
- **Fallback:**
  - Only one outbound frame → the slice-27 dispatcher missed the response step. The dialog stays open and the game locks.
  - Two outbound frames but the engine returns `streamError BAD_REQUEST` → `data.abilityId` is malformed. Check it's a string UUID, not a number, and not the `originalId`.

#### T27.3 — `_ABILITY_LAST` action + facade-side null-UUID nudge (M5)

- **Setup:** Panel open with 2+ rows. Important: the next ETB event must trigger the same set of abilities again later in the game so T27.3b (auto-order kick-in) is testable. Soul Warden + Soul's Attendant + an extra creature in hand satisfies this.
- **Action:** Open hamburger on row 1 → click `Always put this ability last on the stack`.
- **Expected (T27.3a — current prompt):**
  1. **Outbound:** `playerAction { action: "TRIGGER_AUTO_ORDER_ABILITY_LAST", data: { abilityId: "<row1-uuid>" } }`.
  2. **No outbound `playerResponse`** from the webclient (the wire-side nudge isn't possible — `playerResponse{kind:"uuid"}` rejects non-textual values at `GameStreamHandler.java:463-471`). Instead, the **facade** synthesizes the nudge by calling `embedded.server().sendPlayerUUID(gameId, sessionId, null)` after the action dispatch (Fix 1; `GameStreamHandler.handlePlayerAction` post-`sendPlayerAction` branch). This is invisible from the wire.
  3. Panel closes client-side; engine's `chooseTriggeredAbility` loop unblocks via the synthesized null-UUID, re-iterates (`HumanPlayer.java:1466 while (canRespond())`), moves the tagged ability to the deferred-last pile, and either re-fires `gameTarget` with the remaining ability up first or returns the singleton directly.
  4. Within ~500ms either: (a) a new `gameTarget` arrives with row 2 as the only entry and slice-26 panel re-mounts; click it to resolve. Or (b) no re-prompt and the stack just shows both abilities resolved in row-2-first order.
- **M5 — distinguish "engine re-prompted normally" from "engine soft-frozen":** if no follow-up `gameTarget` arrives within **5 seconds** AND clicking other UI elements is a no-op (the game has soft-frozen mid-step), the facade nudge didn't land. This was the bug case before Fix 1; if it returns post-fix, regression. Confirm by passing priority via F2 and observing no stack resolution. Also verify the server log shows no `IllegalStateException` from the synthesized `sendPlayerUUID(null)` path.
- **Wire-frame check (M5 detail):** open DevTools → Network → WS → after firing `_LAST`, count the frames. Outbound: exactly one `playerAction`. Inbound: one or more `gameTarget` re-prompt or singleton-resolution. **No outbound `playerResponse` from the client** — the nudge is server-internal and never appears on the wire.

- **Setup (T27.3b — second pile, auto-order kicks in):** continue the game until another ETB fires both Soul Warden and Soul's Attendant.
- **Action:** Pass priority through the trigger stage.
- **Expected:** **No** trigger-order panel. The engine consults `triggerAutoOrderAbilityLast` at `HumanPlayer.java:1479-1487` (matched by `originalId` — the engine stored row 1's `originalId` after T27.3a), defers row 1 to the last pile, and short-circuits because only one un-deferred ability remains. Stack shows row 2 (Soul's Attendant) resolving first, then row 1 (Soul Warden) — the order you tagged.
- **Fallback:** Panel reappears in T27.3b → either the `_ABILITY_LAST` action didn't reach the engine, or the engine couldn't resolve `abilityId` to an `originalId` (`HumanPlayer.java:2820-2829`). Check server log for warnings. **OQ #9 (silent failure mode):** if the second pile re-prompts despite the tag, the engine `originalId` lookup at `:2820-2829` failed silently — server log won't show a warning. Instrument by adding a log entry in `setTriggerAutoOrder` for the no-match case if reproducing.

#### T27.4 — `_NAME_FIRST` substitutes `{this}` client-side (D5 / E2)

> **Critique E2 fix:** the implementation substitutes `{this}` **client-side** and ships the substituted rule on the wire as `{ ruleText: "<substituted>" }`. The original ADR D5 mandated facade-side substitution with `{ abilityId }`; this was reconciled in favor of the shipped Swing-mirroring pattern (ADR 0009 D5, revised 2026-04-27).
>
> **Critique E3 fix:** slice 28 added `WebCardView.sourceLabel` and slice 27's `substituteThis` was updated (Fix 2) to prefer it. With sourceLabel populated, the substituted rule string matches what `HumanPlayer.java:1474-1476` recomputes via `ability.getRule(sourceObject.getName())` — the auto-order key compares correctly against future triggers. Without sourceLabel, substitution falls back to `AbilityView.name` (the literal `"Ability"` for permanent-sourced triggers) and the recorded key becomes a dead one — that's the latent bug E3 surfaced. Slice 28's sourceLabel makes the feature actually work.

- **Setup (M4 — needs a `{this}`-bearing rule):** None of the deck's wardens contain `{this}` in their rule text (their trigger phrase is "Whenever another creature enters", not source-referential). To exercise the substitution path, **slot in 2× Mentor of the Meek or 2× Courser of Kruphix** in place of 2 lands — both have permanent-sourced `{this}`-bearing triggers. Verify against `Mage.Sets/src/mage/cards/m/MentorOfTheMeek.java` or `c/CourserOfKruphix.java` that the rule string contains `{this}` literal in the un-substituted form. Then ETB the chosen card alongside Soul Warden so the panel shows a `{this}`-bearing rule. Inspect the inbound `gameTarget` frame's `cardsView1[id].rules[0]` to confirm `{this}` is present in the wire payload (`AbilityView.java:25` calls `ability.getRule()` with no source-name argument, so `{this}` survives to the wire).
  - **Pragmatic alternative if 2 land-slots can't be spared:** test against any non-warden deck the AI has played a `{this}` permanent from. Goblin Bombardment / Soldier of the Pantheon / similar `{this}`-attack triggers also work — but you need it under your control to surface the prompt.
- **Action:** Open hamburger on row 1 (the `{this}`-bearing trigger) → click `Always put abilities with this rule text first on the stack`.
- **Expected:**
  1. **Outbound:** `playerAction { action: "TRIGGER_AUTO_ORDER_NAME_FIRST", data: { ruleText: "<source-name-substituted>" } }`. The wire **carries `ruleText`, NOT `abilityId`** — substitution happens client-side. The substituted string contains the source permanent's name (e.g. `"Whenever Mentor of the Meek attacks, ..."`), NOT the literal `{this}` and NOT the literal `"Ability"` (the latter is what would appear if `sourceLabel` was missing — verify the substitution used `sourceLabel`, not `name`).
  2. **Outbound:** `playerResponse { kind: "uuid", value: "<row1-uuid>", messageId: <current> }` (same two-step pattern as T27.2).
  3. Server log: no `IllegalArgumentException` from `HumanPlayer.setTriggerAutoOrder` at `:2843-2845` (the `{this}` guard would throw if substitution didn't happen).
  4. The trigger resolves; the next time **any** ability with the same printed-rule-after-substitution (e.g. another Mentor of the Meek trigger, even from a different copy) appears in a multi-trigger pile, it gets moved to the front automatically.
- **Verify the wire frame:** open DevTools → Network → WS → click the `playerAction` frame → confirm body contains `ruleText` (string, no `{this}`, source name interpolated correctly), no `abilityId` field. Also confirm the inbound `gameTarget` frame's `cardsView1[id].sourceLabel` was populated (slice 28; otherwise substitution falls back to "Ability" and the key won't match future comparisons).
- **Fallback:**
  - Server log shows `IllegalArgumentException: rule text contains {this}` → the client substitution didn't run; check `substituteThis(...)` in `webclient/src/pages/GameDialog.tsx`.
  - Outbound `ruleText` contains `"Ability"` instead of the source name → `sourceLabel` was empty/missing on the inbound `gameTarget` frame. Verify slice 28 schema 1.18 is on the wire and `CardViewMapper.java:116-120` is populating `sourceLabel` from `AbilityView.getSourceCard().getName()`.
  - The next pile DOES re-prompt with the same rule type → either the substituted rule string didn't match what `HumanPlayer.java:1474-1478` recomputes, or `sourceLabel` was empty. Verify both the wire string and the recompute use the same source name.

#### T27.5 — `_RESET_ALL` clears all stored auto-order rules

- **Setup:** After T27.3 and T27.4 — both `_ABILITY_LAST` (Soul Warden) and `_NAME_FIRST` (Mentor of the Meek or whichever `{this}`-bearer) rules are stored.
- **Action:** Open hamburger on any row → click `Reset all order settings for triggered abilities`.
- **Expected:**
  1. **Outbound:** `playerAction { action: "TRIGGER_AUTO_ORDER_RESET_ALL", data: null }` (`data: null` per ADR 0009 D5; `GamePanel.java:3099-3101`).
  2. No follow-up `playerResponse` (this is fire-and-forget; no facade nudge for `_RESET_ALL`).
  3. Panel may close client-side; the next pile re-prompts with both rows even though we previously tagged them.
- **Verify:** trigger another multi-ability ETB after Reset. The trigger-order panel reappears with the same rule rows (no auto-pick, no auto-order). Without Reset, it would short-circuit due to the prior tags.
- **Fallback:** Reset doesn't take effect → check the action ID matches the server allow-list literal (`PlayerActionAllowList.java:43-48`).

#### T27.6 — `_NAME_*` items disabled when ability has no rule text

- **Setup:** N/A live-testable — virtually every triggered ability has rule text.
- **Action:** **Code path verification only.** Open the slice-27 hamburger menu component and confirm the `_NAME_FIRST` / `_NAME_LAST` items are gated on `cardsView1[id].rules.length > 0 && cardsView1[id].rules[0].trim() !== ""`. If absent, file a polish ticket — does not block slices 27 / 28 ship.

### Slice 28 — polish (`sourceLabel` + standalone Reset-all)

#### T28.1 — `from: ‹source›` line under each row

- **Setup:** Trigger pile from T26.1 — Soul Warden + Soul's Attendant on board, third creature ETBs, panel open.
- **Action:** Read each row.
- **Expected:**
  - Row for Soul Warden's trigger displays a subtitle line `from: Soul Warden` directly under the rule text (rendered via `data-testid="trigger-order-source"` at `GameDialog.tsx:473`).
  - Row for Soul's Attendant's trigger displays `from: Soul's Attendant`.
  - Subtitle is visually subordinate (smaller, dimmer) — design per ADR 0009 D8 mockup.
- **Verify the wire:** inspect the inbound `gameTarget` frame's `cardsView1[id].sourceLabel` field — it should be a non-empty string containing the source permanent's name. This field is new in slice 28 (schema 1.18; `WebCardView.java:62-94` and `CardViewMapper.java:116-120`).
- **Fallback:**
  - `sourceLabel` missing from the frame → schema is 1.17 or older. Verify via `/api/health` and rebuild Mage.Server.WebApi.
  - Field present but UI doesn't render it → `OrderTriggersDialog` row template not updated.
  - Field shows literal `{this}` → mapper passed un-substituted name. Should be `AbilityView.getSourceCard().getName()` not the raw rule.

#### T28.2 — `sourceLabel` does not break other dialogs (regression)

- **Setup:** During the same game, cast a spell that asks you to pick a target (e.g. Llanowar Elves into a tapped basic doesn't count — instead, sideboard a single-target removal spell into the deck for this test, OR rely on slice 26's existing `TargetDialog` rendering for any combat-blocker selection).
  - Pragmatic shortcut: declare a single attacker. Combat doesn't open `TargetDialog` per se, but the existing `gameTarget` frames in non-trigger-order modes (block assignments, etc.) should not show a `from: ...` subtitle.
- **Action:** Open any non-trigger-order target picker.
- **Expected:** Card rows render normally — name, mana cost, type line. **No** `from: ...` subtitle. (If `sourceLabel` is empty/null on `WebCardView`, the renderer should hide the line entirely.)
- **Fallback:** Subtitle leaks into normal `TargetDialog` → the renderer's conditional is wrong. Should be `if (sourceLabel) render(...)`.

#### T28.3 — Standalone Reset-all footer button

- **Setup:** Trigger-order panel open with 2+ rows, after T27.3 / T27.4 stored some rules.
- **Action:** Click the **Reset all** footer button (`data-testid="trigger-order-reset-all"` at `GameDialog.tsx:517`).
- **Expected:** Identical wire effect to T27.5 — single `playerAction { action: "TRIGGER_AUTO_ORDER_RESET_ALL", data: null }` outbound, no `playerResponse`. Subsequent trigger piles re-prompt with all rows present.
- **Fallback:** Button does nothing → check it dispatches the same action constant as the per-row hamburger's fifth item. Both routes should converge on the same `playerAction` payload.

### Slice 26-28 — additional coverage from critique audit

#### T-MULTI — Multi-prompt sequence with 3+ triggers (M7)

- **Setup:** Get **three or more wardens** out simultaneously: Soul Warden + Soul's Attendant + Essence Warden + (optionally) Auriok Champion.
- **Action:** ETB a fourth creature. The engine fires `chooseTriggeredAbility` for the first pick, then again for the second, then auto-resolves the third (one-element short-circuit at `:1521-1524`).
- **Expected:**
  1. First `gameTarget` frame, `messageId = M`, `cardsView1` has 3+ entries. Click row 1.
  2. Second `gameTarget` frame, **strictly higher `messageId` (M+1 or more)**, `cardsView1` has one fewer entry. Click row 1 again.
  3. Engine auto-resolves the singleton — no third prompt arrives. Stack shows all 3+ triggers in your picked order.
  - **Each prompt re-mounts cleanly** — no leaked state from the previous pick (slice 13 fix; `pendingDialog` clears between frames). Verify by checking the panel is empty before the second `gameTarget` re-fills it.
- **Fallback:** `messageId` doesn't increase → re-mount keying is broken. Panel state leaks → re-mount logic broken; check `OrderTriggersDialog`'s `key` or `useState` reset.

#### T-RECONNECT — Reconnect / replay mid-trigger-order (M6)

- **Setup:** Trigger-order panel open with 2+ rows (T26.1 setup).
- **Action:** Mid-prompt, briefly disconnect (DevTools → Network → throttle "Offline" for 2 seconds, then back to "Online" or "No throttling"). The webclient's reconnect-replay machinery (ADR 0007) should re-mount the dialog from the buffered/replayed frames.
- **Expected:**
  - WS reconnects (no auth re-prompt).
  - The `OrderTriggersDialog` re-mounts with the same rows after replay (same `cardsView1`, same `messageId`, panel chrome identical).
  - Clicking a row resolves the trigger as if no disconnect had happened — engine accepts the response, no `BAD_REQUEST`.
- **Fallback:**
  - Panel re-mounts as a `TargetDialog` (no rule rows) → `isTriggerOrder` flag was lost during replay. Verify `WebClientMessageOptions.isTriggerOrder` round-trips through the buffer.
  - Panel stays empty → `pendingDialog` was cleared but not re-populated by the replayed frame. Check the replay handler in `gameStream.ts`.

---

## 4. Regression sweep (5 minutes)

After §3 passes, exercise adjacent surfaces to confirm no collateral damage. Each is one action + visual check.

| Check | Action | Expected |
|---|---|---|
| Stack panel renders normal spells (slice 27 chrome) | Cast Llanowar Elves. | Llanowar Elves appears in the stack panel with name + cost; resolves on priority pass. |
| Hand popover viewport-clamp (slice 38) | Hover the rightmost card in your hand. | Popover opens and stays inside the viewport — never clipped past the right edge. |
| WS keepalive (slice 38) | Leave the tab inactive for 60s, return. | Game state still live; no `WebSocket disconnected` toast; no auto-reconnect-replay banner. |
| Pass-priority hotkeys (`ActionPanel.tsx:30-33`) | Press `F2`, then `F4`, then `F6`, then `F8` during your priority window. | Each fires the corresponding `playerAction` (`PASS_PRIORITY_UNTIL_*`); turn advances accordingly. |
| Mulligan flow (slice 17) | Start a new match; the mulligan dialog opens. | Buttons read `Mulligan` / `Keep` (not `OK` / `Cancel`). |

---

## 5. Out of scope for this plan (M8)

- **Tauri / WebView2 testing** — ADR 0008 mentions the Tauri shell but this plan targets Chrome/Edge/Firefox browsers only. The trigger-order dialog uses `mousedown` outside-click handlers (`GameDialog.tsx:572-577`) and `keydown` Esc handlers via `document.addEventListener` with capture; these can interact oddly with WebView2's right-click context menu inheritance. Worth a follow-up smoke test in the Tauri shell once the trigger-order panel is shipping.

---

## 6. Bug-report template

Paste-ready when any test case fails:

```
### Bug — ADR 0009 live test

- **Test case:** T<number> (e.g. T27.3a)
- **Slice under test:** 26 / 27 / 28
- **Schema version on wire:** (paste from `/api/health` or any frame's `schemaVersion`)
- **Browser:** Chrome / Edge / Firefox <version>

**Expected:**
<copy from §3 "Expected">

**Observed:**
<what actually happened>

**Server log:**
```
<paste last ~30 lines from `mageserver.log` or `Mage.Server.WebApi/smoke.log` around the time of the failure>
```

**Browser console:**
```
<paste any errors / warnings from DevTools → Console at the time of the failure>
```

**WS frames (relevant subset):**
```
Inbound (gameTarget): <paste body>
Outbound (playerAction / playerResponse): <paste body>
```

**Reproducibility:** always / intermittent (X out of Y attempts)

**Suspected root cause / next step:** <optional, your hypothesis>
```

---

## References

- [ADR 0009 — Triggered ability ordering](../decisions/0009-triggered-ability-ordering.md)
- [Critique audit (2026-04-27)](adr-0009-trigger-ordering-live-test-CRITIQUE.md)
- [Dev setup](../dev-setup.md) — server boot, port-clearing, `--add-opens` bundle
- Engine entry point — `Mage.Server.Plugins/Mage.Player.Human/src/mage/player/human/HumanPlayer.java:1456-1573`
- `autoOrderUse` short-circuit — `HumanPlayer.java:1465`, `:1488-1517`
- `setTriggerAutoOrder` — `HumanPlayer.java:2811-2856` (the deadlocking method that motivated Fix 1)
- UserData default — `Mage/src/main/java/mage/players/net/UserData.java:226`
- Server health endpoint — `Mage.Server.WebApi/src/main/java/mage/webapi/server/WebApiServer.java:142`
- Cards endpoint — `WebApiServer.java:164-167`
- Card listing DTO shape — `Mage.Server.WebApi/src/main/java/mage/webapi/dto/WebCardListing.java`
- WebApi run script — `Mage.Server.WebApi/run.sh`
- Schema constant — `Mage.Server.WebApi/src/main/java/mage/webapi/SchemaVersion.java:17`
- Card sources — `Mage.Sets/src/mage/cards/s/SoulWarden.java`, `SoulsAttendant.java`, `SuturePriest.java`, `Mage.Sets/src/mage/cards/e/EssenceWarden.java`, `Mage.Sets/src/mage/cards/a/AuriokChampion.java`
- Trigger phrase rendering — `Mage/src/main/java/mage/abilities/common/EntersBattlefieldAllTriggeredAbility.java:75-82`
- Optional "may" prepending — `Mage/src/main/java/mage/abilities/TriggeredAbilityImpl.java:325-340`
- Facade `_LAST` nudge — `Mage.Server.WebApi/src/main/java/mage/webapi/ws/GameStreamHandler.java:handlePlayerAction` (post-`sendPlayerAction` branch, Fix 1)
- Facade `sourceLabel` mapping — `Mage.Server.WebApi/src/main/java/mage/webapi/mapper/CardViewMapper.java:116-120`
- Webclient substitution — `webclient/src/pages/GameDialog.tsx` `substituteThis(...)`
