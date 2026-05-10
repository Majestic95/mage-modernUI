import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { TargetingArrow } from './TargetingArrow';
import {
  ARROW_INK_FADEOUT_MS,
  ATTACK_ARROW_INK_DRAW_MS,
  BLOCK_ARROW_INK_DRAW_MS,
} from '../animation/transitions';

/**
 * Slice 6-A — pen-stroke ink-overlay draw-in tests.
 *
 * The motion lifecycle:
 *   t=0       — ink path mounts with data-ink-phase="mounting",
 *               strokeDashoffset=1 (path hidden), markerEnd undefined.
 *   t=1 frame — requestAnimationFrame flips data-ink-phase="drawing",
 *               strokeDashoffset=0 (transition fires).
 *   t=300ms   — inkHeadVisible toggles true (75% × 400ms),
 *               markerEnd attribute is now set.
 *   t=400ms   — data-ink-phase="fading", opacity transitions to 0.
 *   t=480ms   — data-ink-phase="done", ink path unmounts.
 *
 * Throughout, the BASE path's strokeDasharray attribute MUST equal
 * the value passed in (e.g. "8 6") — the v1 regression guard.
 */

function mockReducedMotion(reduce: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: reduce && query === '(prefers-reduced-motion: reduce)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

describe('TargetingArrow — slice 6-A ink-overlay draw-in', () => {
  beforeEach(() => {
    mockReducedMotion(false);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('renders only the base path when drawIn is undefined', () => {
    const { container } = render(
      <TargetingArrow
        source={{ x: 0, y: 0 }}
        to={{ x: 100, y: 100 }}
        strokeDasharray="8 6"
      />,
    );
    const paths = container.querySelectorAll('svg > path');
    expect(paths).toHaveLength(1);
    expect(paths[0]?.getAttribute('data-arrow-layer')).toBe('base');
  });

  it('renders both base and ink paths when drawIn={{ kind: "attack" }}', () => {
    const { container } = render(
      <TargetingArrow
        source={{ x: 0, y: 0 }}
        to={{ x: 100, y: 100 }}
        strokeDasharray="8 6"
        drawIn={{ kind: 'attack' }}
      />,
    );
    const base = container.querySelector('path[data-arrow-layer="base"]');
    const ink = container.querySelector('path[data-arrow-layer="ink"]');
    expect(base).not.toBeNull();
    expect(ink).not.toBeNull();
  });

  it('REGRESSION: base path strokeDasharray is preserved verbatim during ink draw', () => {
    // The v1 bug overrode the dasharray on the base path itself, making
    // bundle 1's '8 6' dashed appearance go solid at-rest. v2 must
    // never touch the base path's dasharray attribute regardless of
    // drawIn state. This test pins it down at every observable phase.
    const { container } = render(
      <TargetingArrow
        source={{ x: 0, y: 0 }}
        to={{ x: 100, y: 100 }}
        strokeDasharray="8 6"
        drawIn={{ kind: 'attack' }}
      />,
    );
    const base = container.querySelector('path[data-arrow-layer="base"]');
    expect(base?.getAttribute('stroke-dasharray')).toBe('8 6');
    // Advance through draw + fade phases — base must still be "8 6".
    act(() => {
      vi.advanceTimersByTime(ATTACK_ARROW_INK_DRAW_MS / 2);
    });
    expect(base?.getAttribute('stroke-dasharray')).toBe('8 6');
    act(() => {
      vi.advanceTimersByTime(ATTACK_ARROW_INK_DRAW_MS);
    });
    expect(base?.getAttribute('stroke-dasharray')).toBe('8 6');
    act(() => {
      vi.advanceTimersByTime(ARROW_INK_FADEOUT_MS + 10);
    });
    // Even after the ink unmounts, the base must persist '8 6'.
    expect(base?.getAttribute('stroke-dasharray')).toBe('8 6');
  });

  it('ink path mounts with data-ink-phase="mounting" and strokeDashoffset 1', () => {
    const { container } = render(
      <TargetingArrow
        source={{ x: 0, y: 0 }}
        to={{ x: 100, y: 100 }}
        strokeDasharray="8 6"
        drawIn={{ kind: 'attack' }}
      />,
    );
    const ink = container.querySelector('path[data-arrow-layer="ink"]');
    expect(ink?.getAttribute('data-ink-phase')).toBe('mounting');
    // strokeDashoffset is set via inline style in 'mounting' phase.
    expect((ink as HTMLElement | null)?.style.strokeDashoffset).toBe('1');
    // pathLength="1" normalises the dasharray math.
    expect(ink?.getAttribute('pathLength')).toBe('1');
    expect(ink?.getAttribute('stroke-dasharray')).toBe('1 1');
  });

  it('ink path transitions to data-ink-phase="done" and unmounts after draw + fade', () => {
    const { container } = render(
      <TargetingArrow
        source={{ x: 0, y: 0 }}
        to={{ x: 100, y: 100 }}
        strokeDasharray="8 6"
        drawIn={{ kind: 'attack' }}
      />,
    );
    expect(
      container.querySelector('path[data-arrow-layer="ink"]'),
    ).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(ATTACK_ARROW_INK_DRAW_MS + ARROW_INK_FADEOUT_MS + 10);
    });
    expect(
      container.querySelector('path[data-arrow-layer="ink"]'),
    ).toBeNull();
    // Base path is still there.
    expect(
      container.querySelector('path[data-arrow-layer="base"]'),
    ).not.toBeNull();
  });

  it('block-arrow draws faster than attack-arrow', () => {
    // Block uses BLOCK_ARROW_INK_DRAW_MS (200ms), attack uses 400ms.
    // Mount block, advance past block window but before attack window
    // — block ink should be unmounted, an attack ink at the same
    // moment would still be present.
    expect(BLOCK_ARROW_INK_DRAW_MS).toBeLessThan(ATTACK_ARROW_INK_DRAW_MS);
    const { container } = render(
      <TargetingArrow
        source={{ x: 0, y: 0 }}
        to={{ x: 100, y: 100 }}
        strokeDasharray="8 6"
        drawIn={{ kind: 'block' }}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(
        BLOCK_ARROW_INK_DRAW_MS + ARROW_INK_FADEOUT_MS + 10,
      );
    });
    expect(
      container.querySelector('path[data-arrow-layer="ink"]'),
    ).toBeNull();
  });

  it('reduced-motion users do NOT mount the ink layer', () => {
    mockReducedMotion(true);
    const { container } = render(
      <TargetingArrow
        source={{ x: 0, y: 0 }}
        to={{ x: 100, y: 100 }}
        strokeDasharray="8 6"
        drawIn={{ kind: 'attack' }}
      />,
    );
    expect(
      container.querySelector('path[data-arrow-layer="ink"]'),
    ).toBeNull();
    // Base still renders — at-rest visual is preserved.
    expect(
      container.querySelector('path[data-arrow-layer="base"]'),
    ).not.toBeNull();
  });

  it('slice 6-C — does NOT mount shimmer layer when damageStep is undefined', () => {
    const { container } = render(
      <TargetingArrow
        source={{ x: 0, y: 0 }}
        to={{ x: 100, y: 100 }}
        strokeDasharray="8 6"
      />,
    );
    expect(
      container.querySelector('path[data-arrow-layer="shimmer"]'),
    ).toBeNull();
  });

  it('slice 6-C — mounts shimmer layer with first-strike class when damageStep="first-strike"', () => {
    const { container } = render(
      <TargetingArrow
        source={{ x: 0, y: 0 }}
        to={{ x: 100, y: 100 }}
        strokeDasharray="8 6"
        damageStep="first-strike"
      />,
    );
    const shimmer = container.querySelector(
      'path[data-arrow-layer="shimmer"]',
    );
    expect(shimmer).not.toBeNull();
    expect(shimmer?.getAttribute('class')).toBe('arrow-shimmer-first-strike');
    expect(shimmer?.getAttribute('data-damage-step')).toBe('first-strike');
  });

  it('slice 6-C — mounts shimmer layer with regular class when damageStep="regular"', () => {
    const { container } = render(
      <TargetingArrow
        source={{ x: 0, y: 0 }}
        to={{ x: 100, y: 100 }}
        strokeDasharray="8 6"
        damageStep="regular"
      />,
    );
    const shimmer = container.querySelector(
      'path[data-arrow-layer="shimmer"]',
    );
    expect(shimmer).not.toBeNull();
    expect(shimmer?.getAttribute('class')).toBe('arrow-shimmer-regular');
    expect(shimmer?.getAttribute('data-damage-step')).toBe('regular');
  });

  it('slice 6-C — shimmer class swaps when damageStep transitions (cross-dissolve via re-render)', () => {
    const { container, rerender } = render(
      <TargetingArrow
        source={{ x: 0, y: 0 }}
        to={{ x: 100, y: 100 }}
        strokeDasharray="8 6"
        damageStep="first-strike"
      />,
    );
    expect(
      container
        .querySelector('path[data-arrow-layer="shimmer"]')
        ?.getAttribute('class'),
    ).toBe('arrow-shimmer-first-strike');
    rerender(
      <TargetingArrow
        source={{ x: 0, y: 0 }}
        to={{ x: 100, y: 100 }}
        strokeDasharray="8 6"
        damageStep="regular"
      />,
    );
    expect(
      container
        .querySelector('path[data-arrow-layer="shimmer"]')
        ?.getAttribute('class'),
    ).toBe('arrow-shimmer-regular');
  });

  it('slice 6-C — base path strokeDasharray="8 6" preserved alongside shimmer layer (regression)', () => {
    // The same v1-bug guard from slice 6-A v2 — the base layer must
    // never be touched by sibling layers (ink OR shimmer).
    const { container } = render(
      <TargetingArrow
        source={{ x: 0, y: 0 }}
        to={{ x: 100, y: 100 }}
        strokeDasharray="8 6"
        damageStep="first-strike"
      />,
    );
    const base = container.querySelector('path[data-arrow-layer="base"]');
    expect(base?.getAttribute('stroke-dasharray')).toBe('8 6');
  });

  it('slice 6-X.0 (F-G-N1) — reduced-motion users still mount shimmer layer (static color persists)', () => {
    // Cross-critic blocker F-T-B1 / F-G-B1 / F-M-N3: the brief promises
    // that under prefers-reduced-motion the shimmer KEYFRAME is silenced
    // but the static stroke color persists (WCAG 1.4.1 redundant-signal
    // claim). The CSS fix in slice 6-X.0 adds a class-targeted media-
    // query override that wins over the parent <svg>'s data-essential-
    // motion exemption. At the DOM-shape level we assert the shimmer
    // path STILL mounts (color signal preserved); the runtime keyframe
    // silencing is a CSS concern verified by inspection of the override
    // block in index.css.
    mockReducedMotion(true);
    const { container } = render(
      <TargetingArrow
        source={{ x: 0, y: 0 }}
        to={{ x: 100, y: 100 }}
        strokeDasharray="8 6"
        damageStep="first-strike"
      />,
    );
    const shimmer = container.querySelector(
      'path[data-arrow-layer="shimmer"]',
    );
    expect(shimmer).not.toBeNull();
    expect(shimmer?.getAttribute('class')).toBe('arrow-shimmer-first-strike');
  });

  it('slice 6-X.0 (F-T-N2) — at-rest arrow has exactly one path[marker-end] on the base layer', () => {
    // Regression guard for the test-selector contract: 8+ existing tests
    // across CombatArrows + TargetingArrow use `path[marker-end]` to
    // find "the real arrow" while ignoring the <defs> arrowhead. Bundle
    // 6 added two sibling paths (ink + shimmer); only the base layer
    // carries marker-end at-rest. If a future change adds marker-end to
    // the shimmer layer (it has no arrowhead today), or if the ink
    // layer's marker-end becomes unconditional, that contract silently
    // breaks. Pin it down here so the failure is loud.
    const { container } = render(
      <TargetingArrow
        source={{ x: 0, y: 0 }}
        to={{ x: 100, y: 100 }}
        strokeDasharray="8 6"
        damageStep="first-strike"
      />,
    );
    const markerEndPaths = container.querySelectorAll('path[marker-end]');
    expect(markerEndPaths).toHaveLength(1);
    expect(markerEndPaths[0]?.getAttribute('data-arrow-layer')).toBe('base');
  });

  it('latches drawIn on mount — flipping the prop to undefined mid-animation does not interrupt', () => {
    const { container, rerender } = render(
      <TargetingArrow
        source={{ x: 0, y: 0 }}
        to={{ x: 100, y: 100 }}
        strokeDasharray="8 6"
        drawIn={{ kind: 'attack' }}
      />,
    );
    expect(
      container.querySelector('path[data-arrow-layer="ink"]'),
    ).not.toBeNull();
    // Parent flips drawIn=undefined (CombatArrows marks the arrow drawn
    // on the very next render). The ink layer must keep animating to
    // completion regardless.
    rerender(
      <TargetingArrow
        source={{ x: 0, y: 0 }}
        to={{ x: 100, y: 100 }}
        strokeDasharray="8 6"
        drawIn={undefined}
      />,
    );
    expect(
      container.querySelector('path[data-arrow-layer="ink"]'),
    ).not.toBeNull();
  });
});
