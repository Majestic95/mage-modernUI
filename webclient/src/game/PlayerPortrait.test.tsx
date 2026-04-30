/**
 * Slice 70-J — unit coverage for the PlayerPortrait atom. Tests
 * cover all variants the redesign push needs at slices 70-K
 * (PlayerFrame), 70-L (GameLog + CommanderDamageTracker), and
 * indirectly any future consumer.
 *
 * <p>Pattern mirrors PlayerFrame.test.tsx — webPlayerViewSchema.parse
 * for the fixture shape (so Zod defaults populate correctly), plus
 * a small commander factory for the commandList[] entries.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PlayerPortrait } from './PlayerPortrait';
import {
  webPlayerViewSchema,
  type WebCommandObjectView,
  type WebPlayerView,
} from '../api/schemas';

function makeCommander(
  overrides: Partial<WebCommandObjectView> = {},
): WebCommandObjectView {
  return {
    id: 'cmdr-1',
    kind: 'commander',
    name: 'Atraxa, Praetors\' Voice',
    expansionSetCode: 'C16',
    imageFileName: 'atraxa.jpg',
    imageNumber: 28,
    rules: [],
    ...overrides,
  };
}

function makePlayer(
  overrides: Partial<WebPlayerView> = {},
): WebPlayerView {
  return webPlayerViewSchema.parse({
    playerId: '11111111-1111-1111-1111-111111111111',
    name: 'alice',
    life: 40,
    wins: 0,
    winsNeeded: 1,
    libraryCount: 99,
    handCount: 7,
    graveyard: {},
    exile: {},
    sideboard: {},
    battlefield: {},
    manaPool: { red: 0, green: 0, blue: 0, white: 0, black: 0, colorless: 0 },
    controlled: true,
    isHuman: true,
    isActive: false,
    hasPriority: false,
    hasLeft: false,
    monarch: false,
    initiative: false,
    designationNames: [],
    commandList: [makeCommander()],
    colorIdentity: ['W', 'U', 'B', 'G'],
    connectionState: 'connected',
    ...overrides,
  });
}

describe('PlayerPortrait — image resolution', () => {
  it('renders the commander art-crop URL when commandList has a commander', () => {
    render(<PlayerPortrait player={makePlayer()} />);
    const img = screen.getByTestId(
      'player-portrait-image',
    ) as HTMLImageElement;
    expect(img.src).toContain('api.scryfall.com');
    expect(img.src).toContain('/c16/28');
    expect(img.src).toContain('version=art_crop');
  });

  it('renders the fallback initial when commandList is empty', () => {
    render(<PlayerPortrait player={makePlayer({ commandList: [] })} />);
    expect(screen.queryByTestId('player-portrait-image')).toBeNull();
    expect(
      screen.getByTestId('player-portrait-fallback'),
    ).toHaveTextContent('A'); // alice → A
  });

  it('renders the fallback when commandList only has emblems / dungeons / planes', () => {
    // Slice 70-D's WebCommandObjectView discriminator distinguishes
    // commander entries from emblems / dungeons / planes. Only
    // 'commander' kinds drive the portrait.
    render(
      <PlayerPortrait
        player={makePlayer({
          commandList: [
            makeCommander({ kind: 'emblem', name: 'Liliana, the Last Hope' }),
            makeCommander({ kind: 'dungeon', name: 'Dungeon of the Mad Mage' }),
          ],
        })}
      />,
    );
    expect(screen.queryByTestId('player-portrait-image')).toBeNull();
    expect(
      screen.getByTestId('player-portrait-fallback'),
    ).toBeInTheDocument();
  });

  it('uses the FIRST commander entry when multiple exist (partner pairings)', () => {
    // Partner / background commanders ship as two entries in
    // commandList. Slice 70-J shows the first; slice 70-K may
    // revisit if partner art needs special treatment.
    render(
      <PlayerPortrait
        player={makePlayer({
          commandList: [
            makeCommander({
              id: 'partner-1',
              name: 'Tymna the Weaver',
              expansionSetCode: 'CMD',
              imageNumber: 42,
            }),
            makeCommander({
              id: 'partner-2',
              name: 'Thrasios, Triton Hero',
              expansionSetCode: 'CMD',
              imageNumber: 51,
            }),
          ],
        })}
      />,
    );
    const img = screen.getByTestId(
      'player-portrait-image',
    ) as HTMLImageElement;
    expect(img.src).toContain('/cmd/42'); // Tymna's number
  });

  it('falls back when commander has no expansionSetCode', () => {
    // Defensive — engine could emit a partial commander record
    // (e.g. mid-game-init race). Fallback rather than broken image.
    render(
      <PlayerPortrait
        player={makePlayer({
          commandList: [makeCommander({ expansionSetCode: '' })],
        })}
      />,
    );
    expect(screen.queryByTestId('player-portrait-image')).toBeNull();
    expect(
      screen.getByTestId('player-portrait-fallback'),
    ).toBeInTheDocument();
  });
});

describe('PlayerPortrait — sizes', () => {
  it.each([
    ['small', 32],
    ['medium', 80],
    ['large', 96],
  ] as const)(
    'size="%s" renders at %d px',
    (size, expectedPx) => {
      render(<PlayerPortrait player={makePlayer()} size={size} />);
      const portrait = screen.getByTestId('player-portrait');
      expect(portrait).toHaveAttribute('data-size', size);
      expect(portrait.style.width).toBe(`${expectedPx}px`);
      expect(portrait.style.height).toBe(`${expectedPx}px`);
    },
  );

  it('default size is medium', () => {
    render(<PlayerPortrait player={makePlayer()} />);
    expect(screen.getByTestId('player-portrait')).toHaveAttribute(
      'data-size',
      'medium',
    );
  });
});

describe('PlayerPortrait — halo variants', () => {
  it('renders a halo by default (haloVariant="circular")', () => {
    render(<PlayerPortrait player={makePlayer()} />);
    expect(
      screen.getByTestId('player-portrait-halo'),
    ).toBeInTheDocument();
  });

  it('haloVariant="none" suppresses the halo', () => {
    render(<PlayerPortrait player={makePlayer()} haloVariant="none" />);
    expect(screen.queryByTestId('player-portrait-halo')).toBeNull();
  });

  it('halo data attributes reflect color-identity count', () => {
    render(
      <PlayerPortrait
        player={makePlayer({ colorIdentity: ['W'] })}
      />,
    );
    expect(screen.getByTestId('player-portrait-halo')).toHaveAttribute(
      'data-color-count',
      '1',
    );
  });

  it('multicolor halo rotates (data-rotating="true")', () => {
    // Picture-catalog §2.0: multicolor halos rotate at 12s/rev via
    // animate-halo-rotate. Single-color rings are static (rotation
    // would burn paint cycles).
    render(
      <PlayerPortrait
        player={makePlayer({ colorIdentity: ['W', 'U', 'B', 'G'] })}
      />,
    );
    expect(screen.getByTestId('player-portrait-halo')).toHaveAttribute(
      'data-rotating',
      'true',
    );
  });

  it('single-color halo does NOT rotate', () => {
    render(
      <PlayerPortrait
        player={makePlayer({ colorIdentity: ['R'] })}
      />,
    );
    expect(
      screen.getByTestId('player-portrait-halo'),
    ).not.toHaveAttribute('data-rotating');
  });

  it('empty colorIdentity does NOT rotate (non-commander format)', () => {
    render(
      <PlayerPortrait
        player={makePlayer({ colorIdentity: [] })}
      />,
    );
    expect(
      screen.getByTestId('player-portrait-halo'),
    ).not.toHaveAttribute('data-rotating');
  });

  it('radiates an outer box-shadow glow in the single-color mana-glow token (universal halo-glow rule)', () => {
    // Slice 70-N.1 user directive 2026-04-30: every halo (player
    // portrait + focal stack card + any future surface) MUST have
    // an outer glow that radiates in its color, not just sit as a
    // flat ring. Single-color portrait → one box-shadow layer.
    render(
      <PlayerPortrait
        player={makePlayer({ colorIdentity: ['G'] })}
        size="medium"
      />,
    );
    const halo = screen.getByTestId('player-portrait-halo');
    expect(halo.dataset['haloGlow']).toBe(
      '0 0 14px 0 var(--color-mana-green-glow)',
    );
  });

  it('layers one box-shadow per color for multicolor halos (universal halo-glow rule)', () => {
    render(
      <PlayerPortrait
        player={makePlayer({ colorIdentity: ['W', 'U', 'B', 'G'] })}
        size="medium"
      />,
    );
    const halo = screen.getByTestId('player-portrait-halo');
    // Four colors → four layered shadows, additive composition.
    expect(halo.dataset['haloGlow']).toBe(
      '0 0 14px 0 var(--color-mana-white-glow), 0 0 14px 0 var(--color-mana-blue-glow), 0 0 14px 0 var(--color-mana-black-glow), 0 0 14px 0 var(--color-mana-green-glow)',
    );
  });

  it('uses colorless-glow for empty colorIdentity', () => {
    render(
      <PlayerPortrait
        player={makePlayer({ colorIdentity: [] })}
        size="medium"
      />,
    );
    const halo = screen.getByTestId('player-portrait-halo');
    expect(halo.dataset['haloGlow']).toBe(
      '0 0 14px 0 var(--color-mana-colorless-glow)',
    );
  });

  it('scales glow radius with portrait size (small=8px, medium=14px, large=18px)', () => {
    // Smaller portraits get tighter glows so the radiated halo
    // doesn't dwarf the avatar; larger pods get a wider glow that
    // balances the bigger circle.
    const { rerender } = render(
      <PlayerPortrait
        player={makePlayer({ colorIdentity: ['R'] })}
        size="small"
      />,
    );
    expect(
      screen.getByTestId('player-portrait-halo').dataset['haloGlow'],
    ).toBe('0 0 8px 0 var(--color-mana-red-glow)');

    rerender(
      <PlayerPortrait
        player={makePlayer({ colorIdentity: ['R'] })}
        size="large"
      />,
    );
    expect(
      screen.getByTestId('player-portrait-halo').dataset['haloGlow'],
    ).toBe('0 0 18px 0 var(--color-mana-red-glow)');
  });
});

describe('PlayerPortrait — state composition', () => {
  it('isActive=true sets data-pulsing on the halo', () => {
    render(
      <PlayerPortrait
        player={makePlayer({ isActive: true })}
      />,
    );
    expect(screen.getByTestId('player-portrait-halo')).toHaveAttribute(
      'data-pulsing',
      'true',
    );
  });

  it('isActive=false does NOT pulse', () => {
    render(<PlayerPortrait player={makePlayer({ isActive: false })} />);
    expect(
      screen.getByTestId('player-portrait-halo'),
    ).not.toHaveAttribute('data-pulsing');
  });

  it('eliminated state suppresses halo rotation AND pulse (greys out)', () => {
    // Picture-catalog §2.4: eliminated halo greys + the slash
    // overlay (PlayerArea-level, slice 70-D) is the dominant
    // signal. Halo rotation/pulse would compete with the slash.
    render(
      <PlayerPortrait
        player={makePlayer({
          hasLeft: true,
          isActive: true,
          colorIdentity: ['W', 'U', 'B', 'G'],
        })}
      />,
    );
    const halo = screen.getByTestId('player-portrait-halo');
    expect(halo).not.toHaveAttribute('data-rotating');
    expect(halo).not.toHaveAttribute('data-pulsing');
    expect(halo).toHaveAttribute('data-eliminated', 'true');
  });

  it('disconnected (and not hasLeft) keeps halo animations active', () => {
    // Picture-catalog §2.4: disconnected is recoverable; eliminated
    // is terminal. Disconnected halo desaturates the PORTRAIT but
    // the halo continues to pulse/rotate so the active-player
    // signal remains readable. The "Disconnected" pill is at the
    // pod level (slice 70-H), not the portrait.
    render(
      <PlayerPortrait
        player={makePlayer({
          connectionState: 'disconnected',
          isActive: true,
          colorIdentity: ['W', 'U', 'B', 'G'],
        })}
      />,
    );
    const halo = screen.getByTestId('player-portrait-halo');
    expect(halo).toHaveAttribute('data-rotating', 'true');
    expect(halo).toHaveAttribute('data-pulsing', 'true');

    const portrait = screen.getByTestId('player-portrait');
    expect(portrait).toHaveAttribute('data-disconnected', 'true');
    expect(portrait).not.toHaveAttribute('data-eliminated');
  });

  it('eliminated takes precedence over disconnected (terminal wins)', () => {
    // Same precedence rule as PlayerFrame (slice 70-H critic UX-I1)
    // — a player who's both flagged hasLeft AND has a stale
    // disconnected connectionState renders as eliminated only.
    render(
      <PlayerPortrait
        player={makePlayer({
          hasLeft: true,
          connectionState: 'disconnected',
        })}
      />,
    );
    const portrait = screen.getByTestId('player-portrait');
    expect(portrait).toHaveAttribute('data-eliminated', 'true');
    expect(portrait).not.toHaveAttribute('data-disconnected');
  });

  it('eliminated portrait gets heavier desaturation than disconnected', () => {
    // Picture-catalog §2.4 — eliminated: grayscale(1) opacity(0.5)
    // (terminal); disconnected: grayscale(0.6) opacity(0.7)
    // (recoverable). The visual difference is the at-a-glance
    // "are they coming back" signal.
    const { rerender } = render(
      <PlayerPortrait player={makePlayer({ hasLeft: true })} />,
    );
    let img = screen.getByTestId('player-portrait-image');
    expect(img.style.filter).toBe('grayscale(1) opacity(0.5)');

    rerender(
      <PlayerPortrait
        player={makePlayer({ connectionState: 'disconnected' })}
      />,
    );
    img = screen.getByTestId('player-portrait-image');
    expect(img.style.filter).toBe('grayscale(0.6) opacity(0.7)');
  });
});

describe('PlayerPortrait — accessibility', () => {
  it('has role="img" with derived aria-label (commander present)', () => {
    render(<PlayerPortrait player={makePlayer()} />);
    const portrait = screen.getByTestId('player-portrait');
    expect(portrait).toHaveAttribute('role', 'img');
    expect(portrait).toHaveAccessibleName(
      /alice portrait, commander Atraxa/,
    );
  });

  it('aria-label falls back to player-only when no commander', () => {
    render(<PlayerPortrait player={makePlayer({ commandList: [] })} />);
    const portrait = screen.getByTestId('player-portrait');
    expect(portrait).toHaveAccessibleName('alice portrait');
  });

  it('caller can override via ariaLabel prop', () => {
    render(
      <PlayerPortrait
        player={makePlayer()}
        ariaLabel="Compact game-log avatar for alice"
      />,
    );
    expect(
      screen.getByTestId('player-portrait'),
    ).toHaveAccessibleName('Compact game-log avatar for alice');
  });

  it('the inner image is aria-hidden via empty alt (decoration)', () => {
    // The role="img" + aria-label on the wrapper is the SR
    // announcement surface; the inner <img> is decoration. Empty
    // alt="" is the canonical pattern for decorative images.
    render(<PlayerPortrait player={makePlayer()} />);
    const img = screen.getByTestId('player-portrait-image');
    expect(img).toHaveAttribute('alt', '');
  });

  it('halo is aria-hidden (decoration; color-identity SR signal lives on the parent PlayerFrame)', () => {
    render(<PlayerPortrait player={makePlayer()} />);
    expect(screen.getByTestId('player-portrait-halo')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
  });
});

describe('PlayerPortrait — fallback initial', () => {
  it('uses the first character of player.name uppercased', () => {
    render(
      <PlayerPortrait
        player={makePlayer({ name: 'bob', commandList: [] })}
      />,
    );
    expect(
      screen.getByTestId('player-portrait-fallback'),
    ).toHaveTextContent('B');
  });

  it('uses "?" when player.name is empty', () => {
    render(
      <PlayerPortrait
        player={makePlayer({ name: '', commandList: [] })}
      />,
    );
    expect(
      screen.getByTestId('player-portrait-fallback'),
    ).toHaveTextContent('?');
  });
});
