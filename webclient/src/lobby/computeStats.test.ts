/**
 * Slice L6 — locks the deck-stats math used by the lobby's preview
 * panel. Drop these and a wire-shape change to WebCardInfo or a
 * subtle bug in the mana-curve / type-count / color-pip logic
 * silently shows the wrong numbers in the lobby.
 */
import { describe, expect, it } from 'vitest';
import type { WebCardInfo, WebDeckCardInfo } from '../api/schemas';
import { computeStats } from './computeStats';

function card(overrides: Partial<WebCardInfo>): WebCardInfo {
  return {
    name: 'Card',
    setCode: 'XYZ',
    cardNumber: '1',
    manaValue: 0,
    manaCosts: [],
    rarity: 'common',
    types: [],
    subtypes: [],
    supertypes: [],
    colors: [],
    power: '',
    toughness: '',
    startingLoyalty: '',
    rules: [],
    ...overrides,
  };
}

function entry(name: string, amount: number): WebDeckCardInfo {
  return { cardName: name, setCode: 'XYZ', cardNumber: '1', amount };
}

describe('computeStats', () => {
  it('buckets cards into the correct CMC slot, capping at 7+', () => {
    const cards = new Map<string, WebCardInfo>([
      ['Bolt', card({ manaValue: 1 })],
      ['Counter', card({ manaValue: 2 })],
      ['Big', card({ manaValue: 9 })],
    ]);
    const stats = computeStats({
      mainboard: [entry('Bolt', 4), entry('Counter', 4), entry('Big', 2)],
      commander: null,
      cards,
    });
    expect(stats.manaCurve[0]).toBe(0);
    expect(stats.manaCurve[1]).toBe(4);
    expect(stats.manaCurve[2]).toBe(4);
    expect(stats.manaCurve[7]).toBe(2); // CMC 9 caps at the 7+ bucket
  });

  it('counts each card in exactly one type bucket (primary type wins)', () => {
    const cards = new Map<string, WebCardInfo>([
      ['Bear', card({ types: ['Creature'] })],
      ['Pact', card({ types: ['Instant'] })],
      ['Mox', card({ types: ['Artifact'] })],
      ['Glory', card({ types: ['Enchantment'] })],
      // Artifact-Creature: Creature wins.
      ['Walker', card({ types: ['Artifact', 'Creature'] })],
      // Planeswalker → creatures bucket.
      ['Pw', card({ types: ['Planeswalker'] })],
    ]);
    const stats = computeStats({
      mainboard: [
        entry('Bear', 4),
        entry('Pact', 4),
        entry('Mox', 2),
        entry('Glory', 3),
        entry('Walker', 1),
        entry('Pw', 1),
      ],
      commander: null,
      cards,
    });
    expect(stats.typeCounts.creatures).toBe(6); // 4 Bear + 1 Walker + 1 Pw
    expect(stats.typeCounts.artifacts).toBe(2);
    expect(stats.typeCounts.enchantments).toBe(3);
    expect(stats.typeCounts.instantsAndSorceries).toBe(4);
  });

  it('counts mana symbols per color across the deck', () => {
    const cards = new Map<string, WebCardInfo>([
      // Lightning Helix: 1 R + 1 W
      ['Helix', card({ manaCosts: ['R', 'W'] })],
      // Sphinx's Revelation: X U W W
      ['Revel', card({ manaCosts: ['X', 'U', 'W', 'W'] })],
    ]);
    const stats = computeStats({
      mainboard: [entry('Helix', 4), entry('Revel', 2)],
      commander: null,
      cards,
    });
    expect(stats.colorPipCounts.R).toBe(4);
    expect(stats.colorPipCounts.W).toBe(4 /* Helix */ + 4 /* Revel × 2 W */);
    expect(stats.colorPipCounts.U).toBe(2);
    expect(stats.colorPipCounts.B).toBe(0);
    expect(stats.colorPipCounts.G).toBe(0);
  });

  it('derives color identity from the commander when given', () => {
    const cards = new Map<string, WebCardInfo>([
      [
        'Atraxa',
        card({ types: ['Creature'], colors: ['W', 'U', 'B', 'G'] }),
      ],
    ]);
    const stats = computeStats({
      mainboard: [entry('Atraxa', 1)],
      commander: entry('Atraxa', 1),
      cards,
    });
    expect(stats.colorIdentity).toEqual(['W', 'U', 'B', 'G']);
  });

  it('derives color identity from mana symbols when no commander', () => {
    const cards = new Map<string, WebCardInfo>([
      ['Helix', card({ manaCosts: ['R', 'W'] })],
      ['Bolt', card({ manaCosts: ['R'] })],
    ]);
    const stats = computeStats({
      mainboard: [entry('Helix', 1), entry('Bolt', 1)],
      commander: null,
      cards,
    });
    expect(stats.colorIdentity).toEqual(['W', 'R']);
  });

  it('skips entries whose card is not in the cache without crashing', () => {
    const cards = new Map<string, WebCardInfo>([
      ['Known', card({ manaValue: 3, types: ['Creature'] })],
    ]);
    const stats = computeStats({
      mainboard: [entry('Known', 4), entry('UnknownCard', 60)],
      commander: null,
      cards,
    });
    // mainboardSize counts every entry's amount regardless of cache hit
    expect(stats.mainboardSize).toBe(64);
    // But curve / types only count cache-hit entries
    expect(stats.manaCurve[3]).toBe(4);
    expect(stats.typeCounts.creatures).toBe(4);
  });

  it('returns zero stats for an empty deck', () => {
    const stats = computeStats({
      mainboard: [],
      commander: null,
      cards: new Map(),
    });
    expect(stats.mainboardSize).toBe(0);
    expect(stats.manaCurve.every((n) => n === 0)).toBe(true);
    expect(stats.colorIdentity).toEqual([]);
  });
});
