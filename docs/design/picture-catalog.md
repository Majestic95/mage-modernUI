# Picture Catalog — Canonical Visual Source of Truth

> **Status:** This catalog is the **single source of truth** for how the
> game-table screen should LOOK. Every implementation decision references
> this document. When this catalog disagrees with the earlier design-system
> spec or the commander-screen spec, **this catalog wins.**
>
> **Reference image:** the 4-player FFA Commander screenshot the user
> provided in this push (described in detail below — image not committed
> to repo per copyright; this catalog preserves the load-bearing visual
> details verbatim).
>
> **Updated:** 2026-04-29
> **Related:**
> - [design-system.md](design-system.md) — tokens + component anatomy (lower precedence)
> - [screens-game-table-commander-4p.md](screens-game-table-commander-4p.md) — screen spec (lower precedence)
> - [target-visual-reference.md](target-visual-reference.md) — earlier prose description of the same image (kept for historical decision context)
> - [gap-inventory-2026-04-29.md](gap-inventory-2026-04-29.md) — current-state vs target verdicts

---

## How to use this document

When writing or reviewing any visual code change for the game-table screen:

1. **Find the affected element** in this catalog (region → element).
2. **Match the element's "Look" specification** in your implementation.
3. **If something is ambiguous or under-specified here**, treat the screenshot as authoritative and ask the user for clarification rather than improvising.
4. **If existing tokens/components aren't mentioned**, that's a hint that they should not be in this picture's UI — reconcile by deletion or relocation, not by leaving stale.

## How critics use this document

**Required load-bearing reference for every critic dispatched on a redesign-push slice (70-I through 70-Z + future visual work).** The dispatch template is canonical at [`docs/decisions/critic-checklist-redesign.md`](../decisions/critic-checklist-redesign.md). Every redesign critic:

1. Loads this picture-catalog before reviewing the slice.
2. Identifies which catalog regions/clauses the slice's changes touch.
3. Quotes the relevant clauses verbatim in their findings.
4. Flags **carry-over violations** — visual code preserved from earlier slices that contradicts the catalog (the canonical example is the slice 70-K row-stretch bug; see the lessons log in the checklist doc).
5. Returns findings in the prescribed `## Catalog clauses checked` / `## CRITICAL` / `## IMPORTANT` / `## NICE-TO-HAVE` / `## Carry-over violations` format.

A critic report that doesn't cite catalog clauses is incomplete and gets re-dispatched.

---

## Region map

```
┌────────────────────────────────────────────────────────────────┐
│ HEADER STRIP (1)                                               │
├────────────────────────────────────────────────────────────────┤
│                                                ┌──────────────┐│
│              ┌── Korvold (top) ──┐             │ GAME LOG     ││
│              │   PORTRAIT (2.A)  │             │ (5.A)        ││
│              │   battlefield     │             │              ││
│              └───────────────────┘             │              ││
│                                                ├──────────────┤│
│  ┌─Atraxa┐         ┌─FOCAL─┐   ┌─Meren─┐      │ COMMANDER    ││
│  │(2.B)  │         │ ZONE  │   │(2.C)  │      │ DAMAGE (5.B) ││
│  │       │         │ (3)   │   │       │      │              ││
│  └───────┘         └───────┘   └───────┘      ├──────────────┤│
│                                                │ TURN 8       ││
│              ┌── Locust God ─────┐             │ END STEP     ││
│              │   PORTRAIT (2.D)  │             │   (5.C)      ││
│              │   battlefield     │             │              ││
│              └───────────────────┘             └──────────────┘│
├────────────────────────────────────────────────────────────────┤
│ HAND FAN (4)                                                   │
└────────────────────────────────────────────────────────────────┘
```

---

## Region 1 — Header strip

### 1.1 Header bar (entire strip)

- **Look:** Thin horizontal bar across the top, ~36px tall.
- **Background:** Same very-dark-teal-black as the battlefield body — no separate fill, no border. The strip blends into the canvas.
- **Position:** Fixed at top, full viewport width.
- **Implementation:** Header sits OUTSIDE the side panel (it spans the full width including over the side-panel column).
- **Tokens used:** `--color-bg-base` (no separate header bg), `--space-3` for vertical padding.

### 1.2 Lobby name (left-aligned)

- **Look:** "**COMMANDER — 4 PLAYER FREE-FOR-ALL**"
- **Style:** All-caps, soft purple (`--color-accent-primary` family — lighter variant ≈ `#A78BFA`), letter-spacing wide (`tracking-widest` ~0.1em), font-weight medium (500), small font (~14px / `--font-size-body`).
- **Position:** Left-aligned, vertically centered in the header strip, with `--space-5` (24px) left padding.
- **Content:** Synthesized from `gameView` — for v1 hardcode the format string from `gameView.players.length` + presence of `commandList[].kind === 'commander'`. (Wiring an actual lobby name through the wire is out of scope; this is "good enough" until that lands.)
- **Game-state variations:**
  - 4 players + commander format → "COMMANDER — 4 PLAYER FREE-FOR-ALL"
  - 3 players + commander → "COMMANDER — 3 PLAYER FREE-FOR-ALL"
  - 2 players + commander → "COMMANDER — 1V1"
  - Non-commander → "FREE-FOR-ALL" / "1V1" without the "COMMANDER —" prefix

### 1.3 Top-right icon row

