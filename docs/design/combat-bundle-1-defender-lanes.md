# Bundle 1 — Defender Lanes, scope brief

> **Branch:** `feat/combat-bundle-1-defender-lanes`
> **Status:** scope-locked, ready to slice
> **Source:** Bundle 1 of the combat-phase brainstorm ([`docs/design/combat-phase-brainstorm-bundles.md`](combat-phase-brainstorm-bundles.md))
> **Pain axes addressed:** readability (primary — "where is this attack going?"), phase awareness (secondary — beams reinforce active-defender pressure)

## Goal

Make defender identity legible at a glance during combat. Today every combat arrow is `var(--color-targeting-arrow)` (a single neutral teal); a 4p Commander board with 8 attackers across 3 defenders reads as "8 teal lines pointing somewhere." Bundle 1 routes each arrow's color through the *defending player's* commander identity, lays soft viewport-fixed colored beams from the central focal area toward each defender being attacked, adds a per-portrait "incoming N — M unblocked" tag, and sequences arrow reveal defender-by-defender so the eye does one calm sweep instead of parsing a chaotic instant.

This is the second of six bundles. The brainstorm's cost-per-improvement guidance puts it directly after Bundle 3 (Dashboard, shipped) — biggest 4p readability win, sets up the visual vocabulary Bundles 5 and 6 build on top of.

## Scope lock

### In scope

- Four sub-features, sliced into four shippable units:
  1. **Per-arrow defender color + per-defender dash pattern** — replace the hard-coded neutral arrow stroke with a defender-derived color (single → solid token; multi → SVG `<linearGradient>` stroke) and pair color with a dash pattern that varies per defender, so color-blind users still get a redundant signal.
  2. **Incoming-tag portrait overlay** — small "incoming N — M unblocked" badge mounted inside each opponent's portrait wrapper when the player is an active defender; click-to-pin extends the existing hover-isolation to a sticky filter for that defender's arrows.
  3. **Wave-reveal stagger** — group arrows by `defenderId` and reveal each defender's arrow set ~90 ms after the previous, so the user reads "this defender, then this one, then this one" rather than seeing all arrows pop in at once.
  4. **Defender beams overlay** — new `position: fixed` viewport overlay rendering low-opacity color washes radiating from the central focal area toward each defender being attacked. Idle pods stay neutral.
- Tabletop variant as the primary target. The `current` variant inherits whatever is compatible (color + dash pattern flow through the same renderer) without a dedicated polish pass.
- `prefers-reduced-motion` respected on every new animation (instant state swap fallback for the wave reveal; static beams instead of pulsing).
- WCAG 2.1 SC 1.4.1 (use of color) — color is paired with a non-color signal (dash pattern) on every state cue.

### Out of scope

