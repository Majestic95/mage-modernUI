import { describe, expect, it } from 'vitest';
import {
  bucketBattlefield,
  classifyPermanent,
  rowOrder,
} from './battlefieldRows';
import type { WebPermanentView } from '../api/schemas';

/**
 * Slice 53 / 70-Z.1 — classifier coverage. Every battlefield permanent
 * renders into exactly one of three rows; getting the bucket wrong
 * means a card visibly appears in the wrong row.
 *
 * <p>Slice 70-Z.1 reshaped the buckets — `other` was renamed to
 * `artifacts`, planeswalkers moved from `other` → `creatures`, and
 * the artifacts bucket became the default for any unknown type.
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
    [['ARTIFACT'], 'artifacts'],
    [['ENCHANTMENT'], 'artifacts'],
    // Slice 70-Z.1 — planeswalkers moved to the creatures lane
    // (battle participants read together).
    [['PLANESWALKER'], 'creatures'],
    [['BATTLE'], 'artifacts'],
    // Animated land — creature precedence wins.
    [['LAND', 'CREATURE'], 'creatures'],
    // Land artifact (treasure-like). Not a "pure" land; routes to
    // artifacts. Dominant non-land type wins lands-row placement.
    [['LAND', 'ARTIFACT'], 'artifacts'],
    // Land enchantment (e.g. Urza's Saga in some printings).
    [['LAND', 'ENCHANTMENT'], 'artifacts'],
    // Artifact creature is a creature.
    [['ARTIFACT', 'CREATURE'], 'creatures'],
    // Enchantment creature (god-eternal-style) is a creature.
    [['ENCHANTMENT', 'CREATURE'], 'creatures'],
    // Slice 70-Z.1 — unknown type falls through to the artifacts
    // bucket as the default (user direction: "any question about
    // a card type, it would, by default, go into the artifact
    // zone"). Defends against future engine type introductions.
    [['SOME_FUTURE_TYPE'], 'artifacts'],
    [[], 'artifacts'],
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
    expect(buckets.artifacts).toEqual([]);
  });

  it('returns empty arrays for empty input', () => {
    const buckets = bucketBattlefield([]);
    expect(buckets.creatures).toEqual([]);
    expect(buckets.artifacts).toEqual([]);
    expect(buckets.lands).toEqual([]);
  });

  it('routes planeswalker + creature mixed board correctly', () => {
    // Slice 70-Z.1 — both creatures and planeswalkers cluster in
    // the creatures lane. Order preserved per insertion.
    const c1 = permWithTypes(['CREATURE']);
    c1.card = { ...c1.card, name: 'BearCub' };
    const pw = permWithTypes(['PLANESWALKER']);
    pw.card = { ...pw.card, name: 'Liliana' };
    const c2 = permWithTypes(['CREATURE']);
    c2.card = { ...c2.card, name: 'Wolverine' };
    const a = permWithTypes(['ARTIFACT']);
    a.card = { ...a.card, name: 'SolRing' };
    const buckets = bucketBattlefield([c1, pw, c2, a]);
    expect(buckets.creatures.map((p) => p.card.name)).toEqual([
      'BearCub',
      'Liliana',
      'Wolverine',
    ]);
    expect(buckets.artifacts.map((p) => p.card.name)).toEqual(['SolRing']);
  });
});

describe('rowOrder', () => {
  it('puts lands at bottom for self (creatures face the focal zone)', () => {
    // Slice 70-Z.1 — main rows are creatures + lands only;
    // artifacts render as a SIDE box (positioned per pod by
    // PlayerArea). rowOrder no longer includes 'artifacts'.
    expect(rowOrder('self')).toEqual(['creatures', 'lands']);
  });

  it('puts lands at top for opponent (mirror)', () => {
    expect(rowOrder('opponent')).toEqual(['lands', 'creatures']);
  });
});
