# Bundle 3 — Combat Dashboard, scope brief

> **Branch:** `feat/combat-bundle-3-dashboard`
> **Status:** scope-locked, ready to slice
> **Source:** Bundle 3 of the combat-phase brainstorm (`c:\Users\austi\.cursor\plans\combat_phase_brainstorm_clusters_5c8a1050.plan.md`)
> **Pain axes addressed:** phase awareness (primary), readability (secondary)

## Goal

Make every combat sub-step visible at a glance — *which step we're in, whose priority is live, what you've staged so far* — without enlarging the existing layout footprint or changing the wire format.

This is the cheapest of the six bundles, the most independent (zero coordination work with the other five), and the highest "feels noticeably better" return per slice. The brainstorm suggested treating Bundle 3 as a menu rather than all-or-nothing — this brief codifies that, splitting it into four slices that ship and evaluate independently.

## Scope lock

### In scope

- Five sub-features, sliced into four shippable units:
  1. **Combat runway** — extend `PhaseTimeline`'s combat segment so the active sub-step pulses, past steps are muted with a check-mark, future steps are ghosted, and "waiting on Lyrra" passive copy appears when priority isn't local.
  2. **Active-step ribbon** — small text block showing the rules-step name + operational state (`PRIORITY` / `PASSING` / `WAITING`) anchored to the active phase segment.
  3. **Banner depth ladder** — restructure `CombatBanner` from one flex row into a typographic stack: H1 + sub-title + outlined Done pill + razor top highlight.
  4. **Tempo meter** — five-tick mini meter under the banner mirroring the runway, with a player-color dot traveling on stop-eligible steps.
  5. **Staged-action recap** — auto-generated 2-line ledger under the banner prompt showing staged attackers and blockers from `gameView.combat`.
- Tabletop variant only as the primary target. The legacy `current` variant inherits whatever is compatible without a dedicated polish pass.
- Respect for `prefers-reduced-motion` on every new animation (instant state swap fallback).

### Out of scope

- **Damage math previews.** The user explicitly excluded decision support from the brainstorm. The recap shows commitments, not predicted outcomes.
- **Combat arrows or any focal-cell changes.** Those belong to Bundles 1, 5, 6.
- **Creature-tile chrome.** Belongs to Bundle 4.
- **Vignette / staging atmosphere.** Belongs to Bundle 2.
- **Wire-format changes.** Schema 1.30 already exposes everything we need.
- **Client-side staged-attacker tracking.** Confirmed unnecessary — see "Wire-format readiness" below.

---

## Wire-format readiness (recon result)

All five sub-features read existing fields. No `schemaVersion` bump.

| Sub-feature | Source field | File:line |
|---|---|---|
| Active step | `gameView.step` | `webclient/src/api/schemas.ts:788` |
| Turn number | `gameView.turn` | `webclient/src/api/schemas.ts:786` |
| Active player | `gameView.activePlayerName` | `webclient/src/api/schemas.ts:789` |
| Priority holder | `gameView.priorityPlayerName` | `webclient/src/api/schemas.ts:790` |
| Self-priority flag | `WebPlayerView.hasPriority` | `webclient/src/api/schemas.ts:706` |
| Skip-macro armed | `WebPlayerView.skipState` | `webclient/src/api/schemas.ts:758-777` |
| Staged attackers + blockers | `gameView.combat` | `webclient/src/api/schemas.ts:799` |

**Staged attackers verified:** `webclient/src/game/clickRouter.ts:144-152` dispatches each declare-attackers / declare-blockers click via `sendObjectClick`, which round-trips through the engine and re-emits `gameView` with the combat groups updated. No client-side tracker needed; one-frame round-trip latency is acceptable.

---

## Slice breakdown

### Slice 3-A — Combat runway + active-step ribbon

**Tier:** Standard (single-surface, no wire change, no race surface).
**Critic matrix:** technical + UX.
**Files touched:**
- `webclient/src/game/PhaseTimeline.tsx` — modify
- `webclient/src/game/PhaseTimeline.test.tsx` — **create** (currently absent — coverage gap)

