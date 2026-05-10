# Bundle 4 — Combat Role Markers, scope brief

> **Branch:** `feat/combat-bundle-4-role-markers` (to be created at slice 4-A start)
> **Status:** scope-locked, ready to slice
> **Source:** Bundle 4 of the combat-phase brainstorm ([`docs/design/combat-phase-brainstorm-bundles.md`](combat-phase-brainstorm-bundles.md))
> **Pain axis addressed:** participant legibility — "even with arrows visible, when there are 8 creatures on the field I lose track of which ones are participating in combat at all."

## Goal

Make per-creature combat role legible at a glance. Today the only per-creature combat signal on the battlefield is a small ATK / BLK text badge inside `<CardFace>` (added in earlier work) — the rest of the role information lives in the arrows alone. On a Commander board with 8 creatures across 4 pods and a stack-busy central area (where arrows can be hidden by the central-cell mutex), there is no way to scan "who is in combat at all." Bundle 4 layers tile-corner brackets onto every combat participant, gives them a per-role colored inner ring + a commander-color outer ring, retunes the existing eligibility ring as a learnable "you can click these" cue, and adds a low-detail fallback for crowded boards so the markers don't become noise.

This is the third combat bundle to ship after Bundles 3 (Dashboard) and 1 (Defender Lanes). Picked next because it has **no central-area mutex gate** (unlike 5 and 6), needs no architectural prep slice (unlike 2's combat-mode coordinator), and reuses Bundle 1's commander-color helpers + alpha-reduced glow tokens with zero new wire shape.

## Scope lock

### In scope

- Four sub-features, sliced into four shippable units:
  1. **Corner brackets on attackers and blockers** — small L-shaped SVG brackets pinned to the four corners of every battlefield creature with a non-undefined `combatRole`. Warm orange for attackers, cool blue for blockers.
  2. **Combat-role inner ring + commander-color outer ring** — a thin per-role colored ring drawn on the inside edge of the card tile, plus a thicker outer ring keyed to the controller's `colorIdentity`. The inner ring tells you "what is this thing doing in combat"; the outer ring tells you "whose creature is it." Pod ownership and combat role never compete for the same pixel.
  3. **Eligibility shimmer retune** — the existing static `ring-2 ring-amber-400/60` (already on `<CardFace>` when `isEligibleCombat=true`) gets a slow ~1.5s sine-wave alpha pulse during DECLARE_ATTACKERS / DECLARE_BLOCKERS, gated on `prefers-reduced-motion`. Pure wayfinding — "these are the things you can click right now" — the static ring stays as the source-of-truth for reduced-motion users.
  4. **Crowded-board LOD fallback** — when a card's measured tile width is below a threshold (≈ 88 px), corner brackets and rings collapse to a single upright `A` / `B` sigil overlay so the markers don't visually swamp the cardart. Threshold is `width-only` to match T1's "cards adapt by shrink → stack → scroll" rule.
- Tabletop variant as the primary target (4-pod 1440p target). The `current` variant inherits any role-marker rendering that flows through the shared `<TabletopCardButton>` / `<CardFace>` path; no dedicated polish pass for `current`.
- `prefers-reduced-motion` respected on the eligibility shimmer (instant-static fallback) and on any future polish that adds motion to the rings.
- WCAG 2.1 SC 1.4.1 (use of color) — combat role is paired with a non-color signal: the corner brackets' shape itself (warm L-corners point inward; cool L-corners point inward but with a 1 px stem extension) plus the LOD `A` / `B` sigil for small tiles.

### Out of scope

- **Damage parcels traveling along arrows / portrait bloom on damage / freeze-frame on resolution.** Bundle 5 territory.
- **Pen-stroke arrow draw-in.** Bundle 6 territory.
- **Vignette / staging atmosphere around the central focal area.** Bundle 2 territory.
- **Banner content, phase strip, runway dots.** Bundle 3 territory (already shipped).
- **Defender-derived arrow color / incoming-tag / wave-reveal / defender beams.** Bundle 1 territory (already shipped).
- **Wire-format changes.** `combatRoles` is already derived in [`webclient/src/game/Battlefield.tsx:87-98`](../../webclient/src/game/Battlefield.tsx#L87) from `gv.combat`; `eligibleCombatIds` already threaded from `interactionMode.ts:182-187`.
- **Decision support / damage previews / "would this kill it?" overlays.** Brainstorm-wide exclusion from the user.
- **Per-creature halo on the `current` (asymmetric-T) variant.** Slice 4-B's outer ring is tabletop-only; legacy variant stays as-is. Cheap to extend later if the legacy variant survives long enough to want it.

---

## Wire-format readiness (recon result)

All four sub-features read existing fields. **No `schemaVersion` bump.** Per T5: no engine code, no wire change.

| Sub-feature | Source | File:line |
|---|---|---|
| Per-creature combat role (attacker / blocker) | Derived from `WebGameView.combat` into `Map<id, 'attacker' \| 'blocker'>` at battlefield init | [`webclient/src/game/Battlefield.tsx:87-98`](../../webclient/src/game/Battlefield.tsx#L87) |
| Already-threaded `combatRole` prop on the per-creature button | `<TabletopCardButton data-combat-role={role}>` carries it; `<CardFace combatRole>` already consumes it for the existing ATK/BLK text badge | [`webclient/src/game/tabletopBucketStacking.tsx:104`](../../webclient/src/game/tabletopBucketStacking.tsx#L104), [`webclient/src/game/CardFace.tsx:287`](../../webclient/src/game/CardFace.tsx#L287) |
| Controller's `colorIdentity` (outer-ring derivation, slice 4-B) | `WebPlayerView.colorIdentity` keyed by `WebPermanentView.controllerId` | [`webclient/src/api/schemas.ts:728`](../../webclient/src/api/schemas.ts#L728), [`webclient/src/api/schemas.ts:638`](../../webclient/src/api/schemas.ts#L638) |
| Eligible-to-pick set | `interactionMode.possibleIds` derived from `possibleAttackers[]` / `possibleBlockers[]` on the active wire message | [`webclient/src/game/interactionMode.ts:182-187`](../../webclient/src/game/interactionMode.ts#L182) |
| Already-threaded eligibility flag on the per-creature button | `<TabletopCardButton data-combat-eligible>`; `<CardFace isEligibleCombat>` already paints the static amber ring | [`webclient/src/game/tabletopBucketStacking.tsx:106`](../../webclient/src/game/tabletopBucketStacking.tsx#L106), [`webclient/src/game/CardFace.tsx:319`](../../webclient/src/game/CardFace.tsx#L319) |

**Outer-ring color derivation:** new pure helper `controllerOuterRingBackground(colorIdentity, fallback) → string` lives next to `arrowStrokeForColorIdentity` in `halo.ts`. Single-color → `manaGlowTokenForCode` (alpha-reduced family — same as Bundle 1's defender beams, so creature halos compound minimally against tabletop's per-pod zone glow). Multi-color → `conic-gradient` with hard-edged stops mirroring `computeTabletopZoneBackground`. Empty `colorIdentity` (colorless commander) → `var(--color-team-neutral)`.

**Inner-ring color tokens (new):** `--color-attacker` / `--color-blocker` added to `tokens.css`. Token names match the brainstorm's "warm orange / cool blue" semantics. Used by both the corner brackets (4-A) and the inner ring (4-B); single source so a future palette retune is one edit.

---

## Slice breakdown

### Slice 4-A — Corner brackets on attackers and blockers

**Tier:** Standard (new visual surface on every battlefield creature; no wire change, no race surface).

**Critic matrix:** Builder + Technical critic + UI critic.
- UX deferred to 4-C (eligibility ring is the bundle's interaction surface).
- Graphical N/A — slice ships static SVG, no animation.

**Files touched:**
- `webclient/src/game/RoleMarkers.tsx` — new file (~80 LOC). Pure-function-component over `combatRole` prop; renders 4 absolutely-positioned `<svg>` corner brackets when role is defined, else returns null.
- `webclient/src/game/tabletopBucketStacking.tsx` — modify (`+5` LOC). Mount `<RoleMarkers combatRole={...} />` as a sibling of `<CardFace>` inside the `<TabletopCardButton>` wrapper. CardFace's existing ATK/BLK text badge stays for now (slice 4-D LOD fallback re-uses the same `A` / `B` sigil concept — coordination point).
- `webclient/src/styles/tokens.css` — extend (`+4` LOC). Add `--color-attacker` (warm orange) and `--color-blocker` (cool blue) tokens.
- `webclient/src/game/RoleMarkers.test.tsx` — new file. 5+ tests: renders 4 brackets when role=attacker, 4 brackets when role=blocker, returns null when role=undefined, attacker uses `var(--color-attacker)` token, blocker uses `var(--color-blocker)` token.

**Intent:** Make every combat participant scannable in one pass at full tile size. Corner brackets are the cheapest unambiguous marker — they don't compete with cardart for the inner area, they read at a glance, and they pair color (warm / cool) with shape (the bracket geometry itself differs subtly between attacker and blocker — see design points).

**Key design points:**
- Brackets sit OUTSIDE the cardart bounds (negative inset of ~3 px) so they read as a frame around the tile, not as a stamp on top of it. T3 (full Scryfall art) is preserved — no pixels covered.
- Per-role shape redundancy: attackers get a sharp 90° L-corner; blockers get the same L-corner plus a 4 px 45° inward diagonal stub from the L's vertex. (Original brief said "1 px perpendicular stem"; ratified up to 4 px diagonal in slice 4-A's UI-critic pass — at `strokeWidth=2` a 1 px perpendicular stub would be subsumed by the leg's stroke and produce no readable shape difference.) WCAG 1.4.1 redundant-signal claim: a deuteranopia-simulator screenshot of a mixed attacker+blocker board still distinguishes the two via shape alone.
- Pure SVG inside an absolutely-positioned `<div>` overlay — no CSS keyframes, no per-creature React state. Re-renders only when `combatRole` changes.
- Footprint preservation (T1): `<RoleMarkers>` is `position: absolute; pointer-events: none`. The button's bounding box is unchanged.

**Tests (countable per ADR 0014 D2):**
- `[data-testid="role-markers"]` is absent when `combatRole === undefined`; present with `data-role="attacker"` when role=attacker; present with `data-role="blocker"` when role=blocker.
- `<svg>` renders exactly 4 children (top-left, top-right, bottom-left, bottom-right).
- Bracket stroke uses `var(--color-attacker)` (assert via inline style/computed value) when role=attacker; uses `var(--color-blocker)` when role=blocker.
- Mount inside `<TabletopCardButton>` does not change the button's bounding box (compare `getBoundingClientRect()` before/after toggling combatRole on a fixture).

**Acceptance:** On the 3-attacker fixture (`?game=fixture&variant=tabletop&combat=1`), every attacker creature has 4 warm-orange corner brackets; the blocked-attacker fixture's blocker has 4 cool-blue corner brackets; non-combat creatures have none. Switching pods does not move or duplicate brackets.

### Slice 4-B — Combat-role inner ring + commander-color outer ring

**Tier:** Standard (introduces a new per-creature visual primitive — the commander-color outer halo — that the brainstorm wrongly assumed already existed).

**Critic matrix:** Builder + Technical critic + UI critic.
- UX deferred to 4-C (no new interaction surface here; rings are decorative).
- Graphical (`covered by UI` — single-frame paint, no animation).

**Files touched:**
- `webclient/src/game/RoleMarkers.tsx` — extend (~80 → ~140 LOC). Add inner-ring + outer-ring siblings to the existing 4 brackets.
- `webclient/src/game/halo.ts` — extend (~325 → ~360 LOC). Add `controllerOuterRingBackground(colorIdentity)` helper. Reuses `manaGlowTokenForCode` family so creature halos sit in the same alpha-reduced family as Bundle 1's defender beams — no cross-bundle saturation collision.
- `webclient/src/game/PlayerArea.tsx` / `webclient/src/game/TabletopBuckets.tsx` / `webclient/src/game/tabletopBucketStacking.tsx` — thread `controllerColorIdentity?: readonly string[]` from the `players` array down to `<TabletopCardButton>` (resolved via `permanent.controllerId` lookup at the `<PlayerArea>` boundary). ~3 prop additions, ~10 LOC total.
- `webclient/src/game/halo.test.ts` — extend. New test cases for `controllerOuterRingBackground` (mono-color → glow token; multi → conic-gradient; colorless → team-neutral; unknown code → team-neutral).
- `webclient/src/game/RoleMarkers.test.tsx` — extend. Inner-ring + outer-ring presence and color assertions.

**Intent:** Anchor combat-role color (inner) and pod-ownership color (outer) on the same DOM element so a viewer reads role + ownership in one glance. The brainstorm framed this as the bundle's signature change; the recon revealed the outer halo doesn't exist on creatures yet, so this slice introduces it for the first time as a tabletop-only primitive.

**Key design points:**
- Inner ring: 1.5 px solid `var(--color-attacker)` / `var(--color-blocker)`, drawn as a `box-shadow: inset 0 0 0 1.5px <token>` on a sibling div sized to match the cardart bounds. Inset means it reads as part of the cardart frame, not as a separate ring outside.
- Outer ring: 2.5 px halo derived from `controllerColorIdentity`, painted as a sibling `<div>` with `background: <halo-bg>` and a `border-radius` matching the cardart corner radius. Uses the same alpha-reduced glow tokens as Bundle 1's defender beams — three layered creature halos at the central focal area worst case yield ~0.18 effective alpha (well under WCAG 1.4.11 floor for the underlying art).
- Outer ring is **suppressed** when `combatRole === undefined`. Non-participants get zero new chrome — the bundle's brief said "everyone else is unmarked." This avoids the entire battlefield lighting up under our own commander color, which would be visual noise.
- T1 footprint preservation: both rings are `pointer-events: none` overlays that share the cardart's bounding box. The button does not grow or shrink.
- T3 art preservation: rings live on the cardart's border, not on its surface. Cardart pixels are not occluded.

**Tests:**
- Inner-ring sibling `[data-testid="role-inner-ring"]` is present iff `combatRole` is defined.
- Outer-ring sibling `[data-testid="role-outer-ring"]` is present iff `combatRole` is defined.
- Outer-ring `background` substring contains the controller's commander-color glow token (`var(--color-mana-green-glow)` for a mono-G controller).
- `controllerOuterRingBackground(['W','U','B','R','G'])` returns a 5-arc `conic-gradient` with 72° bands.
- `controllerOuterRingBackground([])` returns `var(--color-team-neutral)` (colorless commander).

**Acceptance:** On the 3-attacker fixture, mono-green attacker shows green outer ring + warm-orange inner ring; B/R multicolor attacker shows banded conic outer + warm-orange inner; mono-R blocked attacker shows red outer + warm-orange inner; the assigned blocker shows red outer + cool-blue inner. Non-combat creatures retain zero rings.

### Slice 4-C — Eligibility shimmer retune

**Tier:** Trivial (single-file CSS keyframe + media-query gate; existing static ring stays as the source of truth).

**Critic matrix:** Builder ONLY (per CLAUDE.md cadence — Trivial tier "applying enhancement to an existing visual + media-query gate is below the threshold for fresh critic dispatch"; Bundle 4's UI + Technical concerns for the marker overlay land in 4-A and 4-B).

**Files touched:**
- `webclient/src/game/CardFace.tsx` — modify (`+1-2` LOC). Apply a new utility class (e.g. `combat-eligibility-pulse`) alongside the existing `ring-2 ring-amber-400/60` when `isEligibleCombat=true`.
- `webclient/src/styles/tokens.css` or `webclient/src/index.css` — add `@keyframes combat-eligibility-pulse` (1.5s sine-wave alpha) + the `combat-eligibility-pulse` utility selector wrapped in `@media (prefers-reduced-motion: no-preference)`. Inside `prefers-reduced-motion: reduce`, the keyframe is unset and the static ring takes over.
- `webclient/src/animation/transitions.ts` — extend. Migrate the new keyframe's duration constant (`COMBAT_ELIGIBILITY_PULSE_MS = 1500`) into the motion-vocabulary registry per the file's "named preset first" convention (matches Bundle 1's slice 1-C precedent).
- `webclient/src/game/CardFace.test.tsx` (or a sibling test if one exists) — extend. Assert: `isEligibleCombat=true` element has the pulse class; `isEligibleCombat=false` does not. Reduced-motion test via the existing matchMedia mock pattern asserts the static ring stays painted with no animation class.

**Intent:** Convert the existing static eligibility ring from "discoverable affordance" to "learnable affordance." The static ring already exists — the pulse makes it the unmistakable click-target during pick phases without changing the wire signal or the static fallback.

**Key design points:**
- The pulse is a slow sine-wave alpha (≈ 0.4 → 0.8 → 0.4 over 1.5s), not a brightness flash or a color shift. Slow enough to read as ambient breathing rather than urgent; fast enough that "this is interactive" registers in under a second.
- Static ring always renders. Pulse class adds the keyframe; if reduced-motion is on, the pulse is suppressed but the static ring remains. This is a strict additive enhancement — no path produces less signal than today.
- WCAG 2.3.3 (Animation from Interactions): the pulse is decorative animation triggered by interaction-state, not flashing — the alpha range never produces flicker. Reduced-motion users see no animation; static ring covers them.

**Tests:**
- Element has `combat-eligibility-pulse` class iff `isEligibleCombat=true`.
- Reduced-motion fixture (matchMedia mock returns `matches: true` for `prefers-reduced-motion: reduce`) leaves the static ring intact and suppresses the pulse animation.
- Migrate `COMBAT_ELIGIBILITY_PULSE_MS` constant to `transitions.ts`; assert via the existing transitions-registry test.

**Acceptance:** During DECLARE_ATTACKERS on the fixture, every legal attacker pulses gently amber; non-eligible creatures sit static. Toggling reduced-motion in DevTools settles the pulse to the existing static ring without removing the visual cue.

### Slice 4-D — Crowded-board LOD fallback

**Tier:** Standard (introduces a measurement + threshold path that didn't exist; touches every battlefield card; resize-aware).

**Critic matrix:** Builder + Technical critic + UI critic.
- UX (`covered by UI` — UI absorbs the threshold-tuning concern + sigil readability).
- Graphical (`no motion` — sigils are static; no transition between LOD modes is animated in this slice).

**Files touched:**
- `webclient/src/game/RoleMarkers.tsx` — extend (~140 → ~180 LOC). Add a `useResizeObserver` (or share the existing pattern from Bundle 1's `DefenderBeams`) that measures the parent button's `getBoundingClientRect().width`. Below threshold → render a single centered `A` / `B` sigil instead of the 4 brackets + 2 rings.
- `webclient/src/game/RoleMarkers.test.tsx` — extend. Tests at 200 px width (full LOD), 60 px width (sigil LOD), and a transition test (resize event flips the rendered output).

**Intent:** Cards in crowded pods or under stack-shrink can drop below the size at which 4 corner brackets + 2 rings read as "marker" rather than "noise." The brainstorm anticipates this risk explicitly. The LOD fallback keeps the role signal alive (the `A` / `B` sigil) while removing the corner brackets and rings that would crowd a thumbnail-sized tile.

**Key design points:**
- Threshold: tile width < `LOD_FALLBACK_WIDTH_PX = 88`. Empirically tuned in 4-D's UI-critic pass against the existing fixture's "stack" mode (10% peek). Adjust during fixer if the live cutoff disagrees.
- Sigil styling: bold serif `A` / `B` (or whatever 4-A's UI critic ratifies) inside a small filled circle keyed to the role color. Sits in the top-right corner of the tile so it doesn't fight for the cardart center.
- Resize-aware via `ResizeObserver`. Capture-at-mount with viewport resize listener follows Bundle 1's `DefenderBeams` precedent.
- T1 footprint preservation: sigil is also `position: absolute; pointer-events: none`.

**Tests:**
- Mount with stub `getBoundingClientRect().width = 200` → renders 4 brackets + 2 rings, no sigil.
- Mount with stub `getBoundingClientRect().width = 60` → renders 0 brackets + 0 rings + 1 sigil.
- Resize listener fires on window resize event; output flips correctly.
- `LOD_FALLBACK_WIDTH_PX` exported as a constant so future bundles can read it (Bundle 5's damage parcel may need to know whether the tile is in LOD mode to decide where to land the parcel).

**Acceptance:** Visiting the crowded-pod fixture (open question #2 below — fixture extension may be needed) shows sigils replacing brackets+rings on cards below threshold. Resizing the browser to drop pod cards below threshold transitions cleanly without flashing the wrong LOD for one frame.

---

## Cross-slice considerations

### Renderer cohesion across the bundle

Slice 4-A introduces `<RoleMarkers>` as a sibling overlay; 4-B extends it with the rings; 4-C is independent (lives on `<CardFace>` itself, not in `<RoleMarkers>`); 4-D wraps 4-A/4-B in an LOD threshold check. There is no "rebuild the marker twice" risk — the four slices layer cleanly and 4-C's surface is genuinely orthogonal (different file, different prop).

### Open decision deferred: per-creature halo on `current` variant

Slice 4-B's outer ring is tabletop-only because `<TabletopCardButton>` is the mount point; the `current` (asymmetric-T) variant uses a different per-creature button. Adding the outer ring to `current` would mean either threading `controllerColorIdentity` into the legacy button OR duplicating `<RoleMarkers>` mount. Cheap to do, but `current` is the legacy escape hatch (T6) and the bundle's primary value lands on tabletop. Decision deferred — re-open only if user direction prioritizes legacy variant polish.

### Tabletop load-bearing rules (T1–T7) verification

| Rule | Verification |
|---|---|
| **T1** Zones are fixed dimensional anchors | All marker sub-features (4-A brackets, 4-B rings, 4-C pulse class, 4-D sigil) are `position: absolute; pointer-events: none` overlays that share the existing button's bounding box. Tile footprint never changes; cards inside still adapt via shrink → stack → scroll. **Pass.** |
| **T2** Action panel floats; never displaces | No interaction with the floating ActionButton — markers sit on the cards, not in the action panel. **N/A.** |
| **T3** Cards render full Scryfall art | Brackets sit on negative inset (outside cardart). Inner ring is on the cardart border (1.5 px frame, not pixels of the art). Outer ring is outside the cardart. Sigil sits in a corner (small percentage of the cardart); explicit acceptance check in 4-D's UI critic that a 60-px tile's sigil doesn't occlude card type-line readability. **Pass.** |
| **T4** Target viewport 1440p | LOD threshold (4-D) tuned at 1440p; sub-1440p degradation acceptable per T4. **Pass at design time; verify in live-test.** |
| **T5** No engine code, no wire change, no schema bump | All work in `webclient/`. Every wire field already on schema 1.34. **Pass.** |
| **T6** Tabletop is production default | Bundle 4 ships under tabletop default. `current` variant inherits 4-A (corner brackets work in any per-creature button via `<RoleMarkers>` mount), 4-C (eligibility pulse — `<CardFace>` is shared), and 4-D (LOD threshold is shared). 4-B's outer halo is tabletop-only — see deferred decision above. **Pass with one explicit deferral.** |
| **T7** Cross/plus 4-pod arrangement | Markers attach per-creature, not per-pod — geometry is identical for all 4 pod positions. **Pass.** |

### File LOC trajectory

| File | Current | Δ post-bundle | Risk |
|---|---|---|---|
| `RoleMarkers.tsx` (new) | — | ~180 (4-A: 80, 4-B: +60, 4-D: +40) | Comfortable. |
| `RoleMarkers.test.tsx` (new) | — | ~250 | Comfortable. |
| `tabletopBucketStacking.tsx` | 269 | ~280 (4-A: +5, 4-B: +6 prop threading) | Comfortable. |
| `CardFace.tsx` | 646 (already over hard cap, documented exception) | +1-2 (4-C class addition only) | **Don't make it worse.** Bundle 4 explicitly avoids extending CardFace's responsibilities — the role-marker overlay lives in a sibling component. |
| `halo.ts` | ~360 (post-Bundle-1) | ~395 (4-B: +35 for `controllerOuterRingBackground`) | Comfortable. |
| `tokens.css` | (manageable) | +6 (`--color-attacker`, `--color-blocker`, eligibility-pulse keyframe) | Comfortable. |
| `transitions.ts` | (motion-vocabulary registry) | +5 (4-C constant migration) | Comfortable. |
| `PlayerArea.tsx` / `TabletopBuckets.tsx` | (existing) | ~+10 total (4-B prop-threading) | Comfortable. |

### Test fixture coverage

- The existing `?game=fixture&variant=tabletop&combat=1` fixture already places attackers (mono-G goat, multicolor B/R momur, mono-R alloc with assigned blocker) and is sufficient for slices 4-A, 4-B.
- Slice 4-C needs a fixture with `interactionMode = DECLARE_ATTACKERS` AND `possibleAttackers` non-empty. The current fixture parks at `COMBAT_DAMAGE` so the pulse won't surface — extend the fixture with a `?attackers=1` opt-in (or repurpose `?combat=1` to start at DECLARE_ATTACKERS).
- Slice 4-D needs a fixture path that produces sub-88 px tiles. The existing stack-with-10%-peek path probably gets there at 4+ creatures per pod; if not, add a `?dense=1` opt-in that floods one pod with 6+ permanents.

### Accessibility

- **Role paired with shape AND text.** Color (warm/cool) + bracket geometry difference + LOD `A` / `B` sigil + the existing ATK/BLK text badge inside `<CardFace>` together provide a quadruple-redundant role signal. WCAG 2.1 SC 1.4.1 — pass.
- **Eligibility pulse honors `prefers-reduced-motion`.** Static ring always paints; pulse keyframe is wrapped in `@media (prefers-reduced-motion: no-preference)`.
- **Markers are decorative.** `aria-hidden="true"` on the `<RoleMarkers>` overlay; the wire role is already in the button's `data-combat-role` attribute and the existing CardFace ATK/BLK text badge is the screen-reader-readable surface.
- **No new keyboard surfaces.** Markers don't carry interaction; existing `<TabletopCardButton>` keyboard semantics are unchanged.

---

## Pre-coding breakage analysis (bundle-level)

### Scope lock

This brief covers tile-corner brackets, role + commander-color rings, eligibility-pulse retune, and the LOD fallback for crowded boards. It does NOT touch arrow paths, central-cell mutex, banner content, phase strip, or any wire-format DTO. It explicitly avoids extending `CardFace.tsx` past its current already-over-cap LOC. Anything outside that surface is a follow-up bundle.

### What I'm changing

- New files: `RoleMarkers.tsx` + `RoleMarkers.test.tsx`.
- Modify: `tabletopBucketStacking.tsx` (mount + prop), `halo.ts` (helper), `tokens.css` (3 tokens + keyframe), `transitions.ts` (constant), `CardFace.tsx` (single class addition for 4-C only).
- Prop threading: `PlayerArea.tsx` / `TabletopBuckets.tsx` for `controllerColorIdentity`.

### What could break

- **Cardart border-radius mismatch with the outer-ring halo.** If `<CardFace>`'s rounding ≠ the halo's `border-radius`, the halo will visibly clip on the corners. Slice 4-B's UI-critic pass MUST verify this with a measurement. Mitigation: the halo `<div>` reads `--card-radius` from a CSS variable matching CardFace's inner radius rather than hard-coding a px value.
- **Three layered creature halos at the central focal cell** (when 3 attackers all converge on the user's bottom pod) compound saturation against the pod's already-tinted zone background. Slice 4-B reuses `manaGlowTokenForCode` (alpha 0.5 family) — same precaution as Bundle 1's defender beams. Worst case 3-stack at 0.5 each = 0.75 effective if all green, well within WCAG 1.4.11 for cardart underneath.
- **Resize listener leak in slice 4-D.** Every battlefield creature mounts a `ResizeObserver`. On a crowded board (10+ creatures per pod × 4 pods = 40+ observers) this is fine, but the cleanup discipline must be tight — observer disconnected on unmount; Bundle 1's `DefenderBeams` precedent shows the working pattern.
- **`prefers-reduced-motion` regression in 4-C.** If the keyframe selector is misplaced outside the media query, reduced-motion users will see the pulse — same shape as Bundle 1's slice 1-C reduced-motion concern. Mitigated by the existing `transitions.reducedMotion.test.tsx` mock pattern.
- **`CardFace.tsx` LOC creep.** The slice plan adds ≤ 2 LOC to CardFace (a single class addition for 4-C). Builder must NOT add a sub-component or helper inside CardFace — that file is already over hard cap and the bundle's stated discipline is to KEEP IT THERE.
- **`controllerColorIdentity` lookup on partner-pairings or commander-changed states.** Some Commander variants (Partner, Background) use multiple commanders per player; `colorIdentity` aggregates them already (the wire pre-aggregates), so no special handling needed at the marker level.

### Edge cases

- **Creature with no controller** (engine impossible, but defensive) — `controllerOuterRingBackground([])` returns `var(--color-team-neutral)`. No crash.
- **Combat role flips mid-frame** (player un-assigns a blocker before pressing Done) — the `combatRoles` map is rebuilt on every game-state tick; `<RoleMarkers>` re-renders with the new role or returns null. No stale marker.
- **Token creatures attacking** (no controller's commander color in the brainstorm sense) — wire still carries `controllerId`; the player's `colorIdentity` flows through. Token gets the same outer ring as the controller's other creatures. Correct.
- **Eligibility set turns over while pulsing** (declare-attackers → declare-blockers tick) — keyframe restarts on the new mount; no jank. Tested in 4-C via fireEvent.
- **Tile width straddles the LOD threshold** during a viewport resize — observer fires once, output flips, no double-render. Tested in 4-D.
- **Reduced-motion user during 4-C's eligibility pulse** — pulse class is no-op under `@media (prefers-reduced-motion: reduce)`; static ring still paints. Tested via matchMedia mock.

### Schema impact

**None.** All fields exist on schema 1.34: `combatRole` derived from `gv.combat`, `controllerColorIdentity` from `gv.players[*].colorIdentity`, eligibility set from `interactionMode.possibleIds`. **No `schemaVersion` bump.**

### Upstream rebase impact

**None.** All changes in `webclient/src/`, which is ours. No upstream-tracked files touched. T5 satisfied.

### Test plan

- Per-slice unit tests as enumerated under each slice. Every acceptance criterion is countable per ADR 0014 D2.
- Regression check: existing `CardFace.test.tsx`, `tabletopBucketStacking.test.tsx`, `PlayerArea.test.tsx`, `Battlefield.test.tsx`, and `halo.test.ts` continue to pass without modification (slices ADD tests; they don't ALTER existing behavior assertions, except where `<RoleMarkers>` mount changes the DOM child count of `<TabletopCardButton>` — and that test is updated to match the new shape).
- Pre-commit gate: `cd webclient && pnpm typecheck && pnpm lint && pnpm test`.
- One manual `?game=fixture&variant=tabletop&combat=1` walk-through per slice to confirm visible behavior matches the spec; one manual fixture-extended walk-through for 4-C (eligibility) and 4-D (LOD).
- After all four slices land, dispatch a bundle-level critic pass (technical + UI + UX + bug-hunter) per Bundles 1 + 3's pattern. Findings produce 4-X.* follow-up slices.

---

## Open questions to resolve before slices land

- **Token names + hex anchors for `--color-attacker` and `--color-blocker`.** Brainstorm says "warm orange" and "cool blue" but doesn't pin a hex. Default suggestion: `--color-attacker = oklch(0.75 0.15 50)` (~ warm amber-orange, distinct from the amber `--color-team-active`); `--color-blocker = oklch(0.70 0.13 230)` (~ cool steel-blue, distinct from `--color-mana-blue`). Decide at 4-A start with a 30-min A/B against the fixture.
- **Bracket geometry redundant-signal for color-blind users.** ~~Default suggestion: attacker = sharp 90° L-corner; blocker = same L with 1 px stem extension.~~ **Resolved in slice 4-A**: attacker = sharp 90° L-corner; blocker = same L + 4 px 45° inward diagonal stub from the vertex. UI critic ratified the 4 px diagonal over the original 1 px perpendicular suggestion (1 px perpendicular at `strokeWidth=2` is invisible — subsumed by the leg's stroke).
- **Fixture extensions for 4-C and 4-D.** `?attackers=1` opt-in to park the fixture at DECLARE_ATTACKERS for the eligibility pulse; `?dense=1` opt-in to flood a pod with 6+ permanents for the LOD threshold test. Decide at 4-C / 4-D start.
- **LOD threshold value (`LOD_FALLBACK_WIDTH_PX`).** Default suggestion: 88 px. Decide in 4-D's UI-critic pass against the actual stack-shrink fixture — may need to adjust if 88 is too aggressive or too lax.
- **Outer ring on the `current` variant.** Deferred decision (see cross-slice section). Re-open only if user direction prioritizes legacy polish.

---

## Sequence + acceptance criteria

| Slice | Ships | Gate to next |
|---|---|---|
| 4-A | Corner brackets on attackers + blockers | 3-attacker fixture renders 4 brackets per combat creature; non-combat creatures unmarked; tile bounding box unchanged (T1) |
| 4-B | Combat-role inner ring + commander-color outer ring | Inner + outer rings render per role; commander-color halo matches controller's `colorIdentity`; cardart border-radius matches halo; saturation collision check passes (3-attacker stack < 0.75 effective alpha) |
| 4-C | Eligibility shimmer retune | DECLARE_ATTACKERS fixture pulses legal attackers; reduced-motion suppresses pulse; static ring intact under both modes |
| 4-D | Crowded-board LOD fallback | Sub-88-px tile renders sigil instead of brackets+rings; resize transitions cleanly; observer cleanup verified |

After 4-D lands, dispatch a bundle-level critic pass (technical + UI + UX + bug-hunter at minimum, per Bundles 1 + 3's pattern). Apply findings as 4-X.* follow-up slices. After 4-X cleanup, Bundle 4 is complete; re-evaluate against the brainstorm's other bundles before opening the next branch.
