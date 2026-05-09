import { describe, expect, it } from 'vitest';
import {
  buildAttackerRecap,
  buildBlockerRecap,
  formatRecap,
} from './combatRecap';
import type { WebCombatGroupView } from '../api/schemas';

/**
 * Bundle 3-D + 3-X.1 — pure-function coverage for the recap builders +
 * formatter. Locks in:
 *
 * <ul>
 *   <li>Local-player filter via {@code controllerName === myName}
 *       (A.6 spec divergence fix; controllerId not on wire today).</li>
 *   <li>Permanent-id dedup (NOT name dedup — two same-named creatures
 *       still both count, and same permanent id appearing in 2 groups
 *       deduplicates).</li>
 *   <li>Blocker pairing only when the group has exactly one attacker
 *       (B.6 fix — drops ambiguous "X blocks Y" copy in multi-attacker
 *       groups).</li>
 *   <li>{@link formatRecap} empty-state copy ("No attackers/blockers
 *       chosen") and "…and N more" overflow phrasing (A.1, A.3).</li>
 *   <li>Singular vs plural unit suffix.</li>
 * </ul>
 */

const ME = 'alice';
const OPP = 'lyrra';

function makePermanent(id: string, name: string, controller: string = ME) {
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
    controllerName: controller,
    tapped: false,
  };
}

function makeGroup(overrides: {
  defenderId?: string;
  defenderName?: string;
  attackers?: Array<{ id: string; name: string; controller?: string }>;
  blockers?: Array<{ id: string; name: string; controller?: string }>;
  blocked?: boolean;
}): WebCombatGroupView {
  const attackers = Object.fromEntries(
    (overrides.attackers ?? []).map((a) => [
      a.id,
      makePermanent(a.id, a.name, a.controller ?? ME),
    ]),
  );
  const blockers = Object.fromEntries(
    (overrides.blockers ?? []).map((b) => [
      b.id,
      makePermanent(b.id, b.name, b.controller ?? ME),
    ]),
  );
  return {
    defenderId: overrides.defenderId ?? 'def-1',
    defenderName: overrides.defenderName ?? OPP,
    attackers: attackers as never,
    blockers: blockers as never,
    blocked: overrides.blocked ?? false,
  };
}

describe('buildAttackerRecap', () => {
  it('returns empty array when no combat groups', () => {
    expect(buildAttackerRecap([], ME)).toEqual([]);
  });

  it('flattens attackers across multiple groups (only local player\'s)', () => {
    const recap = buildAttackerRecap(
      [
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
      ],
      ME,
    );
    expect(recap).toEqual(['Forest Elf', 'Wolf', 'Bear']);
  });

  it('filters out attackers controlled by other players (A.6)', () => {
    const recap = buildAttackerRecap(
      [
        makeGroup({
          attackers: [
            { id: 'a-1', name: 'My Wolf', controller: ME },
            { id: 'a-2', name: 'Their Wolf', controller: OPP },
            { id: 'a-3', name: 'My Bear', controller: ME },
          ],
        }),
      ],
      ME,
    );
    expect(recap).toEqual(['My Wolf', 'My Bear']);
  });

  it('returns empty when myName is empty (gameView not hydrated)', () => {
    const recap = buildAttackerRecap(
      [makeGroup({ attackers: [{ id: 'a-1', name: 'Wolf' }] })],
      '',
    );
    expect(recap).toEqual([]);
  });

  it('dedupes by permanent id, not by name (two same-named creatures both count)', () => {
    const recap = buildAttackerRecap(
      [
        makeGroup({
          attackers: [
            { id: 'a-1', name: 'Bear' },
            { id: 'a-2', name: 'Bear' },
          ],
        }),
      ],
      ME,
    );
    expect(recap).toEqual(['Bear', 'Bear']);
  });

  it('skips an attacker that appears in two groups (defensive)', () => {
    const shared = { id: 'a-1', name: 'Wolf' };
    const recap = buildAttackerRecap(
      [
        makeGroup({ attackers: [shared] }),
        makeGroup({ defenderId: 'def-2', attackers: [shared] }),
      ],
      ME,
    );
    expect(recap).toEqual(['Wolf']);
  });
});

