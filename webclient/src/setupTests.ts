/**
 * Vitest global setup. Imported automatically by every test file via
 * the {@code setupFiles} config in vite.config.ts.
 */
import { beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';

/**
 * 2026-05-04 — graduation cutover defaulted DEFAULT_VARIANT to
 * `tabletop`. The vast majority of existing webclient tests were
 * written against the previous `current` default (asymmetric-T
 * layout, non-compact phase rail, classic side-panel etc.). Rather
 * than touch every test file, force `?variant=current` on each test
 * here. Tests that exercise tabletop-specific behavior set their
 * own URL via {@code window.history.replaceState} (see G1 in
 * {@code Game.test.tsx} for the pattern); local URL overrides win
 * because they run after this global beforeEach.
 */
beforeEach(() => {
  if (typeof window !== 'undefined' && window.history?.replaceState) {
    window.history.replaceState(
      {},
      '',
      `${window.location.pathname}?variant=current`,
    );
  }
});
