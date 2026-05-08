import { describe, expect, it } from 'vitest';
import { createCheckoutSearchIndex, searchCardInCheckout, searchCardInSet, searchSetInCheckout } from './checkoutSearch';
import type { RepoScan } from './types';

const scan: RepoScan = {
  rootPath: 'fixture',
  cardClasses: new Map([
    ['LightningBolt', {
      cardName: 'LightningBolt',
      className: 'LightningBolt',
      packageLetter: 'l',
      classPath: 'Mage.Sets/src/mage/cards/l/LightningBolt.java',
    }],
    ['AppealAuthority', {
      cardName: 'AppealAuthority',
      className: 'AppealAuthority',
      packageLetter: 'a',
      classPath: 'Mage.Sets/src/mage/cards/a/AppealAuthority.java',
    }],
  ]),
  setClasses: new Map([
    ['FDN', {
      setCode: 'FDN',
      setName: 'Foundations',
      setClassName: 'Foundations',
      setPath: 'Mage.Sets/src/mage/sets/Foundations.java',
    }],
    ['EMP', {
      setCode: 'EMP',
      setName: 'Empty Set',
      setClassName: 'EmptySet',
      setPath: 'Mage.Sets/src/mage/sets/EmptySet.java',
    }],
  ]),
  setEntries: [
    {
      setCode: 'FDN',
      setName: 'Foundations',
      setClassName: 'Foundations',
      cardName: 'Lightning Bolt',
      collectorNumber: '123',
      rarity: 'COMMON',
      className: 'LightningBolt',
      rawLine: 'cards.add(new SetCardInfo("Lightning Bolt", 123, Rarity.COMMON, mage.cards.l.LightningBolt.class));',
    },
    {
      setCode: 'AKR',
      setName: 'Amonkhet Remastered',
      setClassName: 'AmonkhetRemastered',
      cardName: 'Appeal // Authority',
      collectorNumber: '227',
      rarity: 'UNCOMMON',
      className: 'AppealAuthority',
      rawLine: 'cards.add(new SetCardInfo("Appeal // Authority", 227, Rarity.UNCOMMON, mage.cards.a.AppealAuthority.class));',
    },
    {
      setCode: 'SLD',
      setName: 'Secret Lair Drop',
      setClassName: 'SecretLairDrop',
      cardName: 'Lightning Bolt',
      collectorNumber: '123',
      rarity: 'RARE',
      className: 'LightningBolt',
      rawLine: 'cards.add(new SetCardInfo("Lightning Bolt", 123, Rarity.RARE, mage.cards.l.LightningBolt.class, RETRO_ART));',
    },
    {
      setCode: 'SLD',
      setName: 'Secret Lair Drop',
      setClassName: 'SecretLairDrop',
      cardName: 'Lightning Bolt',
      collectorNumber: '123',
      rarity: 'RARE',
      className: 'LightningBolt',
      rawLine: 'cards.add(new SetCardInfo("Lightning Bolt", 123, Rarity.RARE, mage.cards.l.LightningBolt.class, NON_FULL_USE_VARIOUS));',
    },
    {
      setCode: 'OLD',
      setName: 'Old Set',
      setClassName: 'OldSet',
      cardName: 'Missing Elsewhere',
      collectorNumber: '7',
      rarity: 'COMMON',
      className: 'MissingElsewhere',
      rawLine: 'cards.add(new SetCardInfo("Missing Elsewhere", 7, Rarity.COMMON, mage.cards.m.MissingElsewhere.class));',
    },
  ],
  tokenEntries: [],
  imageSupportEntries: [],
};
const index = createCheckoutSearchIndex(scan);

