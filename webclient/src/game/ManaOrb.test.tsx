import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ManaOrb } from './ManaOrb';

/**
 * Slice 70-C — pin the {@link ManaOrb} atom contract.
 *
 * Tests intentionally don't assert pixel sizes — those are size-class
 * implementation details that may flex. The contract is: render a
 * colored orb with the count when > 1, no number when count === 1,
 * and an aria-label that conveys the symbol semantically.
 */
describe('ManaOrb', () => {
  it('renders a single mana orb with no number when count is 1', () => {
    render(<ManaOrb color="R" count={1} />);
    const orb = screen.getByTestId('mana-orb-R');
    // count===1 omits the number — the orb's color IS the symbol.
    expect(orb).toBeInTheDocument();
    expect(orb.textContent).toBe('');
  });

  it('renders the count centered on the orb when count is > 1', () => {
    render(<ManaOrb color="W" count={5} />);
    const orb = screen.getByTestId('mana-orb-W');
    expect(orb.textContent).toBe('5');
  });

  it('default count is 1 (mana-cost rendering convention)', () => {
    render(<ManaOrb color="U" />);
    expect(screen.getByTestId('mana-orb-U').textContent).toBe('');
  });

  it('aria-label conveys color word + count semantically', () => {
    render(<ManaOrb color="G" count={3} />);
    expect(screen.getByLabelText('3 green mana')).toBeInTheDocument();
  });

  it('aria-label uses singular form for count===1', () => {
    render(<ManaOrb color="B" count={1} />);
    expect(screen.getByLabelText('1 black mana')).toBeInTheDocument();
  });

  it('respects custom aria-label override', () => {
    render(<ManaOrb color="C" count={2} ariaLabel="Two generic mana" />);
    expect(screen.getByLabelText('Two generic mana')).toBeInTheDocument();
  });

  it('glow variant adds a box-shadow with the matching glow token', () => {
    render(<ManaOrb color="R" count={1} glow />);
    const orb = screen.getByTestId('mana-orb-R');
    // The token name is a closed-set lookup; assert via inline style
    // so we test the glow-token contract specifically.
    expect(orb.style.boxShadow).toContain('var(--color-mana-red-glow)');
  });

  it('non-glow variant has no box-shadow', () => {
    render(<ManaOrb color="R" count={1} />);
    expect(screen.getByTestId('mana-orb-R').style.boxShadow).toBe('');
  });

  it('background uses the matching base color token (not the glow)', () => {
    render(<ManaOrb color="W" count={1} />);
    expect(screen.getByTestId('mana-orb-W').style.backgroundColor).toBe(
      'var(--color-mana-white)',
    );
  });

  it.each([
    ['W', 'mana-white-fg'],
    ['U', 'mana-blue-fg'],
    ['B', 'mana-black-fg'],
    ['R', 'mana-red-fg'],
    ['G', 'mana-green-fg'],
    ['C', 'mana-colorless-fg'],
  ])(
    'count text on color %s uses the paired --color-%s token (slice 70-G contrast fix)',
    (color, fgTokenName) => {
      // Slice 70-G — replaced the global text-bg-base with per-color
      // FG tokens. Each pair is hand-tuned to ≥7:1 contrast (WCAG
      // AAA) against its base color. Asserting the inline-style
      // color binding pins the token contract.
      render(<ManaOrb color={color as 'W' | 'U' | 'B' | 'R' | 'G' | 'C'} count={5} />);
      const orb = screen.getByTestId(`mana-orb-${color}`);
      expect(orb.style.color).toBe(`var(--color-${fgTokenName})`);
    },
  );

  it.each([
    ['W', 'mana-white'],
    ['U', 'mana-blue'],
    ['B', 'mana-black'],
    ['R', 'mana-red'],
    ['G', 'mana-green'],
    ['C', 'mana-colorless'],
  ])('color %s maps to token --color-%s', (color, tokenName) => {
    render(<ManaOrb color={color as 'W' | 'U' | 'B' | 'R' | 'G' | 'C'} />);
    const orb = screen.getByTestId(`mana-orb-${color}`);
    expect(orb.style.backgroundColor).toBe(`var(--color-${tokenName})`);
  });
});
