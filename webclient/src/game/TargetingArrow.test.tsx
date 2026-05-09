import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { TargetingArrow } from './TargetingArrow';

describe('TargetingArrow', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders nothing when source is null', () => {
    const { container } = render(<TargetingArrow source={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when source provided but cursor not yet observed (null `to`)', () => {
    // Without a static `to` AND without any pointermove event, the
    // arrow has no destination — it renders null until the cursor
    // moves at least once.
    const { container } = render(
      <TargetingArrow source={{ x: 100, y: 100 }} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders an SVG curve from source to a static `to` coordinate', () => {
    render(
      <TargetingArrow
        source={{ x: 100, y: 200 }}
        to={{ x: 400, y: 500 }}
      />,
    );
    const svg = screen.getByTestId('targeting-arrow');
    const path = svg.querySelector('path[marker-end]');
    expect(path).not.toBeNull();
    // Quadratic curve M source Q midpoint target.
    expect(path?.getAttribute('d')).toMatch(/^M 100 200 Q .+ 400 500$/);
  });

  it('uses --color-targeting-arrow as the default stroke', () => {
    render(
      <TargetingArrow
        source={{ x: 0, y: 0 }}
        to={{ x: 10, y: 10 }}
      />,
    );
    // The SVG contains TWO paths: the marker's arrowhead (inside <defs>)
    // and the actual curve (top-level child). Match the curve via its
    // `marker-end` attribute, which only the curve carries.
    const path = screen
      .getByTestId('targeting-arrow')
      .querySelector('path[marker-end]');
    expect(path?.getAttribute('stroke')).toBe(
      'var(--color-targeting-arrow)',
    );
  });

  it('defaults opacity to 1 when omitted (cursor-tracking call sites unchanged)', () => {
    render(
      <TargetingArrow
        source={{ x: 0, y: 0 }}
        to={{ x: 10, y: 10 }}
      />,
    );
    const path = screen
      .getByTestId('targeting-arrow')
      .querySelector('path[marker-end]');
    expect(path?.getAttribute('opacity')).toBe('1');
  });

  it('forwards an explicit opacity onto the path', () => {
    render(
      <TargetingArrow
        source={{ x: 0, y: 0 }}
        to={{ x: 10, y: 10 }}
        opacity={0.25}
      />,
    );
    const path = screen
      .getByTestId('targeting-arrow')
      .querySelector('path[marker-end]');
    expect(path?.getAttribute('opacity')).toBe('0.25');
  });

  it('respects a custom color override', () => {
    render(
      <TargetingArrow
        source={{ x: 0, y: 0 }}
        to={{ x: 10, y: 10 }}
        color="hotpink"
      />,
    );
    // The SVG contains TWO paths: the marker's arrowhead (inside <defs>)
    // and the actual curve (top-level child). Match the curve via its
    // `marker-end` attribute, which only the curve carries.
    const path = screen
      .getByTestId('targeting-arrow')
      .querySelector('path[marker-end]');
    expect(path?.getAttribute('stroke')).toBe('hotpink');
  });

  it('carries data-essential-motion="true" so prefers-reduced-motion preserves it', () => {
    // Slice 70-B contract: state-conveying motion (the arrow IS the
    // targeting state, not a transition into it) must remain
    // visually present even when motion is silenced.
    render(
      <TargetingArrow
        source={{ x: 0, y: 0 }}
        to={{ x: 10, y: 10 }}
      />,
    );
    expect(screen.getByTestId('targeting-arrow')).toHaveAttribute(
      'data-essential-motion',
      'true',
    );
  });

  it('aria-hidden — purely visual cue, the SR signal lives elsewhere', () => {
    render(
      <TargetingArrow
        source={{ x: 0, y: 0 }}
        to={{ x: 10, y: 10 }}
      />,
    );
    expect(screen.getByTestId('targeting-arrow')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
  });

  it('cursor-tracking mode subscribes to pointermove only when active', () => {
    // The component should attach a pointermove listener only when
    // source != null AND no static `to` is provided. When source
    // becomes null, the listener tears down — pointermove fires at
    // 60fps so a leaked listener would be wasteful.
    const addSpy = vi.spyOn(document, 'addEventListener');
    const removeSpy = vi.spyOn(document, 'removeEventListener');

    const { rerender } = render(<TargetingArrow source={null} />);
    // No listener while source is null.
    const movesAddedInitial = addSpy.mock.calls.filter(
      (c) => c[0] === 'pointermove',
    ).length;

    // Activate cursor-tracking.
    rerender(<TargetingArrow source={{ x: 0, y: 0 }} />);
    const movesAddedAfter = addSpy.mock.calls.filter(
      (c) => c[0] === 'pointermove',
    ).length;
    expect(movesAddedAfter).toBe(movesAddedInitial + 1);

    // Deactivate — listener removed.
    rerender(<TargetingArrow source={null} />);
    const movesRemoved = removeSpy.mock.calls.filter(
      (c) => c[0] === 'pointermove',
    ).length;
    expect(movesRemoved).toBeGreaterThanOrEqual(1);
  });

  it('updates the arrow endpoint as the cursor moves (rerender on pointermove)', () => {
    render(<TargetingArrow source={{ x: 100, y: 100 }} />);
    // Fire a pointermove at (300, 400).
    act(() => {
      const ev = new PointerEvent('pointermove', {
        clientX: 300,
        clientY: 400,
      });
      document.dispatchEvent(ev);
    });
    // The SVG contains TWO paths: the marker's arrowhead (inside <defs>)
    // and the actual curve (top-level child). Match the curve via its
    // `marker-end` attribute, which only the curve carries.
    const path = screen
      .getByTestId('targeting-arrow')
      .querySelector('path[marker-end]');
    expect(path?.getAttribute('d')).toMatch(/^M 100 100 Q .+ 300 400$/);
  });

  /* =================================================================
   * Bundle 1 / Slice 1-A — defender stroke + dash + per-instance
   * marker + gradient ids.
   * =================================================================*/

  it('accepts a StrokeSpec solid color (precedence over `color`)', () => {
    render(
      <TargetingArrow
        source={{ x: 0, y: 0 }}
        to={{ x: 10, y: 10 }}
        // `color` is ignored when `stroke` is provided.
        color="hotpink"
        stroke={{ kind: 'solid', color: 'var(--color-mana-blue)' }}
      />,
    );
    const path = screen
      .getByTestId('targeting-arrow')
      .querySelector('path[marker-end]');
    expect(path?.getAttribute('stroke')).toBe('var(--color-mana-blue)');
    expect(path?.getAttribute('data-arrow-stroke-kind')).toBe('solid');
  });

  it('renders a <linearGradient> with stops for a gradient StrokeSpec', () => {
    render(
      <TargetingArrow
        source={{ x: 100, y: 200 }}
        to={{ x: 400, y: 500 }}
        stroke={{
          kind: 'gradient',
          stops: [
            { offset: 0, color: 'var(--color-mana-blue)' },
            { offset: 0.5, color: 'var(--color-mana-blue)' },
            { offset: 0.5, color: 'var(--color-mana-green)' },
            { offset: 1, color: 'var(--color-mana-green)' },
          ],
        }}
      />,
    );
    const svg = screen.getByTestId('targeting-arrow');
    const gradient = svg.querySelector('linearGradient');
    expect(gradient).not.toBeNull();
    // Gradient orientation runs along the path's chord (source →
    // target) so multicolor bands flow from attacker to defender.
    expect(gradient?.getAttribute('x1')).toBe('100');
    expect(gradient?.getAttribute('y1')).toBe('200');
    expect(gradient?.getAttribute('x2')).toBe('400');
    expect(gradient?.getAttribute('y2')).toBe('500');
    expect(gradient?.getAttribute('gradientUnits')).toBe('userSpaceOnUse');
    const stops = gradient?.querySelectorAll('stop');
    expect(stops?.length).toBe(4);
    expect(stops?.[0]?.getAttribute('stop-color')).toBe(
      'var(--color-mana-blue)',
    );
    expect(stops?.[3]?.getAttribute('stop-color')).toBe(
      'var(--color-mana-green)',
    );
    // Path stroke references the gradient by id.
    const path = svg.querySelector('path[marker-end]');
    expect(path?.getAttribute('stroke')).toMatch(
      /^url\(#targeting-arrow-grad-/,
    );
    expect(path?.getAttribute('data-arrow-stroke-kind')).toBe('gradient');
  });

  it('marker fill matches the gradient\'s last stop color (defender-side band)', () => {
    render(
      <TargetingArrow
        source={{ x: 0, y: 0 }}
        to={{ x: 100, y: 100 }}
        stroke={{
          kind: 'gradient',
          stops: [
            { offset: 0, color: 'var(--color-mana-blue)' },
            { offset: 1, color: 'var(--color-mana-green)' },
          ],
        }}
      />,
    );
    // The arrowhead path lives inside <defs><marker>, identifiable
    // by NOT having a `marker-end` attribute (only the curve does).
    const svg = screen.getByTestId('targeting-arrow');
    const markerPath = svg.querySelector('marker > path');
    expect(markerPath).not.toBeNull();
    expect(markerPath?.getAttribute('fill')).toBe('var(--color-mana-green)');
  });

  it('forwards strokeDasharray onto the path (per-defender dash signal)', () => {
    render(
      <TargetingArrow
        source={{ x: 0, y: 0 }}
        to={{ x: 10, y: 10 }}
        strokeDasharray="8 6"
      />,
    );
    const path = screen
      .getByTestId('targeting-arrow')
      .querySelector('path[marker-end]');
    expect(path?.getAttribute('stroke-dasharray')).toBe('8 6');
  });

  it('omits stroke-dasharray attribute entirely when prop is empty (solid arrow)', () => {
    // Empty dash pattern = solid; we render no attribute rather than
    // an empty-string attribute so SVG defaults are used cleanly.
    render(
      <TargetingArrow
        source={{ x: 0, y: 0 }}
        to={{ x: 10, y: 10 }}
        strokeDasharray=""
      />,
    );
    const path = screen
      .getByTestId('targeting-arrow')
      .querySelector('path[marker-end]');
    expect(path?.hasAttribute('stroke-dasharray')).toBe(false);
  });

  it('two simultaneously-mounted instances carry distinct marker and gradient ids', () => {
    // Document-global SVG fragment-id resolution means two arrows
    // sharing a marker id paint with whichever marker is first in
    // the DOM. Slice 1-A's per-instance useId() prefix prevents that
    // — verify it actually produces distinct ids here.
    const { container } = render(
      <>
        <TargetingArrow
          source={{ x: 0, y: 0 }}
          to={{ x: 10, y: 10 }}
          stroke={{
            kind: 'gradient',
            stops: [
              { offset: 0, color: 'var(--color-mana-red)' },
              { offset: 1, color: 'var(--color-mana-red)' },
            ],
          }}
        />
        <TargetingArrow
          source={{ x: 50, y: 50 }}
          to={{ x: 60, y: 60 }}
          stroke={{
            kind: 'gradient',
            stops: [
              { offset: 0, color: 'var(--color-mana-blue)' },
              { offset: 1, color: 'var(--color-mana-blue)' },
            ],
          }}
        />
      </>,
    );
    const markers = container.querySelectorAll('marker');
    expect(markers.length).toBe(2);
    const markerIds = Array.from(markers).map((m) => m.getAttribute('id'));
    expect(new Set(markerIds).size).toBe(2);
    const gradients = container.querySelectorAll('linearGradient');
    expect(gradients.length).toBe(2);
    const gradientIds = Array.from(gradients).map((g) => g.getAttribute('id'));
    expect(new Set(gradientIds).size).toBe(2);
  });
});
