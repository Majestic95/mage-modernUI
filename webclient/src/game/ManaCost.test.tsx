import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ManaCost, ManaText } from './ManaCost';

describe('ManaCost', () => {
  it('renders one icon per token', () => {
    render(<ManaCost cost="{2}{R}{R}" />);
    const icons = screen
      .getByTestId('mana-cost')
      .querySelectorAll('i.ms');
    expect(icons).toHaveLength(3);
    expect(icons[0]?.getAttribute('data-symbol')).toBe('{2}');
    expect(icons[1]?.className).toContain('ms-r');
  });

  it('returns null for empty cost', () => {
    const { container } = render(<ManaCost cost="" />);
    expect(container.firstChild).toBeNull();
  });

  it('maps {T} to the tap icon', () => {
    render(<ManaCost cost="{T}" />);
    const icon = screen.getByTestId('mana-cost').querySelector('i.ms');
    expect(icon?.className).toContain('ms-tap');
  });
});

describe('ManaText', () => {
  it('renders plain text untouched when no tokens are present', () => {
    render(<ManaText text="Cancel" />);
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });

  it('replaces {X} tokens with mana icons and keeps surrounding text', () => {
    const { container } = render(<ManaText text="{T}: Add {G}." />);
    const icons = container.querySelectorAll('i.ms');
    expect(icons).toHaveLength(2);
    expect(icons[0]?.className).toContain('ms-tap');
    expect(icons[1]?.className).toContain('ms-g');
    expect(container.textContent).toContain(': Add ');
    expect(container.textContent).toContain('.');
  });

  it('handles a label that starts with a numeric prefix', () => {
    const { container } = render(<ManaText text="1. {T}: Add {W}." />);
    expect(container.textContent).toContain('1. ');
    const icons = container.querySelectorAll('i.ms');
    expect(icons).toHaveLength(2);
  });

  it('handles back-to-back tokens with no separator', () => {
    const { container } = render(<ManaText text="{G}{W}" />);
    const icons = container.querySelectorAll('i.ms');
    expect(icons).toHaveLength(2);
    expect(icons[0]?.className).toContain('ms-g');
    expect(icons[1]?.className).toContain('ms-w');
  });

  it('hybrid tokens drop the slash to match the font class scheme', () => {
    const { container } = render(<ManaText text="Add {W/U}." />);
    const icon = container.querySelector('i.ms');
    expect(icon?.className).toContain('ms-wu');
  });

  it('returns null for empty input', () => {
    const { container } = render(<ManaText text="" />);
    expect(container.firstChild).toBeNull();
  });
});
