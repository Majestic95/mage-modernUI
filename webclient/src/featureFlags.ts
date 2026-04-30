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
 * <p>Default {@code false} — slice 70-D ships the overlay code but
 * the legacy "drop on hasLeft" filter remains the runtime behavior
 * until slice 70-E flips this to {@code true} as part of the
 * 6-region layout shell rollout. Rationale: between 70-D and 70-E,
 * the existing 3-col grid (ADR 0010 D5) would render a slashed pod
 * in a grid cell that was previously collapsed — visually awkward.
 */
export const KEEP_ELIMINATED: boolean =
  import.meta.env['VITE_FEATURE_KEEP_ELIMINATED'] === 'true';
