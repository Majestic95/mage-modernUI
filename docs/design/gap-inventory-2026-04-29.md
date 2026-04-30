# Gap Inventory — Target Design vs. Current Implementation

> **Date:** 2026-04-29
> **Scope:** Commander 4-Player Free-for-All game-table screen.
> **Canonical source of truth:** [`picture-catalog.md`](picture-catalog.md) (added 2026-04-29). When this gap inventory and the catalog disagree, the catalog wins.
> **Other sources (lower precedence):** `screens-game-table-commander-4p.md`, `design-system.md`, `target-visual-reference.md`, current code under `webclient/src/`.
> **Purpose:** Per-element verdict (MATCHES / PARTIAL / MISSING / WRONG-PLACEMENT) so the redesign push has a definitive map of what to keep, replace, and build.

## Executive summary

The current implementation has **most infrastructure** the target needs (4-pod grid, halo mechanism, animations, motion registry, design tokens for color/space/radius/typography, CardFace + BattlefieldTile for card rendering, hand fan, ManaOrb atoms, CommanderDamageTracker, eliminated slash, DISCONNECTED overlay, slice 70-H wire-field detection). What it's **missing** is the **MTGA-grade visual translation**: the assembled view never got rebuilt around the spec's anatomy, so the screen reads as a developer dashboard rather than a game UI.

Three structural rewrites carry most of the gap weight:

1. **PlayerFrame** is a horizontal text strip; spec calls for a portrait-stacked anatomy with the commander image as the dominant element.
2. **Side panel** has the wrong order, the wrong components, and is missing the action button entirely.
3. **Central focal zone** (StackZone) is a card-list strip that lives at the top of the battlefield region; spec calls for a single focal-size card with color-identity glow at the geometric center.

Every other gap is small and follows from these three (header bar polish, top-right icon strip, command-zone styling, ZoneIcon visual, action button consolidation).

There are also **token gaps**: `--card-size-{micro,small,medium,large,focal}` are not defined in `tokens.css` despite the design-system referencing them. Card sizes are currently inline pixel values scattered across components. This is a foundational fix that several other slices will depend on.

---

## Verdict legend

- **MATCHES** — current behavior matches the spec well enough that no change is needed for v2.
- **PARTIAL** — the component exists and works, but visually or structurally diverges from the spec. Needs styling pass or props change, not greenfield.
- **MISSING** — no component renders this element today.
- **WRONG-PLACEMENT** — the component exists and is approximately correct in isolation but is mounted in the wrong region of the layout.

---

## Region 1 — Header strip

### 1.1 Lobby name on the left

