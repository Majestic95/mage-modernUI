# Redesign Slice Plan — Slice 70-I through 70-P (and 70-Z polish)

> **Source of truth:** [`picture-catalog.md`](picture-catalog.md). Every slice in this plan references catalog regions; if a slice's implementation doesn't match the catalog entry, the slice is not done regardless of test pass.
>
> **Created:** 2026-04-29
> **Status:** Plan locked, ready to execute starting with slice 70-I.
> **Estimated total:** 8 architectural/standard slices + 1 polish pass = ~6-10 sessions at our usual cadence.

---

## Operating principles (locked from user input)

1. **Picture catalog is the source of truth** — every visual decision references it.
2. **Single morphing ActionButton** — replaces the current multi-button toolbar (hotkeys preserved invisibly).
3. **Feature flag the redesign** — `VITE_FEATURE_REDESIGN=1` flag gates all changes; old layout stays usable for friend playtests during development.
4. **Visual verification at every slice:**
   - During slice: foreground `npm run dev` + Playwright OR manual screenshot at 1920×1080.
   - End of slice: deploy a Vercel preview, user signs off before next slice begins.
5. **Mana-payment UI rebuild deferred** to 70-Q (after the visual identity lands).
6. **Battlefield rows are traditional MTG-style flat horizontal rows.** Curved arrangements (top opponent's cards arcing above the portrait, left/right pods curving along the edge) are **explicitly out of scope** per user direction 2026-04-30 — not deferred-to-polish, just dropped from the plan entirely. The picture's curved appearance is decorative only and not a fidelity target.
7. **PhaseTimeline kept as-is** in v1 (rich timeline is more informative than spec's simpler version).
8. **Concede moves to settings menu** (not always-visible).
9. **Lobby name in header is hardcoded** based on game type for v1 (real lobby-name plumbing is a separate task).

---

## Slice tier-by-risk matrix (per CLAUDE.md cadence reform)

For each slice, the tier table picks the critic panel:

| Tier | Critics that run |
|---|---|
| Mechanical (rename / token migration only) | Technical |
| Standard (1-2 components, props change, no new architecture) | Technical, UI |
| Architectural (cross-component, new data flow, structural rewrite) | Technical (parallel-with-builder), UI, UX |
| Trivial (typo, comment, single-line) | none |

Slices 70-J / 70-K / 70-M / 70-N are architectural. Slices 70-I / 70-L / 70-O / 70-P are standard. 70-Z is its own thing (polish; no critic — runs as a tuning pass with the user signing off).

---

## Pre-slice setup (one-time, before 70-I)

### Setup A — Add the feature flag

- File: `webclient/src/featureFlags.ts`
- Add: `export const REDESIGN = import.meta.env['VITE_FEATURE_REDESIGN'] === '1';`
- Default `VITE_FEATURE_REDESIGN` unset → `false` (current layout).
- Once set in `.env.local` or via env var → `true` (redesigned layout).
- All redesign slices gate their changes behind this flag.
- Old layout stays as the implementation behind `false`. Don't delete it until 70-P signs off.

### Setup B — Add a redesign-mode dev script

- `package.json` script: `"dev:redesign": "VITE_FEATURE_REDESIGN=1 vite"`
- So the user can `npm run dev:redesign` to render the new layout, `npm run dev` for the old.

### Setup C — Visual verification harness

- Add `tests/redesign/screenshot.spec.ts` (Playwright) that loads the dev server, navigates to a fixture game, and screenshots each region at 1920×1080.
- Each slice updates the fixture / adds a new region screenshot.
- The Playwright spec is for during-slice iteration. Vercel preview is for end-of-slice user sign-off.

### Setup D — Commit conventions

Each slice commits to `main` (no separate branch — the feature flag protects the production deploy). Message format:
```
feat(redesign): slice 70-X — <region/component>

<picture-catalog reference>

Behind VITE_FEATURE_REDESIGN flag. Old layout preserved.

<test summary>
```

---

## Slice 70-I — Card-size tokens + CardFace refactor

**Tier:** Standard (token migration + CardFace prop refactor)
**Catalog reference:** §0 (implementation cross-reference table) + §3.1 (focal size) + §4.1 (large hand) + §2.1 (per-position card sizes)
**Picture region:** N/A (no visual change yet — pure infrastructure)

### Scope

1. Define the 5 card-size tokens in `tokens.css`:
   ```css
   --card-size-micro:  20px;   /* graveyard / exile stack indicator */
   --card-size-small:  72px;   /* opponent battlefield (90% of medium) */
   --card-size-medium: 80px;   /* local battlefield */
   --card-size-large:  120px;  /* hand */
   --card-size-focal:  170px;  /* central focal zone (~150% of medium-via-spec, but tuned for readability) */
   ```
   (Width values shown — height = `width × 7/5` for 5:7 aspect.)

2. Refactor `CardFace.tsx` to accept a `size` prop that reads from these tokens (no more inline pixel constants).

3. Refactor `BattlefieldTile.tsx` to thread the size prop from a perspective hint (self / opponent → medium / small).

4. Refactor `MyHand.tsx` to use `--card-size-large`.

5. Refactor `StackZone.tsx` to use `--card-size-focal` for topmost (preview the 70-N rewrite — full focal-zone redesign comes in 70-N, but the size prop wires here).

### Behind the flag

- This slice is **NOT flag-gated** — it's a pure infrastructure migration that benefits the old layout too. Card sizes already vary today; the refactor consolidates them onto tokens.

### Sign-off

- Local dev server screenshot of the current layout — visually identical (no regressions). Tests pass.

### Risks / blockers

- None. Pure refactor. Existing tests should catch any size regressions.

---

## Slice 70-J — PlayerPortrait component

**Tier:** Architectural (new component, new data flow from gameView to Scryfall)
**Catalog reference:** §2.0 (common pod anatomy — portrait, halo) + §5.A (game log avatar) + §5.B (commander damage cell)
**Picture region:** Each circular commander avatar.

### Scope

1. New component `webclient/src/game/PlayerPortrait.tsx`:
   - Props: `player: WebPlayerView`, `size: 'small' | 'medium' | 'large'` (32 / 80 / 96 px), `haloVariant: 'circular' | 'none'`.
   - Resolves the player's commander's image via existing `scryfall.ts` art-crop URL.
   - Renders a circular `<img>` cropped via `border-radius: 50%` + `object-fit: cover`.
   - Halo ring (when `haloVariant: 'circular'`) — uses the existing mask-composite pattern from `PlayerFrame.tsx:309-362` but applied to a circular wrapper.
   - Active / multicolor / disconnected / eliminated states compose on top — same machinery as current HaloRing.

2. Fallback for players without a commander (non-Commander format): stylized initial-letter circle in the player's first color identity. Defer fancy fallback art; just `{name[0]}` over a flat color.

3. Don't change `PlayerFrame.tsx` yet — that's 70-K. This slice ships the component as a reusable atom only.

### Behind the flag

- Component file is committed. NOT consumed by anything yet (70-K consumes it). The flag doesn't gate component existence; it gates component USE.

### Sign-off

- Storybook-style isolated render of `<PlayerPortrait>` for each variant (small / medium / large × halo / no-halo × commander / fallback).
- Screenshot in user-facing directory (e.g. `webclient/.playtest-screenshots/portrait-variants.png`).

### Risks / blockers

- Scryfall image-crop URL format. Existing `CardFace.tsx` already does this for cards — same URL pattern works for commanders.
- Some commanders have weirdly-cropped art-crop URLs. Acceptable per user — Scryfall standard crop, no curated avatars.

---

## Slice 70-K — PlayerFrame redesign (largest slice)

**Tier:** Architectural (greenfield component swap)
**Catalog reference:** §2 (entire region) — pod anatomy for all four positions
**Picture region:** All four player pods.

### Scope

1. Rewrite `PlayerFrame.tsx` (behind flag):
   - When `REDESIGN` is true, render the catalog §2 anatomy:
     - Portrait (using `<PlayerPortrait>` from 70-J)
     - Life numeral inside / below portrait
     - Player name below portrait (or beside, for left/right positions)
     - Commander name below player name
     - Halo around the portrait (passed through PlayerPortrait)
   - When `REDESIGN` is false, render the existing header-strip layout (preserved verbatim).

2. Update `PlayerArea.tsx`:
   - When `REDESIGN`: drop the `<CommandZone>` strip (per catalog §6.3). Drop the bordered `bg-zinc-900/40 p-3` panel chrome — pods float on the battlefield without a panel container.
   - Battlefield rows flow per the picture's per-position layout:
     - **Top (2.A):** rows ABOVE the portrait
     - **Left (2.B):** rows to the RIGHT of the portrait
     - **Right (2.C):** rows to the LEFT of the portrait
     - **Bottom (2.D):** rows ABOVE the portrait, expanding upward
   - When NOT `REDESIGN`: existing layout.

3. Position-aware sizing:
   - Local pod: portrait 96px, card size medium.
   - Opponent pods: portrait 80px, card size small.

4. Drop the `ACTIVE` pill (active state is the halo pulse).

5. Drop the inline header-strip mana pool + zone icons (relocated in 70-P).

### Behind the flag

- Hard flag-gating in PlayerArea.tsx.

### Sign-off

- Local dev server `npm run dev:redesign` — screenshot all four pods at 1920×1080.
- Compare each pod to its catalog entry (2.A / 2.B / 2.C / 2.D).
- Vercel preview deploy. User signs off.

### Risks / blockers

- This is the slice where the visual identity becomes evident. If the picture's halo + portrait + name layout doesn't materialize cleanly at this slice, subsequent work has wrong foundation.
- Commander art-crop quality varies. Some will look great; some weird. User has confirmed this is acceptable.

---

## Slice 70-L — Game log avatars + Commander damage 2×2 grid

**Tier:** Standard (two visual rewrites consuming PlayerPortrait)
**Catalog reference:** §5.A (game log) + §5.B (commander damage)
**Picture region:** Right side panel — top half (game log) and middle (commander damage).

### Scope

1. Update `GameLog.tsx` (behind flag):
   - When `REDESIGN`: per-entry avatar (small `<PlayerPortrait>` 32px, no halo) + 2-line text (player name + action with card-name highlights).
   - Actor resolution: parse the engine's gameInform text for the actor (heuristic — first capitalized word OR explicit `<font color>` tag).
   - Card-name highlighting: detect engine-emitted `<font color="...">CardName</font>` patterns, replace with our styled `<span>` + HoverCardDetail trigger.

2. Update `CommanderDamageTracker.tsx` (behind flag):
   - When `REDESIGN`: 2×2 grid layout (CSS grid `grid-cols-2`, gap `--space-2`). Each cell shows portrait + damage number.
   - Existing localStorage persistence + flash animation preserved.

### Behind the flag

- Hard flag-gating per component.

### Sign-off

- Screenshot right side panel at 1920×1080 with a fixture game-log + non-zero commander damage.
- Vercel preview.

### Risks / blockers

- Card-name regex heuristic for log entries. Some entries may not match cleanly. Acceptable — fallback is just non-highlighted text. Iterate during 70-Z polish.

---

## Slice 70-M — Side panel reorder + ActionButton component

**Tier:** Architectural (new component + grid restructure)
**Catalog reference:** §5.C (turn + action) + §6.1 (action footer removal)
**Picture region:** Right side panel — bottom; removal of bottom-of-screen action footer.

### Scope

1. New `<ActionButton>` component:
   - Props: `gameView`, `stream`, `myPriority` — internally derives the current required action from `gameView.phase` / `gameView.step` / `pendingDialog` etc.
   - Renders single button with morphing label per catalog §5.C.
   - Adjacent ellipsis menu with multi-pass options (Pass to Next Turn / Pass to Your Turn / Resolve Stack / Stop Skipping / Undo).
   - Hotkeys preserved (F2/F4/F6/F8/Esc/Ctrl+Z) — hidden from UI but functional.

2. Update `GameTable.tsx`:
   - When `REDESIGN`: drop the `[grid-area:action]` row entirely. Side panel grows to fill that vertical space.
   - Mount `<ActionButton>` at the bottom of the side panel (under CommanderDamageTracker).

3. Move Concede:
   - Add a "Settings" modal accessed from the header gear icon (slice 70-O lands the icon; this slice can stub the modal).
   - Concede goes inside the modal. Drop the always-visible Concede button.

4. Drop the existing multi-button `ActionPanel.tsx` from the redesign path (keep behind the false-flag for the old layout).

### Behind the flag

- Hard flag-gating in GameTable.tsx.

### Sign-off

- Local screenshot showing the new bottom-of-side-panel ActionButton in TURN 8 / End Step state.
- Vercel preview.

### Risks / blockers

- ActionButton state-machine logic. The "morphing label" needs to read multiple parts of game state correctly. Test coverage needed: per-state snapshot tests.

---

## Slice 70-N — StackZone focal-size rewrite

**Tier:** Architectural (component rewrite + combat-mode addition)
**Catalog reference:** §3 (entire region) — focal stack, combat arrows, empty state
**Picture region:** Center of battlefield.

### Scope

1. Rewrite `StackZone.tsx`:
   - When `REDESIGN`:
     - Topmost stack item → CardFace at `--card-size-focal` with color-identity glow + 1.5s pulse (`stack-glow-pulse` already wired).
     - Items 2-6 → fanned BEHIND/BELOW the topmost at progressively smaller scales.
     - 6+ → "+N more" pill on topmost.
     - Empty state → render nothing (just the particle-drift backdrop shows through).
   - When NOT `REDESIGN`: existing flex-wrap row layout.

2. Add combat-mode rendering:
   - When `gameView.combat.length > 0` AND stack empty AND `REDESIGN`:
     - Render TargetingArrow SVGs from each attacker's BattlefieldTile to the defending player's portrait OR blocking creature's tile.
     - Re-use `<TargetingArrow>` geometry.

### Behind the flag

- Hard flag-gating in StackZone.tsx.

### Sign-off

- Screenshot focal zone in three states: empty (just particles), single stack item (focal + glow), 5+ stack items (fan).
- Bonus: combat mode if a fixture supports it.
- Vercel preview.

### Risks / blockers

- Combat arrows from DOM-positioned attackers to opponent portraits requires runtime DOM measurement. Pattern exists in TargetingArrow today — re-use the bbox-tracking approach.

---

## Slice 70-O — Header bar polish + top-right icon strip + settings modal

**Tier:** Standard (visual rewrite + small new modal)
**Catalog reference:** §1 (entire region)
**Picture region:** Top of screen.

### Scope

1. Rewrite `GameHeader.tsx` (behind flag):
   - When `REDESIGN`: catalog §1 layout — purple all-caps lobby name on left, four icons on right.
   - Drop gameId display, slowmo badge, connection dot, turn pill, priority subtext, Leave button.
   - Lobby name format derived from `gameView.players.length` + commander-detection: `"COMMANDER — 4 PLAYER FREE-FOR-ALL"` etc.

2. Wire the four icons:
   - Chat → toggles a state in `useGameStore` (UI doesn't exist yet; defer slide-out to 70-R).
   - Layout/zoom → toggles side-panel collapsed state in `useGameStore`. Side-panel reads this state.
   - Fullscreen → calls `document.documentElement.requestFullscreen()`.
   - Settings → opens a `<SettingsModal>` (see below).

3. Build `<SettingsModal>`:
   - Hosts the relocated Concede button (with confirmation).
   - Hosts the Leave game button.
   - Future home for theme toggle, animation toggle, etc.

### Behind the flag

- Hard flag-gating in GameHeader.tsx.

### Sign-off

- Screenshot header at 1920×1080.
- Click each icon, screenshot the resulting state (collapsed panel, fullscreen, settings open).
- Vercel preview.

### Risks / blockers

- Icon SVGs — we don't have an icon library. Use Lucide or Heroicons (lightweight, MIT-licensed, ~5KB per icon). Alternative: hand-code 4 SVGs.

---

## Slice 70-P — Mana pool floats + ZoneIcon opponent variant + cleanup

**Tier:** Standard (relocation + small visual variants)
**Catalog reference:** §2.3 (mana pool placement) + §2.2 (zone icons)
**Picture region:** Top-right of hand area + adjacent-to-pod chrome.

### Scope

1. Relocate `<ManaPool>`:
   - When `REDESIGN`: render at top-right of the hand region for the local player.
   - For opponents: render adjacent to their portrait (smaller, no glow).
   - When NOT `REDESIGN`: stays inside the old PlayerFrame strip.

2. Land the opponent variant of `<ZoneIcon>`:
   - Catalog §2.2 — small `<G>` `<E>` icons for opponents. Library shows just a number.

3. Drop the "Your hand (N)" header from `MyHand.tsx` when `REDESIGN`.

4. Final cleanup:
   - Audit any inline pixel values that should now be tokens.
   - Audit any flag-gated branches that left dead code in the OLD layout.
   - Verify the OLD layout still works (run with `VITE_FEATURE_REDESIGN=0`).

### Behind the flag

- Hard flag-gating per relocation.

### Sign-off

- Full-page screenshot at 1920×1080 with `REDESIGN=1` — should look like the picture (~85% fidelity).
- Full-page screenshot at 1920×1080 with `REDESIGN=0` — should look like the current layout (no regressions).
- Vercel preview.

### Risks / blockers

- None unique. This is the wrap-up slice.

---

## Slice 70-Z — Polish pass

**Tier:** Polish (no critic — runs as a tuning session with the user)
**Catalog reference:** "Color & motion impressions" section + "What feels MTGA-grade"
**Picture region:** Whole screen.

### Scope

This is a **session-length tuning pass** rather than a structured slice. Goal: close the gap from "structurally matches the picture" to "feels like the picture."

Process:

1. Open `npm run dev:redesign` + the picture side-by-side.
2. Walk through each region, comparing.
3. Tune as needed:
   - Token values (`--shadow-glow-*`, halo opacity, glow blur radius).
   - Per-element spacing.
   - Typography weights / sizes.
   - Card-frame proportions in BattlefieldTile.
   - Animation timings (halo pulse, focal-card pulse).
4. Live-test with the user — they call out anything that "doesn't feel right."

Expected fidelity gain: **+5-7 points** above the structural baseline (so ~85% → ~90%+).

### When to run

After 70-P signs off, before flipping the flag in production.

### Sign-off

- User reviews side-by-side and calls "ship it."
- Flag flips: `VITE_FEATURE_REDESIGN=1` becomes the default.
- Old layout code is deleted in a follow-up cleanup commit.

---

## Critical path

```
70-I  ── 70-J ── 70-K ── 70-M ── 70-O ─┐
                    │       │           │── 70-Z polish
                    └── 70-L│           │
                            │           │
                    70-N ───┴── 70-P ──┘
```

70-I → 70-J → 70-K is the strict critical path (each depends on the prior). Everything else parallelizes after 70-K.

---

## Definition of done (per slice)

A slice ships ONLY when:

1. ✅ Implementation matches the catalog entry for the affected region.
2. ✅ Server tests + client tests pass (no regressions).
3. ✅ Lint clean for files I modified (pre-existing lint debt allowed).
4. ✅ Local dev server screenshot at 1920×1080 captured.
5. ✅ Vercel preview deployed and URL shared with user.
6. ✅ User signs off on the preview.
7. ✅ Critic-pass log row added (per CLAUDE.md cadence reform).
8. ✅ Commit lands on `main` with the slice 70-X message format.

---

## Open issues to track during the push

- **Combat-mode arrows in StackZone (70-N)** depend on DOM measurement of attacker / target tiles. Pattern works for TargetingArrow today — verify it works for the focal-zone case which has a different parent layout.
- **Card-name regex in GameLog (70-L)** is heuristic and will miss edge cases. Acceptable for v1. Track misses during live-test for a follow-up regex tightening pass.
- **PlayerPortrait fallback art (70-J)** for non-Commander players uses a stylized letter circle. May look out-of-place next to art-crop portraits. Re-evaluate after 70-K renders all four pods.
- **Settings modal (70-O)** is initially minimal (Concede + Leave). Future expansion: theme toggle, animation toggle, accessibility toggles. Track feature requests during live-test.
- **Hotkey rebinding (70-M)** isn't in scope. F2/F4/F6/F8/Esc/Ctrl+Z stay hardcoded. If users want rebinding, slice it as 70-Q or later.
