import { describe, expect, it } from 'vitest';
import {
  buildAttackerRecap,
  buildBlockerRecap,
  formatRecap,
} from './combatRecap';
import type { WebCombatGroupView } from '../api/schemas';

/**
 * Bundle 3-D — pure-function coverage for the recap builders +
 * formatter. Lock in: deduplication by permanent id (NOT by name —
 * two creatures with the same name still both count), the 4-entry
 * head + "+N more" overflow, and the singular/plural unit suffix.
 */

function makePermanent(id: string, name: string) {
  return {
    card: {
      id,
      name,
      displayName: name,
      expansionSetCode: 'M21',
      cardNumber: '1',
      manaCost: '',
      manaValue: 0,
      typeLine: 'Creature — Beast',
      supertypes: [],
      types: ['CREATURE'],
      subtypes: ['Beast'],
      colors: [],
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
    },
    controllerName: 'alice',
    tapped: false,
  };
}

function makeGroup(overrides: {
  defenderId?: string;
  defenderName?: string;
  attackers?: Array<{ id: string; name: string }>;
  blockers?: Array<{ id: string; name: string }>;
  blocked?: boolean;
}): WebCombatGroupView {
  const attackers = Object.fromEntries(
    (overrides.attackers ?? []).map((a) => [
      a.id,
      makePermanent(a.id, a.name),
    ]),
  );
  const blockers = Object.fromEntries(
    (overrides.blockers ?? []).map((b) => [
      b.id,
      makePermanent(b.id, b.name),
    ]),
  );
  return {
    defenderId: overrides.defenderId ?? 'def-1',
    defenderName: overrides.defenderName ?? 'lyrra',
    attackers: attackers as never,
    blockers: blockers as never,
    blocked: overrides.blocked ?? false,
  };
}

describe('buildAttackerRecap', () => {
  it('returns empty array when no combat groups', () => {
    expect(buildAttackerRecap([])).toEqual([]);
  });

  it('flattens attackers across multiple groups', () => {
    const recap = buildAttackerRecap([
      makeGroup({
        attackers: [
          { id: 'a-1', name: 'Forest Elf' },
          { id: 'a-2', name: 'Wolf' },
        ],
      }),
      makeGroup({
        defenderId: 'def-2',
        attackers: [{ id: 'a-3', name: 'Bear' }],
      }),
    ]);
    expect(recap).toEqual(['Forest Elf', 'Wolf', 'Bear']);
  });

  it('dedupes by permanent id, not by name (two same-named creatures both count)', () => {
    const recap = buildAttackerRecap([
      makeGroup({
        attackers: [
          { id: 'a-1', name: 'Bear' },
          { id: 'a-2', name: 'Bear' },
        ],
      }),
    ]);
    expect(recap).toEqual(['Bear', 'Bear']);
  });

  it('skips an attacker that appears in two groups (defensive — wire shouldn\'t do this but engine could)', () => {
    const shared = { id: 'a-1', name: 'Wolf' };
    const recap = buildAttackerRecap([
      makeGroup({ attackers: [shared] }),
      makeGroup({ defenderId: 'def-2', attackers: [shared] }),
    ]);
    expect(recap).toEqual(['Wolf']);
  });
});

describe('buildBlockerRecap', () => {
  it('pairs each blocker with the first attacker in its group', () => {
    const recap = buildBlockerRecap([
      makeGroup({
        attackers: [{ id: 'a-1', name: 'Wolf' }],
        blockers: [
          { id: 'b-1', name: 'Knight' },
          { id: 'b-2', name: 'Soldier' },
        ],
      }),
    ]);
    expect(recap).toEqual(['Knight blocks Wolf', 'Soldier blocks Wolf']);
  });

  it('falls back to bare blocker name when group has no attackers (edge case)', () => {
    const recap = buildBlockerRecap([
      makeGroup({
        attackers: [],
        blockers: [{ id: 'b-1', name: 'Knight' }],
      }),
    ]);
    expect(recap).toEqual(['Knight']);
  });

  it('handles multiple groups', () => {
    const recap = buildBlockerRecap([
      makeGroup({
        attackers: [{ id: 'a-1', name: 'Wolf' }],
        blockers: [{ id: 'b-1', name: 'Knight' }],
      }),
      makeGroup({
        defenderId: 'def-2',
        attackers: [{ id: 'a-2', name: 'Bear' }],
        blockers: [{ id: 'b-2', name: 'Soldier' }],
      }),
    ]);
    expect(recap).toEqual(['Knight blocks Wolf', 'Soldier blocks Bear']);
  });
});

describe('formatRecap', () => {
  it('returns empty string for empty list', () => {
    expect(formatRecap([], 'attacker')).toBe('');
  });

  it('singular unit when 1 entry', () => {
    expect(formatRecap(['Wolf'], 'attacker')).toBe('1 attacker — Wolf');
  });

  it('plural unit when 2+ entries', () => {
    expect(formatRecap(['Wolf', 'Bear'], 'attacker')).toBe(
      '2 attackers — Wolf, Bear',
    );
  });

  it('shows up to 4 names then "+N more" overflow', () => {
    expect(
      formatRecap(['A', 'B', 'C', 'D', 'E', 'F'], 'attacker'),
    ).toBe('6 attackers — A, B, C, D, +2 more');
  });

  it('exactly 4 entries → no overflow suffix', () => {
    expect(formatRecap(['A', 'B', 'C', 'D'], 'attacker')).toBe(
      '4 attackers — A, B, C, D',
    );
  });

  it('plural blocker unit', () => {
    expect(
      formatRecap(['Knight blocks Wolf', 'Soldier blocks Bear'], 'blocker'),
    ).toBe('2 blockers — Knight blocks Wolf, Soldier blocks Bear');
  });
});
