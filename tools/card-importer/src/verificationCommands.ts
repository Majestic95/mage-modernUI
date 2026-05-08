import type { BatchSetPlan, ImportPlan, ImportedCard } from './types';
import { getCardIdentity } from './xmageNaming';

export type VerificationScope = 'card' | 'set' | 'checkout';
export type VerificationCost = 'fast' | 'medium' | 'slow';

export interface VerificationCommand {
  id: string;
  label: string;
  command: string;
  scope: VerificationScope;
  cost: VerificationCost;
  description: string;
  proves: string;
  caveat: string;
}

export function createCardVerificationCommands(card: ImportedCard): VerificationCommand[] {
  const className = getCardIdentity(card.name).className;
  const setCode = normalizeSetCode(card.setCode);
  return createCardVerificationCommandsFromIdentity(card.name, className, setCode);
}

function createCardVerificationCommandsFromIdentity(
  cardName: string,
  className: string,
  setCode: string,
): VerificationCommand[] {
  return [
    {
      id: `show-card-info-${className}`,
      label: `Show generated rules text for ${cardName}`,
      command: mavenVerifyCommand('VerifyCardDataTest#test_showCardInfo', [
        ['xmage.showCardInfo', className],
      ]),
      scope: 'card',
      cost: 'fast',
      description: 'Prints XMage-generated rules text beside MTGJSON reference text without relying on stale client card DB text.',
      proves: 'The card class can be found and created, and its rendered rules text can be inspected.',
      caveat: 'Does not prove gameplay correctness for timing, targets, triggers, replacement effects, or new mechanics.',
    },
    createSetAbilityTextCommand(setCode),
    createMissingCardDataCommand(),
    createCardConstructorsCommand(),
  ];
}

export function createSetVerificationCommands(plan: BatchSetPlan): VerificationCommand[] {
  return [
    createSetAbilityTextCommand(normalizeSetCode(plan.set.code)),
    createMissingCardDataCommand(),
    createCardConstructorsCommand(),
  ];
}

export function createPlanVerificationCommands(plan: ImportPlan | BatchSetPlan): VerificationCommand[] {
  return 'cardPlans' in plan ? createSetVerificationCommands(plan) : createCardVerificationCommands(plan.card);
}

export function createVerificationCommandStrings(cardName: string, setCode: string): string[] {
  const className = getCardIdentity(cardName).className;
  return createCardVerificationCommandsFromIdentity(cardName, className, normalizeSetCode(setCode))
    .map((entry) => entry.command);
}

function createSetAbilityTextCommand(setCode: string): VerificationCommand {
  return {
    id: `verify-set-text-${setCode}`,
    label: `Check ability text for ${setCode}`,
    command: mavenVerifyCommand('VerifyCardDataTest#test_verifyCards', [
      ['xmage.tests.verifyCheckSetCodes', setCode],
      ['xmage.tests.verifyCheckOnlyText', 'true'],
    ]),
    scope: 'set',
    cost: 'medium',
    description: 'Runs XMage card verification in set-scoped text mode for the selected set code.',
    proves: 'Rendered rules text for cards in the set is compared against MTGJSON where possible.',
    caveat: 'Text matching is not a full gameplay test and can be noisy for cards with special layouts or unsupported mechanics.',
  };
}

function createMissingCardDataCommand(): VerificationCommand {
  return {
    id: 'check-missing-card-data',
    label: 'Check missing card data',
    command: mavenVerifyCommand('VerifyCardDataTest#test_checkMissingCardData', []),
    scope: 'checkout',
    cost: 'slow',
    description: 'Runs repository-wide metadata checks over XMage set/card registrations.',
    proves: 'Catches duplicate art settings, bad set/card metadata, invalid card numbers, constructor creation, and related repository checks.',
    caveat: 'This is a broad checkout health check; failures may be unrelated to the generated preview.',
  };
}

function createCardConstructorsCommand(): VerificationCommand {
  return {
    id: 'check-card-constructors',
    label: 'Check card constructors',
    command: mavenVerifyCommand('VerifyCardDataTest#test_checkCardConstructors', []),
    scope: 'checkout',
    cost: 'slow',
    description: 'Creates registered cards to catch broken constructors and invalid custom expansion codes.',
    proves: 'Registered card classes can be instantiated from their set entries.',
    caveat: 'This is repository-wide and does not prove card rules behave correctly in a game.',
  };
}

function mavenVerifyCommand(testName: string, properties: Array<[string, string]>): string {
  const args = [
    'mvn',
    '-pl',
    'Mage.Verify',
    '-am',
    'test',
    quotePowerShellProperty('surefire.failIfNoSpecifiedTests', 'false'),
    quotePowerShellProperty('test', testName),
    ...properties.map(([key, value]) => quotePowerShellProperty(key, value)),
  ];
  return args.join(' ');
}

function quotePowerShellProperty(key: string, value: string): string {
  return `"-D${key}=${value.replace(/"/g, '\\"')}"`;
}

function normalizeSetCode(setCode: string): string {
  return setCode.trim().toUpperCase();
}
