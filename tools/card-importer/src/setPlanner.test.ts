import { describe, expect, it } from 'vitest';
import { createBatchSetPlan } from './setPlanner';
import type { ImportedCard, ImportedSet } from './types';

const tokenMaker: ImportedCard = {
  name: 'Goblin Maker',
  setCode: 'TST',
  collectorNumber: '1',
  rarity: 'uncommon',
  layout: 'normal',
  manaCost: '{1}{R}',
  typeLine: 'Sorcery',
  oracleText: 'Create two 1/1 red Goblin creature tokens.',
  power: null,
  toughness: null,
  loyalty: null,
  defense: null,
  faces: [],
  keywords: [],
  isReprint: false,
  scryfallUri: null,
};

describe('setPlanner', () => {
  it('includes token proposals in batch card plans', () => {
    const set: ImportedSet = {
      code: 'TST',
      name: 'Test Set',
      releaseDate: '2026-01-01',
      setType: 'expansion',
      cards: [tokenMaker],
    };
    const plan = createBatchSetPlan(set, null);
    expect(plan.cardPlans[0]?.changes.some((change) => change.kind === 'token-database')).toBe(true);
    expect(plan.cardPlans[0]?.changes.some((change) => change.kind === 'image-support')).toBe(true);
  });
});
