/**
 * Slice A (this pass) — focused tests for the mana-symbol splitter
 * inside {@link renderUpstreamMarkup}. The wider markup tokenizer is
 * exercised through consumer suites (ManaPayBanner, GameLog, etc.);
 * this file specifically locks in the {@code {X}} → Mana font icon
 * behavior so future refactors can't silently regress mana rendering.
 */
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { renderUpstreamMarkup } from './markupRenderer';

function renderToContainer(node: React.ReactNode) {
  return render(<div data-testid="root">{node}</div>).getByTestId('root');
}

describe('renderUpstreamMarkup — mana symbols', () => {
  it('renders bare cost text as ordered Mana font symbols', () => {
    const root = renderToContainer(renderUpstreamMarkup('Pay {1}{G}{W}'));
    const symbols = Array.from(root.querySelectorAll('[data-symbol]'));
    expect(symbols.map((s) => s.getAttribute('data-symbol'))).toEqual([
      '{1}',
      '{G}',
      '{W}',
    ]);
    // Surrounding prose remains as text.
    expect(root.textContent?.startsWith('Pay')).toBe(true);
  });

  it('renders symbols inside font-color highlights (recursive case)', () => {
    const root = renderToContainer(
      renderUpstreamMarkup(
        "Pay <font color='#FF6347'>{R}</font> for the spell",
      ),
    );
    const symbols = Array.from(root.querySelectorAll('[data-symbol]'));
    expect(symbols.map((s) => s.getAttribute('data-symbol'))).toEqual(['{R}']);
  });

  it('handles hybrid and tap tokens', () => {
    const root = renderToContainer(renderUpstreamMarkup('{T}: Add {W/U}.'));
    const symbols = Array.from(root.querySelectorAll('[data-symbol]'));
    expect(symbols.map((s) => s.getAttribute('data-symbol'))).toEqual([
      '{T}',
      '{W/U}',
    ]);
  });

  it('renders messages without mana tokens unchanged', () => {
    const root = renderToContainer(
      renderUpstreamMarkup('alice draws a card'),
    );
    expect(root.querySelector('[data-symbol]')).toBeNull();
    expect(root.textContent).toBe('alice draws a card');
  });

  it('keeps adjacent tokens distinct (no run-on)', () => {
    const root = renderToContainer(renderUpstreamMarkup('{2}{G}{G}'));
    const symbols = Array.from(root.querySelectorAll('[data-symbol]'));
    expect(symbols).toHaveLength(3);
    expect(symbols.map((s) => s.getAttribute('data-symbol'))).toEqual([
      '{2}',
      '{G}',
      '{G}',
    ]);
  });
});
