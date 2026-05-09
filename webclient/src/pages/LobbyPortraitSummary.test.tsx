import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
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

  it('resets the failed-image placeholder when displayCard changes', () => {
    // Audit follow-up — `imgFailed` state was previously persisted
    // across re-renders. A one-time Scryfall 404 on the first pick
    // would keep the placeholder rendered even after the user picked
    // a different card with valid art. Pin the reset behavior so a
    // future refactor doesn't reintroduce the leak.
    const cardA = {
      cardName: 'Lightning Bolt',
      setCode: 'M11',
      cardNumber: '149',
      amount: 4,
    };
    const cardB = {
      cardName: 'Doom Blade',
      setCode: 'M10',
      cardNumber: '95',
      amount: 4,
    };

    const { rerender } = render(<LobbyPortraitSummary displayCard={cardA} />);
    let summary = screen.getByTestId('lobby-portrait-summary');
    let img = summary.querySelector('img');
    expect(img).not.toBeNull();

    // Simulate the Scryfall 404 path on card A — onError flips
    // imgFailed → true, the img unmounts, only the placeholder div
    // remains.
    fireEvent.error(img!);
    summary = screen.getByTestId('lobby-portrait-summary');
    expect(summary.querySelector('img')).toBeNull();

    // User picks card B. Without the reset, imgFailed stays true and
    // the placeholder keeps rendering. With the reset, the new img
    // mounts and points at card B's URL.
    rerender(<LobbyPortraitSummary displayCard={cardB} />);
    summary = screen.getByTestId('lobby-portrait-summary');
    img = summary.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toBe(
      'https://api.scryfall.com/cards/m10/95?format=image&version=art_crop',
    );
  });
});
