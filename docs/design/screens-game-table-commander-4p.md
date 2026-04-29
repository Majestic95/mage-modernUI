# Screen: Commander 4-Player Free-for-All Game Table

## Purpose

The primary game-play screen for 4-player Commander Free-for-All. Renders the battlefield, players, stack, hand, command zones, and the side panel for game log and tracking widgets. This screen is the most complex in the application and exercises the largest portion of the design system.

## Reading order

This spec assumes the reader has already reviewed `design-system.md`. It does not redefine tokens, components, or motion. Where it says "uses `CardTile`," that is a direct reference to the component spec in section 7.1 of the design system.

## Reconciliation note for Claude Code

Before implementing, reconcile every component name and token name in this document against the existing codebase, in particular `webclient/src/styles/tokens.css` (slice 69b) and `webclient/src/animation/transitions.ts`. Where naming collides or the existing pattern differs from this spec, prefer the existing pattern and flag the conflict back to the human reviewer.

This spec was written without visibility into existing slice conventions (50-59, 69b, 71). Treat slice numbering in this document as descriptive shorthand, not authoritative.

## Architecture context

This screen consumes game state from a WebSocket connection at `/api/games/{gameId}/stream`. Game state is held in the Zustand store at `webclient/src/game/store.ts`. Components subscribe to slices of the store via Zustand selectors. The screen does not hold local game state; all rendered state is derived from the store.

Spectator mode uses the same screen with the local player's hand hidden and all interactive elements disabled. The spectator endpoint is `/api/games/{gameId}/spectate`.

## Layout overview

The screen is divided into **six regions**:

1. **Header strip** (top) — format/lobby name, top-right window controls
2. **Battlefield** (center, the largest region) — four player pods arranged with the local player at bottom and three opponents at top, left, right
3. **Central focal zone** (middle of battlefield) — stack and combat
4. **Hand area** (bottom) — local player's hand, with command zone slot and floating mana
5. **Side panel** (right) — phase indicator, game log, commander damage tracker, optional chat
6. **Action area** (bottom-right) — turn counter and action button

```
┌─────────────────────────────────────────────────────────────────────┐
│ HEADER: Lobby Name                              [icons] [icons] ... │
├─────────────────────────────────────────────────┬───────────────────┤
│                                                 │ PHASE INDICATOR   │
│         ┌─ Top Opponent Pod ───┐                ├───────────────────┤
│         │  player frame         │               │ GAME LOG          │
│         │  battlefield rows     │               │   entry           │
│         └───────────────────────┘               │   entry           │
│                                                 │   entry           │
│  ┌─Left┐    ┌────────────┐    ┌─Right┐          │   ...             │
│  │ pod │    │  CENTRAL   │    │ pod  │          ├───────────────────┤
│  │     │    │   FOCAL    │    │      │          │ COMMANDER DAMAGE  │
│  └─────┘    │   ZONE     │    └──────┘          │   tracker         │
│             │  (stack /  │                      │                   │
│             │  combat)   │                      │                   │
│             └────────────┘                      │                   │
│                                                 │                   │
│         ┌─ Bottom (Local) Pod ─┐                │                   │
│         │  battlefield rows    │                │                   │
│         │  player frame        │                │                   │
│         └──────────────────────┘                │                   │
├─────────────────────────────────────────────────┤                   │
│ HAND AREA   [hand cards]   [command zone]   $   │                   │
├─────────────────────────────────────────────────┴───────────────────┤
│                                            TURN N        [action ▼] │
└─────────────────────────────────────────────────────────────────────┘
```

## Region 1 — Header strip

**Content:**

- Left: lobby name, auto-populated from the lobby setup (e.g., "COMMANDER — 4 PLAYER FREE-FOR-ALL", or whatever name the user entered when creating the table)
- Right: four icons in this order — chat toggle, layout/zoom toggle, fullscreen, lobby settings

**Behavior:**

- Header strip does not scroll; it stays fixed during all game states
- Chat icon toggles a slide-out panel below the game log (does not modify the header itself)
- Settings icon opens lobby/game options modal (full mode)

**Tokens used:** `--color-bg-elevated`, `--color-text-primary`, `--space-3` for padding

## Region 2 — Battlefield (four player pods)

