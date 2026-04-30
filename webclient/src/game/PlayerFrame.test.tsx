import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PlayerFrame } from './PlayerFrame';
import { webPlayerViewSchema, type WebPlayerView } from '../api/schemas';

function makePlayer(overrides: Partial<WebPlayerView> = {}): WebPlayerView {
  return webPlayerViewSchema.parse({
    playerId: '11111111-1111-1111-1111-111111111111',
    name: 'alice',
    life: 20,
    wins: 0,
    winsNeeded: 1,
    libraryCount: 60,
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
    ...overrides,
  });
}

describe('PlayerFrame', () => {
  it('renders the player name + life total', () => {
    render(
      <PlayerFrame
        player={makePlayer({ name: 'alice', life: 18 })}
        perspective="self"
        onPlayerClick={() => {}}
        targetable={false}
      />,
    );
    expect(screen.getByText('alice')).toBeInTheDocument();
    expect(
      screen.getByTestId('life-counter-value-self').textContent,
    ).toBe('18');
  });

  it('synthesizes aria-label with persona signals (critic N11)', () => {
    // Slice 70-D moved aria-label synthesis from PlayerArea here.
    // The frame owns name + life + active + priority + eliminated
    // signals, so it owns the SR announcement of them.
    render(
      <PlayerFrame
        player={makePlayer({
          name: 'alice',
          life: 18,
          isActive: true,
          hasPriority: true,
        })}
        perspective="self"
        onPlayerClick={() => {}}
        targetable={false}
      />,
    );
    const frame = screen.getByTestId('player-frame-self');
    expect(frame).toHaveAccessibleName(
      'alice, 18 life, your seat, active turn, has priority',
    );
  });

  it('aria-label includes commander color identity (critic UX-I3)', () => {
    // SR users get no halo information from a visual ring; the
    // colorIdentity strings are the strategic signal Atraxa-vs-Edgar
    // info that sighted users get from the conic-gradient.
    render(
      <PlayerFrame
        player={makePlayer({
          name: 'alice',
          life: 18,
          colorIdentity: ['W', 'U', 'B', 'G'],
        })}
        perspective="self"
        onPlayerClick={() => {}}
        targetable={false}
      />,
    );
    const frame = screen.getByTestId('player-frame-self');
    expect(frame).toHaveAccessibleName(
      'alice, 18 life, your seat, white, blue, black, green',
    );
  });

  it('aria-label includes "eliminated" when hasLeft is true', () => {
    render(
      <PlayerFrame
        player={makePlayer({ name: 'bob', hasLeft: true })}
        perspective="opponent"
        onPlayerClick={() => {}}
        targetable={false}
      />,
    );
    const frame = screen.getByTestId('player-frame-opponent');
    expect(frame).toHaveAccessibleName(/eliminated/);
  });

  describe('elimination overlay', () => {
    it('renders the slash SVG when hasLeft is true', () => {
      render(
        <PlayerFrame
          player={makePlayer({ name: 'bob', hasLeft: true })}
          perspective="opponent"
          onPlayerClick={() => {}}
          targetable={false}
        />,
      );
      expect(
        screen.getByTestId('elimination-slash-opponent'),
      ).toBeInTheDocument();
      // data-eliminated attribute drives any sibling CSS that needs to
      // know the state without re-checking the player view-object.
      expect(screen.getByTestId('player-frame-opponent')).toHaveAttribute(
        'data-eliminated',
        'true',
      );
    });

    it('does NOT render the slash when hasLeft is false', () => {
      render(
        <PlayerFrame
          player={makePlayer({ name: 'alice', hasLeft: false })}
          perspective="self"
          onPlayerClick={() => {}}
          targetable={false}
        />,
      );
      expect(screen.queryByTestId('elimination-slash-self')).toBeNull();
      expect(screen.getByTestId('player-frame-self')).not.toHaveAttribute(
        'data-eliminated',
      );
    });

    it('the slash uses the paired stroke tokens (color-blind safety)', () => {
      // Critic A11y — the slash needs both a fill (red) and an
      // outline (white) so the diagonal SHAPE signals elimination
      // even when the red collapses to grey under deuteranopia /
      // protanopia / tritanopia. ADR 0011 D2 paired tokens.
      render(
        <PlayerFrame
          player={makePlayer({ hasLeft: true })}
          perspective="opponent"
          onPlayerClick={() => {}}
          targetable={false}
        />,
      );
      const svg = screen.getByTestId('elimination-slash-opponent');
      const lines = svg.querySelectorAll('line');
      expect(lines).toHaveLength(2);
      expect(lines[0]?.getAttribute('stroke')).toBe(
        'var(--color-eliminated-slash-outline)',
      );
      expect(lines[1]?.getAttribute('stroke')).toBe(
        'var(--color-eliminated-slash)',
      );
    });
  });

  describe('colorIdentity halo', () => {
    // Slice 70-D critic UI-C1 / Graphical-G6 fix — both single and
    // multi-color paths render through one mechanism: a
    // background-tinted div masked to a 2px ring via mask-composite.
    // Tests assert the BACKGROUND value (the colored surface)
    // regardless of color-count, since the mask handles the ring
    // shape uniformly.

    it('empty colorIdentity → neutral team-ring background (NOT grey)', () => {
      render(
        <PlayerFrame
          player={makePlayer({ colorIdentity: [] })}
          perspective="self"
          onPlayerClick={() => {}}
          targetable={false}
        />,
      );
      const halo = screen.getByTestId('player-halo');
      expect(halo).toHaveAttribute('data-color-count', '0');
      expect(halo.style.background).toContain('var(--color-team-neutral)');
    });

    it('single color → solid ring background in that mana color', () => {
      render(
        <PlayerFrame
          player={makePlayer({ colorIdentity: ['R'] })}
          perspective="self"
          onPlayerClick={() => {}}
          targetable={false}
        />,
      );
      const halo = screen.getByTestId('player-halo');
      expect(halo).toHaveAttribute('data-color-count', '1');
      expect(halo.style.background).toContain('var(--color-mana-red)');
    });

    it('multicolor → conic-gradient background across all colors', () => {
      render(
        <PlayerFrame
          player={makePlayer({ colorIdentity: ['W', 'U', 'B', 'G'] })}
          perspective="self"
          onPlayerClick={() => {}}
          targetable={false}
        />,
      );
      const halo = screen.getByTestId('player-halo');
      expect(halo).toHaveAttribute('data-color-count', '4');
      expect(halo.style.background).toContain('conic-gradient');
      expect(halo.style.background).toContain('var(--color-mana-white)');
      expect(halo.style.background).toContain('var(--color-mana-blue)');
      expect(halo.style.background).toContain('var(--color-mana-black)');
      expect(halo.style.background).toContain('var(--color-mana-green)');
    });

    it('multicolor halo rotates per spec §7.3 (slice 70-G)', () => {
      // Spec calls for "5 distinct bands rotating at 12s/revolution"
      // for multicolor halos. The static conic-gradient was a stub
      // in 70-D; 70-G adds the rotation.
      render(
        <PlayerFrame
          player={makePlayer({ colorIdentity: ['W', 'U', 'B', 'G'] })}
          perspective="self"
          onPlayerClick={() => {}}
          targetable={false}
        />,
      );
      const halo = screen.getByTestId('player-halo');
      expect(halo).toHaveAttribute('data-rotating', 'true');
      expect(halo.className).toContain('animate-halo-rotate');
    });

    it('single-color halo does NOT rotate (uniform ring; rotation would burn paint)', () => {
      render(
        <PlayerFrame
          player={makePlayer({ colorIdentity: ['R'] })}
          perspective="self"
          onPlayerClick={() => {}}
          targetable={false}
        />,
      );
      const halo = screen.getByTestId('player-halo');
      expect(halo).not.toHaveAttribute('data-rotating');
      expect(halo.className).not.toContain('animate-halo-rotate');
    });

    it('eliminated multicolor halo stops rotating (static neutral ring)', () => {
      // When eliminated, the halo desaturates to a neutral ring;
      // rotating would distract from the slash overlay's signal.
      render(
        <PlayerFrame
          player={makePlayer({
            colorIdentity: ['W', 'U', 'B', 'G'],
            hasLeft: true,
          })}
          perspective="opponent"
          onPlayerClick={() => {}}
          targetable={false}
        />,
      );
      const halo = screen.getByTestId('player-halo');
      expect(halo).not.toHaveAttribute('data-rotating');
      expect(halo.className).not.toContain('animate-halo-rotate');
    });

    it('mask-composite ring mechanism — gradient is clipped to a 2px perimeter', () => {
      // Critic UI-C1 — without the mask, the conic gradient would
      // paint the entire pod surface and hide the content. The
      // mask-composite: exclude trick subtracts the inner content-box
      // from the outer border-box, leaving only the 2px-wide ring.
      // Pin the contract so a future regression that drops the mask
      // (and re-paints the entire pod) fails this test.
      render(
        <PlayerFrame
          player={makePlayer({ colorIdentity: ['W', 'U'] })}
          perspective="self"
          onPlayerClick={() => {}}
          targetable={false}
        />,
      );
      const halo = screen.getByTestId('player-halo');
      // The mask uses two stacked layers + composite=exclude. JSDOM
      // surfaces the React-camelCase property names verbatim.
      expect(halo.style.mask).toContain('content-box');
      expect(halo.style.maskComposite).toBe('exclude');
      // 2px padding is the ring width; the mask reveals only that
      // perimeter band.
      expect(halo.style.padding).toBe('2px');
    });

    it('eliminated → halo background desaturates to neutral team-ring', () => {
      render(
        <PlayerFrame
          player={makePlayer({
            colorIdentity: ['R'],
            hasLeft: true,
          })}
          perspective="opponent"
          onPlayerClick={() => {}}
          targetable={false}
        />,
      );
      const halo = screen.getByTestId('player-halo');
      expect(halo).toHaveAttribute('data-eliminated', 'true');
      expect(halo.style.background).toContain('var(--color-team-neutral)');
      // Mana color is suppressed when eliminated — no red leaks.
      expect(halo.style.background).not.toContain('mana-red');
    });
  });

  describe('targetable affordance', () => {
    it('renders an underlined click-target when targetable', () => {
      render(
        <PlayerFrame
          player={makePlayer({ name: 'alice' })}
          perspective="opponent"
          onPlayerClick={() => {}}
          targetable
        />,
      );
      expect(
        screen.getByTestId('target-player-opponent'),
      ).toBeInTheDocument();
    });

    it('suppresses the click-target when player is eliminated', () => {
      // You can't target a player who's out of the game.
      render(
        <PlayerFrame
          player={makePlayer({ name: 'bob', hasLeft: true })}
          perspective="opponent"
          onPlayerClick={() => {}}
          targetable
        />,
      );
      expect(screen.queryByTestId('target-player-opponent')).toBeNull();
    });
  });
});
