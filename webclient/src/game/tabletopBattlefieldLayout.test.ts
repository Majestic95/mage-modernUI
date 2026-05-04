/**
 * Slice B-13-A — tests for partitionForTabletop.
 *
 * Coverage matrix per element #4 spec:
 *   - Single-type permanents (LAND / CREATURE / PLANESWALKER / ARTIFACT
 *     / ENCHANTMENT / BATTLE) go to the expected bucket.
 *   - Hybrid types route via "creature wins": artifact creature,
 *     enchantment creature, animated manland, flipped-to-creature
 *     battle all go to Creatures.
 *   - Inanimate manland stays in Lands.
 *   - Unknown type tag defensively goes to Artifacts-Enchantments.
 *   - Insertion order preserved within each bucket.
 *   - Empty input returns empty buckets.
 */
import { describe, it, expect } from 'vitest';
import {
  partitionForTabletop,
  type TabletopBuckets,
} from './tabletopBattlefieldLayout';
import {
  webCardViewSchema,
  webPermanentViewSchema,
  type WebPermanentView,
} from '../api/schemas';

function makePerm(
  name: string,
  types: readonly string[],
  id: string,
): WebPermanentView {
  return webPermanentViewSchema.parse({
    card: webCardViewSchema.parse({
      id,
      cardId: id,
      name,
      displayName: name,
      expansionSetCode: 'TST',
      cardNumber: '001',
      manaCost: '',
      manaValue: 0,
      typeLine: types.join(' '),
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
    }),
    controllerName: 'Test',
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

function names(arr: readonly WebPermanentView[]): readonly string[] {
  return arr.map((p) => p.card.name);
}

describe('partitionForTabletop — single-type routing', () => {
  it('LAND → lands bucket', () => {
    const result = partitionForTabletop([makePerm('Forest', ['LAND'], 'a')]);
    expect(names(result.lands)).toEqual(['Forest']);
    expect(result.creatures).toHaveLength(0);
    expect(result.artifactsEnchantments).toHaveLength(0);
  });

  it('CREATURE → creatures bucket', () => {
    const result = partitionForTabletop([
      makePerm('Goblin Guide', ['CREATURE'], 'a'),
    ]);
    expect(names(result.creatures)).toEqual(['Goblin Guide']);
  });

  it('PLANESWALKER → creatures bucket (per element #4 spec)', () => {
    const result = partitionForTabletop([
      makePerm('Nissa', ['PLANESWALKER'], 'a'),
    ]);
    expect(names(result.creatures)).toEqual(['Nissa']);
    expect(result.artifactsEnchantments).toHaveLength(0);
  });

  it('ARTIFACT → artifacts-enchantments bucket', () => {
    const result = partitionForTabletop([
      makePerm('Sol Ring', ['ARTIFACT'], 'a'),
    ]);
    expect(names(result.artifactsEnchantments)).toEqual(['Sol Ring']);
  });

  it('ENCHANTMENT → artifacts-enchantments bucket', () => {
    const result = partitionForTabletop([
      makePerm('Pacifism', ['ENCHANTMENT'], 'a'),
    ]);
    expect(names(result.artifactsEnchantments)).toEqual(['Pacifism']);
  });

  it('BATTLE → artifacts-enchantments bucket (per element #4 spec)', () => {
    const result = partitionForTabletop([
      makePerm('Invasion of Tarkir', ['BATTLE'], 'a'),
    ]);
    expect(names(result.artifactsEnchantments)).toEqual(['Invasion of Tarkir']);
  });
});

describe('partitionForTabletop — hybrid types ("creature wins")', () => {
  it('artifact creature → creatures', () => {
    const result = partitionForTabletop([
      makePerm('Walking Ballista', ['ARTIFACT', 'CREATURE'], 'a'),
    ]);
    expect(names(result.creatures)).toEqual(['Walking Ballista']);
    expect(result.artifactsEnchantments).toHaveLength(0);
  });

  it('enchantment creature → creatures', () => {
    const result = partitionForTabletop([
      makePerm('Boon Satyr', ['ENCHANTMENT', 'CREATURE'], 'a'),
    ]);
    expect(names(result.creatures)).toEqual(['Boon Satyr']);
  });

  it('animated manland → creatures', () => {
    const result = partitionForTabletop([
      makePerm('Mutavault (animated)', ['LAND', 'CREATURE'], 'a'),
    ]);
    expect(names(result.creatures)).toEqual(['Mutavault (animated)']);
    expect(result.lands).toHaveLength(0);
  });

  it('inanimate manland (LAND only) → lands', () => {
    const result = partitionForTabletop([
      makePerm('Mutavault', ['LAND'], 'a'),
    ]);
    expect(names(result.lands)).toEqual(['Mutavault']);
  });

  it('battle that flipped to creature → creatures', () => {
    const result = partitionForTabletop([
      makePerm('Flipped Battle', ['BATTLE', 'CREATURE'], 'a'),
    ]);
    expect(names(result.creatures)).toEqual(['Flipped Battle']);
  });
});

describe('partitionForTabletop — defensive fallback', () => {
  it('unknown type tag → artifacts-enchantments', () => {
    const result = partitionForTabletop([
      makePerm('Future Type', ['NEW_TYPE_2030'], 'a'),
    ]);
    expect(names(result.artifactsEnchantments)).toEqual(['Future Type']);
  });

  it('empty types array → artifacts-enchantments', () => {
    const result = partitionForTabletop([makePerm('Nameless', [], 'a')]);
    expect(names(result.artifactsEnchantments)).toEqual(['Nameless']);
  });
});

describe('partitionForTabletop — order + edge cases', () => {
  it('empty input returns three empty buckets', () => {
    const result: TabletopBuckets = partitionForTabletop([]);
    expect(result.lands).toEqual([]);
    expect(result.creatures).toEqual([]);
    expect(result.artifactsEnchantments).toEqual([]);
  });

  it('preserves insertion order within each bucket', () => {
    const result = partitionForTabletop([
      makePerm('Forest 1', ['LAND'], '1'),
      makePerm('Bear', ['CREATURE'], '2'),
      makePerm('Mountain', ['LAND'], '3'),
      makePerm('Wolf', ['CREATURE'], '4'),
      makePerm('Sol Ring', ['ARTIFACT'], '5'),
      makePerm('Plains', ['LAND'], '6'),
    ]);
    expect(names(result.lands)).toEqual(['Forest 1', 'Mountain', 'Plains']);
    expect(names(result.creatures)).toEqual(['Bear', 'Wolf']);
    expect(names(result.artifactsEnchantments)).toEqual(['Sol Ring']);
  });

  it('mixed realistic battlefield partitions correctly', () => {
    const result = partitionForTabletop([
      makePerm('Forest', ['LAND'], '1'),
      makePerm('Llanowar Elves', ['CREATURE'], '2'),
      makePerm('Nissa', ['PLANESWALKER'], '3'),
      makePerm('Sol Ring', ['ARTIFACT'], '4'),
      makePerm('Lightning Greaves', ['ARTIFACT'], '5'),
      makePerm('Pacifism', ['ENCHANTMENT'], '6'),
      makePerm('Walking Ballista', ['ARTIFACT', 'CREATURE'], '7'),
    ]);
    expect(names(result.lands)).toEqual(['Forest']);
    expect(names(result.creatures)).toEqual([
      'Llanowar Elves',
      'Nissa',
      'Walking Ballista',
    ]);
    expect(names(result.artifactsEnchantments)).toEqual([
      'Sol Ring',
      'Lightning Greaves',
      'Pacifism',
    ]);
  });
});
