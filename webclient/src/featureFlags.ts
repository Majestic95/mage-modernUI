/**
 * Slice 70-D (ADR 0011 D2) — feature flags for the design-system push.
 *
 * Single source of truth for build-time feature toggles. Vite
 * substitutes {@code import.meta.env.VITE_*} at build time — these
 * are NOT runtime-toggleable. Flipping a flag in production requires
 * a rebuild + redeploy, which is the right blast-radius for the
 * structural changes these gate.
 *
 * <p>Convention: read each flag in EXACTLY ONE place (the gating
 * module) and re-export. Never read {@code import.meta.env.VITE_*}
 * directly from a component — drift across read sites makes the gate
 * porous.
 */

/**
 * Slice 70-D — keep eliminated players in the layout (with the
 * elimination slash overlay) instead of dropping their seat from the
 * grid. Read EXCLUSIVELY by {@code battlefieldLayout.selectOpponents};
 * downstream {@code PlayerFrame} renders the slash overlay
 * unconditionally based on {@code player.hasLeft}, on the assumption
 * that if hasLeft players are in its props the layout intentionally
 * kept them.
 *
 * <p>Default flipped to {@code true} in slice 70-E (the 6-region
 * layout shell rollout). Eliminated pods now stay in the layout
 * with the slice 70-D slash overlay. The flag remains as a
 * kill-switch — set {@code VITE_FEATURE_KEEP_ELIMINATED=false} in
 * the environment to revert to the legacy collapse behavior (slice
 * 69b's flat-row layout dropped eliminated seats entirely).
 *
 * <p><b>Allowlist semantics</b> (slice 70-E technical critic C2):
 * The flag uses an explicit "off-only" allowlist so that empty /
 * garbage env values default to ON (the new production default)
 * rather than silently flipping to false. Only the literal string
 * {@code 'false'} disables the flag.
 */
export const KEEP_ELIMINATED: boolean =
  import.meta.env['VITE_FEATURE_KEEP_ELIMINATED'] !== 'false';

/**
 * Slice 70-I (redesign push, 2026-04-29) — gates the visual redesign
 * landing across slices 70-I through 70-P + 70-Z polish.
 *
 * <p>When ON: PlayerFrame renders the picture-catalog §2 portrait-
 * stacked anatomy, side panel reorganized per §5, central focal zone
 * redesigned per §3, header bar matches §1, etc. The redesigned UI
 * is what the user's reference screenshot depicts.
 *
 * <p>When OFF (default): the pre-redesign layout shipped at slice
 * 70-H.5 stays in effect — header strip + horizontal-strip
 * PlayerFrame + multi-button ActionPanel + flex-wrap StackZone +
 * PhaseTimeline-on-top side panel. This is the layout currently
 * deployed to production.
 *
 * <p><b>Opt-in semantics</b> (intentionally inverse of
 * KEEP_ELIMINATED's "off-only" allowlist): the redesign is opt-in
 * during development. Only the literal string {@code 'true'} or
 * {@code '1'} enables it. Any other value (unset, empty, 'false',
 * '0', garbage) keeps the production layout. Flag flips to default-
 * ON only after slice 70-Z polish signs off and the user approves
 * the production cutover.
 *
 * <p><b>Single source of truth.</b> Per the convention above, only
 * the gating module (this file) reads the env var. Components import
 * {@code REDESIGN} as a boolean. Tests can override via
 * {@code vi.mock('../featureFlags', ...)} per the existing
 * battlefieldLayout.test.ts pattern.
 *
 * <p>Reference: docs/design/picture-catalog.md, docs/design/slice-plan-redesign-2026-04-29.md
 */
export const REDESIGN: boolean =
  import.meta.env['VITE_FEATURE_REDESIGN'] === 'true' ||
  import.meta.env['VITE_FEATURE_REDESIGN'] === '1';

/**
 * Slice 70-Y / 70-X.14 (Wave A→B push, 2026-05-01) — replace dialog
 * popups with click-to-resolve on the relevant zone (hand for
 * discard, battlefield for target, mana sources for pay) per the
 * picture-catalog §6 click-resolution principle.
 *
 * <p>When ON: gameSelect / gameTarget / gamePlayMana frames where
 * the eligible cards are in VISIBLE zones (hand, graveyard, exile,
 * battlefield) render a bottom-center DialogBanner + pulse the cards
 * in their existing zone instead of a modal popup. Cards outside
 * visible zones (Demonic Tutor library search; scry from top of
 * library) STILL use a modal — there's no existing zone to pulse.
 *
 * <p>When OFF (default): all dialog frames render as the legacy
 * modal popup via GameDialog → SelectDialog / TargetDialog. This is
 * the production behavior at slice 70-X.14 Wave A.
 *
 * <p>Opt-in semantics (same as REDESIGN). Only 'true' / '1' enables.
 *
 * <p><b>Removal plan:</b> the flag exists during the rollout of
 * slice 70-Y.1 (discard) + 70-Y.3 (mana pay). Once both have been
 * live-tested for at least one playtest AND the user confirms the
 * UX, REMOVE this flag and delete the modal-fallback branches in
 * GameDialog.tsx. Tracked via grep "CLICK_RESOLUTION" — every read
 * site needs cleanup. The legacy modal code becomes dead weight as
 * soon as click-resolution is the only path.
 */
export const CLICK_RESOLUTION: boolean =
  import.meta.env['VITE_FEATURE_CLICK_RESOLUTION'] === 'true' ||
  import.meta.env['VITE_FEATURE_CLICK_RESOLUTION'] === '1';