- **Look:** Four icons in a horizontal row, ~16px each, spaced ~16-20px apart.
- **Style:** Outline-style SVG icons, `--color-text-secondary` fill (light grey, ~50% alpha against bg), no chrome.
- **Hover state:** fill brightens to `--color-text-primary`, no background change.
- **Position:** Right-aligned, vertically centered in header, `--space-5` right padding.
- **Icon order (left to right):**
  1. **Chat** — speech-bubble outline. Click toggles slide-out chat panel below the game log (see §5.D — deferred).
  2. **Layout/zoom** — square brackets `[ ]` or two arrows facing in. Click collapses/expands the side panel (battlefield grows / shrinks). **When the side panel is collapsed, the ActionButton (catalog §5.C) MUST remain reachable** — slice 70-O floats it as a fixed bottom-right dock so the player never loses access to "End Step / Pass Priority / Next Phase." The hotkey set (F2 / F4 / F6 / F8 / Esc / Ctrl+Z) is preserved at the document level and works regardless of the panel state, but the visible button must also persist.
  3. **Fullscreen** — four corner brackets `⌜ ⌝ ⌞ ⌟`. Click toggles browser fullscreen via `document.documentElement.requestFullscreen()`. When already fullscreen, click calls `document.exitFullscreen()` to leave (slice 70-O extension; the implementation must support both directions, not just enter).
  4. **Settings** — gear icon. Click opens settings modal (Concede lives here per the user's preference; "Leave game" too).

### 1.4 What's NOT in this header

The current implementation has these in the header — **remove them**:
- gameId UUID display
- Slowmo debug badge
- Connection-state colored dot (per-player DISCONNECTED overlay handles this signal already)
- "Your turn / Opponent's turn" pill (per-pod halo handles this)
- "Your priority / Waiting for opponent" subtext (PriorityTag handles this)
- "Leave" text button (move to settings modal)

---

## Region 2 — Player pods

Four pods total. Each has the same anatomy with size/orientation variations per position.

### 2.0 Common pod anatomy (all four positions)

- **Portrait:** Circular `border-radius: 50%`, default ~80px diameter for opponents, ~96px for local.
- **Portrait fill:** Scryfall art-crop URL of the player's commander (resolved via existing `scryfall.ts`). Object-fit: cover.
- **Halo ring:** 2-3px ring around the circular portrait. Color = player's color identity (multicolor = alternating bands rotating at 12s/rev). Renders OUTSIDE the portrait via box-shadow OR a separate concentric ring element. **MUST also radiate an outer glow per the universal halo-glow rule (§Universal halo glow below).**
- **Halo states (composes additively):**
  - Default: static glow ring in color identity colors **+ outer radiating glow in the same color(s)**
  - Active player: ring brightens + pulses at 1.9s period (`animate-player-active-halo` already shipped)
  - Multicolor + active: rotating bands AND pulse compose (slice 70-G)
  - Disconnected: ring desaturates, "Disconnected" pill overlay (slice 70-H — keep)
  - Eliminated: ring greys, slash overlay across entire pod (slice 70-D — keep)
- **Life total:** Large bold numerals overlaid INSIDE the portrait area (or just below — to-resolve at implementation; the picture shows it overlaid at lower-portion). Font size ~`--font-size-heading-lg` (24px) for opponents, larger for local. White (`--color-text-primary`) with subtle text-shadow for legibility against varied art.
- **Player name:** White, semibold (`--font-weight-semibold`), `--font-size-heading-sm` (14px), positioned BELOW the portrait. Single line.
- **Commander name:** Light grey (`--color-text-secondary`), regular weight, `--font-size-caption` (12px), positioned below the player name. Single line. Typography slightly smaller than the player name.

### 2.1 Position-specific layouts

#### 2.1.0 Universal battlefield-area composition (slice 70-Z.1, user direction 2026-04-30)

Every pod's battlefield region is a single composed surface (`data-testid="battlefield-area"`) with TWO sub-elements:

- **Main rows** — exactly two: `creatures` and `lands`, in the order returned by `rowOrder(perspective)` (self → creatures→lands; opponent → lands→creatures). Creatures always sit closest to the central focal zone; lands always sit closest to the player's screen edge.
- **Side artifact box** — a single perpendicular row (`data-testid="artifact-zone"`) holding ARTIFACTS, ENCHANTMENTS, BATTLES, land-artifacts, land-enchantments, AND any unknown future card type. The box is positioned PERPENDICULAR to the main-rows axis: top/bottom pods get a vertical column to the side; left/right pods get a horizontal strip at the bottom.

**Bucket rules (`battlefieldRows.classifyPermanent`):**
- `CREATURE` (anywhere in `types`) → creatures row. Wins over LAND, ARTIFACT, ENCHANTMENT.
- `PLANESWALKER` → creatures row. Per user direction: "Planeswalkers and commanders should be in the 'creature' zone since they are creatures." Commanders fall through naturally — most are creatures or planeswalkers.
- Pure `LAND` (no other non-land permanent type stacked) → lands row.
- Everything else → artifact zone. **Default fallback for unknown types**: per user direction "if there is any question about a card type, it would, by default, go into the artifact zone." Defends future engine type introductions from rendering in a wrong row.

**Sizing contract (catalog "rows fixed, cards shrink"):**
- Main rows and the artifact box are STATIC rectangles. They do NOT grow or wrap as card count increases.
- When card count exceeds the row's natural capacity, every tile in that row shrinks UNIFORMLY along the row's main axis. Slot stays square (`aspect-square`) so tap-rotation still fits.
- Mechanism: flex container with `flex: 1 1 0` + `max-(width|height)` per tile + `min-(width|height): 0` on the container so it respects parent bounds.
- Hover surfaces the full-size card (existing `HoverCardDetail` behavior).

**Empty-state rules:**
- Artifact box with zero permanents: render NOTHING (no placeholder, no border, no label). Per user direction: "If artifact box is empty, render nothing until it is needed."
- Entire battlefield empty: replace the whole `battlefield-area` with a single `"No permanents yet."` italic caption.

**Per-pod axis orientation** (drives `BattlefieldRowGroup.orientation`):

| Pod position | Main rows axis | Artifact box axis |
|---|---|---|
| Top (2.A) / Bottom (2.D) | horizontal (cards left→right) | vertical column to the side |
| Left (2.B) / Right (2.C) | vertical (cards top→bottom) | horizontal strip at the bottom |

#### 2.A — Top opponent (Korvold position in the picture)

- **Portrait position:** Centered horizontally near the top of the battlefield region.
- **Battlefield-area:** **ABOVE** the portrait. Composition per §2.1.0 — two horizontal main rows (lands at top closest to the screen edge, creatures at bottom closest to the focal zone) plus a vertical artifact box positioned to the side (renders only when non-empty).
- **Card size:** `--card-size-small` (~80×112 portrait per slice 70-I tokens).
- **Player name + commander name:** below the portrait.
- **Row orientation:** `horizontal` (cards lay left→right). Artifact box's inner row uses `vertical` orientation. **Traditional MTG-style — no curving.** (User direction 2026-04-30: curved arrangements are explicitly out of scope; the picture's curved appearance is decorative only and is not a fidelity target.)
- **In picture:** Korvold has 6 face-down or back-side cards above his portrait + a row of horizontal "Treasure-token-style" smaller cards above that. Implementation per §2.1.0 (creatures / lands main rows + artifact side box). Face-down cards still render at `BattlefieldTile` size — the rendering of "back side" is a separate concern (slice TBD if needed).

