import { describe, expect, it } from 'vitest';
import { createSetInitSnippet, createSingleCardInitSnippet } from './initSnippet';
import type { BatchSetPlan, ImportPlan, ImportedCard } from './types';

const card: ImportedCard = {
  name: 'Lightning Bolt',
  setCode: 'fdn',
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

const plan: ImportPlan = {
  card,
  identity: {
    cardName: 'LightningBolt',
    className: 'LightningBolt',
    packageLetter: 'l',
    classPath: 'Mage.Sets/src/mage/cards/l/LightningBolt.java',
  },
  classification: {
    difficulty: 'simple-stub',
    confidence: 'medium',
    reasons: [],
    issues: [],
  },
  changes: [],
  verificationCommands: [],
};

describe('initSnippet', () => {
  it('creates a single-card smoke-test snippet with basic lands and set-qualified card name', () => {
    const snippet = createSingleCardInitSnippet(plan);

    expect(snippet).toContain('[FDN-LightningBolt]');
    expect(snippet).toContain('battlefield:Human:Plains:5');
    expect(snippet).toContain('battlefield:Human:Forest:5');
    expect(snippet).toContain('hand:Human:FDN-Lightning Bolt:1');
    expect(snippet).toContain('does not prove gameplay correctness');
  });

  it('limits whole-set snippets to a small sample', () => {
    const batch: BatchSetPlan = {
      set: {
        code: 'TST',
        name: 'Test Set',
        releaseDate: '2026-01-01',
        setType: 'expansion',
        cards: Array.from({ length: 12 }, (_, index) => ({
          ...card,
          name: `Card ${index + 1}`,
          setCode: 'TST',
          collectorNumber: String(index + 1),
        })),
      },
      cardPlans: Array.from({ length: 12 }, (_, index) => ({
        ...plan,
        card: {
          ...card,
          name: `Card ${index + 1}`,
          setCode: 'TST',
          collectorNumber: String(index + 1),
        },
        classification: {
          ...plan.classification,
          difficulty: index < 2 ? 'reprint' : 'simple-stub',
        },
      })),
      summary: {
        reprints: 0,
        simpleStubs: 12,
        knownMechanics: 0,
        needsEngineWork: 0,
      },
    };

    const snippet = createSetInitSnippet(batch);

    expect(snippet).toContain('[TST-sample]');
    expect(snippet).not.toContain('hand:Human:TST-Card 1:1');
    expect(snippet).not.toContain('hand:Human:TST-Card 2:1');
    expect(snippet).toContain('hand:Human:TST-Card 11:1');
    expect(snippet).toContain('hand:Human:TST-Card 12:1');
  });

  it('keeps split-card names intact in set-qualified commands', () => {
    const snippet = createSingleCardInitSnippet({
      ...plan,
      card: {
        ...card,
        name: 'Wear // Tear',
        setCode: 'dgm',
      },
      identity: {
        ...plan.identity,
        className: 'WearTear',
      },
    });

    expect(snippet).toContain('[DGM-WearTear]');
    expect(snippet).toContain('hand:Human:DGM-Wear // Tear:1');
  });
});
