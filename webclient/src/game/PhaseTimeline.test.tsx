import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  webGameViewSchema,
  webPlayerViewSchema,
  type WebGameView,
} from '../api/schemas';
import { LayoutVariantProvider, type LayoutVariant } from '../layoutVariants';
import { PhaseTimeline } from './PhaseTimeline';

/**
 * Bundle 3-A coverage — the runway + priority-status ribbon. Locks in:
 *
 * <ul>
 *   <li>P3 header-budget invariant: outside combat, tabletop's compact
 *       mode renders zero sub-step labels.</li>
 *   <li>Combat-phase exemption: when {@code step} is in the combat
 *       enum range, the combat segment's sub-step labels render even
 *       in compact mode (other phases stay suppressed).</li>
 *   <li>Past / active / future sub-step semantics via
 *       {@code data-step-position} (avoids fragile class-name asserts).</li>
 *   <li>Priority-status suffix on the combat phase label, with three
 *       branches: local has priority → PRIORITY (amber); local is
 *       skip-passing through combat → PASSING; remote has priority →
 *       WAITING + their name.</li>
 *   <li>Non-compact (current) variant: priority suffix is absent
 *       regardless of state — the legacy left block already carries
 *       turn / active player.</li>
 * </ul>
 */

const ME_ID = '22222222-2222-2222-2222-222222222222';
const OPP_ID = '33333333-3333-3333-3333-333333333333';

function buildPlayer(
  overrides: Partial<Parameters<typeof webPlayerViewSchema.parse>[0]> = {},
) {
  return webPlayerViewSchema.parse({
    playerId: ME_ID,
    name: 'alice',
    life: 20,
    wins: 0,
    winsNeeded: 1,
    libraryCount: 53,
    handCount: 7,
    graveyard: {},
    exile: {},
    sideboard: {},
    battlefield: {},
    manaPool: { red: 0, green: 0, blue: 0, white: 0, black: 0, colorless: 0 },
    controlled: true,
    isHuman: true,
    isActive: true,
    hasPriority: true,
    hasLeft: false,
    monarch: false,
    initiative: false,
    designationNames: [],
    ...overrides,
  });
}

function buildGameView(
  overrides: Partial<{
    step: string;
    phase: string;
    priorityPlayerName: string;
    activePlayerName: string;
    players: ReturnType<typeof buildPlayer>[];
  }> = {},
): WebGameView {
  const players = overrides.players ?? [buildPlayer()];
  return webGameViewSchema.parse({
    turn: 4,
    phase: overrides.phase ?? 'PRECOMBAT_MAIN',
    step: overrides.step ?? 'PRECOMBAT_MAIN',
    activePlayerName: overrides.activePlayerName ?? 'alice',
    priorityPlayerName: overrides.priorityPlayerName ?? 'alice',
    special: false,
    rollbackTurnsAllowed: false,
    totalErrorsCount: 0,
    totalEffectsCount: 0,
    gameCycle: 0,
    myPlayerId: ME_ID,
    myHand: {},
    stack: {},
    combat: [],
    players,
  });
}

function renderTimeline(gameView: WebGameView, variant: LayoutVariant) {
  return render(
    <LayoutVariantProvider variant={variant}>
      <PhaseTimeline gameView={gameView} />
    </LayoutVariantProvider>,
  );
}