#### 2.B — Left opponent (Atraxa position)

- **Portrait position:** Vertically centered along the left edge of the battlefield region.
- **Battlefield-area:** **TO THE RIGHT** of the portrait. Composition per §2.1.0 — two vertical main rows (lands leftmost / closest to the screen edge, creatures rightmost / closest to the focal zone) plus a horizontal artifact box at the bottom (renders only when non-empty).
- **Card size:** `--card-size-small`.
- **Player name + commander name:** to the RIGHT of the portrait (since vertical real-estate above/below is constrained).
- **Row orientation:** `vertical` (cards lay top→bottom). Artifact box's inner row uses `horizontal` orientation.
- **In picture:** Atraxa has 2 columns of cards stacked vertically along the left edge with what appears to be 4-5 cards per column. Implementation per §2.1.0.

#### 2.C — Right opponent (Meren position)

- **Mirror of 2.B.** Portrait on the right edge, battlefield-area to the LEFT of the portrait (lands rightmost / closest to the screen edge, creatures leftmost / closest to the focal zone), name/commander to the LEFT of the portrait.
- **Card size:** `--card-size-small`.
- **Row orientation:** `vertical`. Artifact box's inner row uses `horizontal` orientation.

#### 2.D — Bottom local (Locust God position)

- **Portrait position:** Centered horizontally near the bottom of the battlefield region (above the hand fan).
- **Portrait diameter:** ~96px (slightly larger than opponents' 80px to emphasize the local player).
- **Battlefield-area:** **ABOVE** the portrait, expanding upward toward the focal zone. Composition per §2.1.0 — two horizontal main rows (lands at bottom closest to the hand, creatures at top closest to the focal zone) plus a vertical artifact box positioned to the side (renders only when non-empty). The picture shows ~10 permanents in a single row with full readability; under heavier board states the row stays static and tiles shrink uniformly.
- **Card size:** `--card-size-medium` (larger than opponents' small — local player gets ~125% the opponent's tile size for readability).
- **Player name + commander name:** below the portrait but above the hand fan.
- **Row orientation:** `horizontal`. Artifact box's inner row uses `vertical` orientation.
- **In picture:** "The Locust God" + "God of the Swarm" labels visible. Halo glows blue-cyan with a soft pulse (Locust God's color identity = U).

### 2.2 ZoneIcons (graveyard / exile / library) — placement

- **Visual:** Small square icons (~16-20px) with a count badge.
- **Position:** Adjacent to the portrait — a small horizontal cluster near the player frame, NOT attached to the portrait stack. The picture doesn't show these prominently for opponents (subtle); for the local player they're slightly more visible but still understated.
- **Per zone:**
  - **Library:** Just a number (no icon — libraries are face-down per spec §7.9).
  - **Hand:** Just a number (slice 70-P.1, user directive 2026-04-30 — opponent hand size is strategic public info; legacy strip showed it inline and the redesigned cluster needed an explicit home for it).
  - **Graveyard:** `🪦` or simple `G` glyph + count.
  - **Exile:** `❌` or simple `E` glyph + count.
- **Click:** Local-player graveyard/exile open the existing `ZoneBrowser` modal. Opponent graveyard/exile show on hover (tooltip — public information per MTG rules; capped at 10 cards + "... and N more" overflow per slice 70-P critic UI/UX-I4). Library + Hand are display-only counts (no click, no tooltip).
- **In picture:** Not prominently visible — they're tucked near the player frame, low-priority chrome. Don't overdesign these.

### 2.3 Mana pool — placement

- **Visual:** Cluster of `ManaOrb`s (one per non-zero color) with count if >1.
- **Position for local player:** **TOP-RIGHT of the hand region** (per spec §4 floating mana). Glow halo on each orb.
- **Position for opponents:** Small cluster adjacent to their player frame. Visible but smaller.
- **Empty pool:** Don't render anything (no zero-orb or "empty" placeholder).
- **In picture:** Not visible (no floating mana for any player at the depicted moment — pool is empty for everyone).

### 2.4 Active / Priority / Disconnected / Eliminated state composition

These compose ON TOP OF the base portrait + halo:

- **Active turn:** Halo brightens + pulses (no extra chrome — replaces the current ACTIVE text pill). The pulse IS the signal.
- **Has priority:** Floating "PRIORITY" pill (`PriorityTag`, slice 70-G) appears NEAR the portrait on the side opposite the side panel (so it doesn't get obscured). Fades in/out per `PRIORITY_TAG_FADE`.
- **Disconnected:** Halo desaturates + "Disconnected — waiting for reconnect" pill in top-right of pod (slice 70-H — keep).
- **Eliminated:** Slash overlay across entire pod + permanents fade to 45% opacity (slice 70-D — keep).

### 2.5 What's NOT in PlayerFrame

Remove from the current implementation:
- The horizontal `<header>` text strip (entire current PlayerFrame layout)
- The "ACTIVE" text pill (replaced by halo pulse)
- Inline LifeCounter as small text (becomes the dominant numeral inside the portrait)
- The flat row of zone icons + hand count + mana pool ALL on one line (split: zone icons → small cluster, mana pool → top-right of hand)

---

## Region 3 — Central focal zone

### 3.1 Stack mode (default when stack non-empty)

- **Topmost stack item:** Rendered at `--card-size-focal` = **170px × 238px** (5:7 portrait, ~210% of `--card-size-medium`). Sized to be visually dominant — the focal card is the primary "what's happening right now" anchor on the screen. Centered geometrically in the middle of the four pods. (User decision 2026-04-30: the focal card should read as **big and dominant**, not subtle. The slice 70-I token at 170px stays; the earlier ~125×175 estimate in this catalog was a rough back-of-envelope figure superseded by the live test.)
- **Card render:** Full `<CardFace>` — Scryfall art, mana cost top-right, name banner middle, type line, rules text, P/T bottom-right.
- **Glow:** Color-identity halo ring **around the card edges** with colored bands matching the spell's mana colors. Single color → solid color halo. Multicolor → conic-gradient with alternating bands, one band per color, **rotating at 12s/rev** via `animate-halo-rotate`. Colorless → neutral team-ring color. The inner ring is feathered via CSS `filter: blur(...)` so the edge reads soft. **MUST also radiate an outer glow per the universal halo-glow rule (§Universal halo glow):** `computeHaloGlow(colors, false, 32)` returns a `box-shadow` with one feathered shadow per color sourced from the `--color-mana-X-glow` tokens, so the focal card visibly emits its color outward, not just sits with a flat colored ring.
- **Glow animation:** Continuous opacity pulse at 1.5s period (`stack-glow-pulse` keyframe — already in the registry). For multicolor cards the pulse composes with the 12s halo rotation.
- **Glow color:** Inner ring via `computeHaloBackground`, outer radiating glow via `computeHaloGlow`. Both helpers live in `halo.ts` and are the canonical source for any halo surface (player portrait, focal card, future surfaces).
- **Lower stack items (positions 2-5):** Fanned BEHIND the topmost via the **same `--card-size-focal` CardFace** (NOT a smaller stack-variant tile) at progressively smaller scale-transform values: 85% / 70% / 55% / 40% (15% step). Fanned at slight angles ~5-8° per position alternating sign (deck-of-spells silhouette).
- **5+ items past the topmost:** Collapse to "+N more" indicator on the topmost (shown in the top-LEFT corner of the focal card so it doesn't compete with the mana cost overlay in top-right).
- **Triggered/activated abilities on the stack:** Render as card-shaped tiles with the source card's art (small) and the ability's rule text overlaid. Same focal-size container.

### 3.2 Combat mode

- **Trigger:** `gameView.combat.length > 0` AND no stack entries.
- **Render:** Replace stack content with attack/block arrows (re-use `<TargetingArrow>` SVG geometry).
- **Arrow source:** the attacker's BattlefieldTile DOM node.
- **Arrow target:** the defending player's portrait OR the blocking creature's BattlefieldTile.
- **Combat trick caveat:** If a spell is cast during combat, switch BACK to stack mode for the duration of that spell on the stack, then return to combat mode.

### 3.3 Empty state

- **Render:** Nothing in the focal zone container.
- **Background:** The particle-drift backdrop (already shipped, slice 70-F) shows through. Don't overlay any UI chrome. Palette per "Particle-drift palette" subsection below — **STATIC** dark-hued mix; explicitly NOT priority-player-tinted (priority is conveyed by the portrait halo pulse + PRIORITY pill, not by the backdrop).

#### Particle-drift palette (slice 70-Z polish, user direction 2026-04-30)

Two large overlapping ellipse radial gradients composite additively over `--color-bg-base #0E1A20`:

- **Warm gold** centered at 30% 35% — `rgb(220 180 110 / 0.10)` peak, fading to transparent at 100% radius. Spans `ellipse 90% 80%`.
- **Cool gray** centered at 70% 65% — `rgb(125 130 140 / 0.11)` peak, fading to transparent at 100% radius. Spans `ellipse 90% 80%`.

The two gradients overlap heavily in the middle two-thirds of the canvas where their additive composite produces a continuous gold ↔ gray mix (no discrete blobs visible at the seam).

**Drift mechanism:** the backdrop element has `background-size: 115%` (15% headroom past the viewport) and animates `background-position: 0% 0% → 100% 100%` over 60 seconds, alternating, ease-in-out. Both gradient centers stay on-screen at every drift phase; the perceived motion is the seam between gold and gray slowly migrating laterally — a subtle "breathing" swirl.

**Alpha discipline:** peak alphas (0.10-0.11) keep the atmosphere subtle so the central focal zone stays visually dominant per "Empty space is intentional" anchor (Color & motion impressions §3). Do not raise these alphas without explicit user sign-off; the backdrop is meant to be felt, not seen as figure-ground chrome.
- **Transition out:** When a stack item arrives, fade in the focal card via `STACK_ENTER_EXIT` motion (already wired).

### 3.4 What's NOT in the central focal zone

- The current `<StackZone>` text strip "Stack (N) — top resolves first" header (drop)
- The "TOP" badge overlay (drop — the topmost being LARGER is the visual signal)
- The flex-wrap row of small uniform stack tiles (replace with focal + fan)
- Border / background panel chrome (the focal card stands alone on the battlefield)

---

## Region 4 — Hand area

### 4.1 Hand fan layout

- **Position:** Bottom strip of the viewport, full-width below the local-player pod (region 2.D). The hand sits ABOVE the bottom edge of the viewport with no margin / no decorative tray (per target).
- **Height:** ~180-200px (enough for `--card-size-large` cards + room for hover-lift overflow).
- **Background:** Transparent (no panel fill, no border). The hand floats over the battlefield's bottom edge.
- **Card layout:** Slight arc fan, NOT Hearthstone-steep. Max angle ~12° per outermost card. Subtle downward droop (lower-y for outermost cards).
- **Card size:** `--card-size-large` (default ~110×155 — to be confirmed when tokens land in slice 70-I).
- **Squeezing:** When hand size > 5, cards squeeze tighter (smaller spread, more overlap). Leftmost and rightmost never go off-screen.
- **Hover lift:** Hovered card scales to 1.10, translates up by `--space-3` (12px), un-rotates to 0°. `card-hover-lift` motion (150ms ease-out) — already shipped.
- **Already correct in current code:** `MyHand.tsx` slice 44 layout matches this. Only the section header "Your hand (N)" needs to drop, and the surrounding panel chrome (border, padding, background tile) needs to remove.

### 4.2 Hand state hints

- **"Your hand (N)" header:** **Drop.** The hand is self-evident. Card count is unnecessary chrome.
- **"Waiting for opponent" hint when not your priority:** Move to a less-prominent position (perhaps as a faint pill near the End Step button OR drop entirely; the End Step button being disabled IS the signal).

### 4.3 Interaction

- **Click-to-cast** (existing).
- **Drag-to-play** (existing — slice 36).
- **Visual on cast:** Card animates from hand position to the focal zone via `card-cast` motion. Existing.

### 4.4 Cards visible in the picture (for reference)

The picture shows 6 cards in the local hand:
1. Cathartic Reunion
2. Damnation
3. Commencement Splatter (or similar)
4. Aletheia Study
5. Sol Ring
6. (rightmost — illegible at the resolution)

These are reference data only — actual hand contents at runtime come from `gameView.myHand`.

---

## Region 5 — Side panel

### 5.0 Panel container

- **Width:** `clamp(280px, 22vw, 360px)` (already in code).
- **Background:** `--color-bg-elevated` (#152229) — slightly raised from the battlefield base.
- **Border:** Single 1px left border in `--color-border-subtle` (or zinc-800 equivalent).
- **Position:** Right side of the viewport, full height below the header.
- **Vertical layout:** 3 stacked sections (game log → commander damage → turn/action), each with a horizontal divider between them.

### 5.A — GAME LOG (top section, ~50% of panel height)

#### Section header

- **Text:** "GAME LOG" all-caps, `--color-text-secondary`, `--font-size-caption` (12px), `tracking-widest` (0.1em letter-spacing), `--font-weight-medium`.
- **Padding:** `--space-3` horizontal, `--space-2` vertical.
- **Border-bottom:** 1px in subtle border color, separating header from entries.

#### Entry list

- **Direction:** Latest at bottom, scrolls down (newest entries push older up). Auto-scroll-to-bottom on new entry (existing behavior).
- **Entry density:** ~12px vertical padding per entry, no separator between entries.

#### Per-entry layout

- **Left column:** Small circular portrait avatar (~32px diameter) of the actor. Uses the same `<PlayerPortrait>` component as the main pods, sized smaller. Halo ring is suppressed (just the art-crop circle — no glow on log entries).
- **Right column:** Two lines of text:
  - **Line 1:** Player name in white, `--font-weight-semibold`, `--font-size-body` (14px). Single line.
  - **Line 2:** Action text in `--color-text-primary`, regular weight, `--font-size-caption` (12px). Card name references are highlighted (color shift to a soft purple/cyan and possibly underlined). Hover on a card name → `<HoverCardDetail>` popover.

#### Card name highlighting

- **Detection:** Parse engine gameInform text for card-name patterns (`played <Name>`, `cast <Name>`, `returned <Name>`, etc.). Engine emits `<font color="...">CardName</font>` HTML in some flows — strip and re-render with our own styling.
- **Style:** `--color-accent-primary` (purple) text, optional underline-offset 2px on hover.
- **Click:** Optional — open the card in a focal preview (defer to post-launch).

#### Game log entries shown in the picture

For visual reference (entries from oldest to newest):
1. **Korvold played Blood Crypt** — Korvold portrait, "Korvold" name, "played" action, "Blood Crypt" highlighted card name
2. **Atraxa cast Toxic Deluge** — Atraxa portrait, "Atraxa" name, "cast" action, "Toxic Deluge" highlighted
3. **Meren returned Sakara-Trib Elder to hand** — Meren portrait, "Meren" name, "returned ... to hand" action, "Sakara-Trib Elder" highlighted
4. **You cast The Locust God** — local-player portrait, "You" name (NOT the commander name — when the actor is the local player, the name reads "You"), "cast" action, "The Locust God" highlighted

### 5.B — COMMANDER DAMAGE (middle section)

#### Section header

- **Text:** "COMMANDER DAMAGE" — same styling as GAME LOG header.
- **Border-top:** 1px subtle border separating from game log.

#### Layout

- **2×2 grid** of cells.
- **Cell content per cell:**
  - Small circular portrait of the OPPONENT (or their commander).
  - Damage number to the right of the portrait, in a feature size — `--font-size-heading-md` (18px), `--font-weight-bold`, `--color-text-primary`.
- **Cell sizing:** Each cell ~half panel width × ~80-100px tall.
- **Spacing:** Tight grid — no extra padding between cells beyond a thin divider line.

#### Per-cell variants

- **0 damage cell:** Shows the portrait + "0" or just no number. Picture suggests just the number even at 0.
- **At threshold (21):** The cell highlights — text turns red, optional pulse. Engine doesn't enforce this; client-side flash.
- **Manual entry:** Click cell → reveals -/+ buttons in place (or hover). Existing `LifeCounter` interactive mode.

#### Picture content for reference

The picture shows:
- Top-left cell: Atraxa portrait, "7"
- Top-right cell: (Korvold? or empty), "5"
- Bottom-left cell: (Meren), "6"
- Bottom-right cell: (the local player — but tracking damage TO yourself doesn't make sense; this might be a quirk of the reference image OR the 4th cell is reserved for displaying YOUR damage dealt to others, summed)

For implementation: **3 cells (one per opponent), 4th cell empty or used for a different stat** (TBD — the picture is ambiguous; default to showing 3 cells in a 2×2 grid with the 4th left blank).

### 5.C — TURN + ACTION (bottom section)

#### Layout

- **Content:**
  1. Small grey label "TURN N" at the top of the section, `--color-text-secondary`, `--font-size-caption`.
  2. Below the label: large purple action button.
  3. To the right of the button: small ellipsis (`⋯`) icon for multi-pass menu.
- **Padding:** `--space-3` all around.

#### TURN counter

- **Text:** "TURN 8" (number from `gameView.turn`).
- **Style:** Caption-sized, secondary color, all-caps, tracking-wide.

#### Action button

- **Default label:** "End Step" (at end of phase) — but morphs based on the engine's required action.
- **Morph rules:**
  - In a phase end → "End Step"
  - Holding priority during opponent's stack → "Pass Priority"
  - Targeting prompt → "Confirm Targets"
  - Mana cost prompt → "Pay Mana"
  - Combat declaration → "Attack" / "Block"
  - Default fallback → "Done"
- **Style:**
  - Background: `--color-accent-primary` (purple #8B5CF6)
  - Hover: `--color-accent-primary-hover` (#A78BFA)
  - Active/pressed: `--color-accent-primary-active` (#7C3AED)
  - Text: `--color-text-on-accent` (white #E8EDF0)
  - Border: none, or a subtle inner highlight
  - Border-radius: `--radius-md` (8px)
  - Padding: ~`--space-3` × `--space-4` (12×16px)
  - Width: full-width within the panel section (minus the ellipsis to the right)
  - Height: ~40-44px
  - Font: `--font-weight-semibold`, `--font-size-body`
- **Disabled state:** Lower opacity, `cursor: not-allowed`, no hover.
- **Animation:** Subtle scale on press (~0.97 for 80ms), no other motion.

#### Ellipsis (`⋯`) menu

- **Visual:** Three vertical dots OR three horizontal dots, ~20px square button next to the action button.
- **Click → opens dropdown with:**
  - "Pass to Next Turn" → `PASS_PRIORITY_UNTIL_NEXT_TURN`
  - "Pass to Your Turn" → `PASS_PRIORITY_UNTIL_NEXT_MAIN_PHASE`
  - "Resolve Stack" → `PASS_PRIORITY_UNTIL_STACK_RESOLVED`
  - "Stop Skipping" → `PASS_PRIORITY_CANCEL_ALL_ACTIONS`
  - "Undo" → `UNDO`
- **Hotkeys preserved:** F2/F4/F6/F8/Esc/Ctrl+Z still work (invisible UX for power users).

### 5.D — Chat slide-out (deferred)

- **Trigger:** Header chat icon (1.3).
- **Behavior:** Slides out below the game log section when active.
- **Status:** Defer to slice 70-R (post-redesign). Don't build for v1.

### 5.E — Optional widgets (future)

- Per spec §5: poison counters, energy, experience, monarch token, day/night, dungeon progress.
- **Status:** Render only when relevant. Most games hide these. Defer until a real game needs them.

---

## Region 6 — Removed from the layout

The following EXIST in the current code but should be **removed or relocated**:

### 6.1 Action footer

- **Current:** `<footer data-testid="game-table-action">` in `GameTable.tsx:317-322` renders the multi-button ActionPanel at the bottom of the screen.
- **Target:** REMOVED. The ActionButton + ellipsis menu live in §5.C.
- **Migration:** Delete the `[grid-area:action]` row from `GameTable`'s grid template. Side panel grows to fill that vertical space.

### 6.2 PhaseTimeline (relocate)

- **Current:** Renders at the TOP of the side panel (`GameTable.tsx:292`).
- **Target:** **Relocate or DROP.** The picture doesn't show a phase indicator prominently. The current rich timeline (per-phase color + Combat sub-steps) is informative but visually dominant; the picture shows a much subtler treatment.
- **Decision:** **Defer relocation.** Keep PhaseTimeline at top of side panel for v1 of the redesign — it's already styled well, and the picture is ambiguous about whether/where a phase indicator lives. Re-evaluate after live test.

### 6.3 CommandZone strip (replace)

- **Current:** Horizontal text-chip strip below the battlefield rows for each player (`PlayerArea.tsx:175`).
- **Target:** **REMOVE the chip strip.** The commander's identity is shown via the player's portrait (the avatar IS the commander art). Emblems / dungeons / planes need a different rendering — TBD when a game uses them; not in the picture so don't design for it now.
- **Migration:** Drop `<CommandZone>` from `PlayerArea`. The player portrait now carries the commander identity. Emblems / dungeons / planes get a follow-up slice when a game needs them.

---

## Region 7 — Card animation system (transient overlays)

> **Slice 70-Z.2 / 70-Z.3 / 70-Z.4 (user direction 2026-04-30):** three named animation tiers vary by gameplay context. Standard glides for routine plays; cinematic poses for the spells that should pull the eye; in-place impacts for the moment of destruction. The seam is one diff function (`gameDelta.diffGameViews`) → typed events on a module-singleton bus → the `CardAnimationLayer` overlay portal that mounts the appropriate visuals.

### 7.0 Three tiers

| Tier | Trigger | Visual |
|---|---|---|
| **B (standard)** | Default for any cast / resolve / move-zone | Cross-zone Framer `layoutId` glide via `LAYOUT_GLIDE` spring (stiffness 280 / damping 26 / mass 0.7). Already wired pre-redesign; the seam keeps it as the "do nothing extra" path. |
| **A (cinematic)** | Commander cast OR planeswalker cast OR `manaValue ≥ 7` | 1.5× scale focal pose at the central focal zone center, holds for `CINEMATIC_HOLD_MS` (250ms), color-tinted ribbon trail along an arcing quadratic-Bezier path. |
| **C (impact)** | Per-event (creature death, permanent exiled, board wipe, commander returned) | In-place keyframe (dust crumple / bright dissolve) + per-tile particle field. Board wipe synthesizes a single radial-gradient ripple at the epicenter pod. |

### 7.1 Cinematic cast (A)

- **Threshold rationale:** commander + planeswalker casts deserve flair as named board-state-defining moments. CMC ≥ 7 is the de facto "big spell" threshold in commander format with mana acceleration. Below 7, the vast majority of casts are routine and shouldn't earn a 650ms interruption.
- **Casting pose:** card flies (via `layoutId={cardId}` cross-zone interpolation) from the cast source bbox to the central focal zone center, scales to 1.5× of `--card-size-focal`, holds for 250ms, then unmounts. The StackZone focal tile (which has the same `layoutId`) is gated by `useIsCinematicCastActive` and renders null during the hold so two motion.divs with the same id don't collide.
- **Ribbon trail:** SVG quadratic-Bezier path from cast source to focal-zone center. Single-color spells use `manaTokenForCode` per color; multicolor uses an SVG `<linearGradient>` with one stop per color. `stroke-dashoffset` animates from `var(--ribbon-length)` to 0 over 600ms (drawing the line), then opacity fades the last 40%.
- **Source bbox:** `from === 'hand'` resolves to `[data-testid="my-hand"]`; opponent casts resolve via `[data-player-id="${ownerPlayerId}"]` (NOT seat→position — see slice 70-Z.3 critic CRIT-1: seat indexes don't survive non-seat-0 local players).
- **Destination bbox:** `[data-testid="central-focal-zone"]` — the grid's center cell, NOT viewport center (which is offset by side-panel width).

### 7.2 Commander return (still A-tier — overlay-rendered, glide trajectory)

- **Trigger:** `commander_returned` — a commander left the battlefield WITHOUT entering graveyard or exile (the player chose to redirect to the command zone).
- **Destination:** the player's `PlayerPortrait` (per §6.3 the visible CommandZone strip was removed; the portrait is the canonical commander surface).
- **Trajectory:** Framer `layoutId` interpolates the card from its battlefield bbox to the portrait position. 600ms tween with `ease: [0.25, 0.1, 0.25, 1]` (slower than LAYOUT_GLIDE's spring; "deliberate flight" reads better than spring's "alive bounce" for this slow event).
- **Card payload:** stub reconstructed from `commandList[].name` + `imageNumber` (synthesized as `cardNumber` so the scryfall image lookup resolves). Other fields (mana cost, P/T) are blank — fine because the 600ms glide is brief.

### 7.3 Impact (C)

- **Creature death** (`creature_died`): an `ImpactOverlay` mounts at the dying tile's bbox (captured via `[data-card-id="..."]` at event-handler time) and runs the `card-dust-crumple` keyframe over 600ms — initial **0–8% impact flash** (brightness 1→1.4, scale 1→1.04) reads as the killing blow, then 8–100% dust (opacity 1→0, scale 1.04→0.85, brightness 1.4→0.4, blur 0→2px). 10 dust particles drift downward with random lateral spread; earthy `rgba(82, 82, 91, 0.85)` palette. The original tile's AnimatePresence exit (default B-glide) runs in parallel beneath the overlay so the underlying card visually fades while the overlay paints the disintegration above it.
- **Permanent exiled** (`permanent_exiled`): same overlay mechanism, runs `card-bright-dissolve` keyframe (brightness peak 2.2× at 40%, ramps to 3× at 100% with opacity 0; scale 1→1.05 expansion) over 500ms. 16 white-violet particles `rgba(216, 180, 254, 0.9)` burst RADIALLY (full 360° spread). Distinct geometry + palette so death and exile read differently.
- **Board wipe** (`board_wipe` — synthesized when ≥2 destruction events fire in one snapshot): one fixed-position radial-gradient ripple mounts at the **epicenter pod's portrait** (resolved via `[data-portrait-target-player-id]`, NOT the slot-split-ambiguous `[data-player-id]`). Base diameter 2000px (covers any practical viewport), 700ms keyframe (`board-wipe-ripple`): scale 0→1.1, opacity 0.55→0. Reads as a screen-spanning shockwave, not a localized bloom. Per-permanent overlays stagger by `BOARD_WIPE_STAGGER_MS` (80ms) so the wave reads outward from the epicenter.
- **Performance budget:** `MAX_CONCURRENT_DISINTEGRATES = 4`. A wipe destroying ≥5 permanents animates the first 4; surplus get the default B-glide exit alone. Single ripple still fires regardless.
- **Why a layer overlay (not in-tile keyframe):** AnimatePresence in BattlefieldRowGroup snapshots a child's exit props at the LAST render where the child was present. By the time the snapshot diff fires `creature_died`, the dying card has already been removed from the row's `permanents` array — its motion.div's exit props were captured BEFORE the event fired (with no impact branch). Layer-rendering the impact at the captured bbox sidesteps the AnimatePresence freezing problem (slice 70-Z.4 critic CRIT-1 redesign).

### 7.4 Reduced motion contract

- The Framer `layoutId` cross-zone glide via `LAYOUT_GLIDE` is **essential motion** (it conveys "card moved zones") and is preserved under `prefers-reduced-motion: reduce` via the existing `data-essential-motion` opt-out.
- All decorative overlays — casting pose, ribbon trail, commander-return glide, dust crumple, bright dissolve, board-wipe ripple, per-tile particles — are gated at `CardAnimationLayer`'s event-handler boundary (`prefersReducedMotion()` per-call). When reduce is set, the layer emits NO overlays; tiles get the default B glide.
- The CSS keyframes (`card-dust-crumple`, `card-bright-dissolve`, `dust-particle-drift`, `board-wipe-ripple`, `ribbon-sweep`) are also silenced by the global `@media (prefers-reduced-motion: reduce)` rule in `index.css` as belt-and-suspenders.
- **Known limitation (slice 70-Z.3 critic IMP-3):** `commander_returned` under reduced motion produces a silent disappearance — there's no destination layoutId match for the command zone (which has its own id space, disjoint from cardId), so without the overlay the card has nothing to glide TO. Acceptable per the catalog's "decorative overlays may drop entirely under reduce" rule.

### 7.5 z-index ladder

- **Animation overlays:** `z-[35]` (CardAnimationLayer container).
- **Side panel + floating action dock:** `z-30` — overlays paint over table chrome.
- **Interactive dialogs (GameDialog, ZoneBrowser, ConcedeConfirm, GameEndOverlay banner, TargetingArrow):** `z-40` — interactive surfaces ALWAYS paint over decorative overlays. Catalog rule: a cinematic-cast pose must NEVER obscure a target-confirmation dialog.
- **HoverCardDetail portal:** `z-50` — naturally floats above the layer when the user hovers a card.

### 7.6 Counterspell visual fidelity (known limitation)

The wire does NOT flag countered vs. resolved. For permanent-type spells (commander, planeswalker, creature, artifact, enchantment, battle), the diff cleanly distinguishes "left stack but did not enter battlefield = countered" — these emit `countered`. For instants and sorceries, both "resolved normally" and "countered" land in the graveyard, so the diff cannot tell them apart and emits `resolve_to_grave` for either case. A countered Lightning Bolt looks identical to a resolved one. **Documented limitation per user direction 2026-04-30** ("Permanents only" — simplest, never lies). Future slice could parse log-text "countered" markers if it becomes user-visible.

---

## Universal halo glow (load-bearing rule)

> **User directive 2026-04-30, slice 70-N.1:**
> *"In every instance of colored halo bands around a card or player portrait, the color needs to have a glow effect that radiates from the color. This glow effect is universal and should be implemented everywhere a halo is."*

Every halo surface in the redesign — current and future — composes **two** color layers:

1. **Inner ring / bands** — solid color (single) or `conic-gradient` of `--color-mana-X` tokens (multicolor) or neutral team color (colorless / eliminated). Renders the spell or player's color identity as a visible band around the host element. Animations: `animate-halo-rotate` (12s/rev for multicolor), `animate-stack-glow-pulse` or `animate-player-active-halo` for opacity pulse.
2. **Outer radiating glow / bloom** — a blurred copy of the SAME conic-gradient (or solid color) as the inner ring, extending past the host element via negative inset, with `filter: blur(...)` softening the bands into a radiating glow. The bloom layer rotates in lockstep with the ring on a SHARED parent's animated `--halo-angle`, so the bloom color at any compass direction matches the ring color at that direction at every instant — directional rotational color, not a static rainbow sum.

The outer glow MUST be present. A halo that is only a colored ring (no radiating glow) is a catalog violation regardless of which surface it lives on. Critics flag this as a CRITICAL finding and the slice doesn't ship.

> **Slice 70-Z polish (user directive 2026-04-30) — bloom mechanism unified.** Earlier slice-70-N.1 used `computeHaloGlow` returning a `box-shadow` value composed of layered `--color-mana-X-glow` tokens. The box-shadow approach can't be rotated, so for multicolor identities the bloom appeared as a static color sum while the ring rotated through bands — a visible mismatch. Replaced uniformly with the blurred-gradient sibling-div approach above; box-shadow halos are deprecated. Both halo surfaces (`PlayerPortrait` CircularHalo + `StackZone` FocalCard) now use the same mechanism.

**Bloom-radius scaling:** the bloom's negative inset extent + filter blur are tuned per host element size:

| Surface | Element size | Bloom inset / blur (approx.) |
|---|---|---|
| GameLog avatar (PlayerPortrait `size="small"`) | 32px | bloom suppressed via `haloVariant="none"` |
| CommanderDamage cell (PlayerPortrait `size="small"`) | 32px | bloom suppressed via `haloVariant="none"` |
| Opponent pod (PlayerPortrait `size="medium"`) | 80px | inset -8px / blur 7px |
| Local pod (PlayerPortrait `size="large"`) | 96px | inset -11px / blur 9px |
| Focal stack card | 170×238 | inset -8px / blur 10px |

**Helpers (post slice 70-Z polish):**
- `computeHaloBackground(colorIdentity, eliminated)` — returns the inner ring/band CSS background; consumed by BOTH ring + bloom layers (the bloom is a blurred copy of this gradient).
- `manaTokenForCode(code)` — single-character mana code → solid color CSS variable.

**Current surfaces:**
- `PlayerPortrait` CircularHalo — wraps bloom + ring divs in a shared parent that owns the animation classes (`animate-halo-rotate`, `animate-player-active-halo`). Both children consume the parent's animated `--halo-angle` via cascade. Wrapper has `isolation: isolate` so the bloom's `z-index: -1` is contained.
- `StackZone` FocalCard — single halo div with `background: <conic-gradient>` + `filter: blur(10px)` + `animate-stack-glow-pulse` (opacity) + `animate-halo-rotate` (multicolor). Sits at `-inset-2` extending past the focal CardFace edges.

New halo surfaces that ship later (e.g. CommanderDamage threshold cell, focal triggered ability tile) MUST follow this two-layer recipe (or single blurred layer for static halos). Do not invent per-surface glow logic; do not reintroduce box-shadow as the radiation mechanism — it can't rotate.

---

## Color & motion impressions (from picture)

### Palette anchors

- **Battlefield background:** `--color-bg-base` #0E1A20 (existing)
- **Side panel background:** `--color-bg-elevated` #152229 (existing)
- **Body text:** `--color-text-primary` #E8EDF0 (existing)
- **Secondary text:** `--color-text-secondary` #9BA8B0 (existing)
- **Purple accent (header + ActionButton):** `--color-accent-primary` #8B5CF6 (existing)
- **Card-name highlight in log:** `--color-accent-primary` family or `--color-mana-blue` light variant — pick at implementation
- **Halo glows:** `--color-mana-{color}-glow` tokens (existing, all 6 colors + multicolor)

### Motion anchors

All already shipped (slice 70-A through 70-H.5):
- `animate-halo-rotate` (12s/rev for multicolor)
- `animate-player-active-halo` (1.9s pulse)
- `stack-glow-pulse` (1.5s focal-card pulse)
- `card-hover-lift` (150ms hand interaction)
- `LIFE_FLASH_POP` (life-tick flash)
- `DELTA_FLOAT_UP` (floating ±N number)
- `PRIORITY_TAG_FADE` (priority pill in/out)
- `ELIMINATION_SLASH` (slash overlay)
- `LAYOUT_GLIDE` (cross-zone card movement via layoutId)
- `particle-drift` (ambient backdrop)

### What feels "MTGA-grade"

The picture's polish comes from:
1. **Every glowing element is a soft halo, not a hard ring.** Box-shadows with feathered edges (large blur radius, low alpha) — not crisp 1px borders.
2. **Card art is the dominant element** in every pod. Player frames are about the COMMANDER, not about labels.
3. **Empty space is intentional.** The center focal zone is mostly empty when the stack is empty (just the particle drift).
4. **Type hierarchy is restrained.** Most labels are caption-sized; only the life numerals and the focal card are feature-sized.
5. **No bevels, no chrome, no skeuomorphism.** Flat surfaces with glow accents.

These are tuning targets for the slice 70-Z polish pass — measure each shipped slice against these qualitative anchors.

---

## Implementation cross-reference

| Element in picture | Slice that lands it | Token / component dependency |
|---|---|---|
| Card-size tokens | 70-I | `--card-size-{micro,small,medium,large,focal}` |
| Circular commander portrait | 70-J | New `<PlayerPortrait>` |
| Portrait halo (circular geometry) | 70-J | Reuse mask-composite from current HaloRing |
| New PlayerFrame anatomy | 70-K | Depends on 70-J |
| Game log avatars | 70-L | Reuse PlayerPortrait at 32px |
| Commander damage 2×2 | 70-L | Reuse PlayerPortrait at 32-40px |
| ActionButton single morphing | 70-M | New `<ActionButton>` component |
| Side panel reorder + ActionButton placement | 70-M | Depends on 70-K, drops `[grid-area:action]` |
| Focal stack at 170×238 (dominant) | 70-N | Depends on 70-I (`--card-size-focal`) |
| Combat-mode arrows in focal | 70-N | Reuse `<TargetingArrow>` |
| Header purple all-caps + icons | 70-O | New header component |
| Drop the gameId / connection / leave from header | 70-O | Cleanup |
| Mana pool floats top-right of hand | 70-P | Reuse ManaPool, relocate |
| Polish sweep (glow tuning, spacing) | 70-Z | Token tuning, no new components |

---

## Sign-off rule

For every slice in this push, the slice's "definition of done" must include:

1. **Local dev server screenshot of the affected region** at standard 1920×1080 resolution.
2. **Side-by-side comparison** with the catalog entry for the corresponding region.
3. **Vercel preview URL** for the user to sign off on before the next slice begins.

Without these, a slice doesn't ship — even if tests pass and lint is clean. The whole point of this catalog is to prevent the slice 70-A→70-G pattern of shipping infrastructure without verifying the assembled view.
