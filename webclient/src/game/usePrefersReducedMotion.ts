import { useEffect, useState } from 'react';

/**
 * Bundle 1 / Slice 1-C — small reactive hook for the
 * {@code prefers-reduced-motion: reduce} CSS media query. Returns
 * {@code true} when the user has opted into reduced motion at the
 * OS level (Windows: "Show animations in Windows" toggle; macOS:
 * Accessibility → Display → Reduce motion; etc.); {@code false}
 * otherwise. Updates reactively if the user toggles the setting
 * mid-session.
 *
 * <p><b>Why a hook (instead of a one-shot check):</b> the slice 1-C
 * combat-arrow wave-reveal stagger needs to honor the setting AND
 * react to mid-game changes — a player who hits the OS reduce-motion
 * toggle while a long combat is in progress should see subsequent
 * combat phases stagger-free without a refresh. The existing one-shot
 * pattern in {@code CardAnimationLayer.tsx} ({@code window.matchMedia(
 * '(prefers-reduced-motion: reduce)').matches}) doesn't subscribe.
 *
 * <p><b>SSR / non-browser:</b> defaults to {@code false} (motion
 * allowed) when {@code window} is unavailable, matching the
 * project's other media-query consumers.
 *
 * <p><b>Test mocking:</b> tests substitute
 * {@code window.matchMedia = vi.fn().mockImplementation(...)}
 * returning a {@code MediaQueryList}-shaped object before render.
 * See {@code transitions.reducedMotion.test.tsx} for the canonical
 * mock shape (matches + addEventListener + addListener stubs).
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (ev: MediaQueryListEvent) => {
      setReduced(ev.matches);
    };
    // Modern + legacy listener registration. Safari < 14 only supports
    // the deprecated addListener / removeListener pair; modern browsers
    // expose addEventListener('change', ...).
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    }
    if (typeof mql.addListener === 'function') {
      mql.addListener(onChange);
      return () => mql.removeListener(onChange);
    }
    return undefined;
  }, []);

  return reduced;
}
