import { extractUnmappedRulesText, getKeywordMapping } from './mechanics';
import type { GeneratedChange, ImportedCard, ImportPlan, RepoScan } from './types';
import { getCardIdentity, isCoreBasicLand, toSetClassName } from './xmageNaming';
import { classifyImport } from './classifier';
import { createTokenAndImageChanges } from './tokenSupport';
import { createVerificationCommandStrings } from './verificationCommands';

const CARD_TYPES = [
  'ARTIFACT',
  'BATTLE',
  'CONSPIRACY',
  'CREATURE',
  'ENCHANTMENT',
  'INSTANT',
  'LAND',
  'PLANESWALKER',
  'SORCERY',
  'KINDRED',
] as const;

const SUPER_TYPES = ['BASIC', 'LEGENDARY', 'SNOW', 'WORLD'] as const;

export function createSingleCardPlan(card: ImportedCard, scan: RepoScan | null): ImportPlan {
  const identity = getCardIdentity(card.name);
  const classification = classifyImport(card, scan);
  const changes: GeneratedChange[] = [
    ...(!isCoreBasicLand(card.name) && classification.difficulty !== 'reprint' ? [generateCardClassChange(card)] : []),
    generateSetEntryChange(card, scan),
    ...createTokenAndImageChanges(card),
    generateChecklistChange(card),
  ];

  return {
    card,
    identity,
    classification,
    changes,
    verificationCommands: createVerificationCommands(card.name, card.setCode),
  };
}

export function generateCardClassChange(card: ImportedCard): GeneratedChange {
  const identity = getCardIdentity(card.name);
  return {
    kind: 'card-class',
    path: identity.classPath,
    title: `${identity.className}.java`,
    content: generateCardClass(card),
    applied: false,
  };
}

export function generateSetEntryChange(card: ImportedCard, scan: RepoScan | null): GeneratedChange {
  const setEntry = scan?.setEntries.find((entry) => entry.setCode === card.setCode);
  const setClassName = setEntry?.setClassName ?? toSetClassName(card.setCode);
  return {
    kind: 'set-entry',
    path: `Mage.Sets/src/mage/sets/${setClassName}.java`,
    title: `Set entry for ${card.name}`,
    content: generateSetCardInfoLine(card),
    applied: false,
  };
}

export function generateChecklistChange(card: ImportedCard): GeneratedChange {
  const commands = createVerificationCommands(card.name, card.setCode)
    .map((command) => `- \`${command}\``)
    .join('\n');
  return {
    kind: 'checklist',
    path: `generated/${card.setCode}-${getCardIdentity(card.name).className}-checklist.md`,
    title: 'Import checklist',
    content: [
      `# ${card.name} Import Checklist`,
      '',
      '- Review generated Java for exact oracle behavior.',
      '- Confirm rules text in the deck editor or `test_showCardInfo`.',
      '- Add a focused rules test if the card has any non-keyword behavior.',
      '- Confirm image download works for the collector number.',
      '',
      '## Verification Commands',
      commands,
    ].join('\n'),
    applied: false,
  };
}

