import { describe, expect, it } from 'vitest';
import { scanRepo, type RepoFileProvider } from './repoScanner';

const files = new Map<string, string>([
  [
    'Mage.Sets/src/mage/cards/l/LightningBolt.java',
    'package mage.cards.l;\npublic final class LightningBolt extends CardImpl {}',
  ],
  [
    'Mage.Sets/src/mage/cards/n/NonFinalCard.java',
    'package mage.cards.n;\npublic class NonFinalCard extends CardImpl {}',
  ],
  [
    'Mage.Sets/src/mage/cards/a/AbstractBase.java',
    'package mage.cards.a;\npublic abstract class AbstractBase extends CardImpl {}',
  ],
  [
    'Mage/src/main/java/mage/cards/basiclands/Plains.java',
    'package mage.cards.basiclands;\npublic final class Plains extends CardImpl {}',
  ],
  [
    'Mage.Sets/src/mage/sets/Foundations.java',
    [
      'super("Foundations", "FDN", ExpansionSet.buildDate(2024, 11, 15), SetType.EXPANSION);',
      '        cards.add(new SetCardInfo("Lightning Bolt", 123, Rarity.COMMON, mage.cards.l.LightningBolt.class));',
      '        cards.add(new SetCardInfo("Plains", "A08", Rarity.LAND, mage.cards.basiclands.Plains.class, NON_FULL_USE_VARIOUS));',
    ].join('\n'),
  ],
  [
    'Mage.Sets/src/mage/sets/EmptySet.java',
    'super("Empty Set", "EMP", ExpansionSet.buildDate(2026, 1, 1), SetType.EXPANSION);',
  ],
  [
    'Mage/src/main/resources/tokens-database.txt',
    '|TOK:FDN|Goblin||GoblinToken|',
  ],
  [
    'Mage.Client/src/main/java/org/mage/plugins/card/dl/sources/ScryfallImageSupportTokens.java',
    'put("FDN/Goblin", "https://api.scryfall.com/cards/tfdn/1/en?format=image");',
  ],
]);

const provider: RepoFileProvider = {
  async listFiles(_rootPath, relativeDir) {
    return Array.from(files.keys()).filter((path) => path.startsWith(relativeDir));
  },
  async readText(_rootPath, relativePath) {
    const text = files.get(relativePath);
    if (text === undefined) throw new Error(`Missing fixture ${relativePath}`);
    return text;
  },
};

describe('repoScanner', () => {
  it('scans card, set, token, and image metadata', async () => {
    const scan = await scanRepo('fixture', provider);
    expect(scan.cardClasses.has('LightningBolt')).toBe(true);
    expect(scan.cardClasses.has('NonFinalCard')).toBe(true);
    expect(scan.cardClasses.has('AbstractBase')).toBe(false);
    expect(scan.cardClasses.get('Plains')).toMatchObject({
      packageLetter: 'basiclands',
      classPath: 'Mage/src/main/java/mage/cards/basiclands/Plains.java',
    });
    expect(scan.setClasses.get('FDN')).toMatchObject({
      setName: 'Foundations',
      setClassName: 'Foundations',
      setPath: 'Mage.Sets/src/mage/sets/Foundations.java',
    });
    expect(scan.setClasses.get('EMP')).toMatchObject({
      setName: 'Empty Set',
      setClassName: 'EmptySet',
      setPath: 'Mage.Sets/src/mage/sets/EmptySet.java',
    });
    expect(scan.setEntries[0]).toMatchObject({
      setCode: 'FDN',
      cardName: 'Lightning Bolt',
      collectorNumber: '123',
    });
    expect(scan.setEntries[1]).toMatchObject({
      setCode: 'FDN',
      cardName: 'Plains',
      collectorNumber: 'A08',
      className: 'Plains',
    });
    expect(scan.tokenEntries[0]?.tokenName).toBe('Goblin');
    expect(scan.imageSupportEntries[0]).toMatchObject({
      setCode: 'FDN',
      name: 'Goblin',
    });
  });
});
