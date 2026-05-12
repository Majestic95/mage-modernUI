/**
 * Pure helpers + types shared by DeckEditor, DeckLane, and CardRow.
 * Extracted from DeckEditor.tsx during slice DB-0 (mechanical split
 * to drop DeckEditor.tsx below the 400 LOC soft cap before the
 * lobby-themed workbench reskin).
 */
import type { WebCardInfo, WebDeckCardInfo } from '../api/schemas';

export type Lane = 'cards' | 'sideboard';

export const TYPE_BUCKET_ORDER = [
  'Commander',
  'Creature',
  'Planeswalker',
  'Instant/Sorcery',
  'Artifact',
  'Enchantment',
  'Land',
  'Other',
] as const;
export type TypeBucket = (typeof TYPE_BUCKET_ORDER)[number];

export function bucketFor(card: WebCardInfo | null): TypeBucket {
  if (!card) return 'Other';
  // Wire types are UPPERCASE per CardInfoMapper.toDto. Normalize once.
  const types = card.types.map((t) => t.toUpperCase());
  if (types.includes('LAND')) return 'Land';
  if (types.includes('CREATURE')) return 'Creature';
  if (types.includes('PLANESWALKER')) return 'Planeswalker';
  if (types.includes('INSTANT') || types.includes('SORCERY')) {
    return 'Instant/Sorcery';
  }
  if (types.includes('ARTIFACT')) return 'Artifact';
  if (types.includes('ENCHANTMENT')) return 'Enchantment';
  return 'Other';
}

export function totalAmount(entries: WebDeckCardInfo[]): number {
  let n = 0;
  for (const e of entries) n += e.amount;
  return n;
}

export function scryfallArtCropUrl(
  setCode: string,
  cardNumber: string,
): string | null {
  if (!setCode || !cardNumber) return null;
  const set = setCode.toLowerCase();
  const num = encodeURIComponent(cardNumber);
  return `https://api.scryfall.com/cards/${set}/${num}?format=image&version=art_crop`;
}
