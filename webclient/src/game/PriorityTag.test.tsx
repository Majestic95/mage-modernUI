import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PriorityTag } from './PriorityTag';

describe('PriorityTag', () => {
  it('renders the literal "PRIORITY" label', () => {
    render(<PriorityTag />);
    expect(screen.getByTestId('priority-tag').textContent).toBe('PRIORITY');
  });

  it('is aria-hidden — priority is announced via PlayerArea aria-label, not per-tag mount', () => {
    // Slice 70-C critic UX-C2 — during stack resolution priority can
    // cycle 8-12 times in seconds; an SR announcement per
    // mount/unmount produces useless spam. The PlayerArea container
    // already includes "has priority" in its aria-label so SR users
    // hear the signal once at the seat level.
    render(<PriorityTag />);
    expect(screen.getByTestId('priority-tag')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
  });

  it('uses the accent-primary token for the background (slice 70-A token contract)', () => {
    render(<PriorityTag />);
    const tag = screen.getByTestId('priority-tag');
    // The atom uses Tailwind utility classes that resolve through
    // the @theme block to design tokens. Asserting className keeps
    // the test stable across tooling changes.
    expect(tag.className).toContain('bg-accent-primary');
    expect(tag.className).toContain('text-text-on-accent');
  });
});
