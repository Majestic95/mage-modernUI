import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  webCombatGroupViewSchema,
  webGameViewSchema,
  webPermanentViewSchema,
  webPlayerViewSchema,
  webCardViewSchema,
  type WebPermanentView,
  type WebCardView,
} from '../api/schemas';
import { useGameStore } from './store';
import { useArrowIsolation } from './arrowIsolationStore';
import { IncomingTag } from './IncomingTag';

const ME_ID = '11111111-1111-1111-1111-111111111111';
const OPP1_ID = '22222222-2222-2222-2222-222222222222';
const OPP2_ID = '33333333-3333-3333-3333-333333333333';

function makeCard(id: string): WebCardView {
  return webCardViewSchema.parse({
    id,
    cardId: id,
    name: 'Test Creature',
    displayName: 'Test Creature',
    expansionSetCode: 'TST',
    cardNumber: '001',
    manaCost: '{1}{G}',
    manaValue: 2,
    typeLine: 'Creature — Beast',
    supertypes: [],
    types: ['CREATURE'],
    subtypes: ['BEAST'],
    colors: ['G'],
    rarity: 'COMMON',
    power: '2',
    toughness: '2',
    startingLoyalty: '',
    rules: [],
    faceDown: false,
    counters: {},
    transformable: false,
    transformed: false,
    secondCardFace: null,
  });
}

function makePerm(card: WebCardView): WebPermanentView {
  return webPermanentViewSchema.parse({
    card,
    controllerName: 'alice',
    tapped: false,
    flipped: false,
    transformed: false,
    phasedIn: true,
    summoningSickness: false,
    damage: 0,
    attachments: [],
    attachedTo: '',
    attachedToPermanent: false,
  });
}

function basePlayer(playerId: string, name: string) {
  return webPlayerViewSchema.parse({
    playerId,
    name,
    life: 20,
    wins: 0,
    winsNeeded: 1,
    libraryCount: 53,
    handCount: 7,
    graveyard: {},
    exile: {},
    sideboard: {},
    battlefield: {},
    manaPool: {
      red: 0,
      green: 0,
      blue: 0,
      white: 0,
      black: 0,
      colorless: 0,
    },
    controlled: true,
    isHuman: true,
    isActive: false,
    hasPriority: false,
    hasLeft: false,
    monarch: false,
    initiative: false,
    designationNames: [],
  });
}

interface CombatFixture {
  defenderId: string;
  attackerIds: readonly string[];
  blockerIds?: readonly string[];
}

function setGameView(opts: {
  phase: string;
  combat: readonly CombatFixture[];
}) {
  const me = basePlayer(ME_ID, 'me');
  const opp1 = basePlayer(OPP1_ID, 'opp1');
  const opp2 = basePlayer(OPP2_ID, 'opp2');

  const combat = opts.combat.map((c) =>
    webCombatGroupViewSchema.parse({
      defenderId: c.defenderId,
      defenderName: 'opp',
      attackers: Object.fromEntries(
        c.attackerIds.map((id) => [id, makePerm(makeCard(id))]),
      ),
      blockers: Object.fromEntries(
        (c.blockerIds ?? []).map((id) => [id, makePerm(makeCard(id))]),
      ),
      blocked: (c.blockerIds ?? []).length > 0,
    }),
  );

  const gameView = webGameViewSchema.parse({
    turn: 1,
    phase: opts.phase,
    step: opts.phase,
    activePlayerName: 'me',
    priorityPlayerName: 'me',
    special: false,
    rollbackTurnsAllowed: false,
    totalErrorsCount: 0,
    totalEffectsCount: 0,
    gameCycle: 0,
    myPlayerId: ME_ID,
    myHand: {},
    stack: {},
    combat,
    players: [me, opp1, opp2],
  });

  useGameStore.setState({ gameView });
}

beforeEach(() => {
  useGameStore.getState().reset();
  useArrowIsolation.getState().clearPin();
});

afterEach(() => {
  useGameStore.getState().reset();
  useArrowIsolation.getState().clearPin();
});