describe('checkoutSearch', () => {
  it('finds an existing card class and its set entries', () => {
    const result = searchCardInCheckout(index, 'Lightning Bolt');
    expect(result.classExists).toBe(true);
    expect(result.classPath).toBe('Mage.Sets/src/mage/cards/l/LightningBolt.java');
    expect(result.setEntries).toHaveLength(3);
  });

  it('treats core basic lands as existing upstream classes', () => {
    const result = searchCardInCheckout(index, 'Plains');
    expect(result.classExists).toBe(true);
    expect(result.classPath).toBe('Mage/src/main/java/mage/cards/basiclands/Plains.java');
    expect(result.notes[0]).toContain('Core basic land classes');
  });

  it('finds an existing set by code', () => {
    const result = searchSetInCheckout(index, 'fdn');
    expect(result.exists).toBe(true);
    expect(result.setName).toBe('Foundations');
    expect(result.entries).toHaveLength(1);
    expect(result.uniqueCardCount).toBe(1);
  });

  it('finds an empty set class with no entries', () => {
    const result = searchSetInCheckout(index, 'EMP');
    expect(result.exists).toBe(true);
    expect(result.setName).toBe('Empty Set');
    expect(result.entries).toHaveLength(0);
    expect(result.setPath).toBe('Mage.Sets/src/mage/sets/EmptySet.java');
  });

  it('handles mixed-case set code input', () => {
    expect(searchSetInCheckout(index, 'fDn').exists).toBe(true);
  });

  it('finds split card entries by generated class name and printed name', () => {
    const result = searchCardInCheckout(index, 'Appeal // Authority');
    expect(result.classExists).toBe(true);
    expect(result.identity.className).toBe('AppealAuthority');
    expect(result.setEntries[0]?.setCode).toBe('AKR');
  });

  it('reports card and set entry exist together', () => {
    expect(searchCardInSet(index, 'Lightning Bolt', 'FDN').status).toBe('card-and-set-entry-exist');
  });

  it('reports an existing card missing from a set', () => {
    const localScan: RepoScan = {
      ...scan,
      setClasses: new Map([
        ...scan.setClasses,
        ['TST', {
          setCode: 'TST',
          setName: 'Test Set',
          setClassName: 'TestSet',
          setPath: 'Mage.Sets/src/mage/sets/TestSet.java',
        }],
      ]),
      setEntries: [
        ...scan.setEntries,
        {
          ...scan.setEntries[0]!,
          setCode: 'TST',
          setName: 'Test Set',
          setClassName: 'TestSet',
          cardName: 'Other Card',
          className: 'OtherCard',
        },
      ],
    };
    expect(searchCardInSet(createCheckoutSearchIndex(localScan), 'Lightning Bolt', 'TST').status).toBe('class-exists-missing-set-entry');
  });

  it('reports a missing card class', () => {
    expect(searchCardInSet(index, 'Not A Card', 'FDN').status).toBe('card-missing');
  });

  it('reports set exists but card class and set entry are missing when other printings exist', () => {
    expect(searchCardInSet(index, 'Missing Elsewhere', 'FDN').status)
      .toBe('set-exists-card-class-and-entry-missing');
  });

  it('handles empty and whitespace queries without false negatives', () => {
    const card = searchCardInCheckout(index, '   ');
    const set = searchSetInCheckout(index, '   ');
    const cardSet = searchCardInSet(index, '   ', 'FDN');
    expect(card.isEmptyQuery).toBe(true);
    expect(card.classExists).toBe(false);
    expect(card.notes[0]).toContain('Type a card name');
    expect(set.isEmptyQuery).toBe(true);
    expect(cardSet.status).toBe('empty-query');
  });

  it('warns when set entries reference a card without a scanned class', () => {
    const result = searchCardInCheckout(index, 'Missing Elsewhere');
    expect(result.classExists).toBe(false);
    expect(result.warnings[0]).toContain('Set entries reference this card');
  });

  it('sorts entries deterministically while preserving duplicate raw rows', () => {
    const result = searchCardInCheckout(index, 'Lightning Bolt');
    expect(result.setEntries.map((entry) => `${entry.setCode}-${entry.rawLine.includes('RETRO_ART') ? 'retro' : 'other'}`))
      .toEqual(['FDN-other', 'SLD-other', 'SLD-retro']);
  });
});
