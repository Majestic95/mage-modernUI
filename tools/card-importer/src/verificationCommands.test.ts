import { describe, expect, it } from 'vitest';
import { createCardVerificationCommands, createSetVerificationCommands } from './verificationCommands';
import type { BatchSetPlan, ImportedCard } from './types';

const lightningBolt: ImportedCard = {
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

describe('verificationCommands', () => {
  it('creates official card import verification commands with PowerShell-safe properties', () => {
    const commands = createCardVerificationCommands(lightningBolt);

    expect(commands.map((entry) => entry.label)).toEqual([
      'Show generated rules text for Lightning Bolt',
      'Check ability text for FDN',
      'Check missing card data',
      'Check card constructors',
    ]);
    expect(commands[0]?.command).toBe(
      'mvn -pl Mage.Verify -am test "-Dsurefire.failIfNoSpecifiedTests=false" "-Dtest=VerifyCardDataTest#test_showCardInfo" "-Dxmage.showCardInfo=LightningBolt"',
    );
    expect(commands[1]?.command).toContain('"-Dtest=VerifyCardDataTest#test_verifyCards"');
    expect(commands[1]?.command).toContain('"-Dxmage.tests.verifyCheckSetCodes=FDN"');
    expect(commands[1]?.command).toContain('"-Dxmage.tests.verifyCheckOnlyText=true"');
    expect(commands.map((entry) => entry.command).join('\n')).not.toContain('test_checkMissingAbilitiesText');
    expect(commands.map((entry) => entry.command).join('\n')).not.toContain('Mage.Server.WebApi');
  });

  it('creates set commands without card-specific showCardInfo leakage', () => {
    const plan: BatchSetPlan = {
      set: {
        code: 'tst',
        name: 'Test Set',
        releaseDate: '2026-01-01',
        setType: 'expansion',
        cards: [lightningBolt],
      },
      cardPlans: [],
      summary: {
        reprints: 0,
        simpleStubs: 0,
        knownMechanics: 0,
        needsEngineWork: 0,
      },
    };

    const commands = createSetVerificationCommands(plan);

    expect(commands).toHaveLength(3);
    expect(commands[0]?.command).toContain('"-Dxmage.tests.verifyCheckSetCodes=TST"');
    expect(commands.map((entry) => entry.command).join('\n')).not.toContain('xmage.showCardInfo');
  });
});
