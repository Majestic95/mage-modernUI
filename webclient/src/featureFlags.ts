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
