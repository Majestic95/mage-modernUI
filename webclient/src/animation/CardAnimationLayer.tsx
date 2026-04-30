/**
 * Slice 70-Z.2 — empty skeleton for the card-animation overlay.
 *
 * <p>This file ships in slice 70-Z.2 as a wiring foundation only —
 * the `<div>` mounts and exposes the testid that future slices'
 * integration tests assert against, but it renders no visuals yet.
 * Slice 70-Z.3 fills in the cinematic casting-pose overlay + ribbon
 * trail + commander-return glide; slice 70-Z.4 adds the board-wipe
 * ripple and per-tile particle dispatchers.
 *
 * <p><b>Reduced-motion:</b> the layer mounts unconditionally; the
 * decorative overlays it spawns (in later slices) check
 * {@code window.matchMedia('(prefers-reduced-motion: reduce)').matches}
 * at their own mount time and bail out. The layer itself is not
 * gated because the cardId-based layoutId graph (LAYOUT_GLIDE) is
 * essential motion that survives reduced-motion — only the overlay
 * decorations get suppressed.
 *
 * <p><b>Mount point:</b> rendered as a sibling of {@code GameTable}
 * inside the page root's {@code LayoutGroup} (see Game.tsx). Sits
 * fixed-position over the entire viewport with {@code
 * pointer-events: none} so it never intercepts clicks.
 *
 * <p><b>z-index ladder</b> (slice 70-Z.2 critic UI/UX-C1 fix): the
 * layer sits at {@code z-35} — ABOVE the side panel + floating
 * action dock (both {@code z-30}, GameTable.tsx) so animation
 * overlays paint over the table chrome, but BELOW every interactive
 * dialog ({@code z-40}: GameDialog shells, ZoneBrowser, ConcedeConfirm,
 * GameEndOverlay banner, TargetingArrow). Decorative-over-interactive
 * is the rule the catalog implies — a cinematic-cast pose must NEVER
 * obscure a target-confirmation dialog. HoverCardDetail's portal at
 * {@code z-50} naturally floats above us.
 *
 * <p><b>aria-hidden contract:</b> overlays inside this layer are
 * visual flourishes only. The underlying gameView snapshot already
 * conveys "this card is on the stack / battlefield" through
 * StackZone / BattlefieldTile DOM nodes that live OUTSIDE this
 * layer. Don't remove {@code aria-hidden} when slice 70-Z.3 mounts
 * the cinematic-pose card — the screen-reader-relevant card is the
 * StackZone focal tile, not the pose copy.
 */
export function CardAnimationLayer(): React.JSX.Element {
  return (
    <div
      data-testid="card-animation-layer"
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[35]"
    />
  );
}
