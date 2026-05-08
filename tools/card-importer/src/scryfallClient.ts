import type { ImportedCard, ImportedSet } from './types';
import {
  mapScryfallCard,
  mapScryfallSet,
  scryfallListSchema,
  scryfallSetSchema,
} from './sourceSchemas';

const SCRYFALL_API = 'https://api.scryfall.com';
const SCRYFALL_USER_AGENT = 'XMage Card Importer Workbench (https://github.com/Majestic95/mage-modernUI)';
const SCRYFALL_PAGE_DELAY_MS = 100;

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': SCRYFALL_USER_AGENT,
    },
  });
  if (!response.ok) {
    throw new Error(`Scryfall request failed (${response.status}): ${response.statusText}`);
  }
  return response.json() as Promise<unknown>;
}

export async function fetchCardByName(cardName: string, setCode?: string): Promise<ImportedCard> {
  const query = setCode
    ? `!"${cardName}" set:${setCode.toLowerCase()}`
    : `!"${cardName}"`;
  const url = `${SCRYFALL_API}/cards/search?q=${encodeURIComponent(query)}&unique=prints`;
  const raw = await fetchJson(url);
  const list = scryfallListSchema.parse(raw);
  const first = list.data[0];
  if (!first) {
    throw new Error(`No Scryfall card found for ${cardName}.`);
  }
  return mapScryfallCard(first);
}

export async function fetchSetByCode(setCode: string): Promise<ImportedSet> {
  const code = setCode.toLowerCase();
  const rawSet = await fetchJson(`${SCRYFALL_API}/sets/${code}`);
  const set = scryfallSetSchema.parse(rawSet);
  const cards = await fetchAllCardsForSet(code);
  return mapScryfallSet(set, cards);
}

async function fetchAllCardsForSet(code: string): Promise<ImportedCard[]> {
  const cards: ImportedCard[] = [];
  let nextUrl: string | null = `${SCRYFALL_API}/cards/search?q=${encodeURIComponent(`set:${code}`)}&unique=prints&order=set`;

  while (nextUrl !== null) {
    const rawCards = await fetchJson(nextUrl);
    const list = scryfallListSchema.parse(rawCards);
    cards.push(...list.data.map(mapScryfallCard));
    nextUrl = list.has_more ? (list.next_page ?? null) : null;
    if (nextUrl !== null) {
      await delay(SCRYFALL_PAGE_DELAY_MS);
    }
  }

  return cards;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
