import { describe, expect, it } from 'vitest';
import { createSetCompletionReport } from './setCompletion';
import type { BatchSetPlan, ImportPlan, ImportedCard, RepoScan } from './types';

const baseCard: ImportedCard = {
  name: 'Existing Card',
  setCode: 'TST',
  collectorNumber: '1',
  rarity: 'common',
  layout: 'normal',
  manaCost: '{G}',
  typeLine: 'Creature — Bear',
  oracleText: '',
  power: '2',
  toughness: '2',
  loyalty: null,
  defense: null,
  faces: [],
  keywords: [],
  isReprint: false,
  scryfallUri: null,
};

function planFor(card: ImportedCard, changes: ImportPlan['changes'], difficulty: ImportPlan['classification']['difficulty'] = 'simple-stub'): ImportPlan {
  return {
    card,
    identity: {
      cardName: card.name.replace(/\s+/g, ''),
      className: card.name.replace(/\s+/g, ''),
      packageLetter: card.name[0]?.toLowerCase() ?? 'x',
      classPath: `Mage.Sets/src/mage/cards/e/${card.name.replace(/\s+/g, '')}.java`,
    },
    classification: {
      difficulty,
      confidence: 'medium',
      reasons: [],
      issues: [],
    },
    changes,
    verificationCommands: [],
  };
}

describe('setCompletion', () => {
  it('summarizes present entries, missing classes, proposals, and warnings', () => {
    const existingCard = planFor(baseCard, [], 'reprint');
    const missingCard = planFor({
      ...baseCard,
      name: 'Missing Class',
      collectorNumber: '2',
    }, [
      {
        kind: 'card-class',
        path: 'Mage.Sets/src/mage/cards/m/MissingClass.java',
        title: 'MissingClass.java',
        content: '',
        applied: false,
      },
      {
        kind: 'set-entry',
        path: 'Mage.Sets/src/mage/sets/TestSet.java',
        title: 'Set entry',
        content: '',
        applied: false,
      },
      {
        kind: 'token-database',
        path: 'Mage/src/main/resources/tokens-database.txt',
        title: 'Token proposal',
        content: '',
        applied: false,
      },
      {
        kind: 'image-support',
        path: 'Mage.Client/src/main/java/org/mage/plugins/card/dl/sources/ScryfallImageSupportTokens.java',
        title: 'Image proposal',
        content: '',
        applied: false,
      },
    ], 'needs-engine-work');
    const batch: BatchSetPlan = {
      set: {
        code: 'TST',
        name: 'Test Set',
        releaseDate: '2026-01-01',
        setType: 'expansion',
        cards: [baseCard],
      },
      cardPlans: [
        existingCard,
        missingCard,
      ],
      summary: {
        reprints: 1,
        simpleStubs: 0,
        knownMechanics: 0,
        needsEngineWork: 1,
      },
    };
    const scan: RepoScan = {
      rootPath: 'fixture',
      cardClasses: new Map([
        [existingCard.identity.className, existingCard.identity],
      ]),
      setClasses: new Map(),
      setEntries: [
        {
          setCode: 'tst',
          setName: 'Test Set',
          setClassName: 'TestSet',
          cardName: 'Existing Card',
          collectorNumber: '1',
          rarity: 'COMMON',
          className: existingCard.identity.className,
          rawLine: 'cards.add(new SetCardInfo("Existing Card", 1, Rarity.COMMON, mage.cards.e.ExistingCard.class));',
        },
      ],
      tokenEntries: [],
      imageSupportEntries: [],
    };

    const report = createSetCompletionReport(batch, scan);

    expect(report.summary.totalCards).toBe(2);
    expect(report.summary.presentSetEntries).toBe(1);
    expect(report.summary.missingSetEntries).toBe(1);
    expect(report.summary.missingCardClasses).toBe(1);
    expect(report.summary.tokenProposalCards).toBe(1);
    expect(report.summary.imageProposalCards).toBe(1);
    expect(report.summary.warnings).toContain('Token and image counts are generated proposals, not verified missing database rows.');
    expect(report.rows[1]).toMatchObject({
      cardName: 'Missing Class',
      hasSetEntry: false,
      hasCardClass: false,
      hasTokenProposal: true,
    });
  });

  it('treats core basic lands as existing classes while still checking set entry presence', () => {
    const plainsCard: ImportedCard = {
      ...baseCard,
      name: 'Plains',
      collectorNumber: '301',
      rarity: 'land',
      manaCost: '',
      typeLine: 'Basic Land — Plains',
    };
    const batch: BatchSetPlan = {
      set: {
        code: 'TST',
        name: 'Test Set',
        releaseDate: '2026-01-01',
        setType: 'expansion',
        cards: [plainsCard],
      },
      cardPlans: [planFor(plainsCard, [], 'needs-engine-work')],
      summary: {
        reprints: 0,
        simpleStubs: 0,
        knownMechanics: 0,
        needsEngineWork: 1,
      },
    };

    const report = createSetCompletionReport(batch, null);

    expect(report.rows[0]).toMatchObject({
      cardName: 'Plains',
      hasCardClass: true,
      hasSetEntry: false,
    });
  });
});
