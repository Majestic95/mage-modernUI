import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LayoutGroup, MotionConfig } from 'framer-motion';
import { GameTable } from './GameTable';
import { webGameViewSchema, webPlayerViewSchema, type WebGameView } from '../api/schemas';

/**
 * Slice 70-E — pin the 6-region GameTable shell contract:
 * (a) every region renders, (b) the side-panel CSS variable is
 * exposed for the dialog dock, (c) SR announcers live at GameTable
 * root (not Battlefield), (d) GameLog + PhaseTimeline are inside the
 * side panel, (e) the central focal zone houses the Stack.
 */

function makeGameView(): WebGameView {
  const me = webPlayerViewSchema.parse({
    playerId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    name: 'alice',
    life: 20,
    wins: 0, winsNeeded: 1, libraryCount: 60, handCount: 7,
    graveyard: {}, exile: {}, sideboard: {}, battlefield: {},
    manaPool: { red: 0, green: 0, blue: 0, white: 0, black: 0, colorless: 0 },
    controlled: true, isHuman: true, isActive: true, hasPriority: true,
    hasLeft: false, monarch: false, initiative: false, designationNames: [],
  });
  const opp = webPlayerViewSchema.parse({
    playerId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    name: 'bob',
    life: 18,
    wins: 0, winsNeeded: 1, libraryCount: 60, handCount: 7,
    graveyard: {}, exile: {}, sideboard: {}, battlefield: {},
    manaPool: { red: 0, green: 0, blue: 0, white: 0, black: 0, colorless: 0 },
    controlled: false, isHuman: false, isActive: false, hasPriority: false,
    hasLeft: false, monarch: false, initiative: false, designationNames: [],
  });
  return webGameViewSchema.parse({
    turn: 1,
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
    myHand: {},
    stack: {},
    combat: [],
    players: [me, opp],
  });
}

function renderInLayoutGroup(node: React.ReactElement) {
  // GameTable assumes it lives inside <MotionConfig><LayoutGroup>
  // wrappers (per Game.tsx); preserve that contract in tests so the
  // child motion components don't warn.
  return render(
    <MotionConfig reducedMotion="user">
      <LayoutGroup>{node}</LayoutGroup>
    </MotionConfig>,
  );
}

