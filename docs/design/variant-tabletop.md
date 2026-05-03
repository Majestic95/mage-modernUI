# Variant: `tabletop` — living map

**Status:** scaffold landed (B-0). Per-element implementation slices pending.
**Variant name:** `tabletop` (registered in `webclient/src/layoutVariants.tsx`).
**Reference:** [`commander_board_v2.png`](variant-tabletop/commander_board_v2.png).
**Origin:** comprehensive layout overhaul started 2026-05-03 from the user-supplied `commander_board_v2` reference. Follows the picture-catalog pattern from the slice 70-I → 70-Z redesign.

![commander_board_v2.png](variant-tabletop/commander_board_v2.png)

---

## Load-bearing decisions (read before any tabletop slice lands)

These constraints come from the user's slice-B-0 sign-off and override the matching defaults in the `current` variant:

- **Zones are fixed dimensional anchors; cards inside adapt.** The colored zone containers (and the type-bucket boxes inside each zone) hold a fixed footprint that does NOT shrink/expand based on how full they are. Cards within a zone CAN shrink and/or stack to fit the available space — same spirit as the existing `LAYOUT_BOUNDS` Tier 2 behavior, but scoped per-zone-bucket rather than per-pod. **Vertical scroll within a zone is the last-resort worst-case** — it only kicks in if the cards-shrink-and-stack strategy can't fit the content. The intent: layout shape stays stable across game state changes; only the per-card density adapts.
- **Variant scope is fixture-mode-first.** Tabletop is iterated against `?game=fixture&variant=tabletop`. The production game window keeps rendering `current` until the user signs off on a tabletop graduation cutover.
- **No engine code touched.** All work happens in `webclient/`. Java side and the wire format are untouched. No `schemaVersion` bump.
- **Switcher visible from B-0 onward.** `[ current | tabletop ]` button row appears in the fixture from slice B-0. Tabletop will look incomplete until all element slices ship — that's expected. Side-by-side comparison is the point.

---

## Element index

Sequenced by dependency (matches the implementation order — earlier elements unblock later ones). Status: `todo` / `in-progress` / `done` / `deferred`.

| # | Element | Region in screenshot | Target component(s) | Status | Slice ref |
|---|---|---|---|---|---|
| 1 | **Tokens & color palette** | All zone backgrounds (red / blue / green / purple) | `webclient/src/tokens.css` (new tabletop tokens) | todo | — |
| 2 | **Wooden frame chrome** | Outer ornate border around the whole board | New: `GameTable` variant or wrapping `<TabletopFrame>` | todo | — |
| 3 | **Per-pod colored zones** | Each pod's full background tinted to its commander color | `PlayerArea` / `Battlefield` per-pod wrappers (variant) | todo | — |
| 4 | **Type-bucketed battlefield slots** | Lands / Creatures / Artifacts-Enchantments boxes within each pod | New `battlefieldLayout` strategy + new `BattlefieldRow` variant | todo | — |
| 5 | **Dedicated commander slot** | Top-corner (or zone-corner) box for the commander, separate from creatures | New slot inside the pod variant component | todo | — |
| 6 | **Graveyard / exile prominence** | Visible boxes in opponent pods (not just user) | Existing `ZoneIcon` repositioned per-pod; possibly larger | todo | — |
| 7 | **Central focal zone shrink** | "Stack & Turn" tile is smaller and less ornate than current | `StackZone` variant (`StackZone.tabletop.tsx`) | todo | — |
| 8 | **Phase indicators below focal** | Small icon row below the central tile | Existing `PhaseTimeline` repositioned | todo | — |
| 9 | **Player portrait + life total positioning** | Portrait sits centered above pod for opponents, below pod for user; life total adjacent | `PlayerPortrait` + `PlayerFrame` variant | todo | — |
| 10 | **Hand fan (user)** | User's hand row at the bottom (visible cards) | `MyHand` — likely unchanged from current | todo | — |
| 11 | **Zone-overflow strategy (vertical scroll)** | Each zone gets `overflow-y: auto` when its content exceeds height | Per-zone scroll wrapper inside the pod variant component | todo | — |
| 12 | **Action panel placement** | Not visible in screenshot — TBD | TBD | deferred | — |

---

## Per-element specs

