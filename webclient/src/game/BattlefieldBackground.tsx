/**
 * Viewport-spanning battlefield artwork backdrop. Mounts as the first
 * child of the game-window wrappers (real game, fixture mode, lab) so
 * it paints behind every game UI element while the wrapper's
 * `bg-zinc-950` solid black sits underneath the artwork.
 *
 * <p><b>Why an absolute-positioned sibling (not body-level CSS):</b>
 * scoping the backdrop to the game-window wrappers keeps it off the
 * lobby / login / deck-editor surfaces (which use a different visual
 * language). DOM order puts it before the rest of the children so
 * painting order naturally places it behind without explicit z-index
 * juggling against the action panel (z-30), dialogs (z-40), or the
 * cinematic-lab panel (z-50).
 *
 * <p><b>Alpha:</b> rendered at {@link BATTLEFIELD_BG_ALPHA} (0.5 at
 * landing) via CSS opacity so tuning is a single-number change. The
 * 50%-opacity image composites over the wrapper's solid black, so
 * the result reads as a desaturated darker version of the artwork.
 *
 * <p><b>Asset:</b> served as a static file from {@code public/} via
 * the path {@code /battlefield-bg.png}. The file is ~2.3 MB which
 * loads as a separate request after first paint; until it loads the
 * user sees the wrapper's solid black, identical to the pre-bg
 * appearance — no flash, just a delayed reveal.
 */

/**
 * Tuning dial — the backdrop's overall transparency. 0.5 ships at
 * slice landing per user direction ("reduce the png's alpha by 50%
 * for starters so it's a bit less vibrant"). Adjust freely.
 */
export const BATTLEFIELD_BG_ALPHA = 0.5;

export function BattlefieldBackground() {
  return (
    <div
      data-testid="battlefield-bg"
      aria-hidden="true"
      className="absolute inset-0 pointer-events-none z-0"
      style={{
        backgroundImage: 'url(/battlefield-bg.png)',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        opacity: BATTLEFIELD_BG_ALPHA,
      }}
    />
  );
}
