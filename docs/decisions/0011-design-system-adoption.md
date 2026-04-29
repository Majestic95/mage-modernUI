# 0011 — Design System Adoption + Spec Reconciliation

- **Status:** Accepted
- **Date:** 2026-04-29
- **Amends:** [ADR 0010 v2](0010-multiplayer-architecture.md) — D7 (design tokens), D11(a) (eliminated player), D11(e) (disconnect)
- **Deciders:** Austin
- **Scope:** Adopting the design-system + Commander 4p game-table spec authored in `docs/design/`. Locking the three reconciliation decisions reached during the gap-analysis pass. Sequencing the implementation push (slices 70-A through 70-G).

---

## Context

Two design specs landed in `docs/design/`:

- `design-system.md` — universal token / component / motion spec
- `screens-game-table-commander-4p.md` — concrete game-table screen, the largest single screen in the app

Both were authored without visibility into the existing codebase patterns (slices 50-71). A focused gap-analysis pass surfaced:

- ~9 of 15 spec'd components already exist under different names (`CardFace=CardTile`, `LifeTotal=LifeCounter`, `ZoneCounter=ZoneIcon`, `PhaseTimeline=PhaseIndicator`, `StackZone=Stack`, `CommandZone=CommandZoneSlot`, `GameLog=GameLogEntry`, `PlayerArea⊃PlayerFrame`, `ManaPool⊃ManaOrb`). The work is **rename + extend, not greenfield** for those.
- Most tokens (mana colors, status, surface, typography, spacing, radii, shadow, z-index) are net-new — `webclient/src/styles/tokens.css` from slice 69b ships only the four ADR-D7 wedge tokens (`--active-glow`, `--priority-glow`, `--targetable-accent`, `--focus-ring`, plus team-ring + badge-fill). Slice 70-A expands this to the full design-system surface.
- Most motion presets are partial — `transitions.ts` from slices 50-59 has 7 named springs + 4 ms constants; the design-system names 15 motions. ~half map cleanly (rename); ~half are net-new.
- Three places where the design spec contradicts ADR 0010 v2 architectural decisions and need explicit reconciliation.
- The reference screenshot (preserved in `target-visual-reference.md`) is the canonical visual target.

This ADR locks the reconciliation decisions and sequences the implementation slices.

---

## Decisions

### D1. Spectator UI — DEFERRED entirely from this push

**Decision.** The design-system spec assumed spectator mode reuses the player game-table verbatim with hand hidden. ADR 0010 v2 D2/D4/D8/D9/D11(c) decided spectator is its own UX (distinct route, perspective-rotation banner, pulse frames, "spectator UI is not a stripped player UI"). This push **defers spectator UI implementation entirely**. The server-side spectator route shipped in slice 71 and is stable; client-side spectator UX becomes a future v2.x slice with its own screen spec.

**Rationale.** ADR 0010 v2 D2/D4 was the result of a 4-reviewer architectural critique that surfaced load-bearing security + UX concerns (perspective leak via `processWatchedHands`, pulse frames during private decisions, the read-only contract). Building spectator UI inside the player-route component tree would either re-litigate those decisions or silently violate them. Keeping it deferred preserves the architecture and avoids a retrofit.

**Consequences.**
- `docs/design/screens-game-table-commander-4p.md` will be updated alongside slice 70-A: remove the verbatim-reuse claim, replace with a TBD reference to a future spectator-screen spec.
- Slices 70-A through 70-G build the player game-table only. No `mode="spectator"` flag, no hand-hidden variant, no read-only path through any of the new components.
- The slice-71 server-side spectator route stays operational. A follow-up v2.x slice will own the spectator-screen spec + implementation.
- **Spectator placeholder route (slice 70-A scope).** A user pasting a spectate URL today would hit a white screen / SPA route miss / generic 404 — that's "broken-looking," not "deferred." Slice 70-A owns a placeholder client route at `/spectate/:gameId` that renders a "Spectator mode is shipping in v2.x" message with the gameId echoed back and a link to the project status. This is a 1-component, 1-route addition; ships alongside the token migration since both touch the App Router shell. Critic finding: deferred features that 404 on the client are indistinguishable from bugs.

### D2. Eliminated player — KEEP-WITH-SLASH OVERLAY (overturns ADR 0010 D11a)

**Decision.** When a player is eliminated (life ≤ 0, 21 commander damage, concession, etc.), their pod **stays visible in the layout** with a red diagonal claw-rip slash overlay. Permanents fade out over 800ms. Player frame desaturates to grey. Halo desaturates. This **overturns ADR 0010 v2 D11(a)** which chose layout-drop via `selectOpponents`'s `hasLeft` filter (`webclient/src/game/battlefieldLayout.ts:18`).