The battlefield is a single layout grid containing four pods. The local player is always at the bottom; opponents are at the top, left, and right. **Seating is static — the local player always sees themselves at the bottom regardless of turn order.**

### Pod anatomy (each player)

Each pod contains:

- A `PlayerFrame` component (see design-system 7.3)
- Two battlefield rows: lands closer to the player edge, creatures/non-land permanents pushed forward (Arena-style)
- A small column to the right of the creature row for non-creature, non-land permanents (artifacts, enchantments) — stacked horizontally, can wrap if many
- A `CommandZoneSlot` near the player frame (see 7.8 — for opponents this is small and adjacent to their frame)
- `ZoneIcon`s for graveyard, exile, and library near the player frame (see 7.9)

### Pod sizing

- **Local player (bottom):** full size, `--card-size-medium` for permanents, `--card-size-large` for hand
- **Opponents (top, left, right):** opponent pods are 90% of local player size; permanents render at `--card-size-small`

### Battlefield row layout

- Each row is a flex container that lays cards left-to-right
- Cards within a row that share a name (or share a token type) collapse into a `CardStack` (see 7.2)
- Tapped cards rotate 90° in place per `card-tap` motion
- When a row would overflow horizontally, cards shrink uniformly down to a minimum readable size, then begin overlapping

### Card sizing under board complexity

- Default size as specified above
- If a player has more than ~12 permanents in a single row, cards shrink uniformly
- Below the minimum readable size, cards start overlapping (each subsequent card overlaps the previous by 30%)
- Hover any card to enlarge it in place to full readable size with all counters visible

### Targeting

- `TargetingArrow`s (see 7.7) are drawn as SVG overlays above the battlefield
- Arrows persist for the duration of the targeting spell on the stack
- Multiple arrows from one source if the spell has multiple targets
- All arrows use `--color-targeting-arrow` (cream/white)

## Region 3 — Central focal zone

**Component:** `Stack` (see design-system 7.6)

The central focal zone occupies the center of the battlefield (between the four pods). It has two modes:

### Mode: stack

- Default mode when there are stack items
- Topmost stack item rendered at `--card-size-focal` with active color-identity glow (`stack-glow-pulse` motion)
- Up to 5 additional items fanned behind/below at progressively smaller sizes
- 6+ items collapse to "+N more" indicator on the topmost queued item
- Triggered and activated abilities render as card-shaped tiles with the ability text and the source card's art
- When a stack item resolves, it animates out per `card-resolve` to its destination zone
- The view does not pan or zoom during resolution; the camera stays static

### Mode: combat

- During combat phases, central zone shows attack/block arrows instead of the stack
- If a spell is cast during combat (a combat trick), the zone briefly switches back to `stack` mode until that spell resolves, then returns to `combat` mode
- Combat arrows use the same `TargetingArrow` component

### Empty state

- When there is nothing on the stack and combat is not in progress, the central zone displays subtle ambient particles (`particle-drift` motion) but no UI

## Region 4 — Hand area

**Local player's hand only.** Opponents' hand cards are not visible (face-down counts shown near their player frames as part of their library count display, since the count of cards in hand is also public information).

### Hand layout

- Cards rendered in a slight fan, matching the reference image (subtle arc, not a Hearthstone-style steep curve)
- Default card size: `--card-size-large`
- When hand is large, cards squeeze tighter (overlap), but the leftmost and rightmost cards never go off-screen
- Hover a hand card: lifts up and scales to 1.10 per `card-hover-lift` motion

### Casting

- Click-to-cast (no drag)
- When clicking a card, the mana payment UI appears (Arena-inspired: floating mana orbs near the bottom of the screen indicate available mana; the player taps lands or available mana sources to pay)
- If the spell has targets, the player enters a targeting state — `TargetingArrow`s draw from the spell to the player's cursor; valid targets are highlighted with `--color-card-frame-targeted`

### Command zone slot

- Located to the immediate right of the hand cards
- Always visible to the local player
- Hidden when the commander is on the battlefield
- Glows in commander's color identity when castable per `stack-glow-pulse`-like behavior

### Floating mana

- Top-right of the hand cards
- Displays as `ManaOrb` components — one orb per color, with a count number if more than 1
- Each orb glows in its mana color (`glow={true}`)
- Visible to all players (floating mana is public information in MTG)

## Region 5 — Side panel

