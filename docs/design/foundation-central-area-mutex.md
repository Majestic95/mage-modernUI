# Foundation — Central Area Mutex Resolution

> **Status:** scope-locked, decision pending user ratification
> **Source:** "Important snag to decide on first" at [`docs/design/combat-phase-brainstorm-bundles.md`](combat-phase-brainstorm-bundles.md) lines 31-39
> **Gates:** Bundle 5 (Damage Moment) and Bundle 6 (Arrow Storytelling) both assume arrows stay visible while damage resolves; today they don't.

## The problem in one sentence

The central focal cell renders **either** the stack zone (pending spells/abilities) **or** combat arrows — never both at once. When something hits the stack during combat (instant, triggered ability, ETB effect — all extremely common during combat in Commander), `CombatArrows` unmounts and `StackFan` takes over. Bundle 5's "damage parcels travel along arrows" requires arrows to be present DURING damage resolution; today, if anything is on the stack when damage resolves, the cinematic degrades to "the life total ticked down."

## Where it lives

The mutex is hard-coded at [`webclient/src/game/StackZone.tsx:216-233`](../../webclient/src/game/StackZone.tsx#L216):

```ts
const stackEmpty = entries.length === 0;
const combatActive = combat.length > 0;

if (stackEmpty && !combatActive) return <empty>;
if (stackEmpty && combatActive)  return <CombatArrows>;
return <StackFan>;  // stack non-empty wins
```

`<CombatArrows>` is mounted EXCLUSIVELY by this gate — no other consumer in the codebase. Whatever the resolution chooses, this is the surface that changes.

## Why this is a foundation slice, not part of Bundle 5

Bundles 5 and 6 both layer NEW behavior on top of the existing arrow renderer. Doing the renderer redesign as part of slice 5-A would either (a) bundle two architectural concerns into one slice or (b) ship Bundle 5 with a known-degraded cinematic. A small foundation slice that resolves the mutex first lets Bundle 5's slices stay focused on the cinematic surface.

This is the precedent set in Bundle 1's scope brief (`docs/design/combat-bundle-1-defender-lanes.md` line 210-216), which explicitly noted that the arrow-renderer-redesign question "belongs to Bundle 5's scope brief, not [Bundle 1's]." We're now resolving it.

---

## Three resolution paths

### Option A — Live with it

**Sketch:** No code changes. Bundle 5's "damage parcel" sub-feature gains a `conservativeMode` gate: when arrows are unmounted (stack non-empty), parcels don't fire; the bundle falls back to portrait-only feedback (life flash + halo bloom). The brainstorm already calls this out as the conservative trigger rule.

**Pros:**
- Zero code, zero risk.
- Forces Bundle 5 to ship a robust portrait-only fallback regardless — a fallback you'd want anyway for first-strike-vs-regular damage reading.

**Cons:**
- The cinematic-payoff bundle's headline moments degrade unpredictably based on what happened to be on the stack. In practice: instants resolving as triggered/triggered-by-attack are extremely common during combat (Path to Exile on attacker, Mother of Runes protect, every ETB-on-attack trigger). The cinematic surfaces only when the board is uncomfortably quiet.
- Bundle 6's "pen-stroke arrow draw-in" loses its narrative beat the same way — it draws in only when the stack happens to be empty.
- User invested heavily in Bundles 1+3+4 chrome to make combat readable. Bundle 5 is the "make it FEEL" payoff. Defaulting to "feels less" most of the time wastes that investment.

**Effort:** ~5 LOC gate + tests. Trivial.

### Option B — Move the arrows to a viewport-fixed overlay

**Sketch:** New `<CombatArrowsOverlay>` component mounted at the GameTable level, positioned `fixed inset-0` with `pointer-events: none`. Renders identically to today's `CombatArrows` but anchored to the viewport, not the central cell. Stays mounted whenever `combatActive` regardless of stack state. Existing focal-cell `CombatArrows` either deletes (overlay is the sole renderer) or stays as a redundant cell-level rendering for hover-isolation precision.

Reuses the precedent from Bundle 1's `DefenderBeams` ([`webclient/src/game/DefenderBeams.tsx:34-40`](../../webclient/src/game/DefenderBeams.tsx#L34) — "viewport overlay, not focal-cell content; survives stack pushes"). The geometry hooks (`useCombatArrowGeometry` in [`combatArrowGeometry.ts`](../../webclient/src/game/combatArrowGeometry.ts)) already measure `getBoundingClientRect()` on the source/target DOM nodes, so they don't care whether the SVG canvas is cell-bound or viewport-bound.

**Pros:**
- Arrows ALWAYS visible during combat. Bundle 5's parcel cinematic always surfaces.
- Reuses the established viewport-overlay pattern (DefenderBeams precedent). Z-index hygiene already worked out at the bundle-1 critic pass.
- No StackZone architectural change. The stack keeps its full focal cell.

**Cons:**
- Arrows now ALWAYS visible during combat — including before damage when they were "the only thing in the central area." With the overlay+focal both rendering, you'd see arrows twice (overlay paints over focal). Need to either delete the focal renderer (loses hover-isolation precision when stack-empty) or gate the overlay to ONLY appear when stack is busy (toggling renderers mid-combat = potential flicker).
- Viewport-bound arrows over a busy stack can read as "decorative noise on top of the action" — the focal cell now has two competing things drawing the eye.
- DefenderBeams works because it's ambient atmosphere (low alpha, unfocused). Arrows are the precise signal — putting them at the same overlay layer as ambient atmosphere muddies the visual hierarchy.

**Effort:** Medium. ~150-200 LOC new overlay component + the toggle/dedup logic + tests + a critic pass on the hover-isolation precision when arrows-on-overlay vs arrows-in-cell.

### Option C — Shrink the stack during combat (recommended)

**Sketch:** Add a `combatActive` prop to `<StackFan>`. When `combatActive=true AND stack-non-empty`, render a COMPACT stack mode: small left-aligned column of stack tiles (e.g. 60% of normal focal-card size, stacked vertically in the focal cell's left third) instead of the centered overlapping fan. Right two-thirds of the focal cell mounts `<CombatArrows>` as it always does in arrows-mode. The stack and arrows visually cohabit the focal cell.

Mutex gate flips from "either/or" to "compact-stack-and-arrows during combat":

```ts
if (stackEmpty && !combatActive) return <empty>;
if (combatActive) return <><StackFan compact={!stackEmpty} /><CombatArrows /></>;
return <StackFan compact={false} />;  // non-combat stack unchanged
```

**Pros:**
- Focal cell remains the SINGLE canonical arrow renderer — no dual-source-of-truth, no overlay/cell sync concerns.
- Arrows stay in the same geometry + anchor system they already use. Bundle 5's parcel cinematic + Bundle 6's pen-stroke draw-in both work without renderer redesign.
- The compact-stack mode is a one-time investment that ALSO benefits Bundle 2 (Combat Stage) — a smaller stack visually frames the central area's "lit stage" mood without dominating it.
- Stack content stays readable (tiles ~60% of focal size at 1440p ≈ 75 px wide — comfortably above the 4-D LOD threshold).
- DefenderBeams keeps its role as ambient atmosphere; arrows stay the precise signal. Visual hierarchy unmuddied.

**Cons:**
- StackFan layout restructure is the touchiest part — `StackFan` currently uses overlapping percentages and a halo-bloom that assumes centered placement. Compact mode needs new geometry. Estimated 30-50 LOC of new layout code + the gate change.
- Tests for stack rendering need a `combatActive` axis added to existing fixtures.
- Visual-design call required: where exactly does the compact stack sit (left edge vs top vs corner-tucked)? The `?combat=declare` and `?combat=1&attackers-pending` cases need fixture knobs (already-shipped 4-X.1 covers the mechanics; the new state to surface is "stack non-empty during combat").

**Effort:** Medium-large. Estimated 1 architectural slice (Standard tier) + 1-2 fixer slices for visual tuning. Roughly 2-3 hours total.

---

## Recommendation: Option C (shrink the stack)

The user invested in Bundles 1+3+4 to make combat readable. Bundle 5 is the cinematic payoff — defaulting to "live with it" wastes the investment. Option B's overlay introduces dual-rendering complexity for a feature (arrow visibility) that's load-bearing for two future bundles. Option C is the only path that keeps the focal cell as the canonical renderer AND makes Bundle 5 + Bundle 6 work uniformly.

Secondary benefit: Option C unlocks Bundle 2 (Combat Stage) too — a "lit stage" central area reads better with a smaller, framed stack inside it than with a centered fan that dominates the cell.

If Option C's StackFan restructure proves fragile in slice work, Option B is the named fallback (not Option A).

---

## Tabletop load-bearing rules (T1-T7) verification

| Rule | Option A | Option B | Option C |
|---|---|---|---|
| **T1** Zones are fixed dimensional anchors | ✅ no change | ✅ overlay is fixed-positioned, no zone footprint change | ✅ focal cell footprint unchanged; only INNER content layout changes |
| **T2** Action panel floats; never displaces | ✅ no impact | ✅ no impact | ✅ no impact |
| **T3** Cards render full Scryfall art | ✅ no impact | ✅ no impact | ✅ stack tiles still use `<CardFace>` with the existing focal-card spec; just at smaller size |
| **T4** Target viewport 1440p | ✅ no impact | ⚠️ overlay z-index needs viewport-resize testing | ✅ compact mode tuned at 1440p; sub-1440p degrades acceptably |
| **T5** No engine code, no wire change, no schema bump | ✅ | ✅ | ✅ — webclient-only restructure |
| **T6** Tabletop is production default | ✅ | ✅ | ✅ — `current` variant inherits the same StackZone changes; legacy stack rendering unchanged for non-tabletop |
| **T7** Cross/plus 4-pod arrangement | ✅ | ✅ | ✅ — central cell unchanged, only its content rearranges |

All three options are T-rules-clean. Option C's only T-flag is a 1440p design tuning, not a violation.

---

## File LOC trajectory (Option C)

| File | Current | Δ post-foundation | Risk |
|---|---|---|---|
| `StackZone.tsx` | 668 (over hard cap, documented exception) | +50 (compact mode + gate change) | **Plan a split first.** Already past 500 LOC. The compact-mode logic should land as a sibling `StackFanCompact.tsx` (or extracted helper) so StackZone.tsx doesn't grow. |
| `StackFan` (sub-component within StackZone.tsx) | ~80 LOC | Possibly extracted to its own file | Cleanup opportunity bundled with the foundation work. |
| New `StackFanCompact.tsx` (proposed) | — | ~120 LOC | Comfortable. |
| `CombatArrows.tsx` | 273 | unchanged (just stays mounted longer) | Comfortable. |
| `combatArrowGeometry.ts` | 384 | unchanged | Comfortable. |
| Tests | — | +60-80 LOC | Adds `combatActive` axis to existing StackZone tests. |

---

## Slice plan (Option C)

If user ratifies Option C, propose three slices:

### Slice F-A — StackFan extraction + compact mode primitive

**Tier:** Mechanical (extract StackFan to its own file) followed by Standard (add compact mode).
- Extract `<StackFan>` from StackZone.tsx into a new `StackFan.tsx` (verbatim).
- Bring StackZone.tsx back under the 500 LOC hard cap.
- Add `compact?: boolean` prop to StackFan. When `compact=true`, render the small-left-column layout instead of the centered fan.
- Tests cover both modes against existing fixtures.

### Slice F-B — Mutex flip in StackZone

**Tier:** Standard.
- Replace the `stackEmpty/combatActive` either/or gate with the new "compact-during-combat" branch.
- Add a `?combat=stack-during-combat` fixture knob (extends 4-X.1's pattern) so the new state is smoke-testable.
- Verify hover-isolation, click-targeting, and z-index ordering still work with the new dual-mount.

### Slice F-X.0 — Bundle-level critic pass

Same shape as Bundle 4's 4-X.0. Dispatch technical + UI + UX + bug-hunter. Apply blockers + cheap notables.

After F-X.0 lands, Bundle 5 (Damage Moment) is unblocked.

---

## Open questions

1. **Compact stack position.** Left-aligned column? Top corner? Visual-design call deferred to slice F-A's UI critic pass against a live fixture.
2. **Compact stack tile size.** Default proposal: 60% of focal-card size (~77 px wide at 1440p). UI critic ratifies or proposes alternative.
3. **Hover-detail behavior.** Does hovering a compact stack tile still expand to full-size hover-detail? Default: yes (existing HoverCardDetail behavior unchanged).
4. **Should non-combat stacks ever use compact mode?** Default: no. Compact only when combat is active AND stack is non-empty.
5. **Arrow + stack visual layering.** Arrows render in the focal cell's right two-thirds; if a stack tile sits at the right edge of the compact column and an arrow path crosses it, who wins z-order? Slice F-B technical critic pass decides.

---

## Decision required

User chooses one of:
- **A** Live with it — accept Bundle 5/6's "pulse-only-when-stack-empty" degradation.
- **B** Move the arrows — viewport-overlay parallel renderer.
- **C** Shrink the stack (recommended) — focal-cell cohabitation via compact stack mode.

After ratification, the chosen path becomes a feature branch with its own scope brief (or this one extends per Option C's slice plan). Bundles 5 and 6 wait on this decision.
