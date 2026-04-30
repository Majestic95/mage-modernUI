import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { Game } from '../pages/Game';
import { useAuthStore } from '../auth/store';
import { useGameStore } from '../game/store';
import {
  webCardViewSchema,
  webGameViewSchema,
  webPermanentViewSchema,
  webPlayerViewSchema,
} from '../api/schemas';

/**
 * Slice 52d — accessibility contract test.
 *
 * The Game root wraps everything in {@code <MotionConfig
 * reducedMotion="user">}, which honors {@code prefers-reduced-motion:
 * reduce}. With reduced-motion ON, Framer Motion skips the animation
 * tweens but the layoutId graph (cross-zone glides) still wires up —
 * users still see the right cards in the right places, just without
 * the glides. This test locks that contract: a battlefield permanent
 * with a stable {@code cardId} renders, and its {@code data-layout-id}
 * attribute is still emitted (so an upstream layoutId match would
 * still fire if there were a sibling tile to glide to).
 */

const ANON_SESSION = {
  schemaVersion: '1.15',
  token: 'tok-anon',
  username: 'alice',
  isAnonymous: true,
  isAdmin: false,
  expiresAt: '2026-04-27T00:00:00Z',
};

const FOREST_CARD_ID = '99999999-9999-9999-9999-999999999999';

const FOREST = webCardViewSchema.parse({
  id: '11111111-1111-1111-1111-111111111111',
  cardId: FOREST_CARD_ID,
  name: 'Forest',
  displayName: 'Forest',
  expansionSetCode: 'M21',
  cardNumber: '281',
  manaCost: '',
  manaValue: 0,
  typeLine: 'Basic Land — Forest',
  supertypes: ['BASIC'],
  types: ['LAND'],
  subtypes: ['Forest'],
  colors: [],
  rarity: 'COMMON',
  power: '',
  toughness: '',
  startingLoyalty: '',
  rules: [],
  faceDown: false,
  counters: {},
  transformable: false,
  transformed: false,
  secondCardFace: null,
});

const TAPPED_FOREST_PERMANENT = webPermanentViewSchema.parse({
  card: { ...FOREST, id: '22222222-2222-2222-2222-222222222222' },
  controllerName: 'alice',
  tapped: true,
  flipped: false,
  transformed: false,
  phasedIn: true,
  summoningSickness: false,
  damage: 0,
  attachments: [],
  attachedTo: '',
  attachedToPermanent: false,
});

function buildGameView() {
  const me = webPlayerViewSchema.parse({
    playerId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    name: 'alice',
    life: 18,
    wins: 0, winsNeeded: 1, libraryCount: 53, handCount: 1,
    graveyard: {}, exile: {}, sideboard: {},
    battlefield: { [TAPPED_FOREST_PERMANENT.card.id]: TAPPED_FOREST_PERMANENT },
    manaPool: { red: 0, green: 1, blue: 0, white: 0, black: 0, colorless: 0 },
    controlled: true, isHuman: true, isActive: true, hasPriority: true,
    hasLeft: false, monarch: false, initiative: false, designationNames: [],
  });
  const ai = webPlayerViewSchema.parse({
    playerId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    name: 'COMPUTER_MONTE_CARLO',
    life: 20,
    wins: 0, winsNeeded: 1, libraryCount: 60, handCount: 7,
    graveyard: {}, exile: {}, sideboard: {}, battlefield: {},
    manaPool: { red: 0, green: 0, blue: 0, white: 0, black: 0, colorless: 0 },
    controlled: false, isHuman: false, isActive: false, hasPriority: false,
    hasLeft: false, monarch: false, initiative: false, designationNames: [],
  });
  return webGameViewSchema.parse({
    turn: 2,
    phase: 'PRECOMBAT_MAIN',
    step: 'PRECOMBAT_MAIN',
    activePlayerName: 'alice',
    priorityPlayerName: 'alice',
    special: false,
    rollbackTurnsAllowed: false,
    totalErrorsCount: 0,
    totalEffectsCount: 0,
    gameCycle: 0,
    myPlayerId: me.playerId,
    myHand: { [FOREST.id]: FOREST },
    stack: {},
    combat: [],
    players: [me, ai],
  });
}

const FAKE_GAME_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

