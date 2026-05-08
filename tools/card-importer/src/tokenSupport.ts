import type { GeneratedChange, ImportedCard } from './types';
import { toXmageClassName } from './xmageNaming';

const TOKEN_CREATION_PATTERN =
  /create(?:s)? (?:a |an |one |two |three |four |five |six |seven |eight |nine |ten |X )?([^.\n]+?) tokens?/gi;

export function detectTokenNames(card: ImportedCard): string[] {
  const names = new Set<string>();
  for (const match of card.oracleText.matchAll(TOKEN_CREATION_PATTERN)) {
    const raw = match[1]?.trim();
    if (!raw) continue;
    names.add(cleanTokenName(raw));
  }
  return Array.from(names).filter(Boolean).sort();
}

export function createTokenAndImageChanges(card: ImportedCard): GeneratedChange[] {
  const tokenNames = detectTokenNames(card);
  if (tokenNames.length === 0) return [];

  const tokenRows = tokenNames
    .map((name) => `|TOK:${card.setCode}|${name}||${toXmageClassName(name)}Token|`)
    .join('\n');
  const imageRows = tokenNames
    .map((name) => `put("${card.setCode}/${name}", "TODO: lookup token image URL in Scryfall token printings");`)
    .join('\n');

  return [
    {
      kind: 'token-database',
      path: 'Mage/src/main/resources/tokens-database.txt',
      title: `Token database proposals for ${card.name}`,
      content: [
        `# Proposed token rows for ${card.name}. Review class names and image variants before applying.`,
        tokenRows,
      ].join('\n'),
      applied: false,
    },
    {
      kind: 'image-support',
      path: 'Mage.Client/src/main/java/org/mage/plugins/card/dl/sources/ScryfallImageSupportTokens.java',
      title: `Scryfall token image proposals for ${card.name}`,
      content: [
        `// Proposed token image rows for ${card.name}. Replace TODO collector numbers from Scryfall token printings.`,
        imageRows,
      ].join('\n'),
      applied: false,
    },
  ];
}

function cleanTokenName(raw: string): string {
  return raw
    .replace(/\bwith\b.*$/i, '')
    .replace(/\bnamed\b.*$/i, '')
    .replace(/\band\b.*$/i, '')
    .replace(/\b(?:tapped|attacking|legendary|artifact|enchantment|creature|white|blue|black|red|green|colorless)\b/gi, '')
    .replace(/\b\d+\/\d+\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.$/, '');
}
