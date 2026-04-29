# Design System

## Purpose

This document is the single source of truth for visual and motion design across the XMage modernized web client. Every screen-specific spec references tokens, components, and motion primitives defined here. Screen specs do not redefine colors, spacing, typography, or component internals — they reference them by name.

## Status of this document

This is the **first pass**, written from the Commander 4-player game-table screen spec. It will grow as additional screens (lobby, deck editor, draft, etc.) surface new tokens and components. Sections marked **TBD — defined when needed** are placeholders intentionally left empty until a real screen exercises them.

## Reconciliation note for Claude Code

This document was authored without visibility into the existing `webclient/src/styles/tokens.css` (slice 69b) or `webclient/src/animation/transitions.ts` registry. **Before adopting any token or motion name from this document, reconcile against the existing files.** If a name in this document collides with or duplicates an existing one, prefer the existing name and update this document to match. Flag any reconciliation conflicts back to the human reviewer rather than silently picking one.

## Architecture context

The XMage modern client is a React 19 + TypeScript SPA that communicates with a Java translation layer over WebSocket. The translation layer sits in front of the XMage server's JBoss Remoting protocol and exposes JSON game state at `/api/games/{gameId}/stream` (gameplay) and `/api/games/{gameId}/spectate` (read-only). This client is one of potentially several frontends that may consume the same translation layer; therefore, the design system should not encode assumptions about transport behavior beyond "game state arrives as discrete events and the UI re-renders in response."

**Open question for Claude Code:** confirm the WebSocket message schema is defined in a shared location (e.g., a `types/` directory or generated from a backend spec). If the schema lives only in the backend, the frontend will drift from it. Flag this if it isn't already addressed.

## Stack reference

- **React 19 + TypeScript** — component framework
- **Vite** — build/dev server
- **Tailwind CSS v4** — utility classes via `@theme` CSS-first config in `tokens.css`
- **CSS custom properties** — semantic design tokens defined in `webclient/src/styles/tokens.css`
- **Framer Motion** — declarative animation, `layoutId` for cross-zone glides
- **Zustand** — game state store at `webclient/src/game/store.ts`
- **CSS keyframes** — for animations outside Framer Motion's idiom (foil shimmer, ambient pulses)
- **SVG** — targeting arrows, particle bursts, vector overlays
- **WebSocket** — `/api/games/{gameId}/stream` and `/api/games/{gameId}/spectate`

---

## 1. Color tokens

All colors are defined as CSS custom properties in `tokens.css` and exposed to Tailwind via `@theme`. Components reference semantic tokens, never raw hex values.

### 1.1 Surface and background

- `--color-bg-base` — deepest background, the canvas behind everything
- `--color-bg-elevated` — panels and cards sitting above the base (game log panel, modals)
- `--color-bg-overlay` — semi-transparent overlay behind modals (dims the battlefield)
- `--color-surface-card` — interactive surfaces (buttons, tiles, list items)
- `--color-surface-card-hover` — hover state for surface cards
- `--color-surface-card-active` — pressed/selected state

### 1.2 Text

- `--color-text-primary` — body text, default
- `--color-text-secondary` — labels, captions, less-important content
- `--color-text-muted` — placeholder, disabled, decorative
- `--color-text-on-accent` — text rendered on accent-colored backgrounds

### 1.3 Accent and brand

- `--color-accent-primary` — purple, primary brand accent (matches the End Step button in reference)
- `--color-accent-primary-hover`
- `--color-accent-primary-active`

### 1.4 Status

- `--color-status-success` — green, life gain, "kept" mulligan, completed quest
- `--color-status-danger` — red, damage, illegal cards, errors
- `--color-status-warning` — amber, time-pressure indicators
- `--color-status-info` — blue, neutral notifications

### 1.5 MTG mana colors

The five colors of Magic, plus colorless and multicolor. Used for mana symbols, card glow, player rings, and color-identity indicators.