The right side panel is collapsible (user-toggled, default open). When collapsed, the battlefield expands to fill the freed horizontal space.

### Panel content (top to bottom)

1. **Phase indicator** (`PhaseIndicator`, see 7.11)
   - Horizontal bar segmented by phase
   - Active phase highlighted in `--color-accent-primary`
   - Right-click opens auto-yield/stops settings (deferred)

2. **Game log** (`GameLogEntry` × N, see 7.10)
   - Most recent entry at top, scrolling down for history
   - Full game history, non-searchable in initial release
   - Card name references in entries are interactive (hover for preview)
   - Default mode logs everything; "Actions Only" toggle deferred

3. **Commander damage tracker** (`CommanderDamageTracker`, see 7.15)
   - One row per opponent
   - Manual entry with `+`/`-` buttons
   - Engine does not auto-track this; players manage themselves

4. **Chat** (slide-out, hidden by default)
   - Toggled via header chat icon
   - Slides out below the game log when active

5. **Optional widgets** (below commander damage)
   - Reserved space for poison counters, energy, experience, monarch token, day/night state, dungeon progress
   - Most games will not display these; they appear only when relevant

### Panel sizing

- Width scales with window size, not fixed pixels
- Minimum width preserves readability of game log entries
- When collapsed, a thin tab remains for re-opening

## Region 6 — Action area

**Bottom-right corner, below the side panel.**

### Content

- **Turn counter:** "TURN N" label
  - Counts entire game turns, not phases
  - Increments by full turns
- **Action button** (`ActionButton`, see 7.12)
  - Single button that morphs based on current required action
  - Label examples: "End Step", "Pass Priority", "Confirm Targets", "Pay Mana", "Attack", "Block", "Done"
  - Single click suffices — no double-click confirmation
- **Ellipsis menu** (adjacent to action button)
  - Opens a small menu with multi-phase pass options:
    - "Pass to Next Turn"
    - "Pass to Your Turn"
  - These are auto-pass shortcuts that skip multiple phase transitions in one click
  - Auto-pass actions are undoable (a brief "undo" affordance appears for several seconds after triggering)

## Player states

### Active player

- The player whose turn it currently is
- `PlayerFrame.isActive` is true
- Halo ring glows brighter and pulses (`player-active-halo` motion)
- Multicolor halos rotate during active state

### Player with priority

- Often the same as active player, but not always (combat tricks, instant-speed responses)
- `PriorityTag` (see 7.13) floats near the player frame
- The local player seeing the tag on their own frame is the cue that they may act

### Eliminated player

- Triggered when life reaches 0, takes 21 commander damage, or loses by other game rule
- Pod animates per `elimination-slash` motion: red claw-rip diagonal slash overlay across the pod, persists for the rest of the game
- All permanents on that pod fade out over 800ms
- Active permanents at moment of elimination get a brief burn animation (post-launch polish)
- Player's hand and library are hidden
- Player frame desaturates to grey

### Disconnected player

- The game pauses for everyone when any player disconnects
- Disconnected player's pod desaturates per `disconnected-overlay` motion
- "DISCONNECTED" overlay text appears across the player's portrait
- On reconnect, overlay clears with no flash or notification (just removes the desaturation)

## Game state interactions

This screen renders state from the Zustand game store. Below are the canonical state transitions and how the UI responds. **The exact state shape is owned by the existing store; this section describes UI behavior, not state structure.** Reconcile against `webclient/src/game/store.ts` during implementation.

### Card movement between zones

Every card has a stable identifier across its lifetime. Components rendering cards use that identifier as the Framer Motion `layoutId`. When a card moves between zones (hand → stack, stack → battlefield, anywhere → graveyard, etc.), the same `layoutId` allows Framer Motion to interpolate position automatically. **Do not unmount-and-remount cards on zone transitions.**

### Stack updates

- New stack item: animates in via `card-cast` from the casting player's hand (or from the source card if a triggered ability)
- Top of stack changes (resolution): the resolving item animates out via `card-resolve`; the next item visually "promotes" to the top position
- Stack cleared: central zone returns to empty state with ambient particles

### Phase transitions

- `PhaseIndicator` segment lights up
- Transition logged to `GameLogEntry`
- Active player's halo continues animating; no view change

### Combat