describe('GameTable shell', () => {
  it('renders all four regions: header / battlefield / side panel / action', () => {
    renderInLayoutGroup(<GameTable gameId="test-game" gameView={makeGameView()} stream={null} />);
    expect(screen.getByTestId('game-table')).toBeInTheDocument();
    expect(screen.getByTestId('game-table-header')).toBeInTheDocument();
    expect(screen.getByTestId('game-table-battlefield')).toBeInTheDocument();
    expect(screen.getByTestId('game-table-sidepanel')).toBeInTheDocument();
    expect(screen.getByTestId('game-table-action')).toBeInTheDocument();
  });

  it('exposes --side-panel-width CSS variable for the dialog dock (technical critic I1)', () => {
    // Three non-blocking dialogs (gameSelect / gameTarget /
    // gamePlayMana) read this var via right-[calc(var(--side-panel-width)+1rem)]
    // so they dock LEFT of the panel rather than overlapping it.
    renderInLayoutGroup(<GameTable gameId="test-game" gameView={makeGameView()} stream={null} />);
    const root = screen.getByTestId('game-table');
    expect(root.style.getPropertyValue('--side-panel-width')).toContain('clamp');
  });

  it('SR announcers live at GameTable root (technical critic N4)', () => {
    // Slice 69d isolated the priority + elimination announcers into
    // separate atomic regions. Slice 70-E moves them from
    // Battlefield to GameTable so unrelated battlefield mutations
    // (cards entering / leaving) don't trigger spurious re-announces.
    renderInLayoutGroup(<GameTable gameId="test-game" gameView={makeGameView()} stream={null} />);
    const priority = screen.getByTestId('priority-announcer');
    const elimination = screen.getByTestId('elimination-announcer');
    // Both should be direct children of game-table (not inside the
    // battlefield grid region that mutates on every ETB).
    const root = screen.getByTestId('game-table');
    expect(priority.parentElement).toBe(root);
    expect(elimination.parentElement).toBe(root);
  });

  it('side panel hosts PhaseTimeline + GameLog + CommanderDamageTracker slot', () => {
    renderInLayoutGroup(<GameTable gameId="test-game" gameView={makeGameView()} stream={null} />);
    const panel = screen.getByTestId('game-table-sidepanel');
    // GameLog is inside the side panel (was in Game.tsx main flex).
    expect(panel).toContainElement(screen.getByTestId('game-log'));
    // PhaseTimeline placement — was between header and main; now in
    // the side panel above GameLog.
    expect(panel.textContent).toMatch(/Turn|Phase|Beg|Main|Combat|End/i);
    // Slice 70-F — CommanderDamageTracker renders only when an
    // opponent has a commander on the wire (commandList entries
    // with kind="commander"). The base fixture has no commanders,
    // so the tracker returns null and the slot is absent. The
    // tracker-render-when-commanders-present case is covered in
    // CommanderDamageTracker.test.tsx.
    expect(screen.queryByTestId('commander-damage-tracker')).toBeNull();
  });

  it('central focal zone houses the Stack (spec §3)', () => {
    // The Stack moves from below the opponents row to the geometric
    // center between the four pods.
    renderInLayoutGroup(<GameTable gameId="test-game" gameView={makeGameView()} stream={null} />);
    expect(screen.getByTestId('central-focal-zone')).toBeInTheDocument();
  });

  it('battlefield uses the 4-pod grid (top/left/right/bottom + center)', () => {
    renderInLayoutGroup(<GameTable gameId="test-game" gameView={makeGameView()} stream={null} />);
    expect(screen.getByTestId('four-pod-grid')).toBeInTheDocument();
    // Self pod always at bottom; opponent at top for the 1v1 case.
    expect(screen.getByTestId('player-area-self')).toBeInTheDocument();
    expect(screen.getByTestId('player-area-opponent')).toBeInTheDocument();
  });

  it('side pods carry data-bounded when LAYOUT_BOUNDS is on (Tier 1 containment)', () => {
    // Layout-bounds Tier 1 (2026-05-02) — busy boards on side pods
    // (Commander wide boards, 30+ permanents) used to escape the cell
    // bounds vertically because the wrapper used items-center +
    // visible overflow. Tier 1 swaps to items-stretch + overflow-
    // hidden + min-h-0 so content clips at the cell edge instead of
    // flying off-screen. This test pins the wrapper attribute so a
    // future refactor that strips the data-* doesn't silently lose
    // the containment regression check.
    //
    // Need 3 players (so opponents.length=2 → idx 0='right' is a
    // SIDE pod, not just 'top').
    const gv = makeGameView();
    const opp2 = webPlayerViewSchema.parse({
      playerId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      name: 'carol',
      life: 20,
      wins: 0, winsNeeded: 1, libraryCount: 60, handCount: 7,
      graveyard: {}, exile: {}, sideboard: {}, battlefield: {},
      manaPool: { red: 0, green: 0, blue: 0, white: 0, black: 0, colorless: 0 },
      controlled: false, isHuman: false, isActive: false, hasPriority: false,
      hasLeft: false, monarch: false, initiative: false, designationNames: [],
    });
    const gv3 = webGameViewSchema.parse({ ...gv, players: [...gv.players, opp2] });
    const { container } = renderInLayoutGroup(
      <GameTable gameId="test-game" gameView={gv3} stream={null} />,
    );
    const sidePods = container.querySelectorAll('[data-side-pod="true"]');
    expect(sidePods.length).toBeGreaterThan(0);
    sidePods.forEach((pod) => {
      // Default flag value is ON in the test env (vite reads
      // import.meta.env which has no overrides during vitest); the
      // off-only allowlist semantics in featureFlags.ts mean
      // undefined → ON. Lock that the attribute is set.
      expect(pod.getAttribute('data-bounded')).toBe('true');
      // Tier 1 marker classes — overflow-hidden caps the cell, min-h-0
      // lets the cell's flex parent collapse properly, items-stretch
      // anchors the inner content to the cell's full height (vs the
      // pre-fix items-center which centered + symmetrically overflowed).
      expect(pod.className).toContain('overflow-hidden');
      expect(pod.className).toContain('min-h-0');
      expect(pod.className).toContain('items-stretch');
      // Pre-fix class must NOT be present.
      expect(pod.className).not.toContain('items-center');
    });
  });
});
