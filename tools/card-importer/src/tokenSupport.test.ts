import { describe, expect, it } from 'vitest';
import { createTokenAndImageChanges, detectTokenNames } from './tokenSupport';
import type { ImportedCard } from './types';

const card: ImportedCard = {
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

describe('tokenSupport', () => {
  it('detects token names from oracle text', () => {
    expect(detectTokenNames(card)).toEqual(['Goblin']);
  });

  it('creates token and image support proposals', () => {
    const changes = createTokenAndImageChanges(card);
    expect(changes).toHaveLength(2);
    expect(changes[0]?.content).toContain('|TOK:TST|Goblin||GoblinToken|');
    expect(changes[1]?.content).toContain('TODO: lookup token image URL in Scryfall token printings');
    expect(changes[1]?.content).not.toContain('api.scryfall.com/cards/t');
  });

  it('detects common plural and X-count token text', () => {
    expect(detectTokenNames({
      ...card,
      oracleText: 'Create X 1/1 white Soldier creature tokens with lifelink.',
    })).toEqual(['Soldier']);
    expect(detectTokenNames({
      ...card,
      oracleText: 'Creates a tapped 4/4 white Angel creature token with flying.',
    })).toEqual(['Angel']);
  });
});
