# Slice plan 70-Y — click-resolution UX (replace pop-up modals with card-click answers)

## Context

The current xmage dialog system pushes server-driven prompts to `pendingDialog` in the Zustand store; `<GameDialog>` reads that state and renders a centered modal or a side panel per `dialog.method` (see [dialogs/](../../webclient/src/game/dialogs/)). For prompts whose answer IS a specific card or board object — discard, target, sacrifice, reveal, mana payment — modal listing the candidates is redundant: the player already sees those cards in their hand / battlefield / graveyard / exile. The modal forces them to look in two places (the modal AND the cards) instead of one.

User direction 2026-04-30: "in every possible instance, I want eligible cards to be highlighted with a breathing effect if an action can target the card. I want to replace the popup modal wherever possible in the full release."

The precedent already exists in the codebase: `gameSelect` in "free priority" mode renders NO modal — the board IS the input surface ([GameDialog.tsx:50-72](../../webclient/src/game/dialogs/GameDialog.tsx#L50)). Slice 70-Y extends that precedent to every dialog type whose answer is a card or board object, gating behind a feature flag so the modal fallback is preserved during iteration.

The intended outcome: when the engine asks "discard a card," the player sees their hand cards pulse with the existing `card-targeted-pulse` keyframe, clicks one to dispatch the response, no modal opens. Same for targeting, sacrificing, exiling-from-zone, and mana payment.

---

## Scope — which dialog types convert vs. stay modal

| Server method | Eligible surface | New UX | Keep modal? |
|---|---|---|---|
| `gameTarget` | Permanents/players in `targets[]` | Pulse eligibles + click-to-pick. Small instruction banner replaces the side panel. | NO (panel becomes banner) |
| `gameSelect` over `cardsView1` (discard, reveal, sacrifice, exile-from-zone) | Cards in `cardsView1` | Pulse eligibles in their zone + click-to-pick. Banner replaces modal. | NO (banner only) |
| `gamePlayMana` / `gamePlayXMana` | Lands and mana sources on the battlefield | Pulse mana sources, click-to-tap. Banner with cost breakdown. | NO (banner only) |
| `gameSelect` declareAttackers | Untapped creatures controlled by you | Pulse eligibles, click-to-toggle attack. Banner with "Done attacking". | NO (banner only) |
| `gameSelect` declareBlockers | Your creatures (when active is opponent) | Pulse eligibles, click-to-toggle block, click attacker to assign. Banner. | NO (banner only) |
| `gameAsk` yes/no | Abstract question | No card to click — modal stays. | YES (existing centered modal) |
| `gameSelectAmount` | Numeric input | No card to click. | YES |
| `gameChooseChoice` (creature type, color, name) | Abstract text choice | No card to click. | YES |
| `gameOrderTriggers` | Multiple triggers, drag-to-reorder | Drag pattern doesn't map to single-click. | YES |
| `gameChooseAbility` | Multiple abilities on one card | Could become a hover-popover on the source card. | DEFERRED to a later slice |
| Mulligan ask (`gameAsk` with mulligan/keep buttons) | The whole hand | Click any card to mulligan, click "Keep" to keep. | Keep MulliganModal full-mode chrome, restyle |

About half of the dialog surface area becomes click-to-resolve.

---

## Architecture

### Shared seam: `useDialogTargets()` hook

A new hook in `src/game/useDialogTargets.ts` reads `pendingDialog` and returns:

```ts
interface DialogTargetState {
  /** True iff the active dialog is a click-to-resolve type. */
  active: boolean;
  /** Set of cardIds eligible to be clicked. Empty for non-click dialogs. */
  eligibleCardIds: Set<string>;
  /** Set of player UUIDs eligible to be targeted (gameTarget can target players). */
  eligiblePlayerIds: Set<string>;
  /** Human-readable instruction for the banner ("Discard a card", "Choose target creature", etc.). */
  message: string;
  /** How many picks the dialog is collecting (e.g., 3 for "discard 3 cards"). */
  min: number;
  max: number;
  /** Click handler — call this with a cardId or playerId; it dispatches the engine response. */
  pick: (id: string) => void;
  /** Cancel handler if the dialog is optional; null otherwise. */
  cancel: (() => void) | null;
}

export function useDialogTargets(): DialogTargetState;
```

Consumers:
- **BattlefieldTile** — applies `card-targeted-pulse` className when its `perm.card.cardId` is in `eligibleCardIds`.
- **HandCardSlot (MyHand)** — same, for hand cards in discard/reveal prompts.
- **CommandZoneCard** — pulses if commander is selectable.
- **ZoneBrowser modal** — pulses graveyard/exile cards when those zones are the source of a select.
- **PlayerPortrait** — pulses if player is targetable.
- **clickRouter** — when `eligibleCardIds.has(cardId)` and a click lands on that card, calls `pick(cardId)` instead of the default cast/target path.

### Visual: extend the existing `card-targeted-pulse` keyframe

The keyframe at [index.css:116](../../webclient/src/index.css#L116) already runs at 1s period with a purple-violet box-shadow ramp. Currently fires only via the `isEligibleCombat` flag on BattlefieldTile (slice 26). Extend the same flag's wiring: a new `data-targetable-for-dialog="true"` attribute applied alongside `isEligibleCombat`, sharing the keyframe via `.animate-card-targeted-pulse` or equivalent.

User-confirmed: same purple as combat targeting (one cognitive load — "purple pulse = clickable now"). Combat eligibility and dialog eligibility are mutually exclusive in time, so reusing the color is unambiguous.

### Instruction banner

Replaces the side-panel modals (gameTarget / gamePlayMana / combat panels) with a fixed-position banner. Position: **bottom-center, just above the hand fan**, dismissible. Properties:

- `pointer-events: auto` on the banner, `none` outside (so the board stays clickable).
- z-index: same as the side-panel dialogs (z-40) — banner is interactive UI, not a decorative animation overlay.
- Content: the dialog's `message` field + count progress ("2 of 3 selected") + Cancel button (when applicable) + Done/OK button (when the dialog accepts an "I'm finished" signal, e.g. declareAttackers).
- Closes when the dialog is cleared by the engine (response sent → engine pushes a new gameView → store clears `pendingDialog`).

Extracted as `src/game/dialogs/DialogBanner.tsx`. Picture-catalog amendment: add §7.7 documenting the banner's role + position.

### Click dispatch — extending `clickRouter`

Current `clickRouter` ([clickRouter.ts](../../webclient/src/game/clickRouter.ts)) already routes board clicks through dialog-aware logic (target mode, mana-pay mode, combat mode, free priority). Extend it to recognize:

- **Hand-card clicks during `gameSelect` cardsView1**: when `pendingDialog.method === 'gameSelect'` and the clicked card is in `data.cardsView1`, dispatch `playerResponse.kind = 'select'` with the card's id. Suppresses the normal cast path.
- **Graveyard/exile-card clicks during `gameSelect` cardsView1**: same, when the source zone of the select is graveyard/exile.
- **Player-portrait clicks during `gameTarget`**: dispatch `playerResponse.kind = 'target'` with the playerId.

The router stays the central decision point — components don't need to know about dialog state directly; they call `routeObjectClick(cardId)` and the router decides what the click means based on the active dialog.

---

## Slice cuts

### 70-Y.1 — Foundation: `useDialogTargets` + DialogBanner skeleton + `gameSelect`-with-cardsView1 (discard) end-to-end

Lowest-risk slice that ships ONE complete dialog-type conversion plus the shared infrastructure. Files:

**New:**
- `src/game/useDialogTargets.ts` — the hook.
- `src/game/dialogs/DialogBanner.tsx` — bottom-center instruction banner.
- `src/game/dialogs/DialogBanner.test.tsx` — render + dispatch + cancel tests.
- `src/game/useDialogTargets.test.ts` — hook unit tests across all dialog methods.

**Modified:**
- `src/game/CardFace.tsx` — accept a `targetableForDialog?: boolean` prop, add `data-targetable-for-dialog` + apply `animate-card-targeted-pulse` className when true (or fold into existing pulse class).
- `src/game/BattlefieldTile.tsx` — pass `targetableForDialog` from `useDialogTargets` for the tile's cardId.
- `src/game/MyHand.tsx` — same for hand cards.
- `src/game/clickRouter.ts` — handle `gameSelect` over `cardsView1` (discard pattern). Hand-card click during this dialog dispatches the select response.
- `src/game/dialogs/GameDialog.tsx` — when `pendingDialog.method === 'gameSelect'` and the dialog has non-empty `cardsView1` AND the feature flag is on, render `<DialogBanner>` instead of the centered modal.
- `src/featureFlags.ts` — add `VITE_FEATURE_CLICK_RESOLUTION` (default off).

**Critic pass:** Technical + UI/UX + Graphical (the pulse extension is motion-adjacent, warrants Graphical).

**Live-test path:** flip the flag, trigger a discard prompt (Cathartic Reunion, Liliana cost, etc.), click a hand card to satisfy. Verify the modal does NOT mount; verify the banner appears with "Discard a card" + 1/1 counter; verify the clicked card is removed from hand and the engine continues.

### 70-Y.2 — `gameTarget` conversion

Replace `TargetDialog` side panel with banner + click-to-pick on board. Permanents and players become click targets. Includes player-portrait click dispatch in `clickRouter`.

**Critic pass:** UI/UX (the panel-to-banner transition needs careful catalog framing).

### 70-Y.3 — `gamePlayMana` / `gamePlayXMana` conversion

`ManaPayPanel` becomes a banner with cost breakdown. Mana sources (lands, treasures, signets) pulse on the battlefield. Click-to-tap dispatches the manaPay response (existing flow — just upgrade visuals + drop the panel).

**Critic pass:** UI/UX + Graphical (mana cost rendering is visual-heavy).

### 70-Y.4 — Combat panels (declareAttackers / declareBlockers)

`CombatPanel` becomes a banner with "Done attacking" / "Done blocking" buttons + per-creature toggle on click. Eligible creatures (untapped attackers / available blockers) pulse.

**Critic pass:** UX (combat is interaction-heavy; the panel-removal needs careful UX validation across multi-block + first-strike cases).

### 70-Y.5 — Mulligan + zone-source select (graveyard/exile pickers)

MulliganModal restyle: cards pulse, click any card to mulligan, click a "Keep" button to keep. Plus extend `useDialogTargets` to enumerate cards from graveyard/exile when the dialog's `cardsView1` matches one of those zones (e.g., "return target card from graveyard" — the graveyard cards in `<ZoneBrowser>` pulse and become clickable). Catalog amendment for §5.E zone browser pulse.

**Critic pass:** UI/UX + Graphical.

---

## What stays as modal

After 70-Y.5 ships, the centered-modal path remains for: `gameAsk` (yes/no), `gameSelectAmount`, `gameChooseChoice`, `gameOrderTriggers`. Each of these has no card to click — the answer is abstract — so the modal pattern is the right fit. They retain the existing `<GameDialog>` central-modal rendering.

`gameChooseAbility` is deferred. Could become a hover-popover on the ability source card in a future slice (call it 70-Y.6 if user prioritizes).

---

## Verification plan (across all sub-slices)

- **Unit**: `useDialogTargets` returns the right `eligibleCardIds` for each dialog method. Fixture-based tests, mirroring the gameDelta.test.ts pattern.
- **Integration**: render a tile + emit a synthetic `pendingDialog`, assert the tile's `data-targetable-for-dialog="true"` + the pulse class. Mock a click, assert the engine response shape.
- **Live test**: each slice ships behind `VITE_FEATURE_CLICK_RESOLUTION`. Flip the flag in playtest sessions; verify the click path works end-to-end against the real engine. Toggle the flag off to confirm the modal fallback still works.
- **Critic pass**: per-slice Technical + UI/UX + occasional Graphical, following [critic-checklist-redesign.md](critic-checklist-redesign.md). Catalog amendments at the end of each slice.

---

## Critical files referenced

- `src/game/dialogs/GameDialog.tsx` (router for all dialog types)
- `src/game/dialogs/{Ask,Target,SelectAmount,ChooseChoice,ChooseAbility,Inform,Combat,ManaPay,TriggerOrder}Dialog.tsx` (per-method renderers)
- `src/game/MulliganModal.tsx`
- `src/game/clickRouter.ts` (central click dispatch decision point)
- `src/game/store.ts` (`pendingDialog` state shape)
- `src/api/schemas.ts` (`webGameClientMessageSchema`, `webChoiceSchema`, dialog method enum)
- `src/index.css` (`@keyframes card-targeted-pulse`)
- `src/featureFlags.ts` (gating)
- `docs/design/picture-catalog.md` (Region 7 amendments per sub-slice)

## Existing utilities to reuse

- `card-targeted-pulse` keyframe + `animate-card-targeted-pulse` class — the pulse visual.
- `clickRouter.routeObjectClick(cardId)` — central click dispatch.
- `interactionMode.deriveInteractionMode(dialog)` — already used by `GameDialog`'s `gameSelect` branch to distinguish declareAttackers/declareBlockers/free-priority.
- `MotionConfig reducedMotion="user"` — pulse silently collapses under reduced motion via the existing `data-essential-motion` opt-out (purple pulse is non-essential decoration; the click target itself is interactive, not motion-gated).
