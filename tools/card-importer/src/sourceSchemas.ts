import { z } from 'zod';
import type { ImportedCard, ImportedCardFace, ImportedSet } from './types';
import { normalizeCollectorNumber } from './xmageNaming';

const nullableString = z.string().nullable().optional();

export const scryfallCardFaceSchema = z.object({
  name: z.string(),
  mana_cost: z.string().optional().default(''),
  type_line: z.string().optional().default(''),
  oracle_text: z.string().optional().default(''),
  power: nullableString,
  toughness: nullableString,
  loyalty: nullableString,
  defense: nullableString,
});

export const scryfallCardSchema = z.object({
  name: z.string(),
  set: z.string(),
  collector_number: z.string(),
  rarity: z.string(),
  layout: z.string(),
  mana_cost: z.string().optional().default(''),
  type_line: z.string().optional().default(''),
  oracle_text: z.string().optional().default(''),
  power: nullableString,
  toughness: nullableString,
  loyalty: nullableString,
  defense: nullableString,
  keywords: z.array(z.string()).optional().default([]),
  reprint: z.boolean().optional().default(false),
  scryfall_uri: nullableString,
  card_faces: z.array(scryfallCardFaceSchema).optional().default([]),
});

export const scryfallSetSchema = z.object({
  code: z.string(),
  name: z.string(),
  released_at: z.string().nullable().optional().default(''),
  set_type: z.string().optional().default('unknown'),
});

export const scryfallListSchema = z.object({
  data: z.array(scryfallCardSchema),
  has_more: z.boolean().optional().default(false),
  next_page: z.string().nullable().optional(),
});

export type ScryfallCard = z.infer<typeof scryfallCardSchema>;
export type ScryfallSet = z.infer<typeof scryfallSetSchema>;
export type ScryfallList = z.infer<typeof scryfallListSchema>;

function mapFace(face: z.infer<typeof scryfallCardFaceSchema>): ImportedCardFace {
  return {
    name: face.name,
    manaCost: face.mana_cost,
    typeLine: face.type_line,
    oracleText: face.oracle_text,
    power: face.power ?? null,
    toughness: face.toughness ?? null,
    loyalty: face.loyalty ?? null,
    defense: face.defense ?? null,
  };
}

export function mapScryfallCard(raw: unknown): ImportedCard {
  const card = scryfallCardSchema.parse(raw);
  return {
    name: card.name,
    setCode: card.set.toUpperCase(),
    collectorNumber: normalizeCollectorNumber(card.collector_number),
    rarity: card.rarity,
    layout: card.layout,
    manaCost: card.mana_cost,
    typeLine: card.type_line,
    oracleText: card.oracle_text,
    power: card.power ?? null,
    toughness: card.toughness ?? null,
    loyalty: card.loyalty ?? null,
    defense: card.defense ?? null,
    faces: card.card_faces.map(mapFace),
    keywords: card.keywords,
    isReprint: card.reprint,
    scryfallUri: card.scryfall_uri ?? null,
  };
}

export function mapScryfallSet(rawSet: unknown, cards: ImportedCard[]): ImportedSet {
  const set = scryfallSetSchema.parse(rawSet);
  return {
    code: set.code.toUpperCase(),
    name: set.name,
    releaseDate: set.released_at ?? '',
    setType: set.set_type,
    cards,
  };
}
