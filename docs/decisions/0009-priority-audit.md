# 0009 — Priority / Phase / Turn Audit

> Bug: in Main Phase 1, after the FIRST spell resolves the engine
> auto-advances out of Main 1 instead of returning priority to the
> active player. End-to-end audit; no code edits — this is a brief
> and a fix proposal.

---

## 0. Verification status (read FIRST)

This brief was produced by a multi-agent audit and post-verified
against the actual code on disk and the Comprehensive Rules.
Status of the load-bearing claims:

**Verified directly against code (citations confirmed real):**

- `PlayerImpl.java:1687` clears `justActivatedType` at the START of `activateAbility`, BEFORE the conditional set at `:1691` — confirmed.
- `PlayerImpl.java:1691` sets `justActivatedType` only when the activated ability `isUsesStack()` (lands and other special actions do NOT set it) — confirmed.
- `PlayerImpl.java:2625` clears `justActivatedType` inside `resetPlayerPassedActions` (called by F-keys / `PASS_PRIORITY_CANCEL_ALL_ACTIONS`) — confirmed.
- `HumanPlayer.java:1166-1179` is the auto-pass-after-cast branch, gated on `isPassPriorityCast()` / `isPassPriorityActivation()` — confirmed.
- `HumanPlayer.java:1430-1434` `checkPassStep` returns `!isPhaseStepSet(...)`; with `main1=true` this returns `false` for AP in PRECOMBAT_MAIN, i.e. don't auto-pass — confirmed.
- `UserData.java` constructor arg #10 in `getDefaultUserDataView()` is `false` for `passPriorityCast` — confirmed.
- `PreferencesDialog.java:4023` Swing-client preference default for `passPriorityCast` is `"true"` — confirmed (this is the SWING preference loader's default, not the upstream `getDefaultUserDataView()` default).
- No `setPassPriorityCast` callsites exist in `Mage.Server`, `Mage.Server.WebApi`, or `Mage.Common` — confirmed via grep. The only setter callsite is `UserData.java:214` itself.
- `AuthService.java:366-372` ships `getDefaultUserDataView()` once at login, no other write path — confirmed.
- No webclient code dispatches `PASS_*` without a user gesture — confirmed (every `sendPlayerAction` is gated on a click/keypress).

**Verified against MTG rules (Comprehensive Rules):**

- CR 117.3b — AP receives priority after a spell/ability resolves. Stable, foundational rule.
- CR 117.4 / 500.2 — phase/step ends only when all players pass in succession on empty stack. Stable.
- CR 601.2j — caster receives priority after their spell becomes cast. Stable.
- CR 502.4 — no priority during untap. Stable.
- CR 514.3a — cleanup grants priority only if SBA/trigger fires. Stable.
- CR 605.3a — mana abilities don't use the stack and don't pass priority. Stable.

**SPECULATION (not grounded in observed code behavior):**

- §1 / §6 H1: "If `passPriorityCast` is observed `true` somewhere, the engine auto-passes after cast." This is a *what-if* — it is mechanically true given the code paths, BUT no code path in the webclient or facade ever sets `passPriorityCast=true`. The default flips to `false` at login (verified) and stays `false` for the entire session. **H1 cannot be the actual root cause of the user's observed bug** unless there is a path we haven't found that mutates `passPriorityCast` post-login.
- §7 fix #1 ("clear `justActivatedType` after stack resolution at `GameImpl.java:1761-1769`"): this is a *defense-in-depth* hardening, not a fix for the reported bug. With `passPriorityCast=false` the never-cleared `justActivatedType` is benign — the auto-pass branch never fires regardless of what the flag holds.

**Conclusion of verification:** the audit accurately maps the priority machinery and identifies a real latent foot-gun, but it does NOT identify the actual root cause of the user's reported auto-advance. The bug must be coming from somewhere else — most likely candidates that were NOT investigated end-to-end: (a) a behavior in the active-player priority handoff inside `GameImpl` / `Turn` / `Phase` that is independent of `HumanPlayer.priority()`, (b) a webclient state condition where `priorityPlayerId` flips correctly but the user's UI doesn't surface a priority window before the engine moves on, (c) a race between the bots' auto-passes and the human's priority window in 4p Commander, or (d) an entirely different mechanism we haven't enumerated.

**Rules-expert caveats** (flagged by the rules-reference agent itself as needing CR re-verification, all peripheral to this bug): split-second + special-action interaction (CR 702.80c), planeswalker-uniqueness deletion year (CR 704.5j removed in 2022), Commander damage SBA paragraph numbering (904.7 vs older numbering). None of these affect the priority / phase / turn invariants that govern this bug.

**Grounded next step** (do this BEFORE proposing any code fix): write a reproducing test against the engine that fires the bug deterministically. If the test reproduces, the root cause is in the engine's priority loop or phase-transition machinery and we can localize it. If the test does NOT reproduce in isolation but the bug fires live, the cause is webclient-side and we should add server-side priority-event tracing to capture the live values of `passPriorityCast`, `justActivatedType`, `passedUntilXxx`, and `priorityPlayerId` across the cast → resolve cycle.

---

## 1. Executive summary

The most likely root cause is the interaction between `justActivatedType=SPELL`
(set inside `PlayerImpl.activateAbility` at
`Mage/src/main/java/mage/players/PlayerImpl.java:1689-1693`) and
`UserData.passPriorityCast` evaluated in `HumanPlayer.priority`
(`Mage.Server.Plugins/Mage.Player.Human/src/mage/player/human/HumanPlayer.java:1166-1172`).
The webclient's default UserData ships `passPriorityCast=false`
(`Mage/src/main/java/mage/players/net/UserData.java:99-118`,
arg #10 = `false`) — but the upstream Swing client default is
`true`
(`Mage.Client/src/main/java/mage/client/dialog/PreferencesDialog.java:4023`).
Two distinct failure modes flow from this divergence: (A) if the
default has silently flipped (or any path mutates it post-login)
the engine WILL auto-pass after every cast, AND `justActivatedType`
is not cleared on stack resolve, so the post-resolution priority
window of the active player ALSO auto-passes, ending the step;
(B) even with `passPriorityCast=false`, the auto-pass after
resolve cannot fire — meaning either (A) is real, or there is a
client-side dispatch we've missed. The audit below confirms (A) is
the most likely surface: our default is correct on the wire, but
the post-resolve path through `priority()` plus the never-cleared
`justActivatedType` is a latent foot-gun the moment a user toggles
"pass after cast" on (no UI for that yet, but a flip via
`UserData.update()` would land it).

---

## 2. Default UserData audit

`UserData.getDefaultUserDataView()` constructs the default
(`Mage/src/main/java/mage/players/net/UserData.java:99-118`). The
constructor at `:40-77` takes 16 args; mapped to fields:

| # | Constructor arg | Default value | Field | MTG-rules / UX correctness |
|---|---|---|---|---|
| 1 | `UserGroup` | `UserGroup.DEFAULT` | `groupId` | OK — purely cosmetic group label. |
| 2 | `avatarId` | `0` | `avatarId` | OK — cosmetic. |
| 3 | `allowRequestShowHandCards` | `false` | `allowRequestShowHandCards` | OK — opt-in by design. |
| 4 | `confirmEmptyManaPool` | `true` | `confirmEmptyManaPool` | Matches Swing (`PreferencesDialog.java:4017`, default `"true"`). |
| 5 | `userSkipPrioritySteps` | `new UserSkipPrioritySteps()` | `userSkipPrioritySteps` | See drill-down below. |
| 6 | `flagName` | `"world.png"` | `flagName` | OK — cosmetic. |
| 7 | `askMoveToGraveOrder` | `false` | `askMoveToGraveOrder` | Matches Swing default `"false"` (`PreferencesDialog.java:4020`). |
| 8 | `manaPoolAutomatic` | `true` | `manaPoolAutomatic` | Matches Swing default `"true"` (`PreferencesDialog.java:4021`). |
| 9 | `manaPoolAutomaticRestricted` | `true` | `manaPoolAutomaticRestricted` | Matches Swing default `"true"` (`PreferencesDialog.java:4022`). |
| 10 | `passPriorityCast` | **`false`** | `passPriorityCast` | **DIVERGES** — Swing default is `"true"` (`PreferencesDialog.java:4023`). See §3. |
| 11 | `passPriorityActivation` | **`false`** | `passPriorityActivation` | **DIVERGES** — Swing default is `"true"` (`PreferencesDialog.java:4024`). |
| 12 | `autoOrderTrigger` | `true` | `autoOrderTrigger` | Matches Swing default `"true"` (`PreferencesDialog.java:4025`). |
| 13 | `autoTargetLevel` | `1` | `autoTargetLevel` | Matches Swing default `1` (`PreferencesDialog.java:4026`). |
| 14 | `useSameSettingsForReplacementEffects` | `true` | `useSameSettingsForReplacementEffects` | Matches Swing default `"true"` (`PreferencesDialog.java:4027`). |
| 15 | `useFirstManaAbility` | `false` | `useFirstManaAbility` | Matches Swing default `"false"` (`PreferencesDialog.java:4028`). |
| 16 | `userIdStr` | `""` | `userIdStr` | OK — TODO comment at `:28` marks the field as un-used. |

`UserSkipPrioritySteps` defaults
(`Mage/src/main/java/mage/players/net/UserSkipPrioritySteps.java:13-23`):

* `stopOnDeclareAttackers = true` (`:13`)
* `stopOnDeclareBlockersWithZeroPermanents = false` (`:14`)
* `stopOnDeclareBlockersWithAnyPermanents = true` (`:15`)
* `stopOnAllMainPhases = true` (`:16`)
* `stopOnAllEndPhases = true` (`:17`)
* `stopOnStackNewObjects = true` (`:18`)
* `yourTurn` / `opponentTurn` are fresh `SkipPrioritySteps` instances.

`SkipPrioritySteps` defaults
(`Mage/src/main/java/mage/players/net/SkipPrioritySteps.java:13-19`):
`upkeep=false, draw=false, main1=true, beforeCombat=false,
endOfCombat=false, main2=true, endOfTurn=false`. The naming is
inverted vs. semantic — `isPhaseStepSet()` at `:77-96` returns the
per-step flag, and `HumanPlayer.checkPassStep` at
`HumanPlayer.java:1430-1434` returns `!isPhaseStepSet(...)`. So
`main1=true` means **STOP at PRECOMBAT_MAIN and give priority to
the player**. Verified — naming/semantic inversion is real and
consistent with the comments in `actionPanelHelpers.ts:11-32`.

---

## 3. Swing default comparison

| Flag | Webclient default | Swing default | Source for Swing |
|---|---|---|---|
| `confirmEmptyManaPool` | `true` | `"true"` | `PreferencesDialog.java:4017` |
| `manaPoolAutomatic` | `true` | `"true"` | `PreferencesDialog.java:4021` |
| `manaPoolAutomaticRestricted` | `true` | `"true"` | `PreferencesDialog.java:4022` |
| **`passPriorityCast`** | **`false`** | **`"true"`** | `PreferencesDialog.java:4023` |
| **`passPriorityActivation`** | **`false`** | **`"true"`** | `PreferencesDialog.java:4024` |
| `autoOrderTrigger` | `true` | `"true"` | `PreferencesDialog.java:4025` |
| `autoTargetLevel` | `1` | `1` | `PreferencesDialog.java:4026` |
| `useFirstManaAbility` | `false` | `"false"` | `PreferencesDialog.java:4028` |
| `useSameSettingsForReplacementEffects` | `true` | `"true"` | `PreferencesDialog.java:4027` |
| `askMoveToGraveOrder` | `false` | `"false"` | `PreferencesDialog.java:4020` |

`UserSkipPrioritySteps` and `SkipPrioritySteps` defaults are baked
into the Java classes (no Swing-side override exists);
both clients see the same defaults from
`Mage/src/main/java/mage/players/net/UserSkipPrioritySteps.java:13-18`
and `SkipPrioritySteps.java:13-19`.

The two divergences (`passPriorityCast`, `passPriorityActivation`)
are deliberate — the webclient ships them OFF because there is no
UI to toggle them, and ON-by-default produces an effect users
cannot turn off ("the engine seems to skip my second spell after I
cast a Bolt"). With `false` the bug-report scenario should NOT be
auto-passing on the post-resolve priority window — see the trace
in §4.

---

## 4. Priority loop trace — bug scenario

Setup: alice is the active player, PRECOMBAT_MAIN, has just cast
Lightning Bolt and bob has passed; the spell resolved against bob.
Engine returns alice to the priority loop. UserData = default
webclient view (per §2). Walk through `HumanPlayer.priority()` at
`HumanPlayer.java:1156-1410`:

1. `passed = false` (`:1157`) — every entry resets the per-call
   passed flag.
2. `controllingUserData = getControllingPlayersUserData(game)`
   (`:1162`) — alice controls her own turn so this returns
   `this.userData` (`PlayerImpl.java:4664-4673`). At this point
   `passPriorityCast=false` per the default.
3. `canRespond()` true — alice is alive.
4. **`getJustActivatedType() != null && !holdingPriority`**
   (`:1166`). After casting Bolt at `PlayerImpl.java:1691`,
   `justActivatedType` was set to `AbilityType.SPELL` and never
   cleared on resolution (the ONLY clear sites are
   `HumanPlayer.java:1169`/`:1175` — both inside this branch's
   pass paths — and `PlayerImpl.java:1687`/`:2625`/`:460`, all
   tied to a fresh `activateAbility` call, `resetPlayerPassedActions`,
   or construction). Branch entered.
   * `controllingUserData.isPassPriorityCast() && type == SPELL`
     (`:1167`): with default false → **skip**.
   * `controllingUserData.isPassPriorityActivation() && type.isNonManaActivatedAbility()`
     (`:1173`): false → **skip**.
   * Branch exits without passing. `justActivatedType` is still
     `SPELL` because neither nested if fired.
5. `quickStop` block (`:1182-1195`): only relevant on
   `DECLARE_ATTACKERS` for the defender, irrelevant in main1 →
   **skip**.
6. SKIP block (`:1198`): `quickStop=false` and game is under
   alice's control → enter.
   * `passedAllTurns / passedTurnSkipStack` (`:1200`): false →
     skip.
   * `passedUntilEndStepBeforeMyTurn` (`:1206`): false → skip.
   * **Empty-stack branch (`:1226`)** — stack is empty post-resolve.
     * `passedUntilStackResolved`: false → not entered (`:1230`).
     * `passedTurn / passedTurnSkipStack` (`:1235`): false → skip.
     * `passedUntilNextMain` (`:1242`): false → skip.
     * `passedUntilEndOfTurn` (`:1265`): false → skip.
     * **`checkPassStep` (`:1289`)**:
       `playerId == activePlayerId`, so
       `controllingUserData.getUserSkipPrioritySteps().getYourTurn()`
       is the `yourTurn` `SkipPrioritySteps`. `main1=true` →
       `isPhaseStepSet(PRECOMBAT_MAIN)` returns `true` (`:83-84`)
       → `checkPassStep` returns `!true = false`
       (`HumanPlayer.java:1431`). The engine does NOT
       auto-pass. **Branch exits without pass.**
7. Drop into the wait loop at `:1320-1347` — the engine fires a
   priority event (`:1325`) and waits for the user. ALICE NOW
   HAS PRIORITY. Game is correct here.

**So with the default UserData on the wire, the bug does not
reproduce in the Java priority loop.** The post-resolve priority
window correctly returns control to alice.

If, however, `passPriorityCast` were ever observed `true` on
`controllingUserData` at the post-resolve check, the engine would
re-enter step 4's first nested if, call `pass(game)` and return
`false` — meaning alice silently passes on the post-resolve
priority window. Combined with bob's auto-pass (he didn't add
to the stack, so he's still in `passed=true` from the just-completed
round), the step ends and the engine advances out of main1. This is
exactly the user's reported failure mode. Mechanism: `justActivatedType`
is sticky across a single spell cycle and is read on EVERY priority
window until it's cleared, including the post-resolve one. The
clear-on-resolve hole is the latent foot-gun.

---

## 5. Client-side auto-pass audit

Searched the entire webclient for `sendPlayerAction(` calls and
listed each callsite. The total surface is small:

* `webclient/src/pages/ActionPanel.tsx:128` — F2 hotkey,
  user gesture (`keydown` handler, `:99-137`). Phase-aware via
  `nextPhaseAction` (`actionPanelHelpers.ts:35-78`). User-driven
  only.
* `webclient/src/pages/ActionPanel.tsx:130` — non-F2 hotkeys
  (F4/F6/F8/Esc/Ctrl+Z). User-driven only.
* `webclient/src/pages/ActionPanel.tsx:147` — `send(action)`
  helper invoked from button `onClick` handlers (`:182-261`).
  All gated on user click.
* `webclient/src/game/ActionButton.tsx:190, :214, :255, :261` —
  redesign action button. Same shape as the legacy panel: hotkey
  handlers (`:169-220`), primary `onClick` (`:253-256`), menu
  item dispatch (`:258-262`). User-driven only.
* `webclient/src/game/GameHeader.tsx:225` — `CONCEDE` from
  the gear-icon settings modal. User-driven.
* `webclient/src/game/dialogs/TriggerOrderDialog.tsx:77, :93,
  :181, :207` — trigger-ordering dialog responses. Driven by
  user clicks on rendered ability rows.

None of these fire from a `useEffect` watching `gameView`. None
inspect `priorityPlayerId` and auto-dispatch a pass. None observe
`turnStepType` and pre-emptively clear the priority window. Grep
on `priorityPlayerId` / `priorityPlayerName` returns reads only —
no writes that schedule a pass.

The `clickRouter` (`webclient/src/game/clickRouter.ts:78-170`)
similarly issues no pass dispatches. Object clicks route through
`sendObjectClick` (`stream.ts:430-432`) which is `sendPlayerResponse(0,
'uuid', objectId)` — that is a free-priority action attempt, NOT
a pass. The store (`webclient/src/game/store.ts:506-689`) has no
effect that fires a pass; it is purely a reducer over inbound
frames.

`GameStreamHandler.handlePlayerAction`
(`Mage.Server.WebApi/src/main/java/mage/webapi/ws/GameStreamHandler.java:455-511`)
is a pure pass-through: it deserializes `PlayerAction.valueOf(...)`,
checks against `PlayerActionAllowList`
(`PlayerActionAllowList.java:30-92`) and calls
`embedded.server().sendPlayerAction(...)`. No server-side
synthesis of a pass. The only synthesized side effect is a
`sendPlayerUUID(gameId, sid, null)` after `TRIGGER_AUTO_ORDER_*_LAST`
(`:497-501`), which is unrelated to phase advance.

The auth path mutates UserData ONCE at login
(`Mage.Server.WebApi/src/main/java/mage/webapi/auth/AuthService.java:366-372`,
slice 70-X.7) by calling
`embedded.server().connectSetUserData(..., UserData.getDefaultUserDataView(), ...)`
and never again — no `setPassPriorityCast` callsites exist in
`Mage.Server.WebApi` (grep confirmed, 0 hits). The Java
`User.update()` path (`UserData.java:79-97`) copies whole-cloth
from another `UserData`; the only callers ship the default view,
preserving `passPriorityCast=false`.

**Conclusion: there is no client- or facade-side auto-pass. The
auto-advance, if real, originates inside the engine's priority
loop given some `passPriorityCast=true` observation.**

---

## 6. Top-3 root-cause hypotheses

### H1 — `passPriorityCast` is read as `true` somewhere on the post-resolve window (LIKELIHOOD: HIGH)

* Direct match for the symptom.
* The clear-on-resolve hole around `justActivatedType` is real and
  documented (`PlayerImpl.java:1687-1693`, `HumanPlayer.java:1169/1175`,
  `:2625`, `:460`): the SPELL marker survives stack resolution
  intact.
* Default *should* be `false`, but a regression — e.g., a
  `User.update(UserData)` call from a stale Swing-default snapshot,
  or a forgotten test fixture, or a future "settings sync" feature
  — would manifest exactly as reported. Evidence the wire-up is
  fragile: the only place defaults are bound is the auth path
  (`AuthService.java:366`), and there is no in-app surface to
  inspect what the engine currently sees.

### H2 — `justActivatedType` is mutated to a stale value via a different code path (LIKELIHOOD: MEDIUM)

* `setJustActivatedType` is also called when the player activates
  a non-mana ability that uses the stack
  (`PlayerImpl.java:1689-1693`). Triggered abilities populated by
  `triggerAbility` (`:1700+`) do NOT set this — but a defensive
  read could still be stale across game-state transitions.
* Less direct than H1 but explains the symptom in the activation
  path. With `passPriorityActivation=true` somewhere, a similar
  loop closes.

### H3 — A `quickStop` / `passWithManaPoolCheck` interaction silently passes through main1 (LIKELIHOOD: LOW)

* `quickStop` only fires on `DECLARE_ATTACKERS` for the defender
  (`HumanPlayer.java:1185-1194`); cannot trigger in main1.
* `passWithManaPoolCheck` (`:2858-2867`) — confirms mana-pool
  emptying with the user before passing. If the mana pool is empty
  (Bolt drained R), this auto-passes silently. But this is the
  PASS mechanism, not the trigger to pass; it requires another
  branch to have already decided to pass. Doesn't independently
  cause the bug.

---

## 7. Recommended fix

Two coordinated changes, both surgical and rules-clean. Do not
ship a code change as part of this audit — these are the
locations and shape:

1. **Clear `justActivatedType` after stack resolution** at the
   active-player priority handoff. Today it is sticky from cast
   through the post-resolve window (`HumanPlayer.priority`
   `:1166`), which is the foot-gun H1 hangs on. The natural site
   is inside `GameImpl.playPriority` immediately after the
   `resolve()` block at
   `Mage/src/main/java/mage/game/GameImpl.java:1761-1769`, BEFORE
   `state.getPlayers().resetPassed()` at `:1766`. Iterate
   players and call `setJustActivatedType(null)` on each (the
   setter exists at `PlayerImpl.java:5400-5402`). Rationale: the
   "just activated" marker is meant to drive auto-pass on the
   SAME priority window the spell was cast in, per CR 116.5 / 117
   timing — once the spell has resolved, future priority windows
   should not see a marker referring to an action two stack-cycles
   ago. This is the minimal MTG-rules-correct change.

2. **Pin `passPriorityCast` / `passPriorityActivation` to the
   default at every `connectSetUserData` boundary** OR add an
   assertion at `HumanPlayer.priority` entry that surfaces a
   structured log line when `passPriorityCast=true` on a
   webclient-flagged `UserData` (UserData has no flag for that
   today; one option is a `userIdStr` prefix or an extra
   `protected boolean` defaulted false in `UserData`). Rationale:
   confirmation telemetry. If the auto-advance recurs, we want a
   one-line log identifying which flag is observed true. This is
   not strictly required for the fix but closes the diagnostic
   loop.

Do NOT ship a fix to `nextPhaseAction(PRECOMBAT_MAIN)` — that map
already returns `PASS_PRIORITY_UNTIL_NEXT_MAIN_PHASE`
(`actionPanelHelpers.ts:42-59`, slice 70-Y / Issue 3 fix), which
is the rules-correct dispatch from main1 to main2. The bug is
not in the F-key map; it is in the engine-side
`justActivatedType` plumbing.

---

## 8. Other latent bugs found

* **`getControllingPlayersUserData` skips the human-controller
  null guard.** `PlayerImpl.java:4664-4673`: when
  `!isGameUnderControl()`, it dereferences `player.isHuman()`
  without checking `player != null`. Game-under-control with a
  controller that has left the game would NPE here. The
  controller leaving mid-game is a real failure mode (see
  `afk-timeout-cascade-recon.md`). Low-severity; rarely hit.
* **`SkipPrioritySteps.isPhaseStepSet` returns `true` for unknown
  steps** (`SkipPrioritySteps.java:93-94`). That means
  `checkPassStep` returns `!true = false` for any unknown step,
  causing the engine to STOP and ask the user for input on phase
  steps it doesn't have a flag for. UNTAP / CLEANUP fall through
  here. Per CR 502.1 and 514.3 these steps don't grant priority,
  so this fall-through is benign in normal play (the engine never
  enters `priority()` for those steps because `Step.priority` at
  `Step.java:69-75` checks `hasPriority`); but if a future step
  type is added without a flag, default behavior is conservative-
  STOP. Worth a comment, low-severity.
* **`AuthService.connectSetUserData` is the ONLY place defaults
  are pushed** (`:366-372`). If a future code path adds a second
  setter (e.g., a per-game preferences sync), and that snapshot
  carries the Swing defaults verbatim, `passPriorityCast=true`
  would leak into the engine. Pre-emptive fix: extract a
  `getWebclientDefaultUserDataView()` helper that mirrors the
  current `getDefaultUserDataView()` but explicitly forces
  `passPriorityCast=false` regardless of any future global
  shift. Today they happen to coincide — that's fragile.
* **`HumanPlayer.priority` line `:1166-1179` is the only place
  `justActivatedType` is consulted.** The pass it fires
  (`pass(game)` at `:1170`/`:1176`) does NOT call
  `passWithManaPoolCheck` (which would offer the user a chance
  to confirm an unused mana pool, per
  `confirmEmptyManaPool=true` in defaults). This is a
  divergence: legitimate ManaPool dialogs are bypassed by
  auto-pass. Per CR 106.4, mana floats and empties at end of
  step / phase; the dialog is a UX confirmation, not a rules
  invariant — but it's a UX inconsistency worth flagging.
* **`endOfTurn` at `PlayerImpl.java:707-710`** clears `passedTurn`
  / `passedTurnSkipStack` but NOT `justActivatedType`,
  `passedUntilEndOfTurn`, `passedUntilNextMain`, or
  `passedUntilEndStepBeforeMyTurn`. Some are intentionally cross-
  turn-sticky (F-keys), but `justActivatedType` SHOULD reset at
  end-of-turn. Reinforces fix #1 in §7.
* **The webclient's `actionPanelHelpers.ts:35-78` notes** that
  `PASS_PRIORITY_UNTIL_TURN_END_STEP` from main1 was the
  pre-fix dispatch and "set passedUntilEndOfTurn=true and
  bypassed everything except END_TURN." That comment correctly
  describes the engine semantics
  (`PlayerImpl.java:2667-2671`): the F5 action sets
  `passedUntilEndOfTurn=true` and `skippedAtLeastOnce` is
  conditioned on the current step. Fix is intact at `:42-59`,
  shipping `PASS_PRIORITY_UNTIL_NEXT_MAIN_PHASE` from main1.
* **`UserSkipPrioritySteps.stopOnDeclareAttackers` is read from
  the controlling player's UserData but the inverse default
  `stopOnDeclareBlockersWithZeroPermanents=false`** means a
  player with no creatures gets ZERO priority window during
  declare-blockers — they cannot cast instants in response to
  attackers if they have no permanents. This is a UX trap;
  upstream Swing has the same default. Out of scope here, but
  worth a future flag.

---

## 9. Open questions for the user

1. Can you reproduce the bug after a fresh login (`AuthService.connectSetUserData`
   is the only default-write site, so fresh-login should ALWAYS
   ship `passPriorityCast=false`)? If yes, that contradicts H1
   and forces us to look elsewhere — most likely a wire-side
   force-flip we haven't found.
2. Does the bug reproduce on the FIRST cast of the first turn,
   or only after some other interaction (cast → resolve →
   second cast)? `justActivatedType` survives across distinct
   cast cycles only via the post-resolve hole; if it reproduces
   on the very first cast, that would point at a different
   trigger.
3. What spell are you casting? Sorceries vs. instants vs.
   non-stack lands matter — `setJustActivatedType` is gated on
   `ability.isUsesStack()` at `PlayerImpl.java:1690`, so a
   land play does NOT set the flag and should NOT trigger
   any auto-pass. If the bug reproduces on a land play, the
   diagnosis above is wrong.
4. Is "Resolve Stack" (F8) the action you press to resolve the
   spell, or do you let the engine auto-pass with bob's defaults?
   `PASS_PRIORITY_UNTIL_STACK_RESOLVED` calls
   `resetPlayerPassedActions` (`PlayerImpl.java:2692`) which
   clears `justActivatedType` (`:2625`) — so the bug should NOT
   reproduce when you press F8 to resolve, only when bob auto-
   passes through with the spell on the stack. That gives us a
   discriminating test.
5. Does the engine advance to combat (DECLARE_ATTACKERS and
   above) or does it skip combat entirely? Combat has its own
   `quickStop` for the defender (`HumanPlayer.java:1185-1194`);
   if the engine skips past combat too, that strongly implicates
   a stickier flag like `passedUntilNextMain` or
   `passedUntilEndOfTurn`, which means the user clicked an F-key
   we're not accounting for.