describe('PhaseTimeline — P3 header-budget invariant (compact mode)', () => {
  // 2026-05-11 — user-requested change: combat sub-step labels are
  // now PERMANENTLY visible above the combat dots in compact mode
  // (slot 0 = "Combat" phase header in place of "Begin"; slots 1-5
  // = sub-step short names). Other phases still suppress their
  // sub-step labels in compact mode (the P3 invariant for the
  // non-combat segments is preserved). The expectations below
  // were updated to match.
  it('combat-only — 6 sub-step labels are permanent in compact, non-combat phases stay suppressed', () => {
    renderTimeline(
      buildGameView({ step: 'PRECOMBAT_MAIN', phase: 'PRECOMBAT_MAIN' }),
      'tabletop',
    );
    // Combat segment always has its label container in compact.
    const containers = screen.queryAllByTestId('phase-step-labels');
    expect(containers).toHaveLength(1);
    expect(containers[0]?.getAttribute('data-combat-runway')).toBe(
      'permanent',
    );
    // 6 labels — slot 0 + 5 sub-steps.
    const labels = screen.queryAllByTestId('phase-step-label');
    expect(labels).toHaveLength(6);
    // None of them are 'active' because we're not in combat.
    expect(
      labels.filter(
        (l) => l.getAttribute('data-step-position') === 'active',
      ),
    ).toEqual([]);
    // Slot 0 carries data-combat-header so consumers can distinguish
    // the phase header from the sub-step stickers.
    const slotZero = labels.find(
      (l) => l.getAttribute('data-combat-header') === 'true',
    );
    expect(slotZero?.getAttribute('data-step')).toBe('BEGIN_COMBAT');
    expect(slotZero?.textContent).toBe('Combat');
  });

  it('beginning, main, and end phases still omit their sub-step labels in compact', () => {
    for (const step of ['UNTAP', 'UPKEEP', 'DRAW', 'END_TURN', 'CLEANUP']) {
      const { unmount } = renderTimeline(
        buildGameView({ step, phase: step.startsWith('END') ? 'END' : 'BEGIN' }),
        'tabletop',
      );
      // Only the combat segment's permanent runway container exists;
      // no other phase materializes a phase-step-labels row.
      const containers = screen.queryAllByTestId('phase-step-labels');
      expect(containers).toHaveLength(1);
      expect(containers[0]?.getAttribute('data-combat-runway')).toBe(
        'permanent',
      );
      unmount();
    }
  });

  it('omits the priority-status suffix when active phase is NOT combat', () => {
    renderTimeline(
      buildGameView({ step: 'PRECOMBAT_MAIN', phase: 'PRECOMBAT_MAIN' }),
      'tabletop',
    );
    expect(screen.queryByTestId('phase-priority-suffix')).toBeNull();
  });
});

describe('PhaseTimeline — combat-phase runway in compact mode', () => {
  it('renders all six combat sub-step labels when active step is in combat', () => {
    renderTimeline(
      buildGameView({ step: 'DECLARE_ATTACKERS', phase: 'COMBAT' }),
      'tabletop',
    );
    const labels = screen.getAllByTestId('phase-step-label');
    expect(labels).toHaveLength(6);
    expect(labels.map((l) => l.getAttribute('data-step'))).toEqual([
      'BEGIN_COMBAT',
      'DECLARE_ATTACKERS',
      'DECLARE_BLOCKERS',
      'FIRST_COMBAT_DAMAGE',
      'COMBAT_DAMAGE',
      'END_COMBAT',
    ]);
  });

  it('marks past sub-steps as past and renders a check-mark sigil (slot 0 is the phase header, never gets ✓)', () => {
    renderTimeline(
      buildGameView({ step: 'COMBAT_DAMAGE', phase: 'COMBAT' }),
      'tabletop',
    );
    const positions = Object.fromEntries(
      screen
        .getAllByTestId('phase-step-label')
        .map((l) => [
          l.getAttribute('data-step'),
          l.getAttribute('data-step-position'),
        ]),
    );
    // data-step-position still reflects sub-step lifecycle for
    // every slot (semantic anchor); slot 0's VISUAL treatment
    // suppresses the ✓ check-mark because the phase header isn't
    // a sub-step that gets "ticked off" — but the data attribute
    // stays past so consumers can still order slots by position.
    expect(positions).toEqual({
      BEGIN_COMBAT: 'past',
      DECLARE_ATTACKERS: 'past',
      DECLARE_BLOCKERS: 'past',
      FIRST_COMBAT_DAMAGE: 'past',
      COMBAT_DAMAGE: 'active',
      END_COMBAT: 'future',
    });
    // 3 check marks: slots 1, 2, 3 (DECLARE_ATTACKERS / _BLOCKERS /
    // FIRST_COMBAT_DAMAGE). Slot 0 (BEGIN_COMBAT) is the phase
    // header and never carries ✓.
    expect(screen.getAllByTestId('phase-step-past-mark')).toHaveLength(3);
  });

  it('only the active step is `active`; the rest are past or future', () => {
    renderTimeline(
      buildGameView({ step: 'BEGIN_COMBAT', phase: 'COMBAT' }),
      'tabletop',
    );
    const labels = screen.getAllByTestId('phase-step-label');
    const active = labels.filter(
      (l) => l.getAttribute('data-step-position') === 'active',
    );
    expect(active).toHaveLength(1);
    expect(active[0]?.getAttribute('data-step')).toBe('BEGIN_COMBAT');
    // BEGIN_COMBAT is the first step — nothing before it is past.
    expect(screen.queryByTestId('phase-step-past-mark')).toBeNull();
  });

  it('exposes data-combat-active on the combat segment + data-combat-runway-active on the runway when active', () => {
    renderTimeline(
      buildGameView({ step: 'DECLARE_BLOCKERS', phase: 'COMBAT' }),
      'tabletop',
    );
    const combatSegment = screen
      .getAllByTestId('phase-segment')
      .find((s) => s.getAttribute('data-phase') === 'Combat');
    expect(combatSegment?.getAttribute('data-combat-active')).toBe('true');
    // The runway container is always 'permanent' for the combat
    // segment in compact mode; the SEPARATE data-combat-runway-active
    // attribute flips true only while combat is the active phase.
    const labels = screen
      .getAllByTestId('phase-step-labels')
      .find(
        (l) => l.getAttribute('data-combat-runway-active') === 'true',
      );
    expect(labels).toBeDefined();
    expect(labels?.getAttribute('data-combat-runway')).toBe('permanent');
  });
});