Each element below gets filled in during the walkthrough. Fields per element:

- **Source:** which region of the screenshot
- **Current behavior:** how the `current` variant handles this region (file:line)
- **Tabletop spec:** what the new behavior should be
- **Visual diff vs current:** specific changes (color / size / position / chrome)
- **Structural diff vs current:** component-arrangement changes
- **Implementation tier:** mechanical / standard / architectural
- **Critic tier:** which specialists to run for this slice
- **Acceptance:** what "done" looks like, including a screenshot capture for visual diff

### 1. Tokens & color palette

- **Source:** Every per-pod color (red, blue, green, purple); the tan/cream of the central tile; the dark wood frame.
- **Current behavior:** `tokens.css` defines `--color-mana-{red,green,blue,white,black}` for mana symbol colors and `--color-team-*` for halo team colors. Pod backgrounds in `current` are dark zinc with subtle accents.
- **Tabletop spec:** _TBD — pending walkthrough_
- **Visual diff vs current:** _TBD_
- **Structural diff vs current:** new tokens prefixed `--tabletop-zone-{red,blue,green,purple,neutral}` and `--tabletop-frame-*`. Existing tokens untouched.
- **Implementation tier:** mechanical (CSS only).
- **Critic tier:** UI critic (color contrast / accessibility against in-zone card art).
- **Acceptance:** all tokens defined in `tokens.css`; `?variant=tabletop` shows the colors via a placeholder rule before later slices wire them into components.

### 2. Wooden frame chrome

- **Source:** Outer ornate border around the entire board.
- **Current behavior:** `GameTable.tsx` renders the grid directly with no outer frame chrome.
- **Tabletop spec:** _TBD — pending walkthrough_
- **Open questions:** image asset vs CSS gradient vs SVG? If image: where does the asset live in the repo?
- **Implementation tier:** _TBD pending walkthrough_
- **Critic tier:** UI critic + Graphical critic.

### 3. Per-pod colored zones

- **Source:** Red zone behind Zafara (top), blue behind Zaven (right), green behind Lyrra (left), purple behind Mirren (user, bottom).
- **Current behavior:** `PlayerArea.tsx` wraps each pod with subtle dark accent chrome; the colored halo is on `PlayerPortrait` only.
- **Tabletop spec:** _TBD — pending walkthrough_
- **Open questions:** does the existing color-identity `PlayerPortrait` halo stay, get replaced by the zone background, or layer on top? What's the interaction with multicolor commanders (the existing `computeHaloBackground` conic-gradient)?
- **Implementation tier:** standard.
- **Critic tier:** UI + Graphical.

### 4. Type-bucketed battlefield slots

- **Source:** Within each pod, separate boxes labeled (visually) Lands / Creatures / Artifacts-Enchantments.
- **Current behavior:** `battlefieldLayout.ts` lays out all permanents in rows, with dynamic shrink (`LAYOUT_BOUNDS` Tier 2) when content exceeds height.
- **Tabletop spec:** _TBD — pending walkthrough_
- **Critical departure:** type-bucket boxes are **fixed-size containers**; cards inside them shrink/stack to fit. Vertical scroll per bucket only as last resort. Same spirit as `LAYOUT_BOUNDS` Tier 2 but scoped per-bucket instead of per-pod.
- **Open questions:** what about Planeswalkers, Battles? Do they go into Creatures, Artifacts-Enchantments, or get their own bucket? What about tokens?
- **Implementation tier:** architectural (new layout strategy + new test surface).
- **Critic tier:** Technical + UI + UX (interaction patterns for click/hover when scrolled).

### 5. Dedicated commander slot

- **Source:** Top-corner box per pod showing the commander.
- **Current behavior:** Commander is a permanent on the battlefield like any other; commander zone is a side-panel zone counter.
- **Tabletop spec:** _TBD — pending walkthrough_
- **Open questions:** does the commander always render in this slot when on the battlefield, when in the command zone, or both?
- **Implementation tier:** standard.

### 6. Graveyard / exile prominence

- **Source:** Visible boxes in each pod for graveyard and exile.
- **Current behavior:** `ZoneIcon` chips in side-panel zone-counter cluster; opponent zones reachable via click-to-open browser.
- **Tabletop spec:** _TBD — pending walkthrough_

### 7. Central focal zone shrink