- **Target:** "COMMANDER — 4 PLAYER FREE-FOR-ALL" in soft purple, all-caps, light tracking. Auto-populated from lobby name.
- **Current:** `GameHeader.tsx:27-31` renders `Game | <gameId-uuid>` in zinc-500 / mono-text. The lobby name isn't fetched into the game-page state at all (the wire `WebGameView` doesn't carry it; the lobby-creation name lives on `WebTableSummary` which the game page doesn't currently consume).
- **Verdict:** **MISSING** (lobby name) + **PARTIAL** (header styling).
- **Work:** wire the lobby name into `Game.tsx` props (probably add a `lobbyName` prop fed by the lobby route's table-summary state; or pull from `gameView.lobbyName` if we extend the wire). Rewrite header layout for soft-purple all-caps + drop the gameId UUID.

### 1.2 Top-right icon row

- **Target:** four icons — chat / layout-zoom / fullscreen / settings.
- **Current:** `GameHeader.tsx:54-71` renders a slowmo debug badge + connection-state dot + a "Leave" text button.
- **Verdict:** **MISSING** (all four icons).
- **Work:** SVG icon strip. Chat toggle (slide-out panel below game log per spec §5). Layout-zoom (TBD — collapse side panel). Fullscreen (`document.documentElement.requestFullscreen`). Settings (modal — per spec §6 still TBD). The "Leave" button can move into the settings modal.

### 1.3 Turn / priority indicators

- **Target:** not in header (per spec §5 they live in side panel + per-pod halo).
- **Current:** `GameHeader.tsx:32-53` renders "Your turn / Opponent's turn" pill + "Your priority / Waiting for opponent" subtext.
- **Verdict:** **WRONG-PLACEMENT.**
- **Work:** Drop these from the header. Per-player active glow (already implemented via halo) + dedicated turn counter in the side panel ("TURN 8") + PriorityTag (already exists, currently rendered in PlayerFrame) covers this.

### 1.4 Connection-state indicator

- **Target:** not specified — implicit in the per-player DISCONNECTED overlay (already shipped as slice 70-H).
- **Current:** `GameHeader.tsx:64` colored dot + state label.
- **Verdict:** **WRONG-PLACEMENT** (or **DROP**).
- **Work:** Drop from the header. The per-player DISCONNECTED pill is the user-facing surface; a global connection dot duplicates that signal once the game is up and never fires for friends (only for the host's view of their own socket, which is uninformative).

---

## Region 2 — Player pods (the largest gap)

### 2.1 PlayerFrame anatomy

- **Target (design-system §7.3):** Circular portrait (`--radius-circle`, default 80px) with halo ring around it. Player name label below portrait (`--font-size-heading-sm`). Commander name below player name (`--font-size-caption`, secondary). Life total in a smaller circle below the name area, large numerals (`--font-size-heading-lg`).
- **Current:** `PlayerFrame.tsx:141-217` renders a horizontal `<header>` strip:
  ```
  [name] [ACTIVE pill] [PriorityTag]    [Life N] [Lib N] [Hand N] [Grave] [Exile] [ManaPool]
  ```
  No portrait. No commander name displayed (commander shows up only as a chip in the CommandZone strip below the battlefield rows). Life is small inline `<span>`, not a numeral feature. Halo wraps the entire pod's bounding-box rectangle, not a circular avatar.
- **Verdict:** **MISSING** (portrait-stacked anatomy).
- **Work:** This is **the biggest single rewrite**. Greenfield PlayerFrame:
  1. Add a `<PlayerPortrait>` sub-component (or inline) that renders a Scryfall art-crop of the player's commander as a circular image with the halo ring around it. Source: take `gameView.players[i].commandList` → first entry with `kind: 'commander'` → use its `imageFileName` + `expansionSetCode` → resolve via existing `scryfall.ts` art-crop endpoint.
  2. Stack the layout vertically: portrait → name → commander name → life numeral.
  3. Move zone counts (graveyard/exile/library) and the mana pool **out of the portrait stack** to a small chip row beneath or beside the portrait (spec §7.9 puts them "near the player frame," not on it).
  4. ACTIVE pill → drop. The active state is conveyed by the halo brightening + pulsing (slice 70-G already wired). The text pill is redundant under the spec's halo-as-active-signal model.
  5. Halo ring becomes circular around the portrait (not the pod bounding box). The current `HaloRing` component in `PlayerFrame.tsx:309-362` uses a mask-composite ring around a rectangular wrapper — a circular variant is a small CSS change since the mask already supports any shape.

### 2.2 Halo ring placement

- **Target:** Circular halo around the portrait, glowing softly. Active player's halo brighter + pulsing. Multicolor halos rotate at 12s/revolution.
- **Current:** Halo is a 2px ring around the entire **rectangular** PlayerArea bounding box (`PlayerFrame.tsx:309-362`). Multicolor rotation animates via `--halo-angle` CSS variable (slice 70-G fix). Active-player pulse via `.animate-player-active-halo` keyframe (`index.css:111`).
- **Verdict:** **PARTIAL** — animations correct, geometry wrong.
- **Work:** When the portrait lands (item 2.1), point the halo's bounding rectangle at the portrait's circular wrapper instead of the pod's rectangle. Same mask-composite mechanism, smaller circular subject.

### 2.3 Battlefield rows around the pod

- **Target (spec §2):** Two rows per pod — lands closer to the player's edge, creatures forward (Arena-style). Small column to the right of the creature row for non-creature non-land permanents (artifacts/enchantments). For 4-pod arrangement: each opponent pod has rows that "curve around the upper edge" or stack vertically along left/right edges.
- **Current:** `PlayerArea.tsx:128-174` + `BattlefieldRowGroup.tsx`. Uses `bucketBattlefield` to split into creatures / other / lands rows. `rowOrder(perspective)` mirrors the order for opponents. All rows render BELOW the PlayerFrame strip in a flex column. CommandZone is a strip below the rows.
- **Verdict:** **PARTIAL** — bucketing is correct, anatomy positioning is wrong.
- **Work:** When the portrait-stacked PlayerFrame lands (item 2.1), the rows need to flow around the portrait per the target. For TOP opponent: rows curve above/below the portrait (the target screenshot shows 6 cards in a horizontal row above + smaller token row below). For LEFT/RIGHT opponents: rows stack vertically along the edge column. For BOTTOM (self): rows above the hand fan, full-width. This is layout work, not new components.

### 2.4 Card sizes by pod

- **Target:** local player permanents `--card-size-medium`, opponents `--card-size-small` (10% smaller). Hand `--card-size-large`. Shrink uniformly under board complexity, then overlap.
- **Current:** `BattlefieldTile.tsx:62` hardcodes `w-[112px] h-[112px]` slot for every permanent regardless of perspective. CardFace has internal `size` prop ("battlefield"/"hand"/"stack") with hardcoded pixel values per size.
- **Verdict:** **PARTIAL** — size prop exists, but no per-pod variation and no token system.
- **Work:** Define `--card-size-{micro,small,medium,large,focal}` in `tokens.css`. Refactor BattlefieldTile + CardFace to consume tokens instead of pixel values. Pass perspective-aware size from PlayerArea (self=medium, opponent=small).

### 2.5 CommandZone slot

- **Target (spec §7.8):** For local player a large slot to the right of the hand. For opponents a smaller slot near their player frame. Hidden when commander is on battlefield. Glows in color identity when castable.
- **Current:** `CommandZone.tsx:14-27` renders a horizontal chip strip below the battlefield rows ("COMMAND" label + chip per command-zone entry). Renders for every player position identically. No glow. Not hidden when commander is on battlefield (would need to read battlefield contents for "is commander here?").
- **Verdict:** **WRONG-PLACEMENT** + **PARTIAL** (no glow, no battlefield-hide, no per-perspective sizing).
- **Work:** Replace text chips with CardFace-rendered slot showing the actual commander art. For self: relocate to right-of-hand region per spec §4. For opponents: small slot adjacent to their PlayerFrame. Glow logic = "castable" predicate (commander tax check) + drives a `stack-glow-pulse`-like animation. Hide-when-on-battlefield: scan `player.battlefield` for an entry where `card.id === commanderEntry.id`; if found, hide.

### 2.6 ZoneIcons (graveyard/exile/library)

- **Target (spec §7.9):** For local player, full size, clickable to open scrollable modal. For opponents, small "G" / "E" icon with count badge. Library shows just a number.
- **Current:** `ZoneIcon.tsx:62-87` accepts a `variant: 'self' | 'opponent'` prop but the comment at line 71-73 explicitly says "Today both branches render identically; 70-D will branch to a compact G/E icon for opponent." Library renders as `Lib N` text strip.
- **Verdict:** **PARTIAL** (forward-compat prop wired, behavior identical).
- **Work:** Land the opponent variant — small `<G>` `<E>` icons with count badges. Library: just a number in monospace, no `Lib` label.

---

## Region 3 — Central focal zone

### 3.1 Stack rendering at focal size

- **Target (spec §3 / §7.6):** Topmost stack item rendered at `--card-size-focal` (~1.5× battlefield-medium) with active color-identity glow (`stack-glow-pulse`). Up to 5 additional items fanned behind/below at progressively smaller sizes. 6+ collapse to "+N more". Center of the geometric battlefield.
- **Current:** `StackZone.tsx` renders all stack entries inline at `<CardFace size="stack">` (small) in a `flex-wrap` row at the top of the battlefield section. Sits in the central grid cell per `Battlefield.tsx:206-215` BUT the CardFace size = "stack" means small uniform cards, not a focal-size centerpiece. There IS `STACK_GLOW_PULSE_CLASS` in animation/transitions but I'd need to verify it's applied to the topmost entry.
- **Verdict:** **WRONG-PLACEMENT** (placement is correct — it IS in the center grid cell — but rendering is wrong).
- **Work:** Rewrite `StackZone`:
  1. Topmost entry → `<CardFace size="focal">` with color-identity glow.
  2. Up to 5 more → fanned behind/below at smaller sizes (use `transform` translate + scale on each).
  3. 6+ → "+N more" pill on the topmost.
  4. Empty state → ambient particles only (not the current `opacity-0` collapse).

### 3.2 Combat-mode (arrows instead of stack)

- **Target (spec §3 mode="combat"):** Central zone shows attack/block arrows during combat phase. If a combat trick is cast, briefly switch back to stack mode.
- **Current:** Combat is rendered via attacker/blocker badges on individual BattlefieldTiles + targeting arrows from TargetingArrow component. There's no central-zone combat mode.
- **Verdict:** **MISSING** (central-zone combat mode).
- **Work:** When `gameView.combat.length > 0`, central zone renders the combat groups as TargetingArrow-style overlays from each attacker to its target/blocker. Re-use TargetingArrow geometry. Stack-mode takes precedence during a stack-during-combat window.

### 3.3 Empty state ambient particles

- **Target (spec §3 empty state):** Subtle ambient particles (`particle-drift` motion) but no UI chrome.
- **Current:** Particle layer exists (`GameTable.tsx:246-256`) and animates via `animate-particle-drift` keyframe. Sits behind the entire battlefield region. The central zone empty state is just hidden via opacity-0.
- **Verdict:** **MATCHES** (the particle-drift wrapper covers the whole battlefield, which includes the central zone).

---

## Region 4 — Hand area

### 4.1 Hand fan layout

- **Target (spec §4):** Slight arc fan, not a Hearthstone-style steep curve. Default `--card-size-large`. Squeeze tighter when hand is large; leftmost/rightmost never go off-screen. Hover lifts to scale 1.10.
- **Current:** `MyHand.tsx:144-158` `fanGeometry()` computes per-card x / y / rot with a 12° max angle and 80px spread, tighter when total > 5. Hover lift via local state in `HandCardSlot`. CardFace renders at `size="hand"` (hardcoded pixels).
- **Verdict:** **MATCHES** ✓ (slice 44 work). Once the `--card-size-large` token lands and CardFace reads from it, this region is done.

### 4.2 Click-to-cast + mana payment UI

- **Target (spec §4):** Click hand card → mana payment UI appears (Arena-inspired floating mana orbs near bottom; tap lands to pay). If targets needed, enter targeting state.
- **Current:** Click-to-cast via `onObjectClick` → `routeObjectClick` in `clickRouter.ts`. Mana payment is currently the gamePlayMana / gamePlayXMana dialog flow rendered as a GameDialog at fixed bottom-right (slice 12 / 27). NOT an inline floating-orbs UI; it's a modal-ish dialog.
- **Verdict:** **PARTIAL** (functionally works; visually a dialog rather than floating orbs).
- **Work:** Replace gamePlayMana dialog with floating ManaOrb cluster near the hand. Each available land/source is tap-clickable. `--color-card-frame-targeted` highlight on valid targets. This is meaningful UX work — defer if scope-cutting.

### 4.3 Floating mana display

- **Target (spec §4):** Top-right of hand cards. ManaOrb per non-zero color with count if >1. Glow in mana color.
- **Current:** ManaPool renders in PlayerFrame's right-side strip (`PlayerFrame.tsx:200-201`). Not near the hand. ManaOrb supports `glow={true}` (slice 70-C).
- **Verdict:** **WRONG-PLACEMENT.**
- **Work:** When the new portrait-stacked PlayerFrame lands and zone icons relocate, place the local player's mana pool as a floating cluster at top-right of the hand region. Opponents' mana pools stay near their frames (still floating cluster, smaller).

---

## Region 5 — Side panel

### 5.1 Panel section order

- **Target (spec §5):** Top to bottom — PhaseIndicator → Game log → Commander damage → Chat (slide-out) → Optional widgets.
- **Current (`GameTable.tsx:285-315`):** PhaseTimeline (top) → GameLog (middle) → CommanderDamageTracker (bottom). No chat in side panel (chat is in lobby UI elsewhere). No optional widgets.
- **Verdict:** **PARTIAL** — order is approximately correct.
- **Work:** Order is fine. Action button (item 5.4 below) needs to land at the bottom under commander damage, then chat slide-out comes from the header chat icon (item 1.2).

### 5.2 PhaseIndicator visual

- **Target (spec §7.11):** Horizontal bar, each phase a segment. Active phase lights up `--color-accent-primary`. Inactive segments dim. Right-click → auto-yield (deferred).
- **Current:** `PhaseTimeline.tsx:36-91` is rich + colorful — each phase has its own color (cyan/sky/red/emerald/purple) with per-step ticks. Combat shows sub-step labels. **More elaborate than the spec calls for.** No right-click auto-yield (deferred per spec).
- **Verdict:** **PARTIAL** (more visual richness than spec; whether to keep or simplify is a design call).
- **Work:** Decide: keep the multi-color rich timeline (richer information, looks great) OR simplify to 5 monochrome segments with the active one in `--color-accent-primary`. The target screenshot doesn't actually show the phase indicator clearly so we have latitude. **My recommendation: keep current.** It's nicer than the spec.

### 5.3 GameLog entries with portrait avatars

- **Target (spec §7.10):** Each entry shows actor (compact PlayerFrame with portrait) + action text. Card names highlighted, hover for preview. Full game history scrollable.
- **Current:** `GameLog.tsx:50-65` renders entries as `T<turn>·<phase> <message-text>` with HTML-tag stripping. No actor portrait. No card-name highlighting / preview hover. Scrollable.
- **Verdict:** **PARTIAL** (functionally works; missing avatar + interactive card names).
- **Work:**
  1. Add a compact PlayerFrame variant (just the portrait, no name/life) — depends on item 2.1 landing first.
  2. Parse the engine's gameInform text for card-name references and wrap them with hover-card-preview triggers (use existing HoverCardDetail component).
  3. Per-entry: small portrait on left + action text on right.

### 5.4 CommanderDamageTracker layout

- **Target (spec §7.15):** One row per opponent. Each row: opponent's PlayerFrame (compact) + LifeCounter interactive + +/- buttons. Partner pairings → two counters per opponent.
- **Target screenshot (visual override):** 2×2 grid of opponent portraits with damage number adjacent.
- **Current:** `CommanderDamageTracker.tsx:65-89` renders as a vertical list with per-row `CommanderDamageRow`. Each row shows opponent name + commander name + LifeCounter +/- buttons. No portrait. Vertical, not 2×2.
- **Verdict:** **PARTIAL** (functionally works; visually wrong).
- **Work:** Switch to 2×2 grid layout. Portrait + damage number per cell (depends on portrait component from item 2.1). Existing localStorage persistence + flash animation (slice 70-G) keep working as-is.

### 5.5 Chat slide-out

- **Target (spec §5):** Toggled via header chat icon. Slides out below game log when active.
- **Current:** No game-table chat UI. Chat in xmage today is at the lobby level (`pages/LobbyChat.tsx`); the game stream HAS a chat channel via `WebStreamFrame.method === 'chatMessage'` but no UI consumes it on the game-table screen.
- **Verdict:** **MISSING.**
- **Work:** Add a slide-out chat panel triggered by the header chat icon (item 1.2). Subscribe to game-stream chat frames. Send via `playerAction.chatSend`.

### 5.6 Turn counter + Action button (in the side panel)

- **Target (spec §6):** "TURN N" label above the action button. Single button label morphs (`"End Step"`, `"Pass Priority"`, `"Confirm Targets"`, etc.). Adjacent ellipsis (`...`) for multi-phase passes ("Pass to Next Turn", "Pass to Your Turn"). Inside the side panel at the bottom.
- **Current:** ActionPanel (`pages/ActionPanel.tsx:152-269`) is a bottom-of-screen horizontal toolbar with **multiple buttons**: Next Phase / End Turn / Skip Combat / Resolve Stack / Stop Skipping / Undo / Concede. NOT a single morphing button. NOT in the side panel — it's in the GameTable's `[grid-area:action]` footer.
- **Verdict:** **WRONG-PLACEMENT** + **MISSING** (single morphing button).
- **Work:** Major restructure:
  1. Build a new `ActionButton` component (per spec §7.12) — single button with action prop, label morphs.
  2. Move it into the side panel at the bottom under CommanderDamageTracker.
  3. Move "Pass to Next Turn" / "Pass to Your Turn" into an adjacent ellipsis menu.
  4. Keep Concede in a less prominent location (settings modal? ellipsis menu sub-item?). The current always-visible Concede button is too easy to misclick.
  5. Drop the Undo / Stop Skipping buttons or move them to the ellipsis menu.
  6. Drop the existing GameTable `[grid-area:action]` footer entirely. The side panel grows to fill that vertical space.

---

## Region 6 — Modals + dialogs

### 6.1 Mulligan modal

- **Target (spec §Modals):** Full-mode modal. All four player frames show "deciding" status until commit; status updates as players commit. Resolves simultaneously.
- **Current:** `MulliganModal.tsx` (slice 70-F) — full mode with 4-pod "deciding" status panels.
- **Verdict:** **MATCHES** ✓.

### 6.2 Library search / Graveyard / Exile modals

- **Target (spec §Modals):** Full-mode modal, scrollable, filterable.
- **Current:** `ZoneBrowser.tsx` for graveyard/exile (slice 31). Library search not implemented (spec §Modals lib-search).
- **Verdict:** **PARTIAL** — graveyard/exile work; library search MISSING.
- **Work:** Library search modal lands when an effect needs it (fetch / tutor). Out of scope for the visual redesign — file as separate slice if/when an effect requires it.

### 6.3 Scry / Surveil modal

- **Target (spec §Modals):** Small-mode modal so the game continues to render behind. Player drags or clicks to choose top/bottom.
- **Current:** Probably renders as the existing GameDialog flow. Small-mode ≠ "doesn't block" today.
- **Verdict:** **PARTIAL** — file as separate slice. Wire format (gameInformPersonal + gameTarget) is in place.

---

## Token / infrastructure gaps

### T.1 Card-size tokens (BLOCKER for several visual fixes)

- **Target (design-system §7.1):** `--card-size-{micro,small,medium,large,focal}` — referenced repeatedly across the spec.
- **Current:** **NOT defined in tokens.css**. `BattlefieldTile.tsx:62` hardcodes `w-[112px] h-[112px]`. CardFace internally uses size constants in pixel values.
- **Verdict:** **MISSING.**
- **Work:** Define the 5 token values in tokens.css. Refactor CardFace + BattlefieldTile + StackZone + MyHand to consume the tokens. **Land this first** — items 2.4, 3.1, 4.1, 5.4 all depend on it.

### T.2 Z-index layer tokens

- **Target (design-system §8.3):** `--z-battlefield`, `--z-stack`, `--z-targeting`, `--z-ui-chrome`, `--z-modal-backdrop`, `--z-modal-content`, `--z-tooltip`.
- **Current:** Tokens.css line 303 has `--z-stack: 10` and a comment alluding to layer organization but the full set isn't there.
- **Verdict:** **PARTIAL.**
- **Work:** Add the full set; audit components for inline z-index values and replace.

### T.3 Targeting arrow color token

- **Target:** `--color-targeting-arrow` (cream/white).
- **Current:** Probably hardcoded inline in TargetingArrow (slice 70-F).
- **Verdict:** **TODO — verify, likely PARTIAL.**

### T.4 Mana-color glow tokens

- **Target:** `--color-mana-{w,u,b,r,g}-glow` (lower saturation, higher luminance, alpha).
- **Current:** Defined in tokens.css line 116-128 — `--color-mana-{color}-glow` exists for all five colors + colorless + multicolor.
- **Verdict:** **MATCHES** ✓.

### T.5 Stack glow tokens

- **Target:** `--color-stack-glow-default` for stack items without color identity.
- **Current:** Slice 70-D ships color-identity-driven halo via the `--color-mana-*-glow` tokens; spec's stack-glow-default token is colorless fallback that's covered by `--color-mana-colorless-glow` already.
- **Verdict:** **MATCHES** ✓ (existing token covers the use case).

### T.6 Player ring tokens

- **Target:** `--color-team-active`, `--color-team-priority`, `--color-team-eliminated`, `--color-team-disconnected`, `--color-team-neutral`.
- **Current:** All five present in tokens.css per slice 70-A.
- **Verdict:** **MATCHES** ✓.

### T.7 Card frame state tokens

- **Target:** `--color-card-frame-{default,targeted,summoning-sick}`.
- **Current:** Some referenced in CardFace; need to verify the full set exists.
- **Verdict:** **TODO — verify, likely PARTIAL.**

---

## What's confirmed working (don't rebuild)

- **4-pod grid template** (`Battlefield.tsx:149-238`) — top/left/right/bottom + center area, gridTemplateAreas works. Slice 70-E.
- **Animations + motion registry** — `animation/transitions.ts` has CARD_DRAW, LAYOUT_GLIDE, MANA_TAP_ROTATE, CARD_HOVER_LIFT_MS, CARD_TARGETED_PULSE, LIFE_FLASH_POP, DELTA_FLOAT_UP, STACK_GLOW_PULSE, PLAYER_ACTIVE_HALO, PRIORITY_TAG_FADE, ELIMINATION_SLASH, ELIMINATION_PERMANENT_FADE wired. Slice 70-A through 70-H.
- **Halo color-identity machinery** — single solid ring, multicolor alternating bands rotating at 12s/rev, eliminated → grey, disconnected → desat. Slice 70-D + 70-G + 70-H. Geometry needs to point at a circular portrait once that exists.
- **Mana orbs** — `ManaOrb.tsx` with `--radius-circle`, color tokens, glow variant. Slice 70-C.
- **Hand fan** — slice 44 + tightening for large hands. Item 4.1 above.
- **CardFace** — Scryfall art-crop, mana cost, name banner, P/T, counters. Slice 45.
- **BattlefieldTile** — 112×112 slot, tap rotation in-slot (no neighbor reflow), combat ring, ATK/BLK badges, summoning sickness border. Slice 45.
- **CommanderDamageTracker** — localStorage persistence per (gameId, opponent, commander), per-cycle reset, flash animation. Slice 70-F + 70-G.
- **Eliminated slash overlay + DISCONNECTED pill** — slice 70-D + 70-H. Composing correctly with portrait once 2.1 lands.
- **Mulligan modal** — slice 70-F full-mode 4-pod "deciding" status.
- **TargetingArrow** — SVG arrow geometry. Slice 70-F.
- **Particle-drift backdrop** — keyframe-driven, no React state. Slice 70-F.
- **Aria-live announcers** — priority + elimination + connectionState transitions (slice 70-H.5).
- **Wire shape** — schema 1.23 carries everything we need (commandList, colorIdentity, connectionState, hasLeft, isActive, hasPriority, manaPool, battlefield map, life, libraryCount, handCount, etc.). No server-side schema work needed for the redesign except whatever powers the lobby-name display (item 1.1).

---

## Slice-cut suggestion (revised from earlier)

The earlier estimate was 5 slices. After full inventory: **8–10 slices** if we want them at sane size.

| # | Slice name | Scope | Tier | Depends on |
|---|---|---|---|---|
| 70-I | Card-size tokens + CardFace refactor | Land `--card-size-{micro,small,medium,large,focal}` in tokens.css; refactor CardFace + BattlefieldTile + MyHand + StackZone to read tokens. No visual change yet — pure token migration. | Standard | none |
| 70-J | PlayerPortrait component | New circular portrait reading commander art from Scryfall. Stub fallback ("?" icon) for non-commander formats. Halo ring around the circular wrapper. | Architectural | 70-I |
| 70-K | PlayerFrame redesign | Replace header strip with portrait-stacked anatomy. Drop ACTIVE pill, relocate zone icons + mana pool, add commander name. ZoneIcon opponent variant lands here. | Architectural | 70-J |
| 70-L | CommanderDamageTracker 2×2 + GameLog with avatars | Reuse PlayerPortrait. Two visual rewrites at once (both depend on the portrait). | Standard | 70-J |
| 70-M | Side-panel reorganization + ActionButton | Single morphing ActionButton component; relocate to side-panel bottom; drop the action footer; ellipsis menu for multi-pass. | Architectural | 70-K |
| 70-N | StackZone focal-size rewrite | Topmost at focal size with color-identity glow; fanned smaller behind; combat-mode arrows. | Architectural | 70-I |
| 70-O | Header bar polish + top-right icon strip | Lobby name on left (requires wire-up of lobby name to game page); icon row on right (chat/zoom/fullscreen/settings); drop turn/priority indicators (now in halo/side-panel). | Standard | 70-M |
| 70-P | CommandZone slot rewrite + mana-pool floating | Replace text chips with CardFace-rendered slot. Per-perspective sizing. Castable glow. Hide-when-on-battlefield. Mana pool floats near hand. | Standard | 70-K |
| 70-Q (optional) | Mana-payment floating-orbs UI | Replace gamePlayMana dialog with inline orb cluster + tap-to-pay. Significant UX change; defer unless playtest reveals the dialog is friction. | Architectural | 70-P |
| 70-R (optional) | Chat slide-out on game-table | Wire chat panel from header icon. Subscribe to gameStream chat frames. | Standard | 70-O |

**Critical path: 70-I → 70-J → 70-K** are sequential. Everything else can mostly parallelize after 70-K.

---

## Recommendations

1. **Build behind a feature flag** (`VITE_FEATURE_REDESIGN`). Layer flag-on / flag-off into PlayerArea, GameTable, and StackZone so the existing layout stays functional during development. Friend playtest can use the old layout while we iterate.

2. **Update each slice's "definition of done"** to require a screenshot comparison against the target. The reason 70-A through 70-G shipped without catching this gap is that no slice's exit criteria included rendering verification — only test passes + critic findings.

3. **Defer Q + R** (mana-payment + chat) for v2.0. They're real polish but not blockers for the visual identity. Q especially is a meaningful UX shift (away from modal dialogs toward inline orb interaction) that warrants its own design pass.

4. **Reconcile the spec doc with reality after 70-Q**. Several spec items are themselves under-specified (combat-mode arrow geometry, library-search modal anatomy, settings-modal contents). After the visual redesign lands, do a second-pass through `screens-game-table-commander-4p.md` and tighten anything still vague.