- **Pen-stroke arrow draw-in or first-strike-vs-regular palette shift.** Bundle 6 territory. Slice 1-A's color routing makes Bundle 6's eventual palette layer easier; the arrow-trio renderer-redesign question (open decision #4 in the handoff) is deferred until the user commits to >1 of {1, 5, 6}.
- **Pulses/parcels traveling along arrows during damage.** Bundle 5 territory.
- **Creature-tile chrome** (corner brackets, dual-rings, eligibility shimmer). Bundle 4 territory.
- **Staging atmosphere** (vignette, central frame, scene-change cross-fades). Bundle 2 territory.
- **Wire-format changes.** `WebPlayerView.colorIdentity` (schema 1.28) and `WebCombatGroupView.defenderId` already carry everything needed.
- **Decision support / damage previews.** Brainstorm-wide exclusion from the user.

---

## Wire-format readiness (recon result)

All four sub-features read existing fields. **No `schemaVersion` bump.**

| Sub-feature | Source field | File:line |
|---|---|---|
| Defender's commander color identity | `WebPlayerView.colorIdentity` (`W`/`U`/`B`/`R`/`G` array) | [`webclient/src/api/schemas.ts:728`](../../webclient/src/api/schemas.ts#L728) |
| Defender player resolution | `WebCombatGroupView.defenderId` | [`webclient/src/api/schemas.ts:658`](../../webclient/src/api/schemas.ts#L658) |
| Players list (defender lookup) | `WebGameView.players` | [`webclient/src/api/schemas.ts`](../../webclient/src/api/schemas.ts) |
| Combat groups (incoming counts, wave grouping) | `WebGameView.combat` | [`webclient/src/api/schemas.ts:799`](../../webclient/src/api/schemas.ts#L799) |
| Local player id (own-portrait suppression of incoming tag) | `WebPlayerView.id` of the seat tagged `youAreHere` | existing pattern |

**Defender-color derivation:** new pure helper `defenderColorIdentity(defenderId, players) → readonly string[]` lives in `halo.ts` alongside the existing `manaTokenForCode` family. Returns `[]` for unknown defenderIds (fail-safe; arrow falls back to the neutral `var(--color-targeting-arrow)` token, same as today).

**Stroke spec:** new pure helper `arrowStrokeForColorIdentity(colorIdentity) → { kind: 'solid'; color: string } | { kind: 'gradient'; stops: readonly { offset: number; color: string }[] }` keeps the SVG concerns in `TargetingArrow` and the token concerns in `halo.ts`. Single-color → `{ kind: 'solid' }` with the existing `manaTokenForCode` reference; multi-color → `{ kind: 'gradient' }` with hard-edged stops (mirroring `computeHaloBackground`'s banded-not-blended choice). Empty identity → solid neutral.

---

## Slice breakdown

### Slice 1-A — Per-arrow defender color + per-defender dash pattern

**Tier:** Standard (single-surface renderer change, no wire change, no race surface).
**Critic matrix:** technical + UI.
**Files touched:**
- `webclient/src/game/halo.ts` — extend (add `defenderColorIdentity` + `arrowStrokeForColorIdentity` helpers).
- `webclient/src/game/halo.test.ts` — extend (helper coverage).
- `webclient/src/game/CombatArrows.tsx` — modify (`ArrowSpec.color` becomes a `StrokeSpec`; pull defender colorIdentity via the players prop / hook; assign per-defender dash pattern).
- `webclient/src/game/CombatArrows.test.tsx` — extend (per-defender stroke + dash assertions).
- `webclient/src/game/TargetingArrow.tsx` — modify (accept `StrokeSpec`; emit per-arrow `<defs><linearGradient>` for multicolor; honor `strokeDasharray` prop).
- `webclient/src/game/TargetingArrow.test.tsx` — extend (gradient + dash render).

**Intent:** the arrow connecting attacker → defender (or attacker → blocker, when blocked) takes its stroke color from the defender's commander identity. A 4p Commander board with three opponents shows arrows in three distinct color families. Defenders also get a pre-assigned dash pattern (one of `solid` / `dashed` / `dotted` / `double-stroke`) so color-blind users get an additional signal.

**Key design points:**

- **Defender → color resolution** lives in a new pure helper `defenderColorIdentity(defenderId, players)`; CombatArrows calls it once per arrow at geometry time, threads the resulting `StrokeSpec` through `ArrowSpec`. Players are read from the existing game-view subscription that CombatArrows' parent already passes (no new wire concern).
- **Multicolor → SVG `<linearGradient>` along the arrow path** with hard-edged stops (banded, not blended) so a Sultai opponent reads as "blue → black → green" along the arrow rather than smudged teal-purple. Each `<TargetingArrow>` already mounts its own `<svg>` (one per arrow), so each can carry its own `<defs><linearGradient id="arrow-grad-{key}">`. Gradient orientation is `(source → target)` — `x1/y1/x2/y2` set in user-space SVG coordinates. The `<marker fill>` references the gradient's last stop color (i.e., the color closest to the arrowhead) so the head doesn't visually decouple from the tail.
- **Per-defender dash assignment** is deterministic by `defenderId` order in `WebGameView.players`: defender at index 0 → solid, index 1 → dashed (`8 6`), index 2 → dotted (`2 5`), index 3 → double-stroke (rendered as a `4 3 4 9` pattern that reads as a paired dash). Pattern set is a constant; lookup is `DASH_PATTERNS[defenderIndex % DASH_PATTERNS.length]`.
- **Blocker-arrows inherit the defender's color/dash.** When blockers exist on a combat group, the attacker → blocker arrows still belong to the defender's lane semantically — color + dash come from the *defender*, not from a blocker (a blocker doesn't have a "lane identity"). Same rule the brainstorm describes ("arrow's color matches the defending player's commander").
- **Empty/unknown identity fallback.** If `defenderColorIdentity` returns `[]` (defender removed mid-game, fixture inconsistency), `arrowStrokeForColorIdentity` returns `{ kind: 'solid', color: 'var(--color-targeting-arrow)' }` — i.e., the legacy neutral teal — so we degrade gracefully.

**Tests (countable, per ADR 0014 D2):**

- `halo.test.ts`: `defenderColorIdentity('p1', [{ id: 'p1', colorIdentity: ['G','W'] }])` returns `['G','W']`; `defenderColorIdentity('missing', [...])` returns `[]`.
- `halo.test.ts`: `arrowStrokeForColorIdentity(['B'])` returns `{ kind: 'solid', color: 'var(--color-mana-black)' }`; `arrowStrokeForColorIdentity(['U','B','G'])` returns a `gradient` whose `stops[0].color === 'var(--color-mana-blue)'`, `stops[2].color === 'var(--color-mana-green)'`, with offsets at `[0, 0.5, 1]`; `arrowStrokeForColorIdentity([])` returns `{ kind: 'solid', color: 'var(--color-targeting-arrow)' }`.
- `CombatArrows.test.tsx`: in a fixture with two defenders (one mono-G, one mono-U), the rendered DOM has one arrow with `data-arrow-stroke-kind="solid"` and `[stroke^='var(--color-mana-green'`, and another with `[stroke^='var(--color-mana-blue'`.
- `CombatArrows.test.tsx`: in the same fixture, `document.querySelectorAll('[data-defender-index="0"][stroke-dasharray=""]').length === <attackers-into-defender-0>` and `document.querySelectorAll('[data-defender-index="1"][stroke-dasharray="8 6"]').length === <attackers-into-defender-1>`.
- `TargetingArrow.test.tsx`: passing `stroke={{ kind: 'gradient', stops: [{ offset: 0, color: 'var(--color-mana-blue)' }, { offset: 1, color: 'var(--color-mana-green)' }] }}` renders one `<linearGradient>` element with two `<stop>` children whose `stop-color` attributes match.

**Acceptance:**

- In `?game=fixture&variant=tabletop` with three opponents (e.g., mono-R, mono-U, GW), `document.querySelectorAll('[data-arrow-defender-id="<R-id>"][stroke="var(--color-mana-red)"]').length` matches the number of attackers into that defender, and zero arrows targeting that defender carry a non-red stroke.
- `document.querySelectorAll('[stroke-dasharray="8 6"]').length === <attackers-into-defender-1>` (the second defender by `players` order) and zero such arrows belong to defender 0.
- Existing `CombatArrows` hover-isolation + endpoint-fan tests pass without modification.

---

### Slice 1-B — Incoming-tag portrait overlay (+ click-to-pin)

**Tier:** Standard (new visual surface + state addition; hover-isolation extended).
**Critic matrix:** technical + UX.
**Files touched:**
- `webclient/src/game/IncomingTag.tsx` — **create** (new sibling component, ~80–120 LOC including tests). PlayerPortrait.tsx is at 504 LOC (already past the hard cap with a documented exception); 1-B does NOT add lines there. The tag mounts as a sibling positioned via `absolute` inside the existing portrait wrapper.
- `webclient/src/game/IncomingTag.test.tsx` — **create**.
- `webclient/src/game/PlayerPortrait.tsx` — minimal modify (one mount-point insertion, ≤5 LOC; no prop-shape change to keep the file as close to its 504-LOC baseline as possible).
- `webclient/src/game/CombatArrows.tsx` — modify (extend `useHoveredCombatId` to also accept a *pinned* defender id; pinned wins over hover; clearing pin requires another click on the same tag or pressing Escape).

**Intent:** when an opponent is an active defender during combat, a small badge appears anchored to their portrait reading `incoming N — M unblocked`. Click pins isolation: only that defender's arrows render at full opacity (matches current hover-isolation behavior, but sticky). Click again to unpin. Escape also unpins. Local player's own portrait never gets the tag (you don't attack yourself in combat phase).

**Key design points:**

- **Counts derive from `combat`.** `incoming = sum of group.attackers.length where group.defenderId === player.id`; `unblocked = sum of group.attackers.length where defenderId === player.id && Object.keys(group.blockers).length === 0`. Both computed via a memo gated on a combat-fingerprint (reuse the existing `useCombatFingerprint` pattern from CombatArrows).
- **Mount point.** Single line added to `PlayerPortrait.tsx` inside the existing wrapper, beneath the halo / portrait stack. The badge itself is `position: absolute` with a fixed offset relative to the portrait, so it doesn't enlarge the portrait footprint (T1 — pod / portrait dimensions stay anchored).
- **Click → pin extends `useHoveredCombatId`.** Today `useHoveredCombatId` returns a single id derived from cursor position. The extension adds a `pinnedId: string | null` state owned by a small Zustand store (or a React context if Zustand feels too heavy for this surface — decide at slice time). When `pinnedId !== null`, `CombatArrows` uses it instead of the hovered id; otherwise hover wins.
- **Tag visibility is gated on combat-active state.** Only mounted when `gameView.phase === 'COMBAT'` AND `incoming > 0`. Outside combat, the tag is unmounted (no idle clutter on opponent portraits).
- **Accessibility.** Tag is a `<button type="button">` with `aria-pressed={pinned}` and `aria-label="N attackers incoming, M unblocked. Click to focus this defender's combat arrows."`. Keyboard tab order follows the portrait. Escape clears pin (handled at the document level by the same hook that owns the pinned state).

**Tests (countable):**

- In a fixture combat with `defenderId='p1'` and 3 attackers (1 blocked, 2 unblocked), `screen.getByTestId('incoming-tag-p1').textContent === 'incoming 3 — 2 unblocked'`.
- `screen.queryByTestId('incoming-tag-<localPlayerId>') === null` (own portrait is suppressed).
- `screen.queryAllByTestId(/^incoming-tag-/).length === <number of distinct defenderIds in combat>`.
- Click on `incoming-tag-p1` then read `document.querySelector('[data-arrow-defender-id="p1"]').getAttribute('opacity') === '1'` AND `document.querySelector('[data-arrow-defender-id!="p1"]').getAttribute('opacity') === '0.25'`.
- Click again → `document.querySelectorAll('[opacity="0.25"]').length === 0`.
- Press Escape with a pin set → no arrows have `opacity="0.25"`.

**Acceptance:**

- Tag shows on every active defender's portrait during combat with the correct count text.
- Tag does not render on the local player's portrait.
- Tag is `clientHeight <= 24 && clientWidth <= 120` (small footprint constraint — visible but doesn't crowd the existing portrait halo / spotlight).
- Click-pin → unpin → click-pin produces the same arrow-isolation pattern hover does today.

---

### Slice 1-C — Wave-reveal stagger + reduced-motion fallback

**Tier:** Standard (small motion primitive layered onto the existing renderer).
**Critic matrix:** technical + Graphical (motion timing / reduced-motion correctness).
**Files touched:**
- `webclient/src/game/CombatArrows.tsx` — modify (compute `revealDelayMs` per arrow from defender-grouping order; pass through to `TargetingArrow`).
- `webclient/src/game/CombatArrows.test.tsx` — extend (delay-assignment + reduced-motion path).
- `webclient/src/game/TargetingArrow.tsx` — modify (extend the existing 120 ms opacity transition with a `transition-delay` driven by a new `revealDelayMs` prop; no-op when `prefers-reduced-motion: reduce` is active).

**Intent:** when an arrow set first appears (declare-attackers commit, or a combat advance that flips visibility on), arrows reveal defender-by-defender at ~90 ms apart instead of all popping in at once. The user reads "this defender being attacked, then this one, then this one" instead of trying to parse 8 simultaneous arrows.

**Key design points:**

- **Delay derivation.** `defenderOrder = uniqueDefenderIdsInOrderOfAppearance(combat)`; `revealDelayMs = defenderOrder.indexOf(arrow.defenderId) * 90`. Computed once per fingerprint change in a `useMemo`, not on every render.
- **Fingerprint discipline.** The existing `useCombatFingerprint` keys the geometry effect; **defender-order info MUST NOT enter that fingerprint** because then defender reordering (e.g., player rejoin) would invalidate geometry. Keep delay computation in a separate `useMemo` that depends only on `combat`.
- **First-paint-only reveal vs. every-change reveal.** Decision at slice time: should the reveal play (a) only on the transition from "no arrows" → "some arrows" (i.e., the moment combat first gets attackers committed), or (b) on every combat-fingerprint change? **Default: (a)** — re-revealing on every blocker addition would be visual noise. Implementation: a `useRef<string>(prevFingerprint)`; only assign delays when the previous fingerprint had `arrows.length === 0`.
- **Reduced-motion path.** Detect via `window.matchMedia('(prefers-reduced-motion: reduce)').matches` (with a media-query listener for live changes). When active, all arrows render at `revealDelayMs = 0` and the existing 120 ms opacity transition still applies (it's a fade, not a translation — WCAG 2.3.3 lets it pass).
- **Cap on stagger.** `Math.min(defenderIndex, 5) * 90` so the worst case (a hypothetical 6+ defender Two-Headed Giant variant) tops out at 450 ms total. 1440p Commander is the target viewport; 4 defenders → 270 ms max stagger.

**Tests (countable):**

- `CombatArrows.test.tsx`: in a 3-defender fixture, all arrows targeting `defenderOrder[0]` have `revealDelayMs={0}` and all arrows targeting `defenderOrder[2]` have `revealDelayMs={180}`.
- `TargetingArrow.test.tsx`: passing `revealDelayMs={180}` produces a `style.transitionDelay` that *includes* `180ms` (jsdom can't render the transition itself, but the inline-style attribute is deterministic).
- `TargetingArrow.test.tsx`: with `matchMedia('(prefers-reduced-motion: reduce)').matches === true` mocked, the rendered `style.transitionDelay` is `'0ms'` regardless of the `revealDelayMs` prop.
- `CombatArrows.test.tsx`: mounting a fixture transitioning from `arrows.length === 0` → `arrows.length === 4` produces non-zero delays; a subsequent re-render with the same combat (same fingerprint) does NOT change any arrow's `revealDelayMs` (i.e., the reveal doesn't replay on incidental gameUpdate frames).

**Acceptance:**

- In `?game=fixture&variant=tabletop` with three opponents and an attacker into each, the reveal sequence reads visibly defender-by-defender at the targeted cadence.
- `prefers-reduced-motion: reduce` (toggled in OS settings or via dev-tools rendering panel) renders all arrows at full opacity within the existing 120 ms — no perceptible stagger.
- No regression in `useCombatFingerprint`'s memo behavior — the existing "no re-run on referentially-fresh-but-equal frame" test continues to pass.

---

### Slice 1-D — Defender beams overlay

**Tier:** Standard (new visual surface; small motion primitive; viewport-fixed mount).
**Critic matrix:** technical + UI.
**Files touched:**
- `webclient/src/game/DefenderBeams.tsx` — **create** (new viewport overlay component, ~120–180 LOC).
- `webclient/src/game/DefenderBeams.test.tsx` — **create**.
- `webclient/src/game/Game.tsx` (or whichever component currently mounts `CombatArrows`) — modify (mount `DefenderBeams` as a sibling overlay; **DOES NOT** touch the focal-cell mutex — beams are viewport-fixed, not focal-cell content).

**Intent:** during combat, soft low-opacity color washes radiate from the central focal area toward each defender being attacked. Idle (non-defended) opponents stay neutral. The wash signals the *distribution of pressure* across the table at a glance — even before parsing individual arrows, the user sees "two opponents are getting hit, one isn't."

**Key design points:**

- **Viewport-fixed mount.** Same `position: fixed inset-0 z-30` pattern `TargetingArrow` uses (one z below arrows, so beams sit *behind* the arrows when both render). `pointer-events: none` so beams don't block clicks.
- **Beam geometry.** For each defender being attacked, compute (at geometry time, using the same DOM-rect technique CombatArrows uses) a vector from `viewportCenter` to the defender's portrait center. Render a CSS `radial-gradient` or SVG `<path>` with a soft falloff — exact shape decided at slice time, but the brainstorm describes "low-opacity wash" so a radial-gradient cone is the leaner implementation. Each beam is a separate DOM element so its color (per defender's commander identity, reusing `arrowStrokeForColorIdentity`) and pattern can vary independently.
- **Beam color.** Reuses `defenderColorIdentity` + `arrowStrokeForColorIdentity` from 1-A. Multicolor defenders get a banded conic-gradient wash (same banded-not-blended treatment as the arrow stroke) — visual consistency across the bundle.
- **Visibility coupling.** Beams are mounted whenever `combat.length > 0` AND any group has unblocked attackers AND `gameView.phase === 'COMBAT'`. They follow the same combat-active rule arrows follow. The brainstorm's open decision #2 (central-area mutex) doesn't apply because beams are viewport overlay, not focal-cell content — they continue to render even when the stack temporarily replaces arrows.
- **Reduced-motion.** Beams are static (no pulse, no rotate) by default. If a future polish slice adds a slow drift, gate it on `prefers-reduced-motion`. For 1-D ship: static gradient washes only.
- **Opacity budget.** Beam wash caps at `0.18` opacity at its core, falling to 0 at viewport edges. Overlapping beams (e.g., two adjacent defenders both being attacked) compound but the cap keeps the worst case under 0.36 — tunable at slice time after live-test feel.

**Tests (countable):**

- In a fixture with two active defenders, `document.querySelectorAll('[data-testid^="defender-beam-"]').length === 2`.
- `document.querySelector('[data-testid="defender-beam-<defenderId-with-mono-G>"]').getAttribute('data-stroke-kind') === 'solid'` AND its inline-style `background` includes `'var(--color-mana-green'`.
- In a fixture with no active defenders (e.g., pre-declare-attackers), `document.querySelectorAll('[data-testid^="defender-beam-"]').length === 0`.
- Outside combat (`gameView.phase !== 'COMBAT'`), `document.querySelectorAll('[data-testid^="defender-beam-"]').length === 0`.
- Beam container has `position: fixed` and `pointer-events: none` (assert via inline style or class match).

**Acceptance:**

- In `?game=fixture&variant=tabletop` with two opponents being attacked and one not, the visual shows two soft color washes pointing at the attacked opponents and no wash at the third.
- Layout is unchanged — beams overlay does not displace pods, portraits, or zones (T1 + T2 invariants).
- Hovering through the beams does not block clicks on cards underneath (verified by clicking a card while a beam visually overlaps it).

---

## Cross-slice considerations

### Renderer cohesion across the bundle

Slice 1-A introduces the per-defender stroke helper (`arrowStrokeForColorIdentity`); 1-D reuses the same helper for beams. Slice 1-C adds a per-arrow `revealDelayMs` plumbed through the same `ArrowSpec` shape 1-A extends. There is no "rebuild the renderer twice" risk — the four slices layer cleanly.

### Open decision deferred: arrow-trio renderer redesign

The brainstorm flags that Bundles 1, 5, 6 all touch the arrow renderer and **a single up-front renderer-redesign slice** is more efficient than rebuilding incrementally. Bundle 1 doesn't trigger that redesign yet because:

- 1-A's color/dash plumbing is additive — `ArrowSpec` gains two fields, `TargetingArrow` gains gradient + dash support. None of this would be undone by Bundle 5 or 6.
- 1-C's `revealDelayMs` is additive on the same axis — Bundle 6 can layer pen-stroke / palette-shift on top of the same prop without conflict.
- Bundle 5 (pulses traveling along arrows) is the slice that *would* warrant a renderer-redesign foundation slice if it lands next, because it changes how the SVG is structured (pulse path + traveling element vs. single static stroke). That decision belongs to Bundle 5's scope brief, not this one.

### Tabletop load-bearing rules (T1–T7) verification

| Rule | Verification |
|---|---|
| **T1** Zones are fixed dimensional anchors | Incoming-tag (1-B) is `position: absolute` inside the portrait wrapper; the portrait wrapper's footprint doesn't change. Beams (1-D) are `position: fixed` viewport overlay. **Pass.** |
| **T2** Action panel floats; never displaces | Beams (1-D) are `position: fixed` overlay with `pointer-events: none` — they sit *over* the layout, never in it. **Pass.** |
| **T3** Cards render full Scryfall art | No card-rendering changes. **N/A.** |
| **T4** Target viewport 1440p | Stagger cap at 5 defenders × 90ms keeps reveals snappy at the target viewport; beam opacity tuning happens at 1440p. **Pass at design time; verify in live-test.** |
| **T5** No engine code, no wire change, no schema bump | All work in `webclient/`. Wire-format readiness verified above — `colorIdentity` + `defenderId` already on schema 1.28. **Pass.** |
| **T6** Tabletop is production default | Bundle 1 ships under tabletop default; `?variant=current` continues to inherit the same renderer changes (color + dash flow through both variants — visually different layout, same arrow paint). **Pass.** |
| **T7** Cross/plus 4-pod arrangement | Per-defender dash assignment is by `players` order, not by pod position. Wave-reveal also keys on `players` order. Both are correct for cross/plus geometry as well as the asymmetric-T `current` variant. **Pass.** |

### File LOC trajectory

| File | Current | Δ post-bundle | Risk |
|---|---|---|---|
| `CombatArrows.tsx` | 432 | ~480 (1-A: +20, 1-C: +25) | Approaching 500 hard cap. **Plan a split now.** Candidate: extract `useCombatArrowGeometry` + `applyEndpointFan` into `combatArrowGeometry.ts` as a 1-X mechanical follow-up before slice 1-D lands, OR document the hard-cap exception inline. Decision at 1-A end. |
| `TargetingArrow.tsx` | 122 | ~180 | Comfortable. |
| `halo.ts` | 204 | ~260 | Comfortable. |
| `PlayerPortrait.tsx` | 504 (already over hard cap, documented exception) | +5 (mount-point only) | Don't make it worse. 1-B's incoming-tag lives in a sibling. |
| `IncomingTag.tsx` (new) | — | ~120 | Comfortable. |
| `DefenderBeams.tsx` (new) | — | ~150 | Comfortable. |

### Test fixture coverage

- Existing `?game=fixture&variant=tabletop` already places three opponents with distinct commander color identities. Confirm color spread covers single-color + multicolor + colorless cases (inspect at slice-1-A start; if not, extend the fixture in the 1-A slice).
- 1-B needs a fixture where local player has NO incoming arrows (to verify the tag suppresses correctly on own-portrait) AND where one opponent has incoming + one does not (to verify the gating).
- 1-C needs a fixture transitioning from `combat: []` → `combat: [3 groups]` on a tick (the existing fixture already supports advance-step affordances).
- 1-D needs the same 3-defender fixture as 1-A; no new fixture work required.

### Accessibility

- **Color paired with dash pattern.** Per-defender dash assignment is the redundant signal for color-blind users. WCAG 2.1 SC 1.4.1 (use of color) — pass.
- **Incoming tag is keyboard-accessible.** `<button>` with `aria-pressed`; tabs in order with the portrait; Escape clears pin.
- **Wave reveal honors `prefers-reduced-motion`** — instant fall-through to the existing 120ms fade, no stagger.
- **Beams are decorative.** `aria-hidden="true"` on the overlay; they don't carry information that isn't also surfaced via arrows + tags.

---

## Pre-coding breakage analysis (bundle-level)

### Scope lock

This brief covers only the combat-arrow color/reveal plus the incoming-tag and beams overlays. It does NOT touch arrow path geometry beyond color, the central focal cell's stack/arrow mutex, creature-tile chrome, banner content, the phase timeline, or any wire-format DTO. Anything outside that surface is a follow-up bundle.

### What I'm changing

- `CombatArrows.tsx` (modify, 432 → ~480 LOC).
- `TargetingArrow.tsx` (modify, 122 → ~180 LOC).
- `halo.ts` (extend, 204 → ~260 LOC).
- `PlayerPortrait.tsx` (mount-point insertion only, +5 LOC).
- New files: `IncomingTag.tsx` (+ test), `DefenderBeams.tsx` (+ test).
- Test extensions: `CombatArrows.test.tsx`, `TargetingArrow.test.tsx`, `halo.test.ts`.

### What could break

- **Existing combat-arrow hover-isolation** ([`CombatArrows.tsx:312-356`](../../webclient/src/game/CombatArrows.tsx#L312)) — slice 1-B extends this with a pinned id; the existing tests must continue to pass without modification (hover behavior unchanged when no pin is set).
- **Endpoint-fan stable visual order** ([`CombatArrows.tsx:234-272`](../../webclient/src/game/CombatArrows.tsx#L234)) — slice 1-A's per-arrow color is set per arrow, not per fan group; the fan-pass continues to operate on geometry only. No coupling.
- **`useCombatFingerprint` memo discipline** ([`CombatArrows.tsx:279-291`](../../webclient/src/game/CombatArrows.tsx#L279)) — slice 1-C MUST NOT thread defender-order into the fingerprint, or every gameUpdate re-runs the geometry pass. The slice plan keeps delay computation in a separate memo.
- **Reduced-motion correctness across slices.** 1-C's stagger respects `prefers-reduced-motion`; 1-D's beams are static by default (no motion concern). A future polish slice that adds beam drift would need to gate it.
- **`PlayerPortrait.tsx` size (504 LOC, over hard cap).** 1-B does NOT add lines beyond a single mount-point insertion. The incoming-tag content lives in `IncomingTag.tsx`. We do not regress further on the portrait file.

### Edge cases

- **Defender removed mid-combat** (player concedes / disconnects) — `defenderColorIdentity` returns `[]` → arrow falls back to neutral teal. Existing behavior, no crash.
- **Local player is the active defender of their own attackers** (mind-control / Telepathy edge) — local player's portrait is suppressed from the incoming-tag mount logic. Verify in a fixture.
- **Multi-attacker into same defender** with mixed blocked/unblocked — `incoming = total attackers`, `unblocked = subset where group has no blockers`. Test fixture with 3 attackers, 1 blocked → tag reads `incoming 3 — 2 unblocked`.
- **Combat phase active but no attackers yet** (BEGIN_COMBAT pre-declare) — `combat = []` → no arrows, no beams, no tags. All four slices early-return cleanly.
- **6+ defenders in an exotic format** (e.g., Free-for-All variant) — wave-reveal stagger caps at `Math.min(defenderIndex, 5) * 90 = 450ms`; dash patterns cycle via modulo so the 5th and 6th defender repeat patterns of defenders 1 and 2. Acceptable (4p is the live target).
- **Colorless commander** (Karn, Kozilek) — `colorIdentity = []` → arrow stroke falls back to neutral teal AND beam wash uses `--tabletop-zone-colorless` (or a neutral fallback for `current` variant). Tested in 1-A.

### Schema impact

**None.** Schema 1.28+ already exposes `WebPlayerView.colorIdentity` and `WebCombatGroupView.defenderId`. No `schemaVersion` bump.

### Upstream rebase impact

**None.** All changes are in `webclient/src/`, which is ours. No upstream-tracked files touched.

### Test plan

- Per-slice unit tests as enumerated under each slice (above). Every acceptance criterion is countable per ADR 0014 D2.
- Regression check: existing `CombatArrows.test.tsx`, `TargetingArrow.test.tsx`, `PlayerPortrait.test.tsx`, `PlayerArea.test.tsx`, `PlayerArea.redesign.test.tsx`, `PlayerFrame.test.tsx`, `PlayerFrameRedesigned.test.tsx`, and `halo.test.ts` continue to pass without modification. (Slices ADD tests; they don't ALTER existing behavior assertions.)
- Pre-commit gate: `cd webclient && pnpm typecheck && pnpm lint && pnpm test`.
- One manual `?game=fixture&variant=tabletop` walk-through per slice to confirm visible behavior matches the spec.
- After all four slices land, dispatch a bundle-level critic pass (technical + UI + UX + bug-hunter) per Bundle 3's pattern. Findings produce 1-X.* follow-up slices.

---

## Open questions to resolve before slices land

- **Dash pattern set.** Default is `solid / dashed (8 6) / dotted (2 5) / double-stroke (4 3 4 9)`. If live-test feel says one of these reads poorly at 3 px stroke width on busy battlefields, swap during 1-A. Decision deferable to 1-A's UI critic pass.
- **Hover-isolation pin store.** Zustand vs. React context for the pinned-defender state in 1-B. Default suggestion: a small Zustand store sibling to the existing `audioSettingsStore` family — consistent with project pattern. Decide at 1-B start.
- **Beam shape.** Radial gradient cone (CSS) vs. SVG `<path>` with feathered edge. Default: radial gradient (less DOM, less code). Decide at 1-D start with a 30-min A/B if the radial doesn't read well.
- **Reveal-trigger semantics in 1-C.** First-paint-only vs. every-fingerprint-change. Default: first-paint-only. Revisit if live-test says re-reveal-on-blocker-add looks better.

---

## Sequence + acceptance criteria

| Slice | Ships | Gate to next |
|---|---|---|
| 1-A | Per-arrow defender color + per-defender dash pattern | 4-defender fixture renders 4 visually distinct arrows; existing hover-isolation regression-clean |
| 1-B | Incoming-tag overlay + click-to-pin | Tag count text matches `combat` derivation; pin/unpin matches hover behavior; own-portrait suppressed; portrait footprint unchanged (T1) |
| 1-C | Wave-reveal stagger + reduced-motion fallback | Stagger reads visibly defender-by-defender at 1440p; `prefers-reduced-motion` clean; `useCombatFingerprint` memo unchanged |
| 1-D | Defender beams overlay | Beams overlay does not displace layout (T2); overlapping-beam opacity stays under threshold; combat-phase-only mounting works |

After 1-D lands, dispatch a bundle-level critic pass (technical + UI + UX + bug-hunter at minimum, per Bundle 3's pattern). Apply findings as 1-X.* follow-up slices. After 1-X cleanup, Bundle 1 is complete; re-evaluate against the brainstorm's other bundles before opening the next branch.