describe('PhaseTimeline — priority-status suffix in compact+combat', () => {
  it('shows PRIORITY (amber) when local player holds priority', () => {
    renderTimeline(
      buildGameView({
        step: 'DECLARE_ATTACKERS',
        phase: 'COMBAT',
        priorityPlayerName: 'alice',
        players: [buildPlayer({ hasPriority: true })],
      }),
      'tabletop',
    );
    const suffix = screen.getByTestId('phase-priority-suffix');
    expect(suffix.getAttribute('data-priority-kind')).toBe('priority');
    expect(suffix.textContent).toContain('PRIORITY');
    // PRIORITY label gets amber styling — soft contract, but lock it in.
    expect(suffix.innerHTML).toContain('text-amber-300');
  });

  it('shows PASSING when local player has a skip macro armed', () => {
    renderTimeline(
      buildGameView({
        step: 'DECLARE_BLOCKERS',
        phase: 'COMBAT',
        priorityPlayerName: 'opponent',
        players: [
          buildPlayer({
            hasPriority: false,
            skipState: 'NEXT_MAIN',
          }),
        ],
      }),
      'tabletop',
    );
    const suffix = screen.getByTestId('phase-priority-suffix');
    expect(suffix.getAttribute('data-priority-kind')).toBe('passing');
    expect(suffix.textContent).toContain('PASSING');
    expect(screen.queryByTestId('phase-priority-waiting-on')).toBeNull();
  });

  it('shows WAITING + remote player name when remote holds priority', () => {
    renderTimeline(
      buildGameView({
        step: 'COMBAT_DAMAGE',
        phase: 'COMBAT',
        priorityPlayerName: 'lyrra',
        players: [
          buildPlayer({ hasPriority: false, skipState: '' }),
        ],
      }),
      'tabletop',
    );
    const suffix = screen.getByTestId('phase-priority-suffix');
    expect(suffix.getAttribute('data-priority-kind')).toBe('waiting');
    expect(suffix.textContent).toContain('WAITING');
    const waitingOn = screen.getByTestId('phase-priority-waiting-on');
    expect(waitingOn.textContent).toBe('lyrra');
    expect(waitingOn.getAttribute('title')).toBe('lyrra');
  });

  it('exposes a composite aria-label on the suffix for assistive tech (3-X.1 A.4)', () => {
    renderTimeline(
      buildGameView({
        step: 'DECLARE_ATTACKERS',
        phase: 'COMBAT',
        priorityPlayerName: 'alice',
        players: [buildPlayer({ hasPriority: true })],
      }),
      'tabletop',
    );
    expect(
      screen.getByTestId('phase-priority-suffix').getAttribute('aria-label'),
    ).toBe('Priority status: you have priority');
  });

  it('aria-label reads "auto-passing" when local player has skip armed (A.4)', () => {
    renderTimeline(
      buildGameView({
        step: 'DECLARE_BLOCKERS',
        phase: 'COMBAT',
        priorityPlayerName: 'opponent',
        players: [
          buildPlayer({ hasPriority: false, skipState: 'NEXT_MAIN' }),
        ],
      }),
      'tabletop',
    );
    expect(
      screen.getByTestId('phase-priority-suffix').getAttribute('aria-label'),
    ).toBe('Priority status: auto-passing');
  });

  it('aria-label reads "waiting on {name}" when remote player has priority (A.4)', () => {
    renderTimeline(
      buildGameView({
        step: 'COMBAT_DAMAGE',
        phase: 'COMBAT',
        priorityPlayerName: 'lyrra',
        players: [buildPlayer({ hasPriority: false, skipState: '' })],
      }),
      'tabletop',
    );
    expect(
      screen.getByTestId('phase-priority-suffix').getAttribute('aria-label'),
    ).toBe('Priority status: waiting on lyrra');
  });

  it('PRIORITY wins over PASSING when both hasPriority and skipState are set (B.3 — precedence lock)', () => {
    // Defensive: it shouldn't be possible for a player to hold
    // priority AND have a skip macro armed simultaneously, but the
    // wire could conceivably emit both. PRIORITY is the actionable
    // signal — a user with priority should NOT be told they're
    // auto-passing. This test locks that precedence so a future
    // refactor of deriveCombatPriorityStatus can't silently flip it.
    renderTimeline(
      buildGameView({
        step: 'DECLARE_ATTACKERS',
        phase: 'COMBAT',
        priorityPlayerName: 'alice',
        players: [
          buildPlayer({ hasPriority: true, skipState: 'NEXT_MAIN' }),
        ],
      }),
      'tabletop',
    );
    expect(
      screen
        .getByTestId('phase-priority-suffix')
        .getAttribute('data-priority-kind'),
    ).toBe('priority');
  });

  it('renders an em-dash placeholder when WAITING but priorityPlayerName is empty (B.1)', () => {
    // Defensive: transient frames or mapper bugs could emit empty
    // priorityPlayerName while the local player isn't priority. The
    // ribbon used to render bare "WAITING" with no name; B.1 now
    // surfaces an em-dash so the missing data is visually distinct
    // from an actual unnamed opponent.
    const orphan = webGameViewSchema.parse({
      turn: 4,
      phase: 'COMBAT',
      step: 'BEGIN_COMBAT',
      activePlayerName: 'alice',
      priorityPlayerName: '',
      special: false,
      rollbackTurnsAllowed: false,
      totalErrorsCount: 0,
      totalEffectsCount: 0,
      gameCycle: 0,
      myPlayerId: ME_ID,
      myHand: {},
      stack: {},
      combat: [],
      players: [
        buildPlayer({ hasPriority: false, skipState: '' }),
      ],
    });
    renderTimeline(orphan, 'tabletop');
    const waitingOn = screen.getByTestId('phase-priority-waiting-on');
    expect(waitingOn.textContent).toBe('—');
    expect(waitingOn.getAttribute('data-waiting-unknown')).toBe('true');
    expect(waitingOn.getAttribute('title')).toBe('Unknown opponent');
  });

  it('falls back to WAITING when local player can\'t be matched (spectator-style)', () => {
    // myPlayerId set to a uuid that doesn't match any player in the
    // list — defensive branch in deriveCombatPriorityStatus.
    const orphan = webGameViewSchema.parse({
      turn: 4,
      phase: 'COMBAT',
      step: 'BEGIN_COMBAT',
      activePlayerName: 'lyrra',
      priorityPlayerName: 'lyrra',
      special: false,
      rollbackTurnsAllowed: false,
      totalErrorsCount: 0,
      totalEffectsCount: 0,
      gameCycle: 0,
      myPlayerId: '99999999-9999-9999-9999-999999999999',
      myHand: {},
      stack: {},
      combat: [],
      players: [buildPlayer({ playerId: OPP_ID, name: 'lyrra' })],
    });
    renderTimeline(orphan, 'tabletop');
    const suffix = screen.getByTestId('phase-priority-suffix');
    expect(suffix.getAttribute('data-priority-kind')).toBe('waiting');
    expect(screen.getByTestId('phase-priority-waiting-on').textContent).toBe(
      'lyrra',
    );
  });
});

