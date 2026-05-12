import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LifeBadge } from './LifeBadge';

/**
 * Bundle 5 polish (2026-05-12) — assertions cover the visible state
 * machine: data-* attributes flip when pendingTicks transitions
 * across the 0 boundary. The motion timing (scale-pop, drop-shadow,
 * color transition) is exercised by live testing in the cinematic
 * lab — Framer Motion does not apply visual transforms in jsdom, so
 * unit tests assert on the synchronous render contract only.
 */
describe('LifeBadge', () => {
  it('renders displayed life as text', () => {
    render(
      <LifeBadge displayedLife={40} pendingTicks={0} perspective="self" />,
    );
    expect(screen.getByTestId('life-numeral-self')).toHaveTextContent('40');
  });

  it('preserves the perspective-suffixed testid for self/opponent', () => {
    const { rerender } = render(
      <LifeBadge displayedLife={20} pendingTicks={0} perspective="self" />,
    );
    expect(screen.getByTestId('life-numeral-self')).toBeInTheDocument();
    rerender(
      <LifeBadge displayedLife={20} pendingTicks={0} perspective="opponent" />,
    );
    expect(screen.getByTestId('life-numeral-opponent')).toBeInTheDocument();
  });

  it('emits data-taking-damage="true" while pendingTicks > 0', () => {
    render(
      <LifeBadge displayedLife={20} pendingTicks={6} perspective="self" />,
    );
    const badge = screen.getByTestId('life-numeral-self');
    expect(badge).toHaveAttribute('data-taking-damage', 'true');
    expect(badge).toHaveAttribute('data-pending-ticks', '6');
  });

  it('omits data-taking-damage when pendingTicks === 0', () => {
    render(
      <LifeBadge displayedLife={14} pendingTicks={0} perspective="self" />,
    );
    const badge = screen.getByTestId('life-numeral-self');
    expect(badge).not.toHaveAttribute('data-taking-damage');
    expect(badge).toHaveAttribute('data-pending-ticks', '0');
  });

  it('flips data-taking-damage when pendingTicks transitions across 0', () => {
    const { rerender } = render(
      <LifeBadge displayedLife={20} pendingTicks={0} perspective="self" />,
    );
    expect(screen.getByTestId('life-numeral-self')).not.toHaveAttribute(
      'data-taking-damage',
    );

    // Damage event arrives: 6 parcels queued, displayed = wireLife
    // (14) + pending (6) = still 20.
    rerender(
      <LifeBadge displayedLife={20} pendingTicks={6} perspective="self" />,
    );
    expect(screen.getByTestId('life-numeral-self')).toHaveAttribute(
      'data-taking-damage',
      'true',
    );

    // All parcels landed: pendingTicks drains to 0, displayed
    // converges to wire (14). Lift + red release.
    rerender(
      <LifeBadge displayedLife={14} pendingTicks={0} perspective="self" />,
    );
    expect(screen.getByTestId('life-numeral-self')).not.toHaveAttribute(
      'data-taking-damage',
    );
    expect(screen.getByTestId('life-numeral-self')).toHaveTextContent('14');
  });

  it('shows the decremented value mid-damage (per-parcel tick)', () => {
    // Simulate parcels 1 + 2 having landed of a 6-damage swing:
    // wireLife = 14, pendingTicks = 4 → displayed = 18.
    render(
      <LifeBadge displayedLife={18} pendingTicks={4} perspective="self" />,
    );
    const badge = screen.getByTestId('life-numeral-self');
    expect(badge).toHaveTextContent('18');
    expect(badge).toHaveAttribute('data-taking-damage', 'true');
    expect(badge).toHaveAttribute('data-pending-ticks', '4');
  });
});