export function generateCardClass(card: ImportedCard): string {
  const identity = getCardIdentity(card.name);
  const typeParts = parseTypeLine(card.typeLine);
  const imports = new Set<string>([
    'import mage.cards.CardImpl;',
    'import mage.cards.CardSetInfo;',
    'import mage.constants.CardType;',
  ]);
  const classification = classifyImport(card, null);
  const bodyLines: string[] = [];

  if (typeParts.subTypes.length > 0) {
    imports.add('import mage.constants.SubType;');
  }
  if (typeParts.superTypes.length > 0) {
    imports.add('import mage.constants.SuperType;');
  }
  if (isIntegerString(card.power) || isIntegerString(card.toughness)) {
    imports.add('import mage.MageInt;');
  }

  const keywordLines = generateKeywordLines(card, imports);
  const cardTypes = typeParts.cardTypes.length > 0
    ? typeParts.cardTypes.map((type) => `CardType.${type}`).join(', ')
    : 'CardType.CREATURE';

  for (const superType of typeParts.superTypes) {
    bodyLines.push(`        this.supertype.add(SuperType.${superType});`);
  }
  for (const subType of typeParts.subTypes) {
    bodyLines.push(`        this.subtype.add(SubType.${subType});`);
  }
  if (isIntegerString(card.power)) {
    bodyLines.push(`        this.power = new MageInt(${card.power});`);
  } else if (card.power !== null) {
    bodyLines.push(`        // TODO: Implement dynamic or non-integer power "${card.power}".`);
  }
  if (isIntegerString(card.toughness)) {
    bodyLines.push(`        this.toughness = new MageInt(${card.toughness});`);
  } else if (card.toughness !== null) {
    bodyLines.push(`        // TODO: Implement dynamic or non-integer toughness "${card.toughness}".`);
  }
  if (isIntegerString(card.loyalty)) {
    bodyLines.push(`        this.setStartingLoyalty(${card.loyalty});`);
  } else if (card.loyalty !== null) {
    bodyLines.push(`        // TODO: Implement dynamic or non-integer loyalty "${card.loyalty}".`);
  }
  if (isIntegerString(card.defense)) {
    bodyLines.push(`        this.setStartingDefense(${card.defense});`);
  } else if (card.defense !== null) {
    bodyLines.push(`        // TODO: Implement dynamic or non-integer defense "${card.defense}".`);
  }
  bodyLines.push(...keywordLines);
  const unmapped = extractUnmappedRulesText(card.oracleText, card.keywords);
  for (const line of unmapped) {
    bodyLines.push(`        // TODO: ${line}`);
  }
  if (classification.difficulty === 'needs-engine-work') {
    bodyLines.push('        throw new UnsupportedOperationException("STUB: rules not implemented by generated preview");');
  }

  const sortedImports = Array.from(imports).sort().join('\n');
  const body = bodyLines.length > 0 ? `\n${bodyLines.join('\n')}\n` : '\n';
  const warningBlock = classification.difficulty === 'needs-engine-work'
    ? ' *\n * STUB: generated source intentionally throws until a human implements the rules.\n'
    : '';
  const deprecatedBlock = classification.difficulty === 'needs-engine-work'
    ? ' *\n * @deprecated Generated stub; remove this marker after human rules review.\n'
    : '';
  const classAnnotation = classification.difficulty === 'needs-engine-work' ? '@Deprecated\n' : '';

  return `package mage.cards.${identity.packageLetter};

import java.util.UUID;
${sortedImports}

/**
 * Generated by XMage Card Importer Workbench.
${warningBlock}${deprecatedBlock} *
 */
${classAnnotation}public final class ${identity.className} extends CardImpl {

    public ${identity.className}(UUID ownerId, CardSetInfo setInfo) {
        super(ownerId, setInfo, new CardType[]{${cardTypes}}, "${card.manaCost}");
${body}    }

    private ${identity.className}(final ${identity.className} card) {
        super(card);
    }

    @Override
    public ${identity.className} copy() {
        return new ${identity.className}(this);
    }
}
`;
}

export function generateSetCardInfoLine(card: ImportedCard): string {
  const identity = getCardIdentity(card.name);
  const number = /^\d+$/.test(card.collectorNumber)
    ? card.collectorNumber
    : `"${card.collectorNumber}"`;
  return `        cards.add(new SetCardInfo("${card.name}", ${number}, Rarity.${toRarity(card.rarity)}, mage.cards.${identity.packageLetter}.${identity.className}.class));`;
}

export function createVerificationCommands(cardName: string, setCode: string): string[] {
  return createVerificationCommandStrings(cardName, setCode);
}

function generateKeywordLines(card: ImportedCard, imports: Set<string>): string[] {
  const lines: string[] = [];
  for (const keyword of card.keywords) {
    const mapping = getKeywordMapping(keyword);
    if (!mapping) continue;
    imports.add(mapping.importLine);
    if (mapping.javaExpression.includes('ManaCostsImpl')) {
      imports.add('import mage.abilities.costs.mana.ManaCostsImpl;');
    }
    lines.push(`        // ${keyword}`);
    lines.push(`        this.addAbility(${mapping.javaExpression});`);
  }
  return lines;
}

function isIntegerString(value: string | null): value is string {
  return value !== null && /^-?\d+$/.test(value);
}

function parseTypeLine(typeLine: string): {
  cardTypes: string[];
  superTypes: string[];
  subTypes: string[];
} {
  const [left = '', right = ''] = typeLine.split('—').map((part) => part.trim());
  const leftWords = left.split(/\s+/).filter(Boolean);
  const cardTypes: string[] = [];
  const superTypes: string[] = [];
  for (const word of leftWords) {
    const normalized = normalizeEnumName(word);
    if ((CARD_TYPES as readonly string[]).includes(normalized)) {
      cardTypes.push(normalized);
    } else if ((SUPER_TYPES as readonly string[]).includes(normalized)) {
      superTypes.push(normalized);
    }
  }
  const subTypes = right
    .split(/\s+/)
    .filter(Boolean)
    .map(normalizeEnumName)
    .filter((word) => /^[A-Z][A-Z0-9_]*$/.test(word));

  return { cardTypes, superTypes, subTypes };
}

function normalizeEnumName(value: string): string {
  return value.replace(/[^A-Za-z0-9]/g, '_').replace(/_+/g, '_').toUpperCase();
}

function toRarity(rarity: string): string {
  switch (rarity.toLowerCase()) {
    case 'common':
      return 'COMMON';
    case 'uncommon':
      return 'UNCOMMON';
    case 'rare':
      return 'RARE';
    case 'mythic':
    case 'mythic rare':
      return 'MYTHIC';
    case 'bonus':
      return 'BONUS';
    case 'special':
      return 'SPECIAL';
    default:
      return 'COMMON';
  }
}