describe('IncomingTag — render gates', () => {
  it('renders nothing when phase is not COMBAT', () => {
    setGameView({
      phase: 'PRECOMBAT_MAIN',
      combat: [{ defenderId: OPP1_ID, attackerIds: ['a-1'] }],
    });
    const { container } = render(<IncomingTag playerId={OPP1_ID} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing for the local player\'s own portrait', () => {
    setGameView({
      phase: 'COMBAT',
      combat: [{ defenderId: ME_ID, attackerIds: ['a-1', 'a-2'] }],
    });
    const { container } = render(<IncomingTag playerId={ME_ID} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when this defender has zero incoming attackers', () => {
    setGameView({
      phase: 'COMBAT',
      combat: [{ defenderId: OPP2_ID, attackerIds: ['a-1'] }],
    });
    const { container } = render(<IncomingTag playerId={OPP1_ID} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the tag for a defender with incoming attackers', () => {
    setGameView({
      phase: 'COMBAT',
      combat: [{ defenderId: OPP1_ID, attackerIds: ['a-1'] }],
    });
    render(<IncomingTag playerId={OPP1_ID} />);
    expect(screen.getByTestId(`incoming-tag-${OPP1_ID}`)).toBeTruthy();
  });
});

describe('IncomingTag — count text', () => {
  it('shows "incoming N — M unblocked" when there are unblocked attackers', () => {
    setGameView({
      phase: 'COMBAT',
      combat: [
        {
          defenderId: OPP1_ID,
          attackerIds: ['a-1', 'a-2', 'a-3'],
          blockerIds: ['b-1'],
        },
      ],
    });
    render(<IncomingTag playerId={OPP1_ID} />);
    const tag = screen.getByTestId(`incoming-tag-${OPP1_ID}`);
    // Group has blockers so unblocked = 0 for this group; the
    // "M unblocked" suffix should NOT appear when M = 0.
    expect(tag.textContent).toBe('incoming 3');
  });

  it('drops the unblocked suffix when zero attackers are unblocked', () => {
    setGameView({
      phase: 'COMBAT',
      combat: [
        {
          defenderId: OPP1_ID,
          attackerIds: ['a-1'],
          blockerIds: ['b-1'],
        },
      ],
    });
    render(<IncomingTag playerId={OPP1_ID} />);
    const tag = screen.getByTestId(`incoming-tag-${OPP1_ID}`);
    expect(tag.textContent).toBe('incoming 1');
  });

  it('shows full text when ALL incoming attackers are unblocked', () => {
    setGameView({
      phase: 'COMBAT',
      combat: [{ defenderId: OPP1_ID, attackerIds: ['a-1', 'a-2'] }],
    });
    render(<IncomingTag playerId={OPP1_ID} />);
    expect(
      screen.getByTestId(`incoming-tag-${OPP1_ID}`).textContent,
    ).toBe('incoming 2 — 2 unblocked');
  });

  it('aggregates across multiple combat groups for the same defender', () => {
    setGameView({
      phase: 'COMBAT',
      combat: [
        {
          defenderId: OPP1_ID,
          attackerIds: ['a-1', 'a-2'],
          blockerIds: ['b-1'],
        },
        { defenderId: OPP1_ID, attackerIds: ['a-3'] },
      ],
    });
    render(<IncomingTag playerId={OPP1_ID} />);
    expect(
      screen.getByTestId(`incoming-tag-${OPP1_ID}`).textContent,
    ).toBe('incoming 3 — 1 unblocked');
  });
});

describe('IncomingTag — accessibility', () => {
  it('renders as a <button> with aria-pressed reflecting pin state', () => {
    setGameView({
      phase: 'COMBAT',
      combat: [{ defenderId: OPP1_ID, attackerIds: ['a-1'] }],
    });
    render(<IncomingTag playerId={OPP1_ID} />);
    const tag = screen.getByTestId(`incoming-tag-${OPP1_ID}`);
    expect(tag.tagName).toBe('BUTTON');
    expect(tag.getAttribute('type')).toBe('button');
    expect(tag.getAttribute('aria-pressed')).toBe('false');
  });

  it('aria-label describes the affordance and varies by pin state', () => {
    setGameView({
      phase: 'COMBAT',
      combat: [{ defenderId: OPP1_ID, attackerIds: ['a-1', 'a-2'] }],
    });
    render(<IncomingTag playerId={OPP1_ID} />);
    const tag = screen.getByTestId(`incoming-tag-${OPP1_ID}`);
    expect(tag.getAttribute('aria-label')).toMatch(/2 attackers incoming/);
    expect(tag.getAttribute('aria-label')).toMatch(/Click to pin/);
  });

  it('pinned aria-label surfaces the Escape affordance (slice 1-X.3 UX-2 fix)', () => {
    setGameView({
      phase: 'COMBAT',
      combat: [{ defenderId: OPP1_ID, attackerIds: ['a-1'] }],
    });
    render(<IncomingTag playerId={OPP1_ID} />);
    const tag = screen.getByTestId(`incoming-tag-${OPP1_ID}`);
    fireEvent.click(tag);
    const tagAfter = screen.getByTestId(`incoming-tag-${OPP1_ID}`);
    const label = tagAfter.getAttribute('aria-label') ?? '';
    expect(label).toMatch(/Pinned\./);
    expect(label).toMatch(/Click to unpin, or press Escape/);
  });

  it('title attribute surfaces the pin + Escape contract for sighted users (slice 1-X.3 UX-2)', () => {
    setGameView({
      phase: 'COMBAT',
      combat: [{ defenderId: OPP1_ID, attackerIds: ['a-1'] }],
    });
    render(<IncomingTag playerId={OPP1_ID} />);
    const tag = screen.getByTestId(`incoming-tag-${OPP1_ID}`);
    // Unpinned state — title invites a click and pre-discloses Escape.
    expect(tag.getAttribute('title')).toMatch(/Click to focus/);
    expect(tag.getAttribute('title')).toMatch(/Press Escape to unpin/);
    fireEvent.click(tag);
    // Pinned state — title focuses the unpin/escape affordance.
    expect(
      screen.getByTestId(`incoming-tag-${OPP1_ID}`).getAttribute('title'),
    ).toMatch(/Click to unpin, or press Escape/);
  });
});

describe('IncomingTag — slice 1-X.3 critic-pass fixes', () => {
  it('click stopPropagation prevents bubble into parent target button (UX-1 mis-fire fix)', () => {
    // Reproduces the UX critic's blocker: when an opponent is BOTH
    // targetable AND an active defender, PlayerFrameRedesigned wraps
    // the portrait in a `<button onClick={target}>`. Clicking the
    // tag inside used to fire BOTH togglePin AND the parent's target
    // dispatch — a real game-state mis-fire surface. The fix is
    // `e.stopPropagation()` on the tag's onClick.
    const parentClick = vi.fn();
    setGameView({
      phase: 'COMBAT',
      combat: [{ defenderId: OPP1_ID, attackerIds: ['a-1'] }],
    });
    render(
      <button type="button" onClick={parentClick}>
        <IncomingTag playerId={OPP1_ID} />
      </button>,
    );
    fireEvent.click(screen.getByTestId(`incoming-tag-${OPP1_ID}`));
    // Pin set on the tag's own store...
    expect(useArrowIsolation.getState().pinnedDefenderId).toBe(OPP1_ID);
    // ...but the parent button did NOT receive the click.
    expect(parentClick).not.toHaveBeenCalled();
  });

  it('Enter/Space keydown does not bubble into parent target button (UX-1 mis-fire fix, keyboard)', () => {
    const parentKeyDown = vi.fn();
    setGameView({
      phase: 'COMBAT',
      combat: [{ defenderId: OPP1_ID, attackerIds: ['a-1'] }],
    });
    render(
      <button type="button" onKeyDown={parentKeyDown}>
        <IncomingTag playerId={OPP1_ID} />
      </button>,
    );
    const tag = screen.getByTestId(`incoming-tag-${OPP1_ID}`);
    fireEvent.keyDown(tag, { key: 'Enter' });
    fireEvent.keyDown(tag, { key: ' ' });
    expect(parentKeyDown).not.toHaveBeenCalled();
  });

  it('left/right pod renders two-line stack with no separator', () => {
    // Slice 1-X-tunings round 5: podPosition prop drives layout
    // ("left" or "right" → two-line stack with no em-dash). The
    // vertical pod has space for the stack; the single-line
    // hyphen form was unnecessary there.
    setGameView({
      phase: 'COMBAT',
      combat: [{ defenderId: OPP1_ID, attackerIds: ['a-1', 'a-2'] }],
    });
    render(<IncomingTag playerId={OPP1_ID} podPosition="left" />);
    const tag = screen.getByTestId(`incoming-tag-${OPP1_ID}`);
    expect(tag.getAttribute('data-pod-position')).toBe('left');
    // Two-line stack — no em-dash separator.
    expect(tag.textContent).toBe('incoming 2unblocked 2');
    expect(tag.textContent).not.toContain('—');
    // Each line lives in its own wrapper.
    expect(tag.querySelectorAll('div').length).toBe(2);
  });

  it('top pod overlaps portrait via translate-y-2 (avoids phase-ladder clip)', () => {
    // Slice 1-X-tunings round 5: top opponent pod is clipped from
    // above by the GameHeader phase ladder. Badge slides DOWN ~8px
    // to overlap the portrait's top edge.
    setGameView({
      phase: 'COMBAT',
      combat: [{ defenderId: OPP1_ID, attackerIds: ['a-1'] }],
    });
    render(<IncomingTag playerId={OPP1_ID} podPosition="top" />);
    const tag = screen.getByTestId(`incoming-tag-${OPP1_ID}`);
    expect(tag.getAttribute('data-pod-position')).toBe('top');
    // Top pod uses single-line form (with em-dash).
    expect(tag.textContent).toBe('incoming 1 — 1 unblocked');
    // Layout class signals the overlap via translate-y-2.
    expect(tag.className).toContain('translate-y-2');
    expect(tag.className).not.toContain('mb-1.5');
  });

  it('default (no podPosition prop) keeps the single-line above-portrait layout', () => {
    setGameView({
      phase: 'COMBAT',
      combat: [{ defenderId: OPP1_ID, attackerIds: ['a-1'] }],
    });
    render(<IncomingTag playerId={OPP1_ID} />);
    const tag = screen.getByTestId(`incoming-tag-${OPP1_ID}`);
    expect(tag.hasAttribute('data-pod-position')).toBe(false);
    expect(tag.className).toContain('mb-1.5');
    expect(tag.className).not.toContain('translate-y-2');
    expect(tag.className).toContain('whitespace-nowrap');
  });

  it('pinned-state fill is the violet accent, NOT amber (UI-3 semantic-collision fix)', () => {
    // Bundle-1 UI critic flagged that amber was being asked to mean
    // three different things (Bundle 3 Done button + active-priority
    // halo + this pin). Pin moved to the project's existing selection
    // accent (--color-accent-primary purple → bg-violet-500).
    setGameView({
      phase: 'COMBAT',
      combat: [{ defenderId: OPP1_ID, attackerIds: ['a-1'] }],
    });
    render(<IncomingTag playerId={OPP1_ID} />);
    fireEvent.click(screen.getByTestId(`incoming-tag-${OPP1_ID}`));
    const tag = screen.getByTestId(`incoming-tag-${OPP1_ID}`);
    expect(tag.className).toContain('bg-violet-500');
    expect(tag.className).not.toContain('bg-amber-500');
  });
});

describe('IncomingTag — click pins / unpins / swaps', () => {
  it('clicking sets the pinned defender id in the isolation store', () => {
    setGameView({
      phase: 'COMBAT',
      combat: [{ defenderId: OPP1_ID, attackerIds: ['a-1'] }],
    });
    render(<IncomingTag playerId={OPP1_ID} />);
    fireEvent.click(screen.getByTestId(`incoming-tag-${OPP1_ID}`));
    expect(useArrowIsolation.getState().pinnedDefenderId).toBe(OPP1_ID);
  });

  it('clicking the same tag again unpins (toggle)', () => {
    setGameView({
      phase: 'COMBAT',
      combat: [{ defenderId: OPP1_ID, attackerIds: ['a-1'] }],
    });
    render(<IncomingTag playerId={OPP1_ID} />);
    const tag = screen.getByTestId(`incoming-tag-${OPP1_ID}`);
    fireEvent.click(tag);
    fireEvent.click(tag);
    expect(useArrowIsolation.getState().pinnedDefenderId).toBeNull();
  });

  it('aria-pressed reflects pinned state after click', () => {
    setGameView({
      phase: 'COMBAT',
      combat: [{ defenderId: OPP1_ID, attackerIds: ['a-1'] }],
    });
    render(<IncomingTag playerId={OPP1_ID} />);
    const tag = screen.getByTestId(`incoming-tag-${OPP1_ID}`);
    expect(tag.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(tag);
    expect(
      screen.getByTestId(`incoming-tag-${OPP1_ID}`).getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('clicking a different defender swaps the pin (last click wins)', () => {
    setGameView({
      phase: 'COMBAT',
      combat: [
        { defenderId: OPP1_ID, attackerIds: ['a-1'] },
        { defenderId: OPP2_ID, attackerIds: ['a-2'] },
      ],
    });
    render(
      <>
        <IncomingTag playerId={OPP1_ID} />
        <IncomingTag playerId={OPP2_ID} />
      </>,
    );
    fireEvent.click(screen.getByTestId(`incoming-tag-${OPP1_ID}`));
    expect(useArrowIsolation.getState().pinnedDefenderId).toBe(OPP1_ID);
    fireEvent.click(screen.getByTestId(`incoming-tag-${OPP2_ID}`));
    expect(useArrowIsolation.getState().pinnedDefenderId).toBe(OPP2_ID);
  });
});

describe('IncomingTag — footprint', () => {
  it('tag is position:absolute so it does not enlarge the portrait box (T1)', () => {
    setGameView({
      phase: 'COMBAT',
      combat: [{ defenderId: OPP1_ID, attackerIds: ['a-1'] }],
    });
    render(<IncomingTag playerId={OPP1_ID} />);
    const tag = screen.getByTestId(`incoming-tag-${OPP1_ID}`);
    // Tailwind utility class: assert via className rather than
    // computed style (jsdom doesn't compute resolved CSS).
    expect(tag.className).toContain('absolute');
  });
});
