# Slice 70-X.14 — engine-gap triage from 2026-04-30 playtest

**Status:** Planned
**Date:** 2026-05-01
**Builds on:** [ADR 0008](0008-player-interactions.md), [slice 70-Y](slice-70-Y-click-resolution.md)
**Source:** 4-agent research review (engine catalog, wire-format audit, MTG
interaction survey, live bug triage) + 3-agent validation review
(architecture, MTG-rules expert, completeness check). Triggered by 6 bugs
surfaced in a 4p Commander playtest 2026-04-30.

## Why this slice exists

Per `feedback_systematic_prep_xmage.md` — the playtest discovery-bug churn
needs systematic prep, not card-by-card chase. This slice catalogs the 6
reported bugs against ADR 0008's canonical surface, calls out engine-side
gaps the multi-agent audit found, and queues a fix order that aligns with
slice 70-Y and the multiplayer frequency doc.

## The 6 reported bugs

### Bug 1 — Fierce Empath / library search shows no images, no eligibility filter

- **Root cause:** `webclient/src/game/dialogs/SelectDialog.tsx` is a slice-B stub. Reads `dialog.data.cardsView1` only as a paste-a-UUID input; never renders cards as `CardFace`.
- **Layer:** UI only.
- **Engine + wire are correct:** `chooseTarget(Outcome, Cards, TargetCard, ...)` fires correctly; `cardsView1` carries the pre-filtered legal subset (mana value 6+ for Fierce Empath); `targets[]` is populated when applicable. See [ADR 0008 §1.28](0008-player-interactions.md) and [ADR 0008 §1.33](0008-player-interactions.md).
- **Fix:** Replace the stub with a card-grid renderer using `CardFace`. Click-to-pick + min/max submit. Reference `TargetDialog.tsx:50-66` which already does ~80% of this — extract a `<CardChooserList>` primitive.
- **Supersedes / aligned with:** [slice 70-Y.1](slice-70-Y-click-resolution.md) plans the same dialog conversion under a feature flag with click-to-resolve semantics. Land Bug 1's fix as part of slice 70-Y.1 or as a parallel quick-win behind the same flag.
- **Size:** Small (~1 hr) for the basic grid; Medium (~half day) for the full slice 70-Y.1 click-to-resolve approach.

### Bug 2 — Phase moves forward without land drop

- **Root cause:** Hypothesis — defaults look correct in three layers (`SkipPrioritySteps.main1=true`, `connectSetUserData` ships defaults via slice 70-X.7, `checkPassStep` returns false at main1). Most plausible: F2 keypress timing during opponent's end-step fires `PASS_PRIORITY_UNTIL_NEXT_TURN` and rolls past the player's main1.
- **Layer:** Multi (config + UI hotkey UX).
- **Fix:** Add server-side INFO log on `HumanPlayer.checkPassStep` returns + dump `controllingUserData.getUserSkipPrioritySteps()` once per game start. Confirm runtime state matches expected. If correct: investigate hotkey timing.
- **Size:** Small to investigate; fix size depends on root cause.

### Bug 3 — Auras don't visually attach to host creature

- **Root cause:** Wire format carries `attachedTo` correctly via `CardViewMapper`. **Renderer drops it.** Zero hits in `webclient/src/game/*.tsx` for `attachedTo` or `attachments`. Battlefield rows render permanents flat with no attachment grouping.
- **Layer:** UI only.
- **Fix:** Battlefield-row layout pass that buckets attachments under host before flat-laying. Design choice: overlap, adjacent, or anchored badge.
- **Size:** Medium (~half day) — needs design plus layout refactor.

### Bug 4 — Commander portrait disappears when commander is summoned

- **Root cause:** `PlayerPortrait.tsx:115-122` (and `PlayerFrame.tsx:578-582`) reads commander identity from `gv.players[].commandList` which empties when commander leaves the command zone.
- **Layer:** UI only — schema work is **DONE**. Slice 70-X already added `commanderName` + `commanderImageNumber` to `WebSeat` (schema 1.24) and `cardNumber` to `WebCommandObjectView`. The plumbing exists; portrait just reads from the wrong source.
- **Fix:** Add stable `commanderIdentities: List<UUID>` to `WebPlayerView` (Partner / Background support) OR have `PlayerPortrait` read from `WebSeat.commanderName` (already plumbed) + cache a per-game commander snapshot in store. Schema bump may not be needed depending on path.
- **Size:** Small (~1 hr).
- **MTG correctness:** **Partner / Background commanders** (CR 702.124) require `List<UUID>`, not single UUID. Don't ship a single-commander assumption.

