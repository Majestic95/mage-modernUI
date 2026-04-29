import { describe, expect, it } from 'vitest';
import {
  bucketBattlefield,
  classifyPermanent,
  rowOrder,
} from './battlefieldRows';
import type { WebPermanentView } from '../api/schemas';

/**
 * Slice 53 — classifier coverage. Every battlefield permanent renders
 * into exactly one of three rows; getting the bucket wrong means a
 * card visibly appears in the wrong row. Cheap table-driven test
 * locks the precedence rule + the eight relevant type combinations.
 */

function permWithTypes(types: string[]): WebPermanentView {
  return {
    card: {
      id: 'card-id',
      cardId: 'card-id',
      name: 'Test',
      displayName: 'Test',
      expansionSetCode: 'TEST',
      cardNumber: '1',
      manaCost: '',
      manaValue: 0,
      typeLine: '',
      supertypes: [],
      types,
      subtypes: [],
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
      sourceLabel: '',
    },
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
  };
}

describe('classifyPermanent', () => {
  it.each([
    [['CREATURE'], 'creatures'],
    [['LAND'], 'lands'],
    [['ARTIFACT'], 'other'],
    [['ENCHANTMENT'], 'other'],
    [['PLANESWALKER'], 'other'],
    [['BATTLE'], 'other'],
    // Animated land — creature precedence wins.
    [['LAND', 'CREATURE'], 'creatures'],
    // Land artifact (treasure-like). Not a "pure" land; routes to other,
    // not lands. Dominant non-land type wins lands.
    [['LAND', 'ARTIFACT'], 'other'],
    // Land enchantment (e.g. Urza's Saga in some printings).
    [['LAND', 'ENCHANTMENT'], 'other'],
    // Artifact creature is a creature.
    [['ARTIFACT', 'CREATURE'], 'creatures'],
    // Enchantment creature (god-eternal-style) is a creature.
    [['ENCHANTMENT', 'CREATURE'], 'creatures'],
  ] as const)(
    'types=%j → row=%s',
    (types, expected) => {
      expect(classifyPermanent(permWithTypes([...types]))).toBe(expected);
    },
  );
});

describe('bucketBattlefield', () => {
  it('preserves insertion order within each bucket', () => {
    const a = permWithTypes(['CREATURE']);
    a.card = { ...a.card, name: 'CreatureA' };
    const b = permWithTypes(['CREATURE']);
    b.card = { ...b.card, name: 'CreatureB' };
    const c = permWithTypes(['LAND']);
    c.card = { ...c.card, name: 'LandC' };
    const buckets = bucketBattlefield([a, b, c]);
    expect(buckets.creatures.map((p) => p.card.name)).toEqual([
      'CreatureA',
      'CreatureB',
    ]);
    expect(buckets.lands.map((p) => p.card.name)).toEqual(['LandC']);
    expect(buckets.other).toEqual([]);
  });

  it('returns empty arrays for empty input', () => {
    const buckets = bucketBattlefield([]);
    expect(buckets.creatures).toEqual([]);
    expect(buckets.other).toEqual([]);
    expect(buckets.lands).toEqual([]);
  });
});

describe('rowOrder', () => {
  it('puts lands at bottom for self', () => {
    expect(rowOrder('self')).toEqual(['creatures', 'other', 'lands']);
  });

  it('puts lands at top for opponent (mirror)', () => {
    expect(rowOrder('opponent')).toEqual(['lands', 'other', 'creatures']);
  });
});
