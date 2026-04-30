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
});
