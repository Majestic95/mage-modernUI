/**
 * Slice 70-C (ADR 0011 D4) — atom for a single mana symbol.
 *
 * Per design-system §7.5: circular orb filled with the mana color,
 * optional centered count when > 1, optional glow halo for floating
 * mana display.
 *
 * <p>Color tokens come from slice 70-A (`--color-mana-{w,u,b,r,g,c}`
 * and `--color-mana-{...}-glow`). The glow variant uses a
 * box-shadow of the matching `-glow` token.
 *
 * <p>Used by:
 * <ul>
 *   <li>{@code ManaPool} — display each non-zero pool color</li>
 *   <li>{@code ManaCost} — render generic + colored mana costs</li>
 *   <li>any future floating-mana indicator</li>
 * </ul>
 */
import type { CSSProperties } from 'react';

export type ManaOrbColor = 'W' | 'U' | 'B' | 'R' | 'G' | 'C';
export type ManaOrbSize = 'small' | 'medium' | 'large';

interface Props {
  color: ManaOrbColor;
  /** Display value when > 1; omitted from the orb when count === 1. */
  count?: number;
  size?: ManaOrbSize;
  /** Halo around the orb in the matching `-glow` token. */
  glow?: boolean;
  /** Optional aria-label override; default is the color word + count. */
  ariaLabel?: string;
  /**
   * Slice 70-X.10 (user feedback 2026-04-30) — when set, the orb
   * renders as a clickable button and invokes this callback on
   * click. Used during gamePlayMana / gamePlayXMana dialogs so the
   * player can spend mana directly from the floating pool by
   * clicking an orb (vs the prior "click a mana source on the
   * battlefield" path only).
   */
  onClick?: () => void;
}

const COLOR_TOKEN: Record<ManaOrbColor, string> = {
  W: 'mana-white',
  U: 'mana-blue',
  B: 'mana-black',
  R: 'mana-red',
  G: 'mana-green',
  C: 'mana-colorless',
};

const COLOR_WORD: Record<ManaOrbColor, string> = {
  W: 'white',
  U: 'blue',
  B: 'black',
  R: 'red',
  G: 'green',
  C: 'colorless',
};

const SIZE_CLASSES: Record<ManaOrbSize, string> = {
  // px-equivalents via Tailwind: 1rem / 1.5rem / 2rem squares with
  // matching font sizes for the centered count.
  small: 'h-4 w-4 text-[0.625rem]',
  medium: 'h-6 w-6 text-xs',
  large: 'h-8 w-8 text-sm',
};

export function ManaOrb({
  color,
  count = 1,
  size = 'medium',
  glow = false,
  ariaLabel,
  onClick,
}: Props) {
  const tokenName = COLOR_TOKEN[color];
  // Use inline CSS variables so we can compose the bg + glow without
  // burning two Tailwind utility classes per call. The token names are
  // closed-set + audited above so this is not a string-injection
  // surface.
  // Slice 70-G — per-color FG token instead of a global text-bg-base.
  // The fg pair is hand-tuned to ≥7:1 contrast against each base
  // color (the lavender mana-black case was borderline at ~5.3:1
  // before; deep-purple #1F1530 brings it well into AAA).
  const style: CSSProperties = {
    backgroundColor: `var(--color-${tokenName})`,
    color: `var(--color-${tokenName}-fg)`,
    ...(glow
      ? { boxShadow: `0 0 8px 2px var(--color-${tokenName}-glow)` }
      : {}),
  };

  // Count discriminator: the spec is "displays count if > 1". For a
  // single mana symbol the orb's color IS the symbol — no number
  // needed. >1 puts the number centered for readability.
  const showCount = count > 1;

  const label =
    ariaLabel ??
    (showCount
      ? `${count} ${COLOR_WORD[color]} mana`
      : `1 ${COLOR_WORD[color]} mana`);

  const baseClass =
    'inline-flex items-center justify-center rounded-full font-mono ' +
    'leading-none align-middle font-semibold ' +
    SIZE_CLASSES[size];

  if (onClick) {
    return (
      <button
        type="button"
        data-testid={`mana-orb-${color}`}
        aria-label={`Spend ${label}`}
        title={`Click to spend ${label}`}
        onClick={onClick}
        style={style}
        className={
          baseClass +
          ' cursor-pointer hover:brightness-125 transition-[filter] ' +
          'focus:outline-none focus:ring-2 focus:ring-fuchsia-400'
        }
      >
        {showCount ? count : ''}
      </button>
    );
  }

  return (
    <span
      data-testid={`mana-orb-${color}`}
      role="img"
      aria-label={label}
      style={style}
      className={baseClass}
    >
      {showCount ? count : ''}
    </span>
  );
}
