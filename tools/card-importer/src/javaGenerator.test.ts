import { describe, expect, it } from 'vitest';
import { createSingleCardPlan, createVerificationCommands, generateCardClass, generateSetCardInfoLine } from './javaGenerator';
import type { ImportedCard, RepoScan } from './types';

const lightningBolt: ImportedCard = {
  name: 'Lightning Bolt',
  setCode: 'FDN',
  collectorNumber: '123',
  rarity: 'common',
  layout: 'normal',
  manaCost: '{R}',
  typeLine: 'Instant',
  oracleText: 'Lightning Bolt deals 3 damage to any target.',
  power: null,
  toughness: null,
  loyalty: null,
  defense: null,
  faces: [],
  keywords: [],
  isReprint: false,
  scryfallUri: null,
};

describe('javaGenerator', () => {
  it('generates card class skeletons', () => {
    const java = generateCardClass(lightningBolt);
    expect(java).toContain('public final class LightningBolt extends CardImpl');
    expect(java).toContain('new CardType[]{CardType.INSTANT}');
    expect(java).toContain('"{R}"');
    expect(java).toContain('// TODO: Lightning Bolt deals 3 damage to any target.');
  });

  it('generates set entries', () => {
    expect(generateSetCardInfoLine(lightningBolt)).toBe(
      '        cards.add(new SetCardInfo("Lightning Bolt", 123, Rarity.COMMON, mage.cards.l.LightningBolt.class));',
    );
  });

  it('classifies existing classes as reprints', () => {
    const scan: RepoScan = {
      rootPath: 'fixture',
      cardClasses: new Map([
        ['LightningBolt', {
          cardName: 'LightningBolt',
          className: 'LightningBolt',
          packageLetter: 'l',
          classPath: 'Mage.Sets/src/mage/cards/l/LightningBolt.java',
        }],
      ]),
      setClasses: new Map(),
      setEntries: [],
      tokenEntries: [],
      imageSupportEntries: [],
    };
    expect(createSingleCardPlan(lightningBolt, scan).classification.difficulty).toBe('reprint');
  });

  it('does not generate duplicate card classes for reprints', () => {
    const scan: RepoScan = {
      rootPath: 'fixture',
      cardClasses: new Map([
        ['LightningBolt', {
          cardName: 'LightningBolt',
          className: 'LightningBolt',
          packageLetter: 'l',
          classPath: 'Mage.Sets/src/mage/cards/l/LightningBolt.java',
        }],
      ]),
      setClasses: new Map(),
      setEntries: [],
      tokenEntries: [],
      imageSupportEntries: [],
    };
    expect(createSingleCardPlan(lightningBolt, scan).changes.some((change) => change.kind === 'card-class')).toBe(false);
  });

  it('marks parameterized keyword cards as blocking stubs instead of guessing values', () => {
    const card: ImportedCard = {
      ...lightningBolt,
      name: 'Ward Beast',
      typeLine: 'Creature — Beast',
      oracleText: 'Ward {3}',
      power: '2',
      toughness: '2',
      keywords: ['Ward'],
    };
    const plan = createSingleCardPlan(card, null);
    const java = generateCardClass(card);
    expect(plan.classification.difficulty).toBe('needs-engine-work');
    expect(plan.classification.issues.some((issue) => issue.title === 'Parameterized keyword mechanics')).toBe(true);
    expect(java).not.toContain('new WardAbility');
    expect(java).toContain('throw new UnsupportedOperationException("STUB: rules not implemented by generated preview");');
  });

  it('does not emit invalid MageInt expressions for dynamic stats', () => {
    const card: ImportedCard = {
      ...lightningBolt,
      name: 'Star Beast',
      typeLine: 'Creature — Beast',
      oracleText: '',
      power: '*',
      toughness: '1+*',
    };
    const java = generateCardClass(card);
    expect(java).toContain('TODO: Implement dynamic or non-integer power "*"');
    expect(java).toContain('TODO: Implement dynamic or non-integer toughness "1+*"');
    expect(java).not.toContain('new MageInt(*)');
  });

  it('drops TODO lines for comma-separated simple keywords already generated', () => {
    const card: ImportedCard = {
      ...lightningBolt,
      name: 'Keyword Angel',
      typeLine: 'Creature — Angel',
      oracleText: 'Flying, vigilance, lifelink.',
      power: '4',
      toughness: '4',
      keywords: ['Flying', 'Vigilance', 'Lifelink'],
    };
    const java = generateCardClass(card);
    expect(java).toContain('FlyingAbility.getInstance()');
    expect(java).not.toContain('// TODO: Flying, vigilance, lifelink.');
  });

  it('only generates set entries for core basic lands', () => {
    const plan = createSingleCardPlan({
      ...lightningBolt,
      name: 'Plains',
      rarity: 'land',
      manaCost: '',
      typeLine: 'Basic Land — Plains',
      oracleText: '',
    }, null);
    expect(plan.classification.difficulty).toBe('needs-engine-work');
    expect(plan.changes.some((change) => change.kind === 'card-class')).toBe(false);
    expect(plan.changes.some((change) => change.kind === 'set-entry')).toBe(true);
  });

  it('uses the official Mage.Verify command set in generated checklists', () => {
    const commands = createVerificationCommands('Lightning Bolt', 'FDN').join('\n');

    expect(commands).toContain('VerifyCardDataTest#test_showCardInfo');
    expect(commands).toContain('VerifyCardDataTest#test_verifyCards');
    expect(commands).toContain('VerifyCardDataTest#test_checkMissingCardData');
    expect(commands).toContain('VerifyCardDataTest#test_checkCardConstructors');
    expect(commands).toContain('"-Dxmage.tests.verifyCheckOnlyText=true"');
    expect(commands).not.toContain('test_checkMissingAbilitiesText');
    expect(commands).not.toContain('Mage.Server.WebApi');
  });
});
