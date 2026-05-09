import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LobbyPortraitSummary } from './LobbyPortraitSummary';

describe('LobbyPortraitSummary', () => {
  it('renders empty-state copy when displayCard is null', () => {
    render(<LobbyPortraitSummary displayCard={null} />);

    const summary = screen.getByTestId('lobby-portrait-summary');
    expect(summary.dataset.state).toBe('empty');
    // Empty-state mentions both the action ("Display") and the
    // Commander-format caveat so users aren't surprised when their
    // commander deck uses commander art instead.
    expect(summary).toHaveTextContent(/no card chosen/i);
    expect(summary).toHaveTextContent(/display/i);
    expect(summary).toHaveTextContent(/commander/i);
    // No img tag in the empty state — placeholder is a plain div.
    expect(summary.querySelector('img')).toBeNull();
  });

  it('renders the chosen card name + Scryfall art when displayCard is set', () => {
    render(
      <LobbyPortraitSummary
        displayCard={{
          cardName: 'Lightning Bolt',
          setCode: 'M11',
          cardNumber: '149',
          amount: 4,
        }}
      />,
    );

    const summary = screen.getByTestId('lobby-portrait-summary');
    expect(summary.dataset.state).toBe('set');
    expect(summary.dataset.cardName).toBe('Lightning Bolt');
    expect(summary).toHaveTextContent('Lightning Bolt');

    // Art URL is the printing-locked Scryfall endpoint, lower-cased
    // setCode + URI-encoded cardNumber. Empty alt is decorative
    // (the cardName is in adjacent text content) — `alt=""` makes the
    // img presentational under ARIA so we query by tag, not role.
    const img = summary.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toBe(
      'https://api.scryfall.com/cards/m11/149?format=image&version=art_crop',
    );
    expect(img?.getAttribute('alt')).toBe('');
  });

  it('URL-encodes the cardNumber for promo / multi-version printings', () => {
    // Some printings use suffixed collector numbers like "287a"
    // (foil/etched/borderless variants). Verify the encoder doesn't
    // mangle them.
    render(
      <LobbyPortraitSummary
        displayCard={{
          cardName: 'Sol Ring',
          setCode: 'CMR',
          cardNumber: '287a',
          amount: 1,
        }}
      />,
    );

    const summary = screen.getByTestId('lobby-portrait-summary');
    const img = summary.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toContain('/cards/cmr/287a?');
  });
});
