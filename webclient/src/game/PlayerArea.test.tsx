import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PlayerArea } from './PlayerArea';
import { webPlayerViewSchema, type WebPlayerView } from '../api/schemas';

/**
 * Slice 69b (ADR 0010 v2 D5 + D13) — player-status visual invariants
 * and keyboard-nav hooks.
 *
 * What's worth locking here:
 *   - Active / priority glow rings are present when the corresponding
 *     state flag is true (D5).
 *   - The two glows STACK additively when both flags are true (typical
 *     1v1 case during your own turn — the paired box-shadow keeps
 *     them visually distinct, not muddied).
 *   - data-active / data-priority attributes are present so e2e tests
 *     and screen-reader integrations can locate the active seat
 *     without depending on inline-style internals.
 *   - tabIndex propagates from the parent so the clockwise FFA tab
 *     order isn't lost between Battlefield and PlayerArea (D13).
 *
 * Doesn't lock: exact rgba values or shadow offsets — those live in
 * tokens.css per D7 and are styling-only.
 */

function basePlayer(overrides: Partial<WebPlayerView>): WebPlayerView {
  // The schema's default-bearing fields (commandList, teamId,
  // goadingPlayerIds…) flow through .parse so older fixtures don't
  // need to know about every new schema-1.20 field.
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
    manaPool: {
      red: 0,
      green: 0,
      blue: 0,
      white: 0,
      black: 0,
      colorless: 0,
    },
    controlled: false,
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

const PASSTHROUGH_PROPS = {
  perspective: 'opponent' as const,
  canAct: false,
  onObjectClick: () => {},
  targetable: false,
  eligibleCombatIds: new Set<string>(),
  combatRoles: new Map<string, 'attacker' | 'blocker'>(),
  isDropTarget: false,
  onBoardDrop: () => {},
};

describe('PlayerArea status glow (slice 69b D5)', () => {
  it('idle player has no glow box-shadow', () => {
    render(
      <PlayerArea player={basePlayer({})} {...PASSTHROUGH_PROPS} />,
    );
    const area = screen.getByTestId('player-area-opponent');
    expect(area.style.boxShadow || '').toBe('');
    expect(area.dataset['active']).toBeUndefined();
    expect(area.dataset['priority']).toBeUndefined();
  });

  it('active player gets the active-glow ring + data-active', () => {
    render(
      <PlayerArea
        player={basePlayer({ isActive: true })}
        {...PASSTHROUGH_PROPS}
      />,
    );
    const area = screen.getByTestId('player-area-opponent');
    expect(area.style.boxShadow).toContain('var(--color-team-active-glow)');
    expect(area.style.boxShadow).not.toContain('var(--color-team-priority-glow)');
    expect(area.dataset['active']).toBe('true');
    expect(area.dataset['priority']).toBeUndefined();
  });

  it('priority player gets the priority-glow ring + data-priority', () => {
    render(
      <PlayerArea
        player={basePlayer({ hasPriority: true })}
        {...PASSTHROUGH_PROPS}
      />,
    );
    const area = screen.getByTestId('player-area-opponent');
    expect(area.style.boxShadow).toContain('var(--color-team-priority-glow)');
    expect(area.style.boxShadow).not.toContain('var(--color-team-active-glow)');
    expect(area.dataset['priority']).toBe('true');
    expect(area.dataset['active']).toBeUndefined();
  });

  it('active + priority stack additively (typical 1v1 your-turn case)', () => {
    render(
      <PlayerArea
        player={basePlayer({ isActive: true, hasPriority: true })}
        {...PASSTHROUGH_PROPS}
      />,
    );
    const area = screen.getByTestId('player-area-opponent');
    // Both shadows present — composed via comma-separated box-shadow.
    expect(area.style.boxShadow).toContain('var(--color-team-active-glow)');
    expect(area.style.boxShadow).toContain('var(--color-team-priority-glow)');
    expect(area.dataset['active']).toBe('true');
    expect(area.dataset['priority']).toBe('true');
  });

  it('drop-target mode suppresses status glow (UI mode wins)', () => {
    // While a hand-card drag is in progress, the dashed
    // "drop-here" border is the dominant visual signal. Showing
    // status glow on top of it would muddy the destination feedback
    // at FFA densities.
    render(
      <PlayerArea
        player={basePlayer({ isActive: true, hasPriority: true })}
        {...PASSTHROUGH_PROPS}
        isDropTarget={true}
      />,
    );
    const area = screen.getByTestId('player-area-opponent');
    expect(area.style.boxShadow || '').toBe('');
    // Status data attributes still surface — they're semantic, not
    // visual. Screen readers / e2e selectors keep working.
    expect(area.dataset['active']).toBe('true');
    expect(area.dataset['priority']).toBe('true');
    expect(area.dataset['dropTarget']).toBe('true');
  });
});

describe('PlayerArea tabIndex (slice 69b D13)', () => {
  it('tabIndex prop propagates to the outer container', () => {
    render(
      <PlayerArea
        player={basePlayer({})}
        {...PASSTHROUGH_PROPS}
        tabIndex={11}
      />,
    );
    const area = screen.getByTestId('player-area-opponent');
    expect(area.getAttribute('tabindex')).toBe('11');
  });

  it('omitting tabIndex falls back to natural DOM order (no attribute)', () => {
    render(
      <PlayerArea player={basePlayer({})} {...PASSTHROUGH_PROPS} />,
    );
    const area = screen.getByTestId('player-area-opponent');
    expect(area.getAttribute('tabindex')).toBeNull();
  });
});

describe('PlayerArea aria-label (slice 70-D — synthesis owned by PlayerFrame)', () => {
  // Slice 70-D — aria-label synthesis migrated from PlayerArea to
  // PlayerFrame (critic N11). PlayerArea is now role="region" with
  // no label; the persona signals (name + life + active + priority +
  // eliminated) are owned by the inner PlayerFrame's role="group"
  // aria-label. SR users traverse PlayerArea (region) → PlayerFrame
  // (group with persona label) → battlefield contents.

  it('idle opponent: name + life only', () => {
    render(
      <PlayerArea
        player={basePlayer({ name: 'alice', life: 18 })}
        {...PASSTHROUGH_PROPS}
      />,
    );
    const frame = screen.getByTestId('player-frame-opponent');
    expect(frame.getAttribute('aria-label')).toBe('alice, 18 life');
    expect(frame.getAttribute('role')).toBe('group');
    // Slice 70-D critic UX-C1 — PlayerArea is a plain div (no
    // role="region", no aria-label). The inner PlayerFrame's
    // labeled group is the sole nameable container.
    const area = screen.getByTestId('player-area-opponent');
    expect(area.getAttribute('role')).toBeNull();
    expect(area.getAttribute('aria-label')).toBeNull();
  });

  it('self perspective announces "your seat"', () => {
    render(
      <PlayerArea
        player={basePlayer({ name: 'alice', life: 20 })}
        {...PASSTHROUGH_PROPS}
        perspective="self"
      />,
    );
    const frame = screen.getByTestId('player-frame-self');
    expect(frame.getAttribute('aria-label')).toBe(
      'alice, 20 life, your seat',
    );
  });

  it('active + priority opponent surfaces both flags in label', () => {
    render(
      <PlayerArea
        player={basePlayer({
          name: 'bob',
          life: 12,
          isActive: true,
          hasPriority: true,
        })}
        {...PASSTHROUGH_PROPS}
      />,
    );
    const frame = screen.getByTestId('player-frame-opponent');
    expect(frame.getAttribute('aria-label')).toBe(
      'bob, 12 life, active turn, has priority',
    );
  });

  it('eliminated opponent surfaces "eliminated"', () => {
    render(
      <PlayerArea
        player={basePlayer({
          name: 'carol',
          life: 0,
          hasLeft: true,
        })}
        {...PASSTHROUGH_PROPS}
      />,
    );
    const frame = screen.getByTestId('player-frame-opponent');
    expect(frame.getAttribute('aria-label')).toBe(
      'carol, 0 life, eliminated',
    );
  });

  it('falls back to "Unknown player" when name missing', () => {
    render(
      <PlayerArea
        player={basePlayer({ name: '', life: 20 })}
        {...PASSTHROUGH_PROPS}
      />,
    );
    const frame = screen.getByTestId('player-frame-opponent');
    expect(frame.getAttribute('aria-label')).toBe(
      'Unknown player, 20 life',
    );
  });
});