**Intent:** when the active phase IS combat, the combat segment of the existing `PhaseTimeline` expands to show the six sub-step labels with smarter state semantics; an inline ribbon next to the active orb shows `PRIORITY` / `PASSING` / `WAITING` based on `priorityPlayerName` + `myPlayerId`. When active phase is anything else, behavior matches today (suppressed sub-step labels in tabletop's compact mode, preserving the P3 header-budget win).

**Key design points:**

- **Tabletop header budget is load-bearing.** The current `PhaseTimeline.tsx:121-126` polish-pass P3 comment locks in "compact mode suppresses sub-step labels to save 28px." The runway must NOT undo this when active phase ≠ combat. Implementation: gate sub-step label rendering on `(phase.label === 'Combat' && phase.steps.some(s => s.name === activeStep))`, not on `showStepLabels` alone.
- **Active-step orb already pulses** (`PhaseTimeline.tsx:218`). The new behavior layers on top: past steps within the combat phase get a ghosted color + check-mark sigil; future steps stay at the existing low-opacity dot.
- **Ribbon placement:** anchored beside the active sub-step label, so it spatially follows the active orb. Width capped; ellipsis on overflow. Reuse the existing `phase.fgClass` for color so it matches the active phase's accent.
- **Priority-state copy mapping:**
  - `gameView.priorityPlayerName === me.name` → `PRIORITY` (accent color).
  - `me.skipState` non-empty → `PASSING` (muted).
  - Otherwise → `WAITING ON {priorityPlayerName}` (muted).

**Tests:**
- `PhaseTimeline.test.tsx` (new): renders all six combat sub-step labels when active phase is combat in tabletop variant; suppresses them when not in combat; ribbon shows `PRIORITY` when local player has priority; ribbon shows `WAITING ON X` when remote player has priority; ribbon shows `PASSING` when local player has a skip-state armed.
- Existing `useStopOnCombatSteps.test.tsx` continues to pass (no changes to stop logic).

**Acceptance:** in `?game=fixture&variant=tabletop`, advancing through combat sub-steps lights each one in turn with the ribbon updating its priority copy. Header height stays at ~24px outside combat; expands to ~38px during combat (one extra label-row for the active phase only). `prefers-reduced-motion`: orb pulse is already gated by Tailwind's `animate-pulse` which respects the media query — no new motion to gate.

---

### Slice 3-B — Banner depth ladder

**Tier:** Standard (visual restructure, no behavior change).
**Critic matrix:** technical + UI.
**Files touched:**
- `webclient/src/game/dialogs/CombatBanner.tsx` — modify
- `webclient/src/game/dialogs/CombatBanner.test.tsx` — extend

**Intent:** restructure the banner's flex-row layout into a typographic stack so the prompt hierarchy is visible at a glance. Today the banner reads as a single noisy line ("Combat — attackers" + message + italic hint + buttons); after, it reads as title / sub-title / action.

**Visual spec:**

- **Title row:** "Combat" in `text-xs uppercase tracking-wider text-amber-300 font-semibold` (existing) — unchanged.
- **Sub-title row (new):** active sub-step name from `gameView.step`, in `text-[10px] uppercase tracking-wide text-zinc-400`.
- **Prompt row:** existing `renderUpstreamMarkup(message)` block — unchanged.
- **Italic hint:** keep the "Click creatures on the board to toggle" line but de-emphasize one notch (`text-zinc-500` → `text-zinc-600`).
- **Action area:** `Done` becomes an outlined pill (`border border-amber-400 bg-amber-500 hover:bg-amber-400 text-zinc-950`) — visually pops as the primary affordance. `All attack` stays its current style as the secondary action.
- **Top highlight:** add a 1px inset top highlight (`box-shadow: inset 0 1px 0 rgba(255,255,255,0.06)`) to lift the frosted band off busy battlefield content.

**Tests:** banner renders title + sub-title + prompt + Done in distinct testid slots; sub-title text matches active step.

**Acceptance:** banner still fits in the same horizontal footprint at 1440p; sub-title accurately reflects `gameView.step`; Done button remains keyboard-focusable and the `data-testid="combat-banner-done"` selector continues to work.

---

### Slice 3-C — Banner tempo meter

**Tier:** Standard (small motion primitive).
**Critic matrix:** technical + UI (for motion timing).
**Files touched:**
- `webclient/src/game/dialogs/CombatBanner.tsx` — extend (or split into a sub-component if it pushes past the 400-line soft cap)
- `webclient/src/game/dialogs/CombatTempoMeter.tsx` — **create** if extracted

**Intent:** five-tick mini meter under the banner sub-title, mirroring the combat runway from Slice 3-A. Reinforces "we are at sub-step 3 of 5" with a second visual cue near where the user is already looking.

**Motion spec:**

- Inactive ticks: 30% opacity, 6px square dot.
- Active tick: ramps to 100% opacity over 150ms `easeOut`, translates up 2px.
- On step change, prior tick drops back over 100ms while next rises — no overlap glow.
- Optional sub-feature: a player-color dot travels the meter on steps where `useStopOnCombatSteps` would stop the local player — gated by a stretch flag, ship without it first.
- `prefers-reduced-motion`: skip the ramp + translate, swap state instantly + bold the active tick label only.

**Tests:** meter renders five ticks with `data-active-step` matching `gameView.step`; reduced-motion variant renders without `transition` styles (jsdom check via computed style).

**Acceptance:** meter updates in lock-step with the runway; no jank; total animation budget per step change ≤200ms.

---

### Slice 3-D — Banner staged-action recap

**Tier:** Standard (state read + render).
**Critic matrix:** technical + UX.
**Files touched:**
- `webclient/src/game/dialogs/CombatBanner.tsx` — extend (likely needs split — see banner-sprawl note below)
- `webclient/src/game/dialogs/CombatStagedRecap.tsx` — **create** (almost certain)

**Intent:** auto-generated 2-line ledger under the banner prompt showing what the user has staged so far during the active declare phase, so the question "why can't I press Done?" becomes self-answering.

**Content rules:**

- **During DECLARE_ATTACKERS:** "Chosen attackers: Goblin Guide, Hydra, Spirit Token" (comma-separated names from `gameView.combat[].attackers` whose `card.controllerId === myPlayerId`).
- **During DECLARE_BLOCKERS:** "Staged blockers: Wall blocking Hydra, Spirit blocking Goblin" (per `gameView.combat[].blockers` joined to their assigned attacker via the parent group).
- **Empty state:** "No attackers chosen" / "No blockers chosen" — passive prose, not a warning.
- **Truncation:** ledger lines clamp to 2 lines via `line-clamp-2`; overflow shows "…and 3 more."
- **No damage math.** Names + relationships only.

**Tests:** ledger lists names from a fixture combat group; updates on combat state change; empty state copy matches; truncates above 6 names.

**Acceptance:** in a declare-attackers fixture with 4 staged attackers, the ledger shows all four names. In declare-blockers, each blocker line correctly identifies which attacker it's blocking. Banner stays under the empirically-determined max height (see banner-sprawl note).

---

## Cross-slice considerations

### Banner sprawl

The banner grows in height with each slice (3-B adds a sub-title row, 3-C adds a meter row, 3-D adds 2 ledger rows). Ship-and-evaluate after each slice. **Hard limit:** the banner must not overlap the user's hand fan or the bottom-right floating action button at 1440p. If it threatens to, defer 3-D until Bundle 3 is re-scoped.

### Tabletop header budget

Slice 3-A re-introduces sub-step labels for the combat phase only. Outside combat, the header stays at ~24px (P3 win preserved). During combat, the header expands by ~14px to fit one row of sub-step labels — accept this as the cost of phase-awareness during the most-information-dense part of the turn.

### Accessibility

- Every text affordance uses semantic markup. Ribbon copy lives in a `<span>` with `aria-label="Priority status: …"`.
- `prefers-reduced-motion`: respected on tempo-meter ramps, banner top-highlight is static (no motion concern).
- Color is paired with shape/typography on every state cue (active-step orb has size + glow + position; ribbon copy uses small caps + accent; tempo-meter active tick has both opacity and translate). Color-blind users get redundant signals.

### File LOC trajectory

- `PhaseTimeline.tsx` is currently 273 lines; Slice 3-A adds maybe 60-80 lines. Comfortably under the 400 soft cap.
- `CombatBanner.tsx` is currently 152 lines; if all three banner slices land in-file, it would push past 400. **Plan: extract `CombatTempoMeter` (Slice 3-C) and `CombatStagedRecap` (Slice 3-D) into sibling files from the start.** Keep banner as the orchestrator.

### Test fixture coverage

- Need a fixture variant that places the local player mid-declare-attackers with 2-3 staged attackers, for Slice 3-D.
- Need a fixture variant where priority is on a remote player during a combat step, for Slice 3-A's `WAITING ON X` ribbon.
- Both fixtures can extend the existing `?game=fixture&variant=tabletop` mode without engine changes.

---

## Pre-coding breakage analysis

### Scope lock

This brief covers only the dashboard surface (`PhaseTimeline` + `CombatBanner`). It does NOT touch combat arrows, creature tiles, the focal-cell mutex, or the wire format. Anything outside that surface is a follow-up bundle.

### What I'm changing

- `webclient/src/game/PhaseTimeline.tsx` — extended; ~273 → ~340 lines.
- `webclient/src/game/dialogs/CombatBanner.tsx` — restructured; current 152 lines stays roughly stable as content moves to sub-components.
- New files: `PhaseTimeline.test.tsx`, `CombatTempoMeter.tsx` (+ test), `CombatStagedRecap.tsx` (+ test).

### What could break

- **P3 tabletop header budget** — addressed by gating sub-step label expansion to `activePhase === Combat`. Verify in slice-3-A test that header height is ≤24px when active phase is Beginning / Main / End.
- **Existing `CombatBanner` consumers** — `CombatBanner` is mounted from `Game.tsx` (likely) with two props (`stream`, `isAttackers`). The restructure preserves both props and the outer component shape; only internal layout changes. Existing testid selectors (`combat-banner-done`, `combat-banner-all-attack`, `combat-banner-title`, `combat-banner-message`) must continue to resolve.
- **`prefers-reduced-motion`** — tempo meter's ramp must skip cleanly; existing Tailwind `animate-pulse` already respects the media query so the orb is fine.
- **Banner draggability** — `useDraggable` wrapper at the top of `CombatBanner.tsx` must continue to work after restructure. Ledger and meter content sit *inside* the draggable container.

### Edge cases

- **Combat phase active but no combat groups** (BEGIN_COMBAT before any attackers declared) — Slice 3-D ledger shows "No attackers chosen" empty state.
- **Multiple defenders, mid-`gameTarget` swap** — `CombatBanner.tsx:21-26` describes the gameTarget banner taking over for defender pick. Slice 3-D's ledger should hide during this swap (the `pendingDialog.method !== 'gameSelect'` branch already early-returns).
- **Skip-state armed mid-step** — ribbon copy switches from `PRIORITY` to `PASSING` reactively as `me.skipState` changes.
- **`activePhase` and `activeStep` desync** in unusual fixtures — Slice 3-A test should include a fixture where `phase: 'COMBAT'` but `step` is still `BEGIN_COMBAT` to confirm the runway expands at phase boundaries.

### Schema impact

**None.** Schema 1.30+ exposes every field needed. No `schemaVersion` bump.

### Upstream rebase impact

**None.** All changes are in `webclient/src/`, which is ours. No upstream-tracked files touched.

### Test plan

- Per-slice unit tests as enumerated under each slice (above).
- Regression check: existing `useStopOnCombatSteps.test.tsx` and `CombatBanner.test.tsx` continue to pass without modification (4-A and 4-B leave behavior unchanged; 4-C and 4-D extend rather than alter).
- Pre-commit gate: `pnpm typecheck && pnpm lint && pnpm test` from `webclient/`.
- One manual `?game=fixture&variant=tabletop` walk-through per slice to confirm the visible behavior matches the spec.

---

## Open questions to resolve before Slice 3-D ships

- **Banner height at full ladder.** After 3-B + 3-C land, measure and record the banner height at 1440p. If it threatens overlap with hand fan / action button, drop 3-D's optional rows or defer.
- **Player-color dot in tempo meter (3-C stretch).** Does the dot follow the local player's commander color identity, or always the active player's? Default suggestion: local player's color, since the meter is about *your* priority cadence.
- **Ledger ordering.** Server-emitted insertion order is the standard pattern in this codebase (per `variant-tabletop.md` element 4). Confirm that's also right for the recap (likely yes).

---

## Sequence + acceptance criteria

| Slice | Ships | Gate to next |
|---|---|---|
| 3-A | Combat runway + active-step ribbon | Header stays ≤24px outside combat; ribbon copy correct in all 3 priority states |
| 3-B | Banner depth ladder | Banner footprint unchanged; existing testids resolve |
| 3-C | Tempo meter | Total per-step animation budget ≤200ms; `prefers-reduced-motion` clean |
| 3-D | Staged-action recap | Recap accurate against fixture combat groups; banner doesn't overlap hand fan at 1440p |

After 3-D lands, Bundle 3 is complete. Re-evaluate against the brainstorm's other bundles before opening the next branch.