- `--color-mana-white` — soft warm off-white
- `--color-mana-blue` — clear sky blue
- `--color-mana-black` — purple-tinged black (pure black is unreadable on dark backgrounds)
- `--color-mana-red` — saturated red-orange
- `--color-mana-green` — forest green
- `--color-mana-colorless` — silver/grey
- `--color-mana-multicolor` — gold (used as fallback when alternating-band rendering isn't possible)

Each mana color has a `-glow` variant (`--color-mana-blue-glow`, etc.) which is the same hue but tuned for use as a glow/halo effect (typically lower saturation, higher luminance, with alpha).

### 1.6 Player team rings

- `--color-team-active` — currently-active player's halo (animated)
- `--color-team-priority` — player who currently holds priority (may be different from active)
- `--color-team-eliminated` — desaturated grey overlay for eliminated players
- `--color-team-disconnected` — same desaturation, with a different overlay treatment

### 1.7 Card frame and stack glow

- `--color-card-frame-default` — neutral border for card tiles
- `--color-card-frame-targeted` — applied when this card is being targeted
- `--color-card-frame-summoning-sick` — subtle indicator
- `--color-stack-glow-default` — fallback glow on stack items without color identity

---

## 2. Typography

Single typeface family for the entire app — a sans-serif with good legibility at small sizes (card-tile counter numbers) and presence at large sizes (life totals, banner headlines).

**Recommended:** Inter, with system-ui fallbacks. Final choice deferred to Claude Code reconciliation against existing `tokens.css`.

### 2.1 Type scale

- `--font-size-display` — banner headlines, victory screen
- `--font-size-heading-lg` — section headings ("WELCOME, PLANESWALKER")
- `--font-size-heading-md` — panel titles ("DAILY QUESTS", "GAME LOG")
- `--font-size-heading-sm` — card-tile names
- `--font-size-body` — default body
- `--font-size-caption` — secondary text, captions
- `--font-size-micro` — counter numbers on card tiles, badge text

### 2.2 Weight tokens

- `--font-weight-regular` — 400
- `--font-weight-medium` — 500
- `--font-weight-semibold` — 600
- `--font-weight-bold` — 700

### 2.3 Tracking

- Body text: default
- Uppercase labels (panel titles, button text in some contexts): `letter-spacing: 0.05em`
- Display headlines: tighter, `letter-spacing: -0.02em`

### 2.4 Mono

- `--font-family-mono` — for any numeric displays where character width consistency matters (life totals optional, depending on whether tabular-nums on Inter is sufficient)

---

## 3. Spacing scale

8-based scale. Tokens map to Tailwind's spacing utilities via `@theme`.

- `--space-1` — 4px
- `--space-2` — 8px
- `--space-3` — 12px
- `--space-4` — 16px
- `--space-5` — 24px
- `--space-6` — 32px
- `--space-7` — 48px
- `--space-8` — 64px

---

## 4. Corner radii

- `--radius-sm` — 4px (small badges, counters)
- `--radius-md` — 8px (buttons, input fields)
- `--radius-lg` — 12px (panels, modal corners, card tiles)
- `--radius-xl` — 16px (large feature tiles)
- `--radius-circle` — 50% (player portraits, mana orbs)

---

## 5. Shadow / elevation

- `--shadow-low` — subtle, for slightly raised surfaces
- `--shadow-medium` — for floating panels and tiles
- `--shadow-high` — for modals
- `--shadow-glow-{color}` — glow effects, parameterized by color token (used for stack glow, player active ring, etc.)

---

## 6. Motion tokens

### 6.1 Durations

- `--motion-duration-instant` — 80ms (hover state changes)
- `--motion-duration-fast` — 150ms (button press, small UI feedback)
- `--motion-duration-medium` — 250ms (card lifts, panel slides)
- `--motion-duration-slow` — 400ms (phase transitions, modal open)
- `--motion-duration-deliberate` — 800ms (game start, victory screen)

### 6.2 Easing

- `--motion-ease-out` — `cubic-bezier(0.2, 0, 0, 1)` — default for entering animations
- `--motion-ease-in` — `cubic-bezier(0.4, 0, 1, 1)` — exit animations
- `--motion-ease-in-out` — `cubic-bezier(0.4, 0, 0.2, 1)` — looping or balanced motion
- `--motion-ease-emphasis` — `cubic-bezier(0.34, 1.56, 0.64, 1)` — slight overshoot for emphasis (card play, life gain)

### 6.3 Motion principles

- **Card movement uses `layoutId`.** Any time a card moves between zones (hand → stack, stack → battlefield, anywhere → graveyard, anywhere → exile), the same `layoutId` is preserved across components and Framer Motion handles interpolation. The card is a single logical entity that visually traverses zones; do not render-and-discard.
- **Ambient animation never blocks gameplay.** Particle drift, ring pulses, and glow shimmer run on CSS keyframes that don't trigger React re-renders.
- **Reduce motion respected.** All non-essential animations honor `prefers-reduced-motion`. Card movement is essential (it conveys game state), so it remains; ambient particle drift, hover scale-up, and pulse animations do not.

### 6.4 Named motion specs

Each named motion has fixed duration, easing, and behavior. Components reference them by name.

- **`card-draw`** — card slides from library position to hand position, 250ms, `--motion-ease-out`. Scales 0.85 → 1.0 in parallel.
- **`card-cast`** — card slides from hand to top of stack, 200ms, `--motion-ease-out`. Briefly scales to 1.1 (emphasis) then settles to 1.0 over an additional 150ms.
- **`card-resolve`** — card animates from stack to its destination zone (battlefield, graveyard, exile, hand, library). Duration determined by distance, capped at 400ms. Easing `--motion-ease-out`.
- **`card-tap`** — 90° rotation around card center, 180ms, `--motion-ease-out`. Untap is the reverse with the same parameters.
- **`card-hover-lift`** — hand card scales to 1.10 and translates up by `--space-3`, 120ms, `--motion-ease-out`. Reverses on un-hover.
- **`card-targeted`** — pulses `--color-card-frame-targeted` border at 1Hz while the targeting state is active.
- **`life-tick`** — life total animates between old and new value. For changes ≤10, ticks integer-by-integer at 60ms per tick. For changes >10, animates over a fixed 1500-2000ms regardless of magnitude (use `--motion-duration-deliberate` × 2). Damage flashes `--color-status-danger`; gain flashes `--color-status-success`.
- **`life-floating-number`** — a floating "+N" or "-N" appears above the player frame, fades in over 100ms, holds for 600ms, fades and rises over 400ms. Color matches the change direction.
- **`stack-glow-pulse`** — topmost stack card gets a continuous pulsing color-identity glow at 1.5s period.
- **`player-active-halo`** — active player's portrait ring glows and slowly rotates if multicolor (5 distinct bands rotating at 12s/revolution). Pulses at 2s period.
- **`priority-tag-appear`** — floating "PRIORITY" tag fades in at 150ms, holds while priority is held, fades out at 150ms when priority passes.
- **`elimination-slash`** — a diagonal red claw-rip overlay animates across the eliminated player's pod over 600ms, then persists. Permanents on that pod fade out over 800ms in parallel. Permanents that were active when life hit zero get a brief "burn" effect (deferred to post-launch polish).
- **`disconnected-overlay`** — pod desaturates over 200ms, overlay fades in with "DISCONNECTED" text. Reverse on reconnect.
- **`game-start-deal`** — opening hand cards animate from library to hand in sequence, 80ms stagger between cards, each card 300ms `card-draw` motion. Commanders simultaneously float into command zones, 600ms total.
- **`particle-drift`** — ambient background particles drift slowly across the battlefield, CSS keyframe-driven, no React state involvement.

---

## 7. Components

Each component spec lists its purpose, the states it must render, the tokens it consumes, and any motion it owns. Component implementation lives in `webclient/src/components/`. All components are typed React function components.

### 7.1 `CardTile`

**Purpose:** Renders a single Magic card. Used in hand, on the battlefield, on the stack, in graveyard, in exile, in modal screens (mulligan, scry, library search), and in the central focal zone.

**Source of card art:** Scryfall image URL fetched at runtime. Card metadata (name, oracle text, mana cost, P/T, type line) comes from the WebSocket game state, falling back to MTGJSON for static display contexts. Card art is never bundled with the application.

**Props:**

- `cardId` — unique card identifier (used as Framer Motion `layoutId`)
- `view` — the card's view-object data from game state
- `size` — `"micro" | "small" | "medium" | "large" | "focal"` — see size token table below
- `state` — `"default" | "tapped" | "targeted" | "summoning-sick" | "disabled"`
- `interactive` — boolean, whether hover and click handlers are active
- `onClick`, `onHover` — optional handlers
- `glowColor` — optional, for stack items (uses color identity)

**Card sizes** (defined in `tokens.css`):

- `--card-size-micro` — graveyard/exile stack indicator (just a card-shaped icon)
- `--card-size-small` — opponent battlefield rows (10% smaller than your row)
- `--card-size-medium` — your battlefield row
- `--card-size-large` — your hand
- `--card-size-focal` — central focal zone (active stack item)

**Counters rendering:**

- +1/+1 counters: bottom-right corner overlapping the P/T box, small black text on a light background pill
- Loyalty counters (planeswalkers): replace the +1/+1 position, larger
- Other counter types (poison, charge, fade, level, etc.): top-right of card image, each counter type has its own icon, count number adjacent. Hover reveals counter type names if multiple are present.

**Multicolor and colorless glow:** When `glowColor` is the card's color identity:

- Single color: solid glow in that mana color's `-glow` variant
- Multicolor: alternating bands of each color, slowly rotating
- Colorless: silver/grey glow

**Motion owned:** `card-tap`, `card-hover-lift`, `card-targeted`, `stack-glow-pulse` (when on stack)

### 7.2 `CardStack`

**Purpose:** Renders multiple "alike" cards as a vertical stack with offset. Used on the battlefield when a player has multiples of the same card name or same token type.

**Props:**

- `cards` — array of card view-objects
- `size` — pass-through to `CardTile`
- `state` — pass-through, but applied per-card (some can be tapped while others are not)

**Behavior:**

- Untapped cards stack vertically with a small offset (`--space-1` between top edges)
- Tapped cards within the stack rotate 90° in place at their stack position; they overhang horizontally, which is acceptable and reads well
- Hover any card in the stack to enlarge that specific card in place
- If 5+ cards stack, show "+N" on the top card to indicate count without rendering all of them at full size

### 7.3 `PlayerFrame`

**Purpose:** Renders a player's identity, life, and status. Used at all four positions of the Commander game table; also referenced from the game log (small variant) and from match-history screens.

**Props:**

- `player` — the player view-object
- `position` — `"bottom" | "top" | "left" | "right"` (your seat is always bottom)
- `variant` — `"full" | "compact"` (compact for game-log entries)
- `colorIdentity` — array of MTG colors, used for the halo ring (chosen by player in lobby, locked at game start)
- `isActive` — boolean, true when it's this player's turn
- `hasPriority` — boolean
- `state` — `"normal" | "disconnected" | "eliminated"`

**Anatomy:**

- Circular portrait (`--radius-circle`), default size 80px
- Halo ring around portrait: solid color if single, alternating bands if multicolor, grey if colorless
- Player name label below portrait (`--font-size-heading-sm`)
- Commander name label below player name (`--font-size-caption`, `--color-text-secondary`). Smaller text if partner/background pairing.
- Life total in a smaller circle below the name area, large numerals (`--font-size-heading-lg`)

**Halo behavior:**

- Default: static glow ring in the player's chosen color(s)
- Multicolor: 5 distinct bands rotating at 12s/revolution
- Active turn: ring brightens and pulses at 2s period (`player-active-halo` motion)
- Priority (when not active player): floating `PriorityTag` near frame, ring does not change
- Disconnected: ring desaturates, "DISCONNECTED" overlay appears across portrait
- Eliminated: ring fades to grey, diagonal red claw-rip slash persists across pod

**Life total animation:** uses `life-tick` and `life-floating-number` motion specs. All four players animate in parallel during board-wide effects.

### 7.4 `LifeCounter`

**Purpose:** The numeric life total. Sub-component of `PlayerFrame` but separable for use in Commander Damage tracker.

**Props:**

- `value` — current life total
- `previousValue` — for animation
- `interactive` — boolean (display-only in main UI; +/- buttons in commander damage tracker)

**Display-only behavior:** Shows current value. On change, animates per `life-tick` and emits `life-floating-number`.

**Interactive behavior (commander damage tracker only):** Shows current value with `-` and `+` buttons. Clicking adjusts manually. No animation.

### 7.5 `ManaOrb`

**Purpose:** Renders a single mana symbol or a count of mana of one color. Used in card mana costs, floating mana display, and anywhere mana is shown numerically.

**Props:**

- `color` — one of the six mana colors (W/U/B/R/G/C)
- `count` — integer; displays "1" for single, ">1" for multiple
- `size` — `"small" | "medium" | "large"`
- `glow` — boolean, whether the orb glows in its color (used for floating mana)

**Display:** circular orb (`--radius-circle`) filled with the mana color. Number rendered centered on the orb if `count > 1`. Glow variant uses the `-glow` color token.

### 7.6 `Stack`

**Purpose:** The central focal zone. Renders the active stack of spells/abilities, fanned out from the center, with the topmost (currently resolving) item largest and queued items smaller behind.

**Props:**

- `items` — array of stack items (spells, triggered abilities, activated abilities)
- `mode` — `"stack" | "combat"` — central zone toggles between showing the stack and showing combat arrows

**Behavior:**

- Topmost stack item rendered at `focal` size with active color-identity glow
- Up to 5 additional items rendered fanned behind/below at progressively smaller sizes
- 6+ items collapse to "+N more" indicator
- When a stack item resolves, it animates out per `card-resolve` to its destination
- Triggered and activated abilities render as card-shaped tiles with the ability text and the source card's art
- `mode="combat"` replaces stack rendering with attack/block arrows; if a spell is cast during combat, briefly switch back to `mode="stack"` until that spell resolves, then return to `mode="combat"`

### 7.7 `TargetingArrow`

**Purpose:** SVG arrow drawn from a source card to a target. Used during targeting selection and persists for the duration of a spell on the stack.

**Props:**

- `from` — DOM node or coordinate of source
- `to` — DOM node or coordinate of target
- `color` — defaults to cream/white (`--color-targeting-arrow`)

**Behavior:**

- Drawn as an SVG curve overlay above the battlefield
- Multiple arrows from one source if multiple targets
- All arrows for a single spell use the same color
- Persists while the spell is on the stack, fades on resolve

### 7.8 `CommandZoneSlot`

**Purpose:** Renders a player's command zone — visible position for their commander when not on the battlefield.

**Props:**

- `player` — owning player
- `commander` — card view-object (or array for partner/background pairings)
- `castable` — boolean, whether the local player can currently cast it (only meaningful for own command zone)

**Behavior:**

- For local player: large slot to the right of the hand, always visible
- For opponents: smaller slot near their player frame
- When commander is on the battlefield, slot is hidden (not just empty)
- When `castable === true`, glows in color identity to indicate playability
- Partner/background pairings: stacked layout, both cards visible
- Hover any opponent's command zone to see the commander card preview

### 7.9 `ZoneIcon`

**Purpose:** Compact representation of a player's graveyard, exile, or library. Each player has these near their frame.

**Props:**

- `zone` — `"graveyard" | "exile" | "library"`
- `count` — number of cards in the zone
- `owner` — owning player (for label and click behavior)

**Display:**

- For local player: full size, clickable to open scrollable modal (same modal style as mulligan)
- For opponents: small "G" / "E" icon with count badge; library shows just a number (no icon, since libraries are not viewable)
- Graveyard and exile are public information — hover any opponent's icon to see contents in a tooltip

### 7.10 `GameLogEntry`

**Purpose:** A single entry in the right-side game log panel.

**Props:**

- `entry` — log entry view-object containing actor, action, and any referenced cards
- `compact` — boolean, for "Actions Only" toggle (post-launch)

**Behavior:**

- Shows actor (compact `PlayerFrame`) + action text
- Card names within the action are highlighted; hovering them shows the card preview tooltip
- Actions logged: spells cast, abilities triggered, cards entering/leaving zones, life changes with cause, mulligans, phase transitions, all game state changes
- Full game history preserved, scrollable, non-searchable (search post-launch)

### 7.11 `PhaseIndicator`

**Purpose:** Mini-bar showing current phase of the active player's turn. Lives in the right side panel between the top icons and the game log.

**Display:**

- Horizontal bar with each phase as a segment: Beginning → Main 1 → Combat → Main 2 → End
- Active phase segment lights up in `--color-accent-primary`
- Inactive segments are dim
- Whose turn it is is conveyed only by the player frame's active halo, not by this component
- Right-click opens auto-yield/stops settings (post-launch detail)

### 7.12 `ActionButton`

**Purpose:** Primary game action button at bottom-right. Morphs based on current required action.

**Props:**

- `action` — current action: `"end-step" | "pass-priority" | "confirm-targets" | "pay-mana" | "attack" | "block" | "done" | ...`
- `enabled` — boolean
- `onClick`

**Behavior:**

- Single button; label changes per `action`
- Single click is sufficient — no double-click confirmation
- Adjacent ellipsis (`...`) menu provides multi-phase passes: "Pass to Next Turn", "Pass to Your Turn"
- Auto-pass actions (from the ellipsis menu) are undoable; the End Step action is not

### 7.13 `PriorityTag`

**Purpose:** Floating label that appears near the player frame of whoever currently holds priority.

**Display:** small pill, `--color-accent-primary` background, "PRIORITY" text, fades in/out per `priority-tag-appear`.

### 7.14 `Modal`

**Purpose:** Container for full-screen and partial-screen overlays — mulligan decision, library search, graveyard view, scry, surveil, sideboard.

**Props:**

- `mode` — `"full" | "small"` — full dims and blocks the battlefield; small overlays in a corner and lets the game continue visible behind
- `title`
- `children`

**Behavior:**

- Full mode used for mulligan and library search (player must commit before continuing)
- Small mode used for scry/surveil during opponent's turn (player may need to react if priority shifts back)
- Both modes use `--color-bg-overlay` for the backdrop
- Modal corners use `--radius-lg`

### 7.15 `CommanderDamageTracker`

**Purpose:** Manual tracker in the right side panel for tracking each opponent's commander damage dealt to the local player. (21 commander damage from a single commander ends the game.)

**Display:**

- One row per opponent
- Each row: opponent's `PlayerFrame` (compact) + `LifeCounter` in interactive mode + `+`/`-` buttons
- For partner/background pairings, two counters per opponent (one per commander)
- This is manual entry; the engine does not enforce its accuracy

---

## 8. Layout primitives

### 8.1 Window minimum and target sizes

- **Minimum supported:** 1280×720
- **Designed for:** 1920×1080
- **Scales gracefully up to:** 2560×1440 and beyond
- **Below 1280×720:** show a "window too small" message; do not attempt to render the game-table

### 8.2 Resize behavior

- Layout reflows smoothly during resize
- No breakpoint snapping for game-table screen
- Side panel collapsibility provides additional battlefield space if needed (user-toggled, not auto)
- Cards on battlefield shrink to a minimum readable size, then begin overlapping rather than shrinking further

### 8.3 Z-index layers

Defined in `tokens.css` so components don't fight each other:

- `--z-battlefield` — base layer, permanents
- `--z-stack` — central focal zone, above battlefield
- `--z-targeting` — targeting arrows overlay
- `--z-ui-chrome` — side panel, action button, hand
- `--z-modal-backdrop` — modal dim overlay
- `--z-modal-content` — modal content
- `--z-tooltip` — card preview tooltips, always on top

---

## 9. Imagery and IP

- **Card images:** fetched from Scryfall at runtime. Never bundled with the application.
- **Card metadata:** sourced from the WebSocket game state where available, MTGJSON otherwise.
- **Mana symbols and set symbols:** rendered from open-source SVG assets; do not use trademarked iconography from official Wizards of the Coast assets.
- **IP disclaimer:** the app must display "Not affiliated with, endorsed by, sponsored by, or approved by Wizards of the Coast" prominently in About, Settings, and any external-facing landing page.

---

## 10. Accessibility

- Color is never the sole channel of information. Targeting arrows have arrowheads; status changes have icons; eliminated players have a slash overlay (not just desaturation).
- All interactive elements are keyboard-reachable. The action button, hand cards, and side panel controls have explicit focus styles.
- `prefers-reduced-motion` honored for ambient animation, hover scale-up, and pulses. Card-zone movement remains since it conveys game state.
- Color contrast meets WCAG AA for body text; AAA where feasible for critical numeric displays (life totals, counter counts).

---

## 11. Open questions and deferred items

- **Light theme** — design tokens should support theme switching. Light theme values not yet defined; defer until launch is complete.
- **Sound effects** — no SFX in initial release. Component design should not preclude hooking SFX later (e.g., motion specs are named, so they can fire SFX events in the future without component changes).
- **Searchable game log** — full text search of the log; deferred.
- **Auto-yield / stops settings UI** — right-click on `PhaseIndicator`; detailed UI deferred.
- **Fire/burn animation on permanent destruction at player elimination** — polish, deferred.
- **Spectator-specific UI changes** — none planned for first release; spectator sees the same layout but cannot interact.
- **Match-history and replay UI** — separate screen, not yet specced.
