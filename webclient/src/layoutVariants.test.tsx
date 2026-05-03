/**
 * Slice A — tests for the layout-variant scaffold.
 *
 * Coverage:
 *   - getActiveVariant() URL parse (missing / empty / valid /
 *     case-insensitive / unknown / multiple).
 *   - LayoutVariantProvider + useLayoutVariant() — explicit override
 *     vs URL-driven default vs no-provider fallback.
 *   - setVariantInUrl() — strips on default, replaces history.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  DEFAULT_VARIANT,
  LayoutVariantProvider,
  __resetWarnedForTests,
  getActiveVariant,
  setVariantInUrl,
  useLayoutVariant,
} from './layoutVariants';

function ConsumerProbe() {
  const variant = useLayoutVariant();
  return <div data-testid="probe">{variant}</div>;
}

describe('getActiveVariant', () => {
  beforeEach(() => {
    __resetWarnedForTests();
  });

  it('returns DEFAULT when no ?variant= param is present', () => {
    expect(getActiveVariant('')).toBe(DEFAULT_VARIANT);
    expect(getActiveVariant('?other=x')).toBe(DEFAULT_VARIANT);
  });

  it('returns DEFAULT when ?variant= is empty', () => {
    expect(getActiveVariant('?variant=')).toBe(DEFAULT_VARIANT);
  });

  it('returns the parsed variant when valid', () => {
    expect(getActiveVariant('?variant=current')).toBe('current');
  });

  it('is case-insensitive', () => {
    expect(getActiveVariant('?variant=CURRENT')).toBe('current');
    expect(getActiveVariant('?variant=Current')).toBe('current');
  });

  it('falls back to DEFAULT on unknown variant + warns once per name', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(getActiveVariant('?variant=zzz')).toBe(DEFAULT_VARIANT);
    expect(getActiveVariant('?variant=zzz')).toBe(DEFAULT_VARIANT);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('Unknown variant "zzz"');
    // A different unknown name warns separately.
    expect(getActiveVariant('?variant=qqq')).toBe(DEFAULT_VARIANT);
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it('takes the first param when multiple ?variant= are present', () => {
    expect(getActiveVariant('?variant=current&variant=zzz')).toBe('current');
  });
});

describe('LayoutVariantProvider + useLayoutVariant', () => {
  it('returns DEFAULT_VARIANT outside any provider', () => {
    render(<ConsumerProbe />);
    expect(screen.getByTestId('probe').textContent).toBe(DEFAULT_VARIANT);
  });

  it('returns the explicit prop value when provided', () => {
    render(
      <LayoutVariantProvider variant="current">
        <ConsumerProbe />
      </LayoutVariantProvider>,
    );
    expect(screen.getByTestId('probe').textContent).toBe('current');
  });

  it('reads from URL when no explicit prop is given', () => {
    // Use history.replaceState rather than Object.defineProperty —
    // defineProperty would replace window.location with a plain
    // object, breaking subsequent tests because history.replaceState
    // would no longer mutate the (now non-Location) location.
    const originalUrl = window.location.href;
    window.history.replaceState({}, '', '/?variant=current');
    try {
      render(
        <LayoutVariantProvider>
          <ConsumerProbe />
        </LayoutVariantProvider>,
      );
      expect(screen.getByTestId('probe').textContent).toBe('current');
    } finally {
      window.history.replaceState({}, '', originalUrl);
    }
  });
});

describe('setVariantInUrl', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/');
  });
  afterEach(() => {
    window.history.replaceState({}, '', '/');
  });

  it('strips ?variant= when setting the default variant (URL stays clean)', () => {
    window.history.replaceState({}, '', '/?variant=current&other=x');
    setVariantInUrl('current');
    const search = new URLSearchParams(window.location.search);
    expect(search.has('variant')).toBe(false);
    // Other params survive.
    expect(search.get('other')).toBe('x');
  });

  it('uses replaceState (does not push a history entry)', () => {
    const before = window.history.length;
    setVariantInUrl('current');
    setVariantInUrl('current');
    setVariantInUrl('current');
    // history.length should not grow on replaceState calls.
    expect(window.history.length).toBe(before);
  });

  // Slice B (when a non-default variant is added) will exercise the
  // `params.set(VARIANT_PARAM, variant)` branch directly. Today only
  // 'current' (== DEFAULT_VARIANT) exists, so the type system can't
  // express a non-default LayoutVariant here.
});