**Rationale.** The screenshot reference + design spec lock a "you see your defeated foe's gravestone" UX intent. In 4p FFA, players want visual context for who's been eliminated (chat history reference, life-history glance, narrative pacing). The pre-fix layout-drop made the table feel like a 3p game once someone died, which was disorienting. The slash overlay is also more accessible (color-blind users get the diagonal-slash shape signal, not just desaturation) and matches MTGA's elimination treatment.

**Consequences.**
- Slice 70-D removes the `!p.hasLeft` filter from `selectOpponents` (or replaces it with a "preserve eliminated for slash overlay" pass). The new `PlayerFrame` component handles the eliminated-state rendering: frame desaturate + slash overlay + permanent fade-out.
- New tokens `--color-eliminated-slash` + `--color-eliminated-slash-outline` (paired — red fill + high-contrast outline so the diagonal-slash *shape* signals elimination even under deuteranopia/protanopia/tritanopia where the red collapses). Added to slice 70-A.
- The slash itself is rendered with ≥4px stroke width and a white outline beneath the red fill so the shape reads on dark teal backgrounds regardless of color perception. ADR 0010 D5 ("no information conveyed by color alone") preserved.
- New motion `ELIMINATION_SLASH` (Framer Motion + CSS keyframe combo), added to slice 70-B's motion registry.
- ADR 0010 v2 D11(a) text needs an "**Amended by ADR 0011 D2**" note inline, and the keep-with-slash contract documented there. The slice-69b commit's claim ("layout collapse is unambiguous and matches MTGA precedent") is **superseded** — MTGA actually uses the keep-with-slash treatment we now match. **Edit timing:** the inline note in `0010-multiplayer-architecture.md` D11(a) lands with slice 70-D's commit, alongside the code change that overturns the layout-drop.
- Test coverage corrections (per critic review): `battlefieldLayout.test.ts` has **one** test that asserts eliminated-filter behavior (`drops eliminated opponents`, lines ~109-122) — that gets inverted. The other `selectOpponents` test (`drops the local player even if they have left`) tests SELF-filter, not elimination-filter, and **stays unchanged**. The three `formatEliminationAnnouncement` tests need re-evaluation — eliminated names are now visible on screen, making the live-region announcement potentially redundant. Recommend keeping the announcer (a11y consumers don't see the slash) but verifying the wording isn't "Eliminated:" twice (visual + announce).
- Slice 70-D ships behind feature flag `VITE_FEATURE_KEEP_ELIMINATED` (default `false`). Slice 70-E flips the flag to `true` as part of the layout-shell rollout. Rationale: between 70-D and 70-E, the existing 3-col grid (ADR 0010 D5) would render a slashed pod in a grid cell that was previously collapsed — visually awkward "3-cell grid with one slashed cell" instead of "3-cell grid with active opponents." Feature flag avoids the broken-transitional state.
- Permanent fade-out scope: when an eliminated player's pod is preserved, the **permanents fade out over 800ms** but their **player frame, life total, name label, and avatar stay visible** with the slash overlay. Counters and attached auras fade with their host permanent (single Framer-Motion exit on the parent — no separate animation). Life total stays as narrative context ("Alice died at 0").
- Post-game-end behavior: when `gameState=ended` (1 survivor + N eliminated), the slashes fade to **40% opacity** so they don't dominate the post-game summary modal but still preserve the gravestone read.

### D3. Disconnect behavior — ADR 0010 D11(e) STANDS (overturns spec)

**Decision.** Disconnects do **not** pause the game for everyone. The ADR 0010 v2 D11(e) contract stands as the policy: simultaneous-action prompts hold for the per-prompt timeout (60s default), then auto-pass for the disconnected player and emit `dialogClear`. The disconnected player's pod desaturates with a "DISCONNECTED" text overlay; the game continues for the others.

**Rationale.** The design spec said "the game pauses for everyone when any player disconnects." This is a denial-of-service vector — any one player's flaky network breaks the table for everyone, including griefing patterns where someone repeatedly disconnects to stall. The ADR's per-prompt timeout was deliberately chosen to bound the impact: only the active prompt waits, only for 60 seconds, only for the disconnected player. The visual treatment (desaturated pod + overlay text) is preserved from the spec; the game-flow behavior follows the ADR.

**Implementation status (corrected by ADR 0011 critic pass).** Critic finding: ADR 0010 v2 D11(e) was originally assigned to **slice 70**, not slice 71 (`0010-multiplayer-architecture.md:256` — "Slice 70 implements (d) `dialogClear` rate-limit + (e) simultaneous-action timeout"). The actual slice 70 that shipped was a **re-scoped observability-only slice** (admin /metrics + 5 counters); the per-prompt timeout work was deferred without an explicit ADR note. As of this push, **D11(e) is unshipped** — the policy stands but the code does not. Don't assume this code exists when implementing slice 70-D's PlayerFrame disconnect handling.

**Sub-slice 70-H queued.** Per-prompt timeout work — 60s default `MatchOptions.disconnectTimeoutSec`, server-side timer state in `WebSocketCallbackHandler` keyed by `(gameId, awaitingPlayerId)`, cancel-on-reconnect, emit `dialogClear` on timeout — lands as **slice 70-H** after slice 70-G's polish pass. Until then, the visual treatment from D2 (desaturated pod + DISCONNECTED overlay) ships in slice 70-D, but disconnects in v2.0 still allow the game to hang on the disconnected player's prompt indefinitely; same as v1.x and slice-71-shipped behavior.

**Controller-of-target-leaves edge case.** Per ADR 0010 v2 D11 slice-69d deferral note, two cases sit outside D11(e)'s timeout contract:
- `gameAsk` with leaver-named-in-message-text (engine skips server-side, client dialog stays visible until next gameUpdate)
- `gameSelect` with controller-of-target-leaving (e.g., declare-blockers prompt directed at a player who concedes mid-prompt — `targets` carries permanent UUIDs not player UUIDs, so the leaver-in-targets check structurally misses)

These are user-survivable (engine progresses correctly; only the visual cue is delayed) and remain deferred to slice 73-77 polish. **Slice 70-D's PlayerFrame implementation must NOT attempt to fix these** — they need their own architectural decision.

**Consequences.**
- `docs/design/screens-game-table-commander-4p.md` "Disconnected player" subsection updates to: "the prompt the disconnected player owes a response on holds for the per-prompt timeout (60s default) before auto-passing — the game does NOT pause globally. Until slice 70-H ships the timer, disconnects hang on the active prompt indefinitely." Visual treatment (desaturate + overlay) unchanged. Edit lands with slice 70-D.
- Slice 70-D body adds a single visual disconnect-overlay state (`PlayerFrame state="disconnected"`) but does NOT implement the timer.
- Slice 70-H scope: `MatchOptions.disconnectTimeoutSec` field (additive), per-handler timer state, cancel-on-reconnect, emit `dialogClear` with `reason: 'TIMEOUT'`, schema 1.22 dialogClear reason enum extension. Slice 70-H is its own recon→builder→critic→fixer cycle and may displace the v2.0 tag if the user wants it bundled.

### D4. Spec precedence rule for everything else

**Decision.** For all design decisions NOT covered by D1-D3 above — themes, layouts, formats, motion specifications, component anatomy, color/typography/spacing tokens — the design spec takes precedence over the existing implementation. ADR 0010 v2 architectural decisions (state-machine, wire format, security boundaries, observability) remain locked; visual/UX decisions defer to the spec.

**A11y carve-out (critic finding).** Where the design spec is silent on accessibility — aria-live, tabIndex order, aria-label, keyboard nav, screen-reader semantics — the **ADR 0010 D5 + D13 a11y contract applies unchanged**. Spec silence is NOT permission to remove. Specifically, all of the following must survive every slice 70-A through 70-G commit:
- ARIA-live priority announcer at the layout root (slice 69b)
- Clockwise tab order from local seat: self → opp-right → opp-top → opp-left → battlefield → stack (slice 69b D13)
- `aria-label` on every PlayerFrame / CardTile / dialog button (slice 69b)
- ARIA-live elimination announcer (slice 69d)
- `prefers-reduced-motion` honored for ambient + hover + pulse animations (essential card-zone movement preserved per spec §6.3)

If a spec'd component would silently drop one of these contracts, the slice is blocked until reconciled.

**Token namespace migration (critic findings B1+B2).** The reconciliation logic in this ADR — combined with `design-system.md`'s "prefer existing" rule — produced a circular standoff. Resolution: **migrate existing tokens to the spec's `--color-*` namespace as part of slice 70-A**. There are only 8 existing tokens in `webclient/src/styles/tokens.css` (slice 69b: `--active-glow`, `--priority-glow`, `--targetable-accent`, `--focus-ring`, `--team-ring-a..d`, `--badge-fill-{goad,monarch,initiative}`) and ~10 consumers; the migration cost is bounded. Mapping:

| Existing | Becomes |
|---|---|
| `--active-glow` | `--color-team-active-glow` |
| `--priority-glow` | `--color-team-priority-glow` |
| `--targetable-accent` | `--color-card-frame-targeted` (spec name) |
| `--focus-ring` | `--color-focus-ring` |
| `--team-ring-a..d` | `--color-team-{a..d}-ring` |
| `--badge-fill-{goad,monarch,initiative}` | `--color-badge-{goad,monarch,initiative}` |

After 70-A, every token in `tokens.css` follows the `--color-*` (or other `--{category}-*`) namespace. Schizophrenic naming avoided.

**Consequences.**
- Slice 70-A onwards systematically migrates the codebase to the spec's surface.
- Component renames pick the spec's names (`CardTile`, `LifeCounter`, `ZoneIcon`, `PhaseIndicator`, `Stack`, `CommandZoneSlot`, `GameLogEntry`, `PlayerFrame`, `ManaOrb`) and consumers update accordingly. Existing Java backend / wire format / store keys are unchanged — this is pure client-presentation rename.
- Token names follow the migration table above. Net-new tokens (mana colors, status, surface, etc.) adopt the spec's names verbatim.
- A11y contracts from ADR 0010 D5 + D13 are explicitly preserved across the entire push.

### D5. Color-identity on the wire — schema 1.21

**Decision.** Schema bumps to **1.21** with one additive field: `WebPlayerView.colorIdentity: string[]`. Server-side mapper derives from the player's commander card's color identity (or empty array for non-commander formats). The new player-halo ring consumes this for the multicolor band rendering.

**Rationale.** The spec's player halo requires color-identity data that isn't on the wire today. Schema 1.21 is additive (default-safe — older clients ignore the field, older servers omit it and the client falls back to a neutral grey halo). Slice 70-D depends on this field; the schema bump lands ahead of slice 70-D as a sub-step.

**Consequences.**
- New schema 1.21 entry in `docs/schema/CHANGELOG.md`.
- `WebPlayerView` Java record adds `List<String> colorIdentity` field. Mapper populates from `CommanderView.getColorIdentity()` or equivalent upstream accessor.
- `webPlayerViewSchema` adds `colorIdentity: z.array(z.string()).default([])`.
- `PlayerFrame` consumes `player.colorIdentity` for halo rendering.

**Halo state matrix (critic finding B2 — disambiguates from disconnect):**

| Game type | colorIdentity | Halo treatment |
|---|---|---|
| Commander, single color | `["G"]` | Solid green ring (`--color-mana-green-glow`) |
| Commander, multicolor | `["U","B"]` | Multi-band rotation (5 distinct bands at 12s/rev) |
| Commander, colorless | `[]` (empty array) | Silver/grey ring (`--color-mana-colorless`) — same token as mana-colorless to keep "five colors" semantics |
| Non-commander format (Two Player Duel, FFA basic) | `[]` (empty array) | **Neutral team-ring** (`--color-team-neutral` — new token, slice 70-A) — **NOT grey**, because grey collides with the disconnected/eliminated treatment |
| Disconnected | (any colorIdentity) | Halo desaturates to grey via CSS `filter: grayscale(1)` regardless of colorIdentity |
| Eliminated | (any colorIdentity) | Halo fades to grey + slash overlay (D2) |

The "non-commander format gets neutral team-ring not grey" rule is load-bearing: a Two Player Duel player should not visually look like they're disconnected. Slice 70-A adds `--color-team-neutral` as a new token (recommend a soft slate-blue tuned for the dark teal-black background); slice 70-D's PlayerFrame uses it as the fallback when `colorIdentity` is empty AND the format is non-Commander.

Format detection: derive from the game type string (e.g., `gameType` field on the WebGameView, or check whether commandList is empty across all players — empty across all = non-commander format). Slice 70-D picks the cleanest signal during recon.

### D6. Slice sequencing (7 slices)

**Decision.** Implementation proceeds in 7 atomic slices, sequenced bottom-up of the dependency tree. Each ships independently with its own recon → builder → critic → fixer → commit cycle, with **GUI / UX / UI / graphical specialists** added to the critic phase per the user's agentic-team directive.

| Slice | Size | What |
|---|---|---|
| **70-A** | M (~250 LOC, was S 150 — increased per critic) | **Tokens.** Add 11 mana colors, status colors, surface/bg, radii, shadow, z-index. **Migrate existing 8 tokens to `--color-*` namespace** (D4 — `--active-glow` → `--color-team-active-glow`, etc.) + update its 2 actual consumers (ManaPool, PlayerArea — verified via grep). CardFace + BattlefieldTile literal-color migration **deferred to slice 70-C** per recon — those slices rewrite the consuming components anyway, so migrating in 70-A would be churn. **Add `--color-team-neutral`** (D5 fallback for non-Commander formats). **Add `--color-eliminated-slash` + `--color-eliminated-slash-outline`** (D2 paired tokens for color-blind safety). **Add spectator placeholder route at `/spectate/:gameId`** rendering "Spectator UI shipping in v2.x" message. **Mana hex sign-off gate:** recon phase produces a 14-value table (5 mana colors + colorless + multicolor + 7 `-glow` variants) for user approval **before** the builder phase commits. |
| **70-B** | M (~150 LOC, was S 80 — increased per critic) | **Motion registry.** Add `CARD_DRAW`/`CARD_HOVER_LIFT`/`STACK_GLOW_PULSE_KEYFRAMES`/`PLAYER_ACTIVE_HALO_KEYFRAMES`/`CARD_TARGETED_PULSE`/`PRIORITY_TAG_FADE`/`ELIMINATION_SLASH`. **Scope-fix the global `prefers-reduced-motion` rule in `index.css:32-41`** (B4 critic finding) — currently kills ALL animations including spec-essential card-zone movement. New scoped rule: ambient (`particle-drift`) + hover (`card-hover-lift`) + pulses (`stack-glow-pulse`, `player-active-halo`) honor reduced-motion; card-zone movement (`LAYOUT_GLIDE`, `card-resolve`, `game-start-deal`) does NOT. Implementation: add `data-essential-motion` opt-out attribute on the global rule, mark essential-motion elements explicitly. **Motion-parameter contract (B3 critic finding):** spec-named aliases preserve EXISTING parameters; the `design-system.md` motion section gets updated with actual numbers (e.g., `card-tap` becomes spring with `MANA_TAP_ROTATE` parameters, not the spec's "180ms ease-out"). Spec doc updates accompany this slice. |
| **70-C** | M (~250 LOC) | **Atoms.** Extract `ManaOrb`, `LifeCounter` (with interactive mode for commander damage), `PriorityTag`, rename/reshape `ZoneIcon`. Consumes `--color-mana-*` from 70-A. |
| **70-D** | L (~400 LOC, was M 300 — increased per critic N4) | **PlayerFrame + colorIdentity.** Extract from PlayerArea; add portrait + halo + 4-position rotation + animated states. **Schema 1.21 bump for `WebPlayerView.colorIdentity`** (additive, default `[]` — Java record + Zod + CHANGELOG + mapper test refresh). **Halo state matrix from D5** (Commander single/multi/colorless, non-Commander neutral, disconnected, eliminated). **Eliminated overlay (D2)** behind feature flag `VITE_FEATURE_KEEP_ELIMINATED=false` default. Disconnect overlay (visual only — D11e timer is sub-slice 70-H). ADR 0010 D11(a) inline "Amended by ADR 0011 D2" note added to the file in this commit. `battlefieldLayout.test.ts` test inversion (1 test, not 5). |
| **70-E** | **XL (~600 LOC, was L 500 — increased per critic R7)** | **6-region layout shell.** New `GameTable.tsx` with CSS Grid: header / 4-pod battlefield with center focal zone / hand / right side panel / action area. Stack moves to center; right panel hosts PhaseIndicator + GameLog + CommanderDamageTracker. **Flips `VITE_FEATURE_KEEP_ELIMINATED=true`.** **Dialog router preservation (R7 new risk):** the existing `dialogs/GameDialog.tsx` + 14 sub-files mount under `Battlefield`'s orchestrator today; 70-E must explicitly preserve every dialog mount-point in the new shell. Recon-phase deliverable: a dialog-mount-point inventory mapping each existing mount to its new home (typically the central focal zone for Choose/May prompts; full-screen modal for mulligan/library-search; small modal for scry/surveil). **Layout breakpoint testing at 1280×720 + 1920×1080 + 2560×1440** mandatory. **Largest slice — do not bundle.** |
| **70-F** | M (~250 LOC) | **TargetingArrow + CommanderDamageTracker + 4p mulligan UI + ambient particle-drift.** |
| **70-G** | M (~200 LOC) | **Polish motion pass.** `card-hover-lift` Framer migration, `stack-glow-pulse`, `life-tick` integer ticking, `game-start-deal` opening-hand stagger. |
| **70-H** | M (~250 LOC) | **D11(e) per-prompt timeout** (D3 deferred work). Server-side timer keyed by `(gameId, awaitingPlayerId)` in WebSocketCallbackHandler; cancel-on-reconnect; emit `dialogClear{reason: 'TIMEOUT'}`. `MatchOptions.disconnectTimeoutSec` field (additive, default 60, bounds [30, 180]). Schema 1.22 dialogClear `reason` enum extension. Optional bundle with v2.0 tag, or ship as v2.0.1. |

**Dependency tree (critic Nit2):**

```
70-A (tokens + namespace migration + spectator placeholder)
  ├──> 70-C (atoms consume --color-mana-*, --color-team-*-glow)
  └──> 70-D (PlayerFrame consumes halo tokens + new --color-team-neutral)
70-B (motion registry + reduced-motion scope fix)
  ├──> 70-D (PlayerFrame uses ELIMINATION_SLASH + PLAYER_ACTIVE_HALO_KEYFRAMES)
  └──> 70-G (polish slice consumes new motions)
70-A + 70-B can ship in parallel (disjoint surfaces)
70-C + 70-D both depend on 70-A; 70-D additionally depends on 70-B
70-D --> 70-E (PlayerFrame must exist before layout shell consumes it)
70-E --> 70-F (TargetingArrow / CommanderDamageTracker land in the new shell's regions)
70-E --> 70-G (polish layers on the new shell)
70-H standalone (server-side timer; can ship anytime after 70-D's PlayerFrame disconnect overlay exists)
```

**Rationale.** Bottom-up sequencing means each slice's consumers exist before they need to consume. 70-A and 70-B can ship in parallel if needed. 70-E is the structural rewrite gate — until the 6-region shell exists, polish has no home. 70-H is decoupled (server-side, doesn't gate any client slice). After 70-G + 70-H, the v2.0 tag is ready.

### D7. Agentic team for design slices — specialist matrix per slice

**Decision.** Each design-spec slice's critic phase spawns specialist reviewers from the following pool:

- **Technical critic** — architecture, code-correctness, test coverage, ADR alignment.
- **GUI specialist** — overall layout, component hierarchy, screen structure, region arrangement, responsive behavior.
- **UX specialist** — interaction patterns, user flows, click/hover/keyboard/touch behavior, error states, edge cases, accessibility (with a11y carve-out per D4).
- **UI specialist** — visual fidelity to spec + reference screenshot, design-system token adherence, typography, spacing, color, contrast.
- **Graphical specialist** — motion correctness vs design-system §6.4, animation timing, easing, reduced-motion compliance, ambient effects.

Plus a **synthesis pass** that integrates findings before the fixer phase begins.

**Per-slice specialist matrix (cost-bounded per critic N5).** Not every slice needs all 5 specialists. Token-only and motion-only slices have no interaction surface and don't benefit from a UX or GUI reviewer. Mapping:

| Slice | Specialists invoked |
|---|---|
| 70-A (tokens + namespace) | **Technical + UI** (2 reviewers) — pure token plumbing, no interaction, no motion, no layout |
| 70-B (motion registry) | **Technical + Graphical** (2 reviewers) — motion only, no UI, no UX |
| 70-C (atoms) | **Technical + UI + UX** (3 reviewers) — interactive but small surface |
| 70-D (PlayerFrame + schema 1.21 + eliminated overlay) | **Technical + UI + UX + Graphical + GUI** (5 reviewers, full panel) — schema bump + visual + behavior + motion + structural |
| 70-E (6-region layout shell) | **Technical + GUI + UI + UX + Graphical** (5 reviewers, full panel) — the structural gate, every dimension matters |
| 70-F (TargetingArrow + CommanderDamage + mulligan + particles) | **Technical + UI + UX + Graphical** (4 reviewers, no GUI — layout already locked by 70-E) |
| 70-G (polish motion pass) | **Technical + Graphical + UI** (3 reviewers) — motion polish + visual fidelity |
| 70-H (per-prompt timeout) | **Technical + UX** (2 reviewers) — server-side timer + UX of timeout/auto-pass |

**Cost estimate.** ~24 specialist-runs across 8 slices (including 70-H), plus 8 syntheses + 8 builders + 8 fixers + 8 commits. Vs the naive "5 specialists per slice" approach (~40 runs), this saves ~16 specialist-runs across the push. Slice 70-A's 2-reviewer pass is enough; slice 70-E's 5-reviewer pass is genuinely needed.

**Rationale.** Per-domain specialist review surfaces issues a generalist critic misses. The slice-68 ADR review (4 specialists + synthesis) produced this very ADR's predecessor and validated the pattern. Per-slice scaling reflects what each slice actually exercises.

**Consequences.**
- Each slice's recon-builder-critic-fixer-commit cycle dispatches specialists per the matrix.
- Synthesis step integrates findings before the fixer phase.
- BLOCKERs from any reviewer must resolve before commit; NOTABLEs are negotiated; NITs may defer.
- The reference screenshot in `target-visual-reference.md` is part of the briefing for UI + Graphical specialists (D8).

### D8. Reference screenshot is canonical for vocabulary, templated for content

**Decision.** The reference screenshot described in `docs/design/target-visual-reference.md` is the **canonical visual target for vocabulary + layout proportions** (dark teal-black background, 4-pod arrangement around a center focal zone, MTGA-grade information density, halo treatment, glow language, motion semantics). User content (specific avatars, commander art, life totals, log entries, commander damage values) is **templated**, not locked — different games will populate these differently.

**Where the design-system spec or screen spec is ambiguous, the screenshot wins.** Where the screenshot disagrees with the spec, flag the conflict back rather than silently picking either.

**Screenshot-derived but unspec'd values (slice-deferred with user sign-off, per critic N2):**

The following load-bearing visual values are visible in the screenshot but not committed in either spec doc. Each lands during the slice that builds the consuming surface, with explicit user sign-off in that slice's recon phase:

| Value | Slice owner | Decision gate |
|---|---|---|
| Dark teal-black gradient background stops | 70-A (`--color-bg-base` may need a paired `--gradient-bg-base`) | User picks the 2-3 gradient stops + direction; recon agent proposes options |
| Soft purple header text color ("COMMANDER — 4 PLAYER FREE-FOR-ALL") | 70-A or 70-E | Probably `--color-accent-primary` at reduced opacity or a dedicated `--color-text-display` token |
| End Step button purple hex | 70-A | The screenshot's `--color-accent-primary` peg — user signs off on hex |
| Mana color hexes (5 + colorless + multicolor + 7 -glow variants = 14 values) | 70-A | Recon-phase produces a table; user approves before builder |
| `--color-team-neutral` hex (D5 — non-Commander format halo fallback) | 70-A | Soft slate-blue tuned for dark teal-black; user signs off |
| `--color-eliminated-slash` red hex + `--color-eliminated-slash-outline` light hex (D2) | 70-A | Verified against deuteranopia/protanopia/tritanopia simulators |
| Focal-zone glow CSS impl (`box-shadow` vs `filter: drop-shadow`) | 70-E or 70-G | Trade-off: drop-shadow respects rounded corners + alpha; box-shadow doesn't on transparent-bg cards. Recon picks |
| Player portrait art source (Scryfall fetch on-the-fly vs commander-specific assets) | 70-D | Spec §9 says yes-Scryfall for cards; ambiguous for portraits. Recon picks |
| Tooltip preview delay-to-show / dismissal / content-shape | 70-G or follow-up screen-spec amendment | Recommend 200ms delay, ESC + move-out dismissal, Scryfall scan for content |

**Canonical screenshot location.** The PNG itself is not committed (license-sensitive — official Wizards card art). The textual description in `target-visual-reference.md` preserves load-bearing details verbatim. **Recommendation per critic Nit1:** if/when the user can produce a non-Wizards-art mockup or stylized wireframe, commit it under `docs/design/assets/target-game-table.png`. Until then, the textual description is the canonical reference for cold-context reviewers.

**Rationale.** Specs in markdown can be incomplete or inconsistent; a single reference image grounds visual intent unambiguously. The `target-visual-reference.md` doc preserves the screenshot's load-bearing details verbatim so future agents (and parallel design Claudes) can match intent. Enumerating the screenshot-derived gaps surfaces decisions that would otherwise leak into ad-hoc per-slice choices.

---

## Risk register

### R1. Token rename churn

Slice 70-A migrates ~10 existing components from literal Tailwind classes to tokens. Risk: a missed consumer. Mitigation: lint rule (custom ESLint plugin) flags hex/Tailwind-color literals on newly-added semantic surfaces; gradual migration is acceptable (existing literals stay until next polish pass).

### R2. Motion timing regression

Slice 70-B adds new motions and renames existing ones. Risk: subtle timing changes on existing animations break user muscle memory. Mitigation: existing presets (`MANA_TAP_ROTATE`, `STACK_ENTER_EXIT`, etc.) keep their parameters even when getting new spec-aligned aliases. New aliases reference existing presets, no parameter change.

### R3. Schema 1.21 forward-compat

`WebPlayerView.colorIdentity` is additive but adds a server obligation: the mapper must derive from the live commander card. Risk: non-commander formats (which are what we ship today — Two Player Duel, Free For All) have no commander, so the field is empty. Mitigation: mapper returns `List.of()` when no commander exists; client renders neutral grey halo for empty array.

### R4. Eliminated-player overlay performance

Keep-with-slash means N pods still render after eliminations. Risk: 3 simultaneous eliminations in a 4p game = 3 fading-permanent animations + 3 desaturate transitions concurrently. Mitigation: the desaturate is a CSS `filter: grayscale(1)` (no React state), the slash is a single SVG overlay, the permanent fades are existing Framer presets. Total cost is bounded; benchmark on 4p FFA at slice 70-D test phase.

### R5. 6-region layout breakpoint behavior

Slice 70-E ships a CSS Grid shell at 1920×1080 target. Risk: 1280×720 minimum (per spec §8.1) requires the layout to work at that size without breakpoint snapping. Mitigation: use `minmax()` + `fr` units, not fixed pixels. Test at 1280×720 + 1920×1080 + 2560×1440 during slice 70-E critic phase.

### R6. ADR D11(a) amendment cross-references

Slice 69b's commit message references "layout-collapse is unambiguous and matches MTGA precedent" — this is now wrong. Risk: a future contributor reading slice 69b's commit doesn't know D11(a) was amended. Mitigation: the existing battlefieldLayout.ts code comment will get an "**Amended by ADR 0011 D2**" note in slice 70-D. ADR 0010 D11(a) gets the same inline note.

### R7. Slice 70-E dialog-flow regression (added per critic N2)

The 6-region layout shell rewrite touches the orchestrator that mounts every dialog (`dialogs/GameDialog.tsx` + 14 sub-files). Risk: a dialog-mount-point that depended on `Battlefield.tsx`'s structure breaks silently after the rewrite. Mitigation:
- 70-E recon phase deliverable: dialog-mount-point inventory mapping each existing mount → new home in the 6-region shell (typically center focal zone for Choose/May, full modal for mulligan/library-search, small modal for scry/surveil per spec §Modals).
- Test gate: every existing dialog flow integration test in `e2e/` and unit tests in `webclient/src/game/dialogs/__tests__/` must pass against the new shell before commit.
- Game.tsx as the parent orchestrator is the right point of intersection — keep its dialog-routing concerns; only relocate the rendering region.

### R8. Schema 1.21 mapper test refresh (added per critic N4)

The 1.21 schema bump for `colorIdentity` is additive + default-safe, but mapper jsonShape locks (`GameViewMapperTest.java`, `CardViewMapperTest.java`) include field-count assertions that will increment by 1. Risk: missing the field-count update causes a mapper test failure that's mis-attributed to a real regression. Mitigation: 70-D recon phase produces a checklist of every `assertEquals(N, node.size())` that needs updating. Field-count tests also lock the wire-format stability — they're the right place for this guard.

### R9. D11(e) per-prompt timeout is unshipped, not "no code change" (added per critic B1)

ADR 0010 v2 D11(e) was originally assigned to slice 70 (`0010-multiplayer-architecture.md:256`); the actual slice 70 was re-scoped to observability, leaving the timer unshipped. ADR 0011 D3's first draft incorrectly claimed "no code change beyond what slice 71 already shipped" — corrected in fixer pass. Risk: a future agent reading D3 v1 assumes the timer exists and builds against it. Mitigation: D3 now explicitly states D11(e) is unshipped + queues slice 70-H for the work. Inline cross-reference between D3 and slice 70-H scope.

---

## Update log

- **2026-04-29 (v1)** — initial publication. Locks D1-D8, accepts the 7-slice plan, names ADR 0010 amendments.
- **2026-04-29 (v2 — current)** — fixer pass after 3-specialist critic review (technical / UX / UI-visual). Material changes:
  - **D3 corrected** — D11(e) per-prompt timeout is unshipped (originally assigned to slice 70 in ADR 0010, but actual slice 70 was re-scoped to observability). Added slice 70-H to queue the work + R9 risk-register entry. Controller-of-target-leaves edge cases explicitly deferred to 73-77.
  - **D1 expanded** — slice 70-A now ships a spectator placeholder route at `/spectate/:gameId` so deferred ≠ broken-looking 404.
  - **D2 expanded** — added paired `--color-eliminated-slash` + `--color-eliminated-slash-outline` tokens for color-blind safety; permanent fade scope clarified (counters/auras fade with host; life total + avatar stay visible behind slash); slashes fade to 40% opacity post-game-end; `battlefieldLayout.test.ts` test-inversion count corrected (1 test, not 5); slice 70-D now ships behind feature flag `VITE_FEATURE_KEEP_ELIMINATED` (default false) flipped by 70-E.
  - **D4 expanded** — explicit a11y carve-out (slice 69b D5+D13 contracts preserved despite spec silence); token namespace migration to `--color-*` decided + mapping table for 8 existing tokens.
  - **D5 expanded** — halo state matrix (Commander single/multi/colorless, non-Commander neutral, disconnected, eliminated). Non-Commander format gets `--color-team-neutral`, NOT grey, to disambiguate from disconnected.
  - **D6 reshaped** — slice sizes increased per critic findings (70-A S→M, 70-B S→M, 70-D M→L, 70-E L→XL); explicit dependency tree; slice 70-H added for the D11(e) timeout deferred work.
  - **D7 reshaped** — per-slice specialist matrix (token-only slices need 2 reviewers, structural slices need 5). Saves ~16 specialist-runs vs naive 5-per-slice.
  - **D8 expanded** — enumerates 9 screenshot-derived but unspec'd values requiring user sign-off in the consuming slice's recon phase.
  - **R7-R9 added** to risk register: dialog-flow regression on 70-E layout rewrite, schema 1.21 mapper field-count tests, D11(e) unshipped status.

---

## References

- [ADR 0010 v2 — Multiplayer architecture](0010-multiplayer-architecture.md) (D2 spectator hidden info, D4 spectator route, D7 design tokens, D8 sit-anywhere, D9 information density, D11a eliminated player [amended], D11c reconnect-after-elim, D11e disconnect timeout)
- [docs/design/design-system.md](../design/design-system.md) — universal design system
- [docs/design/screens-game-table-commander-4p.md](../design/screens-game-table-commander-4p.md) — Commander game-table screen spec
- [docs/design/target-visual-reference.md](../design/target-visual-reference.md) — canonical visual target + reconciliation log
- Existing tokens: `webclient/src/styles/tokens.css` (slice 69b)
- Existing motion registry: `webclient/src/animation/transitions.ts` (slices 50-59)
- Existing layout: `webclient/src/game/Battlefield.tsx` (slice 57 + 69b grid)
- Slice-69b layout-drop: `webclient/src/game/battlefieldLayout.ts:14-19` (to be overturned per D2)
- Wire format: `webclient/src/api/schemas.ts` + `docs/schema/CHANGELOG.md` (currently 1.20; bumps to 1.21 in slice 70-D per D5)
