import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TargetingArrow } from './TargetingArrow';
import {
  ATTACK_ARROW_DRAW_MS,
  ATTACK_ARROW_HEAD_DELAY_FRACTION,
} from '../animation/transitions';

/**
 * Bundle 6 / Slice 6-A — pen-stroke draw-in.
 *
 * Verifies the rendered DOM at three pen-stroke states:
 *   1. drawIn omitted        — legacy behavior (no pathLength override,
 *                              dasharray reflects the strokeDasharray prop).
 *   2. drawIn=true (initial) — pathLength="1", dasharray="1 1",
 *                              stroke-dashoffset=1, marker head opacity=0.
 *   3. drawIn=true (post-raf)— after the requestAnimationFrame callback
 *                              fires (state flips to 'complete'),
 *                              stroke-dashoffset=0, marker head opacity=1,
 *                              and the path's transition string includes
 *                              `stroke-dashoffset {N}ms`.
 *   4. drawIn=false          — same DOM as the post-raf state but with
 *                              no animation registered (no
 *                              `stroke-dashoffset` substring in the
 *                              path's transition).
 *   5. drawIn=true + prefers- — short-circuits to the static drawn state
 *      reduced-motion          (same DOM as drawIn=false).
 */

function getCurvePath(): SVGPathElement | null {
  // The SVG has TWO paths: the arrowhead inside <defs><marker> and the
  // visible curve. The curve is the one carrying `marker-end`.
  return screen
    .getByTestId('targeting-arrow')
    .querySelector('path[marker-end]');
}

function getMarkerHeadPath(): SVGPathElement | null {
  // The marker's inner triangle path lives inside <defs><marker>.
  return screen
    .getByTestId('targeting-arrow')
    .querySelector('marker > path');
}

describe('TargetingArrow — slice 6-A pen-stroke draw-in', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('drawIn omitted preserves legacy behavior — no pathLength, dasharray honored', () => {
    render(
      <TargetingArrow
        source={{ x: 0, y: 0 }}
        to={{ x: 100, y: 100 }}
        strokeDasharray="8 6"
      />,
    );
    const path = getCurvePath();
    expect(path?.getAttribute('pathLength')).toBeNull();
    expect(path?.getAttribute('stroke-dasharray')).toBe('8 6');
    // No inline stroke-dashoffset; legacy style block.
    const styleAttr = path?.getAttribute('style') ?? '';
    expect(styleAttr).not.toContain('stroke-dashoffset');
    // Marker inner-path should have no inline opacity style (legacy).
    const head = getMarkerHeadPath();
    expect(head?.getAttribute('style') ?? '').toBe('');
  });

  it('drawIn=true initial paint — pathLength=1, dasharray=1 1, offset=1, head opacity=0', () => {
    // No raf stub: the requestAnimationFrame scheduled inside the
    // component's useEffect doesn't fire during render(), so
    // drawProgress stays 'initial'.
    render(
      <TargetingArrow
        source={{ x: 0, y: 0 }}
        to={{ x: 100, y: 100 }}
        drawIn={true}
      />,
    );
    const path = getCurvePath();
    expect(path?.getAttribute('pathLength')).toBe('1');
    expect(path?.getAttribute('stroke-dasharray')).toBe('1 1');
    const styleAttr = path?.getAttribute('style') ?? '';
    expect(styleAttr).toContain('stroke-dashoffset: 1');
    const head = getMarkerHeadPath();
    expect(head?.getAttribute('style') ?? '').toContain('opacity: 0');
  });

  it('drawIn=true after raf flush — offset=0, head opacity=1, transition wired', () => {
    // Stub raf to fire synchronously so the useEffect's state flip
    // commits within the same act() boundary. React then re-renders
    // with drawProgress='complete' before render() returns.
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(
      (cb: FrameRequestCallback) => {
        cb(0);
        return 0;
      },
    );
    render(
      <TargetingArrow
        source={{ x: 0, y: 0 }}
        to={{ x: 100, y: 100 }}
        drawIn={true}
      />,
    );
    const path = getCurvePath();
    const styleAttr = path?.getAttribute('style') ?? '';
    expect(styleAttr).toContain('stroke-dashoffset: 0');
    expect(styleAttr).toContain(`stroke-dashoffset ${ATTACK_ARROW_DRAW_MS}ms`);
    const head = getMarkerHeadPath();
    const headStyle = head?.getAttribute('style') ?? '';
    expect(headStyle).toContain('opacity: 1');
    // Head fades in over the last 25% of the timeline after a 75% delay.
    const headDelayMs = ATTACK_ARROW_DRAW_MS * ATTACK_ARROW_HEAD_DELAY_FRACTION;
    const headFadeMs = ATTACK_ARROW_DRAW_MS - headDelayMs;
    expect(headStyle).toContain(
      `opacity ${headFadeMs}ms ease-out ${headDelayMs}ms`,
    );
  });

  it('drawIn=false renders post-drawn state with no animation', () => {
    render(
      <TargetingArrow
        source={{ x: 0, y: 0 }}
        to={{ x: 100, y: 100 }}
        drawIn={false}
      />,
    );
    const path = getCurvePath();
    // Same final geometry as drawIn=true completed — pathLength + 1 1
    // dash + offset 0 — but no transition entry for stroke-dashoffset.
    expect(path?.getAttribute('pathLength')).toBe('1');
    expect(path?.getAttribute('stroke-dasharray')).toBe('1 1');
    const styleAttr = path?.getAttribute('style') ?? '';
    expect(styleAttr).toContain('stroke-dashoffset: 0');
    expect(styleAttr).not.toContain('stroke-dashoffset 400ms');
    const head = getMarkerHeadPath();
    const headStyle = head?.getAttribute('style') ?? '';
    expect(headStyle).toContain('opacity: 1');
    // Animation transition is suppressed — `none` is the literal value
    // the component writes when no draw-in animation is active.
    expect(headStyle).toContain('transition: none');
  });

  it('drawIn=true + prefers-reduced-motion short-circuits to post-drawn state', () => {
    // matchMedia mock returning matches=true for the reduce query.
    // Same shape as CombatArrows.test.tsx so the project's
    // reduced-motion mocks stay consistent.
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('reduce'),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      onchange: null,
      dispatchEvent: vi.fn(),
    }));
    try {
      render(
        <TargetingArrow
          source={{ x: 0, y: 0 }}
          to={{ x: 100, y: 100 }}
          drawIn={true}
        />,
      );
      const path = getCurvePath();
      expect(path?.getAttribute('pathLength')).toBe('1');
      expect(path?.getAttribute('stroke-dasharray')).toBe('1 1');
      const styleAttr = path?.getAttribute('style') ?? '';
      expect(styleAttr).toContain('stroke-dashoffset: 0');
      // No animation transition under reduced motion.
      expect(styleAttr).not.toContain('stroke-dashoffset 400ms');
      const head = getMarkerHeadPath();
      const headStyle = head?.getAttribute('style') ?? '';
      expect(headStyle).toContain('opacity: 1');
      expect(headStyle).toContain('transition: none');
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });
});