describe('buildBlockerRecap', () => {
  it('pairs each blocker with the attacker when the group has exactly one attacker (unambiguous)', () => {
    const recap = buildBlockerRecap(
      [
        makeGroup({
          attackers: [{ id: 'a-1', name: 'Wolf', controller: OPP }],
          blockers: [
            { id: 'b-1', name: 'Knight' },
            { id: 'b-2', name: 'Soldier' },
          ],
        }),
      ],
      ME,
    );
    expect(recap).toEqual(['Knight blocks Wolf', 'Soldier blocks Wolf']);
  });

  it('drops the "blocks X" suffix when the group has 2+ attackers (B.6 — ambiguous pairing)', () => {
    const recap = buildBlockerRecap(
      [
        makeGroup({
          attackers: [
            { id: 'a-1', name: 'Wolf', controller: OPP },
            { id: 'a-2', name: 'Bear', controller: OPP },
          ],
          blockers: [{ id: 'b-1', name: 'Knight' }],
        }),
      ],
      ME,
    );
    expect(recap).toEqual(['Knight']);
  });

  it('falls back to bare blocker name when group has no attackers (edge case)', () => {
    const recap = buildBlockerRecap(
      [
        makeGroup({
          attackers: [],
          blockers: [{ id: 'b-1', name: 'Knight' }],
        }),
      ],
      ME,
    );
    expect(recap).toEqual(['Knight']);
  });

  it('filters out blockers controlled by other players (A.6)', () => {
    const recap = buildBlockerRecap(
      [
        makeGroup({
          attackers: [{ id: 'a-1', name: 'Wolf', controller: OPP }],
          blockers: [
            { id: 'b-1', name: 'My Knight', controller: ME },
            { id: 'b-2', name: 'Their Knight', controller: 'other-defender' },
          ],
        }),
      ],
      ME,
    );
    expect(recap).toEqual(['My Knight blocks Wolf']);
  });

  it('handles multiple groups', () => {
    const recap = buildBlockerRecap(
      [
        makeGroup({
          attackers: [{ id: 'a-1', name: 'Wolf', controller: OPP }],
          blockers: [{ id: 'b-1', name: 'Knight' }],
        }),
        makeGroup({
          defenderId: 'def-2',
          attackers: [{ id: 'a-2', name: 'Bear', controller: OPP }],
          blockers: [{ id: 'b-2', name: 'Soldier' }],
        }),
      ],
      ME,
    );
    expect(recap).toEqual(['Knight blocks Wolf', 'Soldier blocks Bear']);
  });
});

describe('formatRecap — A.1 + A.3 spec amendments', () => {
  it('returns passive empty-state copy for attackers (A.1)', () => {
    expect(formatRecap([], 'attacker')).toBe('No attackers chosen');
  });

  it('returns passive empty-state copy for blockers (A.1)', () => {
    expect(formatRecap([], 'blocker')).toBe('No blockers chosen');
  });

  it('singular unit when 1 entry', () => {
    expect(formatRecap(['Wolf'], 'attacker')).toBe('1 attacker — Wolf');
  });

  it('plural unit when 2+ entries', () => {
    expect(formatRecap(['Wolf', 'Bear'], 'attacker')).toBe(
      '2 attackers — Wolf, Bear',
    );
  });

  it('shows up to 4 names then "…and N more" overflow (A.3 — Unicode ellipsis)', () => {
    expect(
      formatRecap(['A', 'B', 'C', 'D', 'E', 'F'], 'attacker'),
    ).toBe('6 attackers — A, B, C, D, …and 2 more');
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