### Bug 5 — Surveil and scry have no working UI

- **Root cause:** Same as Bug 1 — `SelectDialog` stub. Engine fires `choose(Outcome, Cards, TargetCard, ...)` with `min=0, max=N` and message "PUT on BOTTOM" (scry) or "GRAVEYARD" (surveil).
- **Layer:** UI only.
- **Fix:** Beyond Bug 1's grid, scry/surveil need an **ordered top/bottom split UI**:
  1. Each card individually toggles between top (default) and bottom (scry) or graveyard (surveil) piles.
  2. **TWO-PHASE** — after partition, if 2+ cards remain on top, a follow-up prompt orders them (CR 701.27 for scry, 701.42 for surveil). The engine fires this ordering call separately.
- **Size:** Medium (~half day) — depends on Bug 1's primitive landing first.
- **MTG correctness note:** Earlier scoping conflated this with single-pick. The two-phase nature (partition THEN order) is non-negotiable.

### Bug 6 — Exile only allowed exiling own creatures

- **Root cause:** Likely **engine state, not UI**. Engine's `possibleTargets` produces the legal set; the wire just carries it; the UI renders what it gets. `Path to Exile` filter is `TargetCreaturePermanent` with no controller restriction.
- **Layer:** Engine state (probably).
- **Likely real cause:** Hexproof / shroud / protection-from-white on opponent creatures filtering them out of `possibleTargets` (CR 702.11, 702.18, 702.16). All filter at target-selection time.
- **Fix:** Investigation only. Confirm exact card cast + opposing battlefield state. Add `possibleTargets` debug log in `HumanPlayer.chooseTarget` line 784 if needed.
- **Size:** Trivial to investigate.

## Engine-side gaps surfaced by the audit

These are NOT WIRED in the WebApi mapper today — every card path that uses
them hangs silently. Per [ADR 0008 §1.30](0008-player-interactions.md) and
[§1.37](0008-player-interactions.md):

- **`GAME_CHOOSE_PILE`** (Fact or Fiction, Steam Augury, Hooded Hydra) — no mapper case in `WebSocketCallbackHandler.mapToFrame`. `cardsView2` field is on the upstream `GameClientMessage` but not in the Zod schema (`webclient/src/api/schemas.ts`) — needs schema extension.
- **`GAME_GET_MULTI_AMOUNT`** (trample damage assignment, Crackle with Power, Hurl Through Hell, Fiery Confluence post-target) — no mapper case. `messages: List<MultiAmountMessage>` field on `GameClientMessage` not in Zod schema.

Both are **must-fix** before serious multiplayer playtesting. Trample damage
assignment alone affects every game with combat.

## Other validated gaps (lower priority)

From the 3-agent validation pass + ADR 0008 cross-reference:

- **`WebPlayerView.counters`** (poison, experience, energy) — not on the wire. Infect decks broken.
- **`WebPlayerView.passedTurn` / `passedUntilEndOfTurn` / `passedAllTurns`** etc. — auto-pass state indicators. Webclient can't render "passing until end of turn."
- **`WebPlayerView.topCard`** (Bolas's Citadel, Future Sight) — top-of-library reveal.
- **`WebPlayerView.commanderDamage: Map<UUID, Map<UUID, Integer>>`** — required for the 21-damage loss-condition UI (CR 903.10).
- **`WebClientMessageOptions.flagMay` / `rightBtnDisable`** — "May" choice variant, disabled-button render.
- **`WebPermanentView` morphed/disguised/manifested/cloaked** — only one `faceDown` boolean for all four.
- **`WebCardView.targets: List<UUID>`** (the targets a stack object points at) — clicking a stack spell can't show its targets.
- **`WebCardView` split-card halves** — Fire//Ice, Wear//Tear can't pick which half.
- **`WebCardView.defense` / `startingDefense`** — battles (MOM-onward) can't render.
- **`WebCardView.cardIcons`** — engine-supplied per-card overlays missing.

## Recommended fix order

### Wave A — blocks playable Commander (~1 day)

1. **Replace `SelectDialog` stub** with `<CardChooserList>` primitive rendering `cardsView1` as `CardFace` tiles, click-to-pick + min/max submit. Resolves Bug 1; foundation for Bug 5. Coordinate with [slice 70-Y.1](slice-70-Y-click-resolution.md).
2. **Scry/surveil two-phase UI** — partition (top/bottom or top/graveyard) + order top group. Resolves Bug 5.
3. **Wire `GAME_GET_MULTI_AMOUNT` + `GAME_CHOOSE_PILE`** in `WebSocketCallbackHandler.mapToFrame`. Schema extension for `cardsView2` + `messages` on Zod side. Resolves trample damage hang + Fact or Fiction hang.
4. **Fix Bug 4** — `PlayerPortrait` reads from `WebSeat.commanderName` (already plumbed) OR add `commanderIdentities: List<UUID>` (Partner-aware) to `WebPlayerView`.
5. **Yes/no stickies on `chooseUse` modal** — "Always Yes / Always No this turn / this game" toggles. Without this, Smothering Tithe + Rhystic Study make Commander unplayable.

### Wave B — Commander correctness (~1 day)

6. **Battlefield-row attachment grouping** — auras/equipment under host. Resolves Bug 3.
7. **`WebPlayerView.counters`** — poison/experience/energy.
8. **`WebPlayerView.commanderDamage`** — per-source-per-defender 21-damage tracking.
9. **`WebClientMessageOptions.flagMay` / `rightBtnDisable`**.
10. **Investigate Bug 2 + Bug 6** with logging; confirm root cause before coding.

### Wave C — broader coverage (~1-2 days)

11. **`WebPlayerView.passedTurn*` flags** — auto-pass indicator on opponent's seat.
12. **`WebCardView.cardIcons`** — engine-supplied overlays.
13. **Multi-block damage ordering UI** — depends on Wave A item 3 landing.
14. **Morphed/disguised/manifested/cloaked distinctions** in `WebPermanentView`.
15. **Stack target visualization** — `WebCardView.targets`.

### Wave D — long tail / fixture investments

16. **Per-mechanic fixture corpus** — one fixture per row in [multiplayer-interaction-frequency.md](../design/multiplayer-interaction-frequency.md).
17. **Wire-shape integration tests** at the WebApi layer — boot a real table, cast top-25 cards, assert wire-frame shape matches expected.
18. Ring tempts you, day/night, Saga chapter — niche but rising.

## Verification

For each wave, the verification path:

- **Wave A item 1, 2, 5:** real-engine playtest, cast Fierce Empath (search), Brainstorm (look-then-arrange), Ponder (scry), surveil card (Thought Scour), Rhystic Study (always-Yes-this-turn).
- **Wave A item 3:** cast Crackle with Power (multi-amount), Fact or Fiction (pile pick).
- **Wave A item 4:** cast commander; portrait survives the zone change. Partner deck (Akiri / Bruse Tarl): both portraits stable.
- **Wave B item 6:** cast Holy Strength on creature; aura visually attaches.
- **Wave B item 8:** play through 21 commander damage; loss condition fires correctly.
- **Wave B items 10:** runtime logs from real games.

## Out of scope (deferred deliberately)

- **Physical legacy/redesign file split** — markers are sufficient until VITE_FEATURE_REDESIGN flips default-on. Documented in slice 70-X.13 Wave 4.
- **Replacement-effect ordering UI** — already partially covered by `gameChooseChoice` per ADR 0008; runtime verification first.
- **Companion declaration** — pre-game, separate from in-game prompts.
- **Replay/spectator** — separate slice.

## See also

- [ADR 0008](0008-player-interactions.md) — canonical engine-callback catalog.
- [Slice 70-Y](slice-70-Y-click-resolution.md) — click-to-resolve dialog conversion.
- [docs/design/multiplayer-interaction-frequency.md](../design/multiplayer-interaction-frequency.md) — Commander frequency ranking.
- [docs/design/gap-inventory-2026-04-29.md](../design/gap-inventory-2026-04-29.md) — design-system gap audit.