- **Source:** Small tan "Stack & Turn" tile in the center.
- **Current behavior:** `StackZone.tsx` renders a 128px focal card with halo, fan tiles, spotlight ring (slice 70-N+).
- **Tabletop spec:** _TBD — pending walkthrough_
- **Open questions:** keep the focal card geometry, just smaller? Or replace entirely with a turn/stack info tile (text-only)?

### 8. Phase indicators below focal

- **Source:** Small icon row below the central tile.
- **Current behavior:** `PhaseTimeline.tsx` lives elsewhere in the layout (header strip / side panel depending on slice).
- **Tabletop spec:** _TBD — pending walkthrough_

### 9. Player portrait + life total positioning per pod

- **Source:** Portrait centered on the outer edge of each pod (above for top, on the sides for left/right, below for user); life total chip near it.
- **Current behavior:** `PlayerPortrait` + `PlayerFrame` arranged via grid-area in `GameTable.tsx`.
- **Tabletop spec:** _TBD — pending walkthrough_

### 10. Hand fan (user)

- **Source:** Bottom-most row in the user's pod (purple zone).
- **Current behavior:** `MyHand.tsx` renders a fan of cards.
- **Tabletop spec:** _TBD — pending walkthrough_

### 11. Zone-overflow strategy (cards adapt, zones don't)

- **Source:** Implied — when a player has more permanents than fit, the zone footprint stays the same and the cards inside adapt.
- **Current behavior:** `LAYOUT_BOUNDS` Tier 2 shrinks `--card-size-medium` per pod (whole pod scales).
- **Tabletop spec:** Three-stage adaptation strategy, scoped per type-bucket inside a fixed-size zone:
  1. **Shrink cards** — reduce card size within the bucket (analogous to current's `--card-size-medium` scaling but per-bucket).
  2. **Stack cards** — overlap cards inside the bucket if shrink alone doesn't fit (e.g., fan-style stacking with the top card fully visible).
  3. **Vertical scroll** — last-resort `overflow-y: auto` on the bucket if shrink + stack still don't fit.
- **Critical:** **zones themselves never shrink/expand.** Layout shape is stable across game state.
- **Implementation tier:** standard (per-bucket CSS scaling logic + scroll fallback).
- **Critic tier:** UI critic + UX (interaction patterns when scrolled — click/hover targets must still work).

### 12. Action panel placement (deferred)

The screenshot does not show an action panel (`Next Phase`, `Concede`, etc.). Open question: hidden behind a SettingsModal-style menu, or moved to a corner of the central tile, or replaced by hover/right-click affordances? Deferred until a walkthrough decision lands.

---

## Walkthrough cadence

We walk through one element at a time. For each:

1. I open the relevant source files and current-behavior `file:line` citations.
2. You describe the target — what the screenshot shows, how it should differ from current, what's important.
3. I ask clarifying questions if any.
4. I write the spec into the section above.
5. We move to the next element.

After all element specs are filled in, we begin the implementation slices in dependency order (1 → 2 → 3 → ...).

---

## Open questions for the user (pre-walkthrough)

A few things I'd like answered before we start element-by-element so I can prep accordingly:

1. **Wooden frame asset:** is this a literal image asset you'll provide, a CSS-gradient simulation, or schematic ornamentation we design from scratch? If a real image, what's the source / licensing?
2. **Zone color semantics:** are the per-pod colors driven by the player's commander color identity (multicolor commanders → blended)? Or are they assigned in a fixed cycle (top=red, right=blue, etc., regardless of who's playing what)? The screenshot looks fixed-cycle but commander-driven would feel more thematic.
3. **Card art:** in the screenshot, the cards within zones look like featureless rectangles. Is this just lo-res rendering, or do tabletop variants intentionally hide card art for opponents (showing only colored placeholders)?
4. **Action panel:** where does it go? (Question 12 above.)
5. **Phase timeline:** keep current's phase indicators verbatim, or replace with something simpler in the icon row?

We'll cover these as part of the walkthrough; flagging here so you know they're coming.

---

## Critic-pass-log + commit references

| Slice | Commit | Element(s) | Critics |
|---|---|---|---|
| B-0 | _pending_ | Scaffold (asset + doc + registry) | builder only (mechanical tier) |
