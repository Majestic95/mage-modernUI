/**
 * Slice A — fixture-only layout-variant picker UI.
 *
 * Renders a small button row floating over the demo fixture. Clicking
 * a button calls {@code onChange} with the picked variant. The caller
 * (typically {@code DemoGame}) wraps {@code onChange} around a React
 * state update + {@code setVariantInUrl} so the variant context flips
 * AND the URL stays in sync (so reloads / shares preserve the
 * selection).
 *
 * <p>Hidden in production builds via {@code import.meta.env.DEV}. The
 * gate is here (not at the call site) so the switcher's own dev-only
 * status is contained inside the component — safer if we ever decide
 * to mount it elsewhere.
 *
 * <p>Today only one variant ({@code 'current'}) exists; the row still
 * renders so the surface is testable and visible. A second variant
 * lighting up the row is the slice-B trigger.
 */
import { LAYOUT_VARIANTS, type LayoutVariant } from '../layoutVariants';

export function VariantSwitcher({
  current,
  onChange,
}: {
  /** The active variant — drives which button shows as selected. */
  current: LayoutVariant;
  /**
   * Called when the user clicks a button. Caller is responsible for
   * propagating the change into both React state (for re-render) and
   * the URL (for share-link / reload persistence).
   */
  onChange: (next: LayoutVariant) => void;
}) {
  if (!import.meta.env.DEV) return null;
  return (
    <div
      data-testid="variant-switcher"
      className="fixed top-1 right-1 z-50 flex items-center gap-1 rounded bg-zinc-900/85 px-2 py-1 text-xs text-zinc-300 ring-1 ring-zinc-700 shadow-md"
    >
      <span className="text-[10px] uppercase tracking-wide text-zinc-500">
        layout
      </span>
      {LAYOUT_VARIANTS.map((v) => {
        const active = v === current;
        return (
          <button
            key={v}
            type="button"
            data-testid={`variant-button-${v}`}
            data-active={active || undefined}
            onClick={() => onChange(v)}
            className={
              'rounded px-2 py-0.5 transition ' +
              (active
                ? 'bg-fuchsia-600 text-white'
                : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300')
            }
          >
            {v}
          </button>
        );
      })}
    </div>
  );
}
