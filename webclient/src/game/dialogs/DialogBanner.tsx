import { useDraggable } from '../../util/useDraggable';
import { BannerSpotlightHalo } from './BannerSpotlightHalo';
import { renderUpstreamMarkup } from './markupRenderer';

/**
 * Slice 70-Y.1 — bottom-center instruction banner that replaces the
 * modal popup for click-to-resolve dialog frames (discard, target,
 * sacrifice, mana pay). Per the picture-catalog amendment for §7.7,
 * this is the persistent UI chrome that tells the player WHAT they're
 * being asked while they click cards in their existing zones.
 *
 * <p>Position: fixed bottom-center, just above the hand fan
 * (using {@code --hand-area-height} CSS var if present, else
 * defaulting to a comfortable margin). z-40 — same layer as the
 * legacy side-panel dialogs; banner is interactive UI not a
 * decorative overlay.
 *
 * <p>Pointer-events: only the banner itself is interactive
 * ({@code pointer-events-auto}); the wrapping fixed positioner is
 * {@code pointer-events-none} so cards behind / around the banner
 * stay clickable. The banner's role is "inform + accept Done/Skip,"
 * not block board interaction.
 *
 * <p>Closes when the engine drives pendingDialog to a fresh state
 * (response sent → server replies with new gameView → store clears
 * or replaces pendingDialog → useDialogTargets returns inactive →
 * banner unmounts).
 */
interface DialogBannerProps {
  /** The instruction text from the engine. Plain or upstream markup. */
  message: string;
  /** Currently-picked count for multi-pick prompts. */
  pickedCount: number;
  /** Selection minimum from the engine (0 = optional). */
  min: number;
  /**
   * Selection maximum from the engine. {@code Infinity} when unbounded.
   * The wire encodes "no upper limit" as a large int; renderer treats
   * any max{@code &gt;}{@code 99} as effectively unbounded for label
   * purposes.
   */
  max: number;
  /**
   * Done handler — submits the selection. Required for multi-pick;
   * single-pick auto-submits via per-card click in
   * {@link useDialogTargets} so the Done button is hidden.
   */
  onDone: () => void;
  /** Cancel handler — engine accepts skip. {@code null} when mandatory. */
  onCancel: (() => void) | null;
}

export function DialogBanner({
  message,
  pickedCount,
  min,
  max,
  onDone,
  onCancel,
}: DialogBannerProps) {
  const isSinglePick = min === 1 && max === 1;
  const submittable = pickedCount >= min && pickedCount <= max;
  const unboundedMax = max >= 99;
  // Initial bottom margin tracks the hand-fan height via the
  // `--hand-area-height` CSS var (default 180px when unset) plus a
  // 16px gap, exactly matching the legacy `calc(var(...) + 16px)`
  // positioner. After the user drags, the hook owns position
  // absolutely.
  const { ref, containerProps, style } = useDraggable({
    placement: {
      kind: 'bottom-center',
      bottomMargin: 16,
      bottomMarginVar: 'hand-area-height',
    },
  });

  return (
    <div
      ref={ref}
      role="status"
      aria-live="polite"
      data-testid="dialog-banner"
      data-drag-handle
      className={
        'relative pointer-events-auto inline-flex items-center gap-3 rounded-lg ' +
        'bg-zinc-900/95 border border-fuchsia-500/40 shadow-xl ' +
        'px-4 py-2 text-zinc-100 backdrop-blur-sm cursor-move select-none z-40'
      }
      style={style}
      {...containerProps}
    >
      <BannerSpotlightHalo testId="dialog-banner-halo" />
      <span className="text-sm" data-testid="dialog-banner-message">
        {renderUpstreamMarkup(message)}
      </span>
      {!isSinglePick && (
        <span
          className="text-xs text-zinc-400 font-mono"
          data-testid="dialog-banner-progress"
        >
          {min === max
            ? `${pickedCount}/${max}`
            : unboundedMax
              ? `${pickedCount}`
              : `${pickedCount}/${max}`}
        </span>
      )}
      {!isSinglePick && (
        <button
          type="button"
          onClick={onDone}
          disabled={!submittable}
          data-testid="dialog-banner-done"
          className={
            'px-3 py-1 rounded text-sm font-medium transition ' +
            (submittable
              ? 'bg-fuchsia-500 hover:bg-fuchsia-400 text-zinc-950'
              : 'bg-zinc-800 text-zinc-500 cursor-not-allowed')
          }
        >
          Done
        </button>
      )}
      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          data-testid="dialog-banner-cancel"
          className="px-3 py-1 rounded text-sm text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition"
        >
          Skip
        </button>
      )}
    </div>
  );
}