describe('prefers-reduced-motion contract', () => {
  beforeEach(() => {
    // Mock matchMedia so the (prefers-reduced-motion: reduce) query
    // returns matches=true. Framer Motion's MotionConfig
    // reducedMotion="user" reads this and short-circuits animations
    // (snaps to final values) without removing the layoutId graph.
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('reduce'),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      onchange: null,
      dispatchEvent: vi.fn(),
    }));

    useAuthStore.setState({
      session: ANON_SESSION,
      loading: false,
      error: null,
      verifying: false,
    });
    useGameStore.getState().reset();

    vi.stubGlobal('WebSocket', class {
      static OPEN = 1;
      url: string;
      readyState = 0;
      constructor(url: string) {
        this.url = url;
      }
      addEventListener() {}
      close() {}
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders battlefield permanents and preserves data-layout-id when reduced-motion is on', () => {
    render(<Game gameId={FAKE_GAME_ID} onLeave={() => {}} />);

    // Trigger a state change that would normally animate (a new
    // permanent appearing on the battlefield). The MotionConfig
    // reducedMotion="user" should skip the spring tween but still
    // mount the motion.div with layoutId wired up.
    act(() => {
      useGameStore.setState({
        connection: 'open',
        gameView: buildGameView(),
      });
    });

    // The new permanent must appear in the DOM — animation MUST NOT
    // block render.
    const perms = screen.getAllByTestId('permanent');
    expect(perms).toHaveLength(1);

    // The layoutId graph must still be wired up. The motion.div
    // wrapping the BattlefieldTile sets data-layout-id={cardId}; if
    // a sibling stack tile with the same cardId existed, Framer
    // would still match them — reduced-motion only skips the
    // animation, not the layout-graph topology.
    const layoutIdNodes = document.querySelectorAll(
      `[data-layout-id="${FOREST_CARD_ID}"]`,
    );
    expect(layoutIdNodes.length).toBeGreaterThanOrEqual(1);
  });

  it('the global CSS reduced-motion override exists in the bundle', async () => {
    // Locks the OTHER half of the a11y story — the CSS-side contract.
    // Framer Motion handles JS-driven animations via reducedMotion="user"
    // (asserted in the prior test by topology + render). CSS transitions
    // (hand fan hover-lift, tap rotation, stack zone collapse, life-color
    // flash) are gated by a global @media (prefers-reduced-motion: reduce)
    // rule in src/index.css that zero-duration's all transition-duration
    // and animation-duration. Without this rule the audit's a11y ask is
    // half-met: Framer is silenced but CSS still glides.
    //
    // We import the raw CSS as a string and assert the rule is present.
    // A future regression that deletes the rule fails this test loud.
    const css = (await import('../index.css?raw')).default;
    expect(css).toMatch(/@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)/);
    expect(css).toMatch(/transition-duration:\s*0\.01ms\s*!important/);
    expect(css).toMatch(/animation-duration:\s*0\.01ms\s*!important/);
  });

  // Slice 70-B (ADR 0011 D4) — scope-fix contract.
  it('the reduced-motion rule scopes via :not([data-essential-motion]) so card movement opts out', async () => {
    // Slice 52d's rule was a "kill ALL animations" hammer. Slice 70-B
    // refactors it to leave card-zone movement intact (per
    // design-system §6.3 — card movement conveys game state and must
    // not be silenced) while still killing ambient/hover/pulse
    // animations. The mechanism is a `data-essential-motion` opt-out
    // attribute. This test pins the selector shape so a future
    // regression that drops the :not() can't silently revert the fix.
    const css = (await import('../index.css?raw')).default;
    expect(css).toMatch(/:not\(\[data-essential-motion\]\)/);
    // The :not() pair on real elements excludes both the marked
    // element AND any descendants.
    expect(css).toMatch(/:not\(\[data-essential-motion\]\):not\(\[data-essential-motion\] \*\)/);
    // Critic technical-C1 — pseudo-elements need the same
    // descendant-of-essential exclusion or a ::before / ::after
    // under a marked subtree gets killed even though its host opted
    // out. Pin the carve-out so a future regression can't silently
    // strip it.
    expect(css).toMatch(/\*::before:not\(\[data-essential-motion\] \*\)/);
    expect(css).toMatch(/\*::after:not\(\[data-essential-motion\] \*\)/);
  });

  it('ships the design-system §6.4 keyframes (stack-glow-pulse, player-active-halo, card-targeted-pulse)', async () => {
    // The three pulse keyframes are slice 70-B foundation work; later
    // slices (70-D PlayerFrame, 70-F top-of-stack) will apply them
    // via the *_CLASS constants in transitions.ts. Pin their presence
    // so the registry constants don't reference dead CSS names.
    const css = (await import('../index.css?raw')).default;
    expect(css).toMatch(/@keyframes\s+stack-glow-pulse/);
    expect(css).toMatch(/@keyframes\s+player-active-halo/);
    expect(css).toMatch(/@keyframes\s+card-targeted-pulse/);
    expect(css).toMatch(/\.animate-stack-glow-pulse/);
    expect(css).toMatch(/\.animate-player-active-halo/);
    expect(css).toMatch(/\.animate-card-targeted-pulse/);
  });
});