describe('PhaseTimeline — non-compact (current variant) preserves legacy behavior', () => {
  it('renders sub-step labels for every phase regardless of active step', () => {
    renderTimeline(
      buildGameView({ step: 'PRECOMBAT_MAIN', phase: 'PRECOMBAT_MAIN' }),
      'current',
    );
    // 5 phases × showStepLabels: true → 5 labels rows.
    expect(screen.getAllByTestId('phase-step-labels')).toHaveLength(5);
    // 13 ticks total (3 + 1 + 6 + 1 + 2).
    expect(screen.getAllByTestId('phase-step-label')).toHaveLength(13);
  });

  it('does NOT render the priority-status suffix in the current variant', () => {
    renderTimeline(
      buildGameView({
        step: 'DECLARE_ATTACKERS',
        phase: 'COMBAT',
        priorityPlayerName: 'alice',
        players: [buildPlayer({ hasPriority: true })],
      }),
      'current',
    );
    expect(screen.queryByTestId('phase-priority-suffix')).toBeNull();
  });

  it('renders the legacy left block (Turn N + active player name)', () => {
    renderTimeline(buildGameView({ step: 'PRECOMBAT_MAIN' }), 'current');
    expect(screen.getByTestId('active-player-name').textContent).toBe('alice');
    expect(screen.getByText('Turn 4')).toBeInTheDocument();
  });

  it('omits the legacy left block in compact mode', () => {
    renderTimeline(buildGameView({ step: 'PRECOMBAT_MAIN' }), 'tabletop');
    expect(screen.queryByTestId('active-player-name')).toBeNull();
  });

  it('runway expands when gameView.phase=COMBAT even if step is an unknown enum value (B.4 — enum drift defense)', () => {
    // Hypothetical: upstream adds a new combat sub-step we haven't
    // enumerated in TIMELINE_PHASES. Pre-fix, the runway silently
    // collapsed because no step matched. Post-fix, gameView.phase
    // alone is enough to keep the runway expanded, so the user
    // still sees "we're in combat" — the unknown step just lights
    // no specific tick.
    renderTimeline(
      buildGameView({
        phase: 'COMBAT',
        step: 'POST_COMBAT_THIRD_STRIKE_DAMAGE',
      }),
      'tabletop',
    );
    expect(screen.getAllByTestId('phase-step-label')).toHaveLength(6);
    const positions = screen
      .getAllByTestId('phase-step-label')
      .map((l) => l.getAttribute('data-step-position'));
    expect(positions.every((p) => p === 'future')).toBe(true);
    expect(screen.queryByTestId('phase-step-past-mark')).toBeNull();
    // The combat segment still flags itself as combat-active so
    // downstream consumers (e.g. styling, the legacy variant's
    // header detection) see consistent state.
    const combatSegment = screen
      .getAllByTestId('phase-segment')
      .find((s) => s.getAttribute('data-phase') === 'Combat');
    expect(combatSegment?.getAttribute('data-combat-active')).toBe('true');
  });

  it('past combat sub-steps are NOT marked past in non-compact mode (P3 exemption is compact-only)', () => {
    renderTimeline(
      buildGameView({ step: 'COMBAT_DAMAGE', phase: 'COMBAT' }),
      'current',
    );
    // In non-compact mode, the past/active/future runway semantics
    // do NOT apply — only active vs not. Older sub-steps stay marked
    // as 'future' (the default non-active branch) so we don't churn
    // the existing visual idiom when the user is on the legacy
    // variant.
    expect(screen.queryByTestId('phase-step-past-mark')).toBeNull();
    const positions = screen
      .getAllByTestId('phase-step-label')
      .filter((l) =>
        ['BEGIN_COMBAT', 'DECLARE_ATTACKERS', 'DECLARE_BLOCKERS'].includes(
          l.getAttribute('data-step') ?? '',
        ),
      )
      .map((l) => l.getAttribute('data-step-position'));
    expect(positions).toEqual(['future', 'future', 'future']);
  });
});
