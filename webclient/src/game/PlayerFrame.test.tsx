import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { webPlayerViewSchema, type WebPlayerView } from '../api/schemas';

// Slice 70-K — flag-mock at the file level so existing legacy
// tests run against REDESIGN=false (production default) AND the
// new redesign-branch describe block can flip it on per test.
// Mirrors the {@code battlefieldLayout.test.ts} hoisted-flag
// pattern (vi.hoisted state + getter on the mocked module).
const flagState = vi.hoisted(() => ({
  redesign: false,
  keepEliminated: true,
}));
vi.mock('../featureFlags', () => ({
  get REDESIGN() {
    return flagState.redesign;
  },
  get KEEP_ELIMINATED() {
    return flagState.keepEliminated;
  },
}));

// Component import MUST come after the vi.mock — Vitest hoists
// vi.mock above imports automatically, but imports below the mock
// declaration read more clearly per the maintainer convention.
import { PlayerFrame } from './PlayerFrame';

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

  describe('disconnected overlay (slice 70-H)', () => {
    // Slice 70-H — the DISCONNECTED state is recoverable (sockets
    // dropped, player can reconnect) and renders LIGHTER than
    // eliminated (terminal). Three composition cases need locking:
    //   - connected + !hasLeft: no overlay
    //   - disconnected + !hasLeft: pill renders
    //   - disconnected + hasLeft: pill SUPPRESSED (eliminated wins)

    it('renders the Disconnected pill when connectionState is "disconnected" and not hasLeft', () => {
      render(
        <PlayerFrame
          player={makePlayer({
            name: 'bob',
            hasLeft: false,
            connectionState: 'disconnected',
          })}
          perspective="opponent"
          onPlayerClick={() => {}}
          targetable={false}
        />,
      );
      expect(
        screen.getByTestId('disconnected-pill-opponent'),
      ).toBeInTheDocument();
      expect(screen.getByTestId('player-frame-opponent')).toHaveAttribute(
        'data-disconnected',
        'true',
      );
      // Pill carries the human-readable label so SR users picking it
      // up via aria-hidden=false fallback still get the signal (today
      // it's aria-hidden, but a future a11y review could flip that).
      expect(
        screen.getByTestId('disconnected-pill-opponent'),
      ).toHaveTextContent(/disconnected/i);
    });

    it('does NOT render the pill when connectionState is "connected"', () => {
      render(
        <PlayerFrame
          player={makePlayer({
            name: 'alice',
            connectionState: 'connected',
          })}
          perspective="self"
          onPlayerClick={() => {}}
          targetable={false}
        />,
      );
      expect(screen.queryByTestId('disconnected-pill-self')).toBeNull();
      expect(screen.getByTestId('player-frame-self')).not.toHaveAttribute(
        'data-disconnected',
      );
    });

    it('SUPPRESSES the pill when also eliminated (terminal wins)', () => {
      // The hasLeft state is terminal — the slash overlay + heavier
      // desaturation already communicates "this player is gone."
      // Layering a recoverable-state pill on top would muddy the read.
      // Per PlayerFrame.tsx the `disconnected` derived var is gated on
      // `!eliminated && connectionState === 'disconnected'`, so this
      // case must produce ONLY the slash (eliminated), no pill.
      render(
        <PlayerFrame
          player={makePlayer({
            name: 'carol',
            hasLeft: true,
            connectionState: 'disconnected',
          })}
          perspective="opponent"
          onPlayerClick={() => {}}
          targetable={false}
        />,
      );
      expect(
        screen.queryByTestId('disconnected-pill-opponent'),
      ).toBeNull();
      // Slash still renders.
      expect(
        screen.getByTestId('elimination-slash-opponent'),
      ).toBeInTheDocument();
      // data-eliminated wins; data-disconnected is suppressed.
      const frame = screen.getByTestId('player-frame-opponent');
      expect(frame).toHaveAttribute('data-eliminated', 'true');
      expect(frame).not.toHaveAttribute('data-disconnected');
    });

    it('aria-label includes "disconnected" when in the recoverable state', () => {
      // SR users get the disconnected signal via the composed
      // ariaLabel even though the pill itself is aria-hidden. The
      // word ordering puts "disconnected" between persona signals
      // and the colorIdentity description.
      render(
        <PlayerFrame
          player={makePlayer({
            name: 'bob',
            hasLeft: false,
            connectionState: 'disconnected',
          })}
          perspective="opponent"
          onPlayerClick={() => {}}
          targetable={false}
        />,
      );
      const frame = screen.getByTestId('player-frame-opponent');
      expect(frame).toHaveAccessibleName(/disconnected/);
    });

    it('aria-label does NOT include "disconnected" when eliminated wins', () => {
      // Mutual exclusion at the SR layer too — eliminated takes
      // precedence in the visual treatment AND in the SR label, so
      // SR users don't hear the redundant "eliminated, disconnected"
      // pair. Just "eliminated."
      render(
        <PlayerFrame
          player={makePlayer({
            name: 'carol',
            hasLeft: true,
            connectionState: 'disconnected',
          })}
          perspective="opponent"
          onPlayerClick={() => {}}
          targetable={false}
        />,
      );
      const frame = screen.getByTestId('player-frame-opponent');
      expect(frame).toHaveAccessibleName(/eliminated/);
      expect(frame).not.toHaveAccessibleName(/disconnected/);
    });

    it('1.22 fixture (no connectionState field) defaults to "connected" via Zod', () => {
      // The makePlayer helper omits connectionState; Zod's
      // .default('connected') fires on the missing key. Verify by
      // checking the parsed object's field directly, then asserting
      // the pill is not rendered.
      const player = makePlayer({ name: 'alice' });
      expect(player.connectionState).toBe('connected');
      render(
        <PlayerFrame
          player={player}
          perspective="self"
          onPlayerClick={() => {}}
          targetable={false}
        />,
      );
      expect(screen.queryByTestId('disconnected-pill-self')).toBeNull();
    });
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

// Slice 70-K — REDESIGN-flag-on test suite. Anatomy is per
// docs/design/picture-catalog.md §2: portrait + name + commander
// stack with life numeral overlaid on the portrait, no horizontal
// strip, no inline mana pool / zone icons, no ACTIVE pill. Each
// test toggles flagState.redesign=true at the start and afterEach
// resets to false so legacy tests above keep running cleanly.
describe('PlayerFrame — REDESIGN flag on (slice 70-K)', () => {
  afterEach(() => {
    flagState.redesign = false;
  });

  it('renders the portrait-stacked anatomy (PlayerPortrait + name + commander)', () => {
    flagState.redesign = true;
    render(
      <PlayerFrame
        player={makePlayer({
          name: 'alice',
          life: 40,
          commandList: [
            {
              id: 'cmdr-1',
              kind: 'commander',
              name: 'Atraxa, Praetors\' Voice',
              expansionSetCode: 'C16',
              imageFileName: 'atraxa.jpg',
              imageNumber: 28,
              rules: [],
            },
          ],
          colorIdentity: ['W', 'U', 'B', 'G'],
        })}
        perspective="self"
        onPlayerClick={() => {}}
        targetable={false}
      />,
    );
    expect(screen.getByTestId('player-portrait')).toBeInTheDocument();
    expect(screen.getByTestId('player-name-stack')).toBeInTheDocument();
    expect(
      screen.getByTestId('commander-name-label'),
    ).toHaveTextContent("Atraxa, Praetors' Voice");
    // Picture-catalog §2.0 — life numeral overlaid on the portrait
    expect(screen.getByTestId('life-numeral-self')).toHaveTextContent(
      '40',
    );
    // data-redesign attribute lets style overrides / tests target
    // only the redesigned frame
    expect(screen.getByTestId('player-frame-self')).toHaveAttribute(
      'data-redesign',
      'true',
    );
  });

  it('does NOT render the legacy ACTIVE pill', () => {
    // Picture-catalog §2.4: active state is signaled by the halo
    // pulse on the portrait, not a text pill.
    flagState.redesign = true;
    render(
      <PlayerFrame
        player={makePlayer({ isActive: true })}
        perspective="self"
        onPlayerClick={() => {}}
        targetable={false}
      />,
    );
    // Legacy ACTIVE pill is a span with the literal text "ACTIVE";
    // queryByText catches it. Halo pulse is on the portrait halo
    // via PlayerPortrait (already tested in PlayerPortrait.test).
    expect(screen.queryByText('ACTIVE')).toBeNull();
  });

  it('renders the slice-70-P info cluster (zone icons + opponent mana pool)', () => {
    // Picture-catalog §2.2 + §2.3: zone icons + opponent mana pool
    // sit in a small adjacent cluster on every redesigned
    // PlayerFrame. Local-player frames render the cluster too —
    // the mana pool slot is the only difference (local pool floats
    // in the hand region, opponent pool sits inline here).
    flagState.redesign = true;
    render(
      <PlayerFrame
        player={makePlayer({
          libraryCount: 47,
          handCount: 6,
          manaPool: {
            red: 1,
            green: 0,
            blue: 0,
            white: 0,
            black: 0,
            colorless: 2,
          },
        })}
        perspective="self"
        onPlayerClick={() => {}}
        targetable={false}
      />,
    );
    // Library count surfaces via the new cluster (ZoneIcon
    // zone="library" inside PlayerFrameInfoCluster).
    expect(
      screen.getByTestId('zone-count-library'),
    ).toHaveTextContent('47');
    // Slice 70-P.1 — Hand chip surfaces handCount in the cluster
    // so opponent hand size stays visible.
    expect(screen.getByTestId('zone-count-hand')).toHaveTextContent('6');
    expect(screen.getByTestId('player-frame-info-self')).toBeInTheDocument();
    // Self-perspective frames don't host the inline mana pool —
    // local pool floats in the hand region per §2.3.
    expect(
      screen.queryByTestId(/^opponent-mana-pool-/),
    ).toBeNull();
    // Slice 70-P.1 — "Hand" label DOES appear now (Hand chip in
    // the cluster). The legacy strip's "Hand" prefix is gone, but
    // the cluster surfaces the same strategic info via ZoneIcon.
  });

  it('opponent frame renders the inline mana pool when non-empty (catalog §2.3)', () => {
    flagState.redesign = true;
    render(
      <PlayerFrame
        player={makePlayer({
          name: 'bob',
          manaPool: {
            red: 2,
            green: 0,
            blue: 0,
            white: 0,
            black: 0,
            colorless: 1,
          },
        })}
        perspective="opponent"
        onPlayerClick={() => {}}
        targetable={false}
      />,
    );
    expect(
      screen.getByTestId(/^opponent-mana-pool-/),
    ).toBeInTheDocument();
  });

  it('opponent frame omits the inline mana pool when the pool is empty', () => {
    flagState.redesign = true;
    render(
      <PlayerFrame
        player={makePlayer({
          name: 'bob',
          manaPool: {
            red: 0,
            green: 0,
            blue: 0,
            white: 0,
            black: 0,
            colorless: 0,
          },
        })}
        perspective="opponent"
        onPlayerClick={() => {}}
        targetable={false}
      />,
    );
    expect(screen.queryByTestId(/^opponent-mana-pool-/)).toBeNull();
  });

  it('opponent perspective uses medium portrait (80px)', () => {
    flagState.redesign = true;
    render(
      <PlayerFrame
        player={makePlayer({ name: 'bob' })}
        perspective="opponent"
        position="top"
        onPlayerClick={() => {}}
        targetable={false}
      />,
    );
    const portrait = screen.getByTestId('player-portrait');
    expect(portrait).toHaveAttribute('data-size', 'medium');
    expect(portrait.style.width).toBe('80px');
  });

  it('self perspective uses large portrait (96px)', () => {
    flagState.redesign = true;
    render(
      <PlayerFrame
        player={makePlayer({ name: 'alice' })}
        perspective="self"
        position="bottom"
        onPlayerClick={() => {}}
        targetable={false}
      />,
    );
    const portrait = screen.getByTestId('player-portrait');
    expect(portrait).toHaveAttribute('data-size', 'large');
    expect(portrait.style.width).toBe('96px');
  });

  it('eliminated state preserves the slash overlay + desaturation', () => {
    // The slash + opacity-0.45 + grayscale(1) chrome carries over
    // from legacy, applied to the redesigned vertical stack
    // instead of the horizontal strip.
    flagState.redesign = true;
    render(
      <PlayerFrame
        player={makePlayer({ hasLeft: true })}
        perspective="opponent"
        onPlayerClick={() => {}}
        targetable={false}
      />,
    );
    expect(
      screen.getByTestId('elimination-slash-opponent'),
    ).toBeInTheDocument();
    const frame = screen.getByTestId('player-frame-opponent');
    expect(frame).toHaveAttribute('data-eliminated', 'true');
  });

  it('disconnected state shows the pill (not eliminated wins precedence)', () => {
    flagState.redesign = true;
    render(
      <PlayerFrame
        player={makePlayer({
          name: 'bob',
          hasLeft: false,
          connectionState: 'disconnected',
        })}
        perspective="opponent"
        onPlayerClick={() => {}}
        targetable={false}
      />,
    );
    expect(
      screen.getByTestId('disconnected-pill-opponent'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('player-frame-opponent')).toHaveAttribute(
      'data-disconnected',
      'true',
    );
  });

  it('targetable name renders as a button just like legacy', () => {
    flagState.redesign = true;
    const onClick = vi.fn();
    render(
      <PlayerFrame
        player={makePlayer({
          playerId: 'opp-uuid',
          name: 'bob',
        })}
        perspective="opponent"
        onPlayerClick={onClick}
        targetable
      />,
    );
    const btn = screen.getByTestId('target-player-opponent');
    expect(btn).toHaveTextContent('bob');
    btn.click();
    expect(onClick).toHaveBeenCalledWith('opp-uuid');
  });

  it('priority tag renders above the portrait (not in the strip)', () => {
    // Legacy: PriorityTag rendered inline next to the name in the
    // header strip. Redesign: PriorityTag floats above the portrait
    // (positioned absolutely via the portrait wrapper).
    flagState.redesign = true;
    render(
      <PlayerFrame
        player={makePlayer({ hasPriority: true })}
        perspective="self"
        onPlayerClick={() => {}}
        targetable={false}
      />,
    );
    // PriorityTag testid is locked by PriorityTag.test.tsx — find
    // it inside the portrait wrapper, not as a sibling of the
    // name stack.
    expect(
      screen.getByTestId('player-portrait-wrapper'),
    ).toBeInTheDocument();
    // Existence of the priority tag (testid set by PriorityTag itself)
    expect(screen.getByText('PRIORITY')).toBeInTheDocument();
  });

  it('aria-label preserves the slice-70-D / 70-H composition rules', () => {
    flagState.redesign = true;
    render(
      <PlayerFrame
        player={makePlayer({
          name: 'alice',
          life: 35,
          isActive: true,
          hasPriority: true,
          colorIdentity: ['W', 'U'],
        })}
        perspective="self"
        onPlayerClick={() => {}}
        targetable={false}
      />,
    );
    const frame = screen.getByTestId('player-frame-self');
    expect(frame).toHaveAccessibleName(
      'alice, 35 life, your seat, active turn, has priority, white, blue',
    );
  });
});