- Central zone switches to `mode="combat"`
- Attack arrows drawn from attackers to defending players (or planeswalkers)
- Block arrows drawn from blockers to attackers
- If a combat trick is cast, central zone switches back to `mode="stack"` until the spell resolves

### Life changes

- All affected players' life totals animate per `life-tick` simultaneously
- Floating "+N" / "-N" emerges above each affected player frame per `life-floating-number`

### Targeting

- When the local player is selecting targets: cursor enters targeting mode, valid targets highlighted, arrows draw from spell source to cursor
- When any player is targeting: arrows draw from source to target(s) and persist while the spell is on the stack

## Modals invoked from this screen

Each of the following is a `Modal` component invocation. Modal mode noted in parens.

### Mulligan (full)

- Opens at game start before the action button becomes available
- Each player makes their mulligan decision privately
- All four player frames show a "deciding" status until a player commits; status updates as players commit
- Once all players commit, mulligans resolve simultaneously and the modal closes

### Library search (full)

- Opens when the local player must search their library (fetches, tutors, etc.)
- Scrollable view of the entire library
- Filterable (text search, type filter)
- Possible-selection cards (those matching the search criteria) are highlighted

### Graveyard view (full)

- Opens when the local player clicks their graveyard `ZoneIcon`
- Scrollable view of all cards in the graveyard
- Read-only unless an effect is referencing the graveyard

### Exile view (full)

- Same as graveyard view but for the exile zone

### Scry / Surveil (small)

- Opens when the local player must scry or surveil
- Small modal, does not block view of the rest of the game
- Cards revealed face-up to local player; player drags or clicks to choose top/bottom or keep/discard
- Game continues to render behind the modal in case priority shifts back

### Choose / "May" prompt (small or in central zone)

- Modal cards with multiple modes, or "may" effects requiring yes/no
- Renders in the central focal zone over the resolving spell
- Player picks an option to proceed

## Animation summary (this screen)

All motion specs reference design-system section 6.4. This screen invokes:

- `card-draw` — when cards are drawn from library to hand
- `card-cast` — when local player casts a spell to the stack
- `card-resolve` — when stack items resolve to their destination
- `card-tap` / untap — every state change of a permanent
- `card-hover-lift` — hand interaction
- `card-targeted` — pulse on targeted permanents
- `life-tick` and `life-floating-number` — life total changes
- `stack-glow-pulse` — continuous on topmost stack card
- `player-active-halo` — continuous on active player
- `priority-tag-appear` — when priority enters/leaves
- `elimination-slash` — on player elimination
- `disconnected-overlay` — on disconnect
- `game-start-deal` — at game start
- `particle-drift` — ambient battlefield background

## State the screen does not handle (out of scope)

- Pre-game lobby: separate screen
- Deck selection: separate screen, occurs before this screen loads
- Sideboarding: not applicable to Commander
- Match-history / replay: separate screen
- Account / profile / settings: separate screens

## Initial render checklist

When this screen first mounts:

1. Connect to `/api/games/{gameId}/stream`
2. Hydrate Zustand store from initial state message
3. Render `PlayerFrame` for each of the four players in seat-fixed positions
4. Run `game-start-deal` motion: animate cards from each library to hands, animate commanders into command zone slots
5. Once dealt, transition to mulligan modal for each player privately
6. After mulligans resolve, mount the action button and start the first turn

## Deferred / post-launch items (Commander game-table screen)

- Light theme variant
- Sound effects
- Searchable game log
- "Actions Only" toggle in game log
- Detailed auto-yield / stops settings UI (right-click PhaseIndicator)
- Fire/burn animation on permanent destruction at elimination
- Match-history and replay UI

## Open questions for Claude Code review

- Confirm the WebSocket message schema is shared between frontend and backend and lives in a defined location (e.g., a `types/` directory generated from a backend spec). If not, the frontend will drift.
- Confirm `card-draw`, `card-cast`, `card-resolve`, etc. are not already named differently in `transitions.ts` (slice 50-59). Reconcile if so.
- Confirm the existing `tokens.css` (slice 69b) defines or does not define the mana color tokens described in this document. If it does, prefer the existing names.
- Confirm whether spectator mode reuses this screen verbatim or has its own component tree. This document assumes verbatim reuse with a `spectator` mode flag.
- Confirm card-image source: this document assumes Scryfall is fetched at runtime and never bundled. If a different source has been chosen, update accordingly.
