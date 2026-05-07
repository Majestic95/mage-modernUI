/**
 * Tests for {@link scryfallImageUrl}, the central card-art URL builder.
 *
 * <p>Two paths exercised:
 * <ul>
 *   <li>Non-token: classic {@code /cards/<set>/<num>} endpoint.</li>
 *   <li>Token (schema 1.32): Scryfall's named-lookup endpoint with
 *       a {@code t}-prefixed set code, since most TOK-database rows
 *       have empty image-number columns and the cardNumber-based
 *       path 404s.</li>
 * </ul>
 */
import { describe, expect, it } from 'vitest';
import { scryfallImageUrl } from './scryfall';
import { webCardViewSchema, type WebCardView } from '../api/schemas';

function makeCard(overrides: Partial<WebCardView> = {}): WebCardView {
  return webCardViewSchema.parse({
    id: '11111111-1111-1111-1111-111111111111',
    cardId: '11111111-1111-1111-1111-111111111111',
    name: 'Test Card',
    displayName: 'Test Card',
    expansionSetCode: 'LEA',
    cardNumber: '161',
    manaCost: '',
    manaValue: 0,
    typeLine: 'Instant',
    supertypes: [],
    types: ['INSTANT'],
    subtypes: [],
    colors: [],
    rarity: 'COMMON',
    power: '',
    toughness: '',
    startingLoyalty: '',
    rules: [],
    faceDown: false,
    counters: {},
    transformable: false,
    transformed: false,
    secondCardFace: null,
    sourceLabel: '',
    source: null,
    isToken: false,
    ...overrides,
  });
}

describe('scryfallImageUrl — non-token path (regression-pin)', () => {
  it('builds /cards/<set>/<num> for a non-token card', () => {
    const url = scryfallImageUrl(makeCard());
    expect(url).toBe(
      'https://api.scryfall.com/cards/lea/161?format=image&version=normal',
    );
  });

  it('respects the version param', () => {
    const url = scryfallImageUrl(makeCard(), 'art_crop');
    expect(url).toBe(
      'https://api.scryfall.com/cards/lea/161?format=image&version=art_crop',
    );
  });

  it('returns null when expansionSetCode is empty', () => {
    expect(scryfallImageUrl(makeCard({ expansionSetCode: '' }))).toBeNull();
  });

  it('returns null when cardNumber is empty', () => {
    expect(scryfallImageUrl(makeCard({ cardNumber: '' }))).toBeNull();
  });
});

describe('scryfallImageUrl — token path (schema 1.32)', () => {
  it('routes tokens through /cards/named with t-prefixed set + exact name', () => {
    const url = scryfallImageUrl(
      makeCard({
        name: 'Goblin',
        expansionSetCode: 'DOM',
        // cardNumber is "0" post-FB#13 for tokens whose database row
        // has empty image-number column. Token path ignores it.
        cardNumber: '0',
        isToken: true,
      }),
    );
    expect(url).toBe(
      'https://api.scryfall.com/cards/named?exact=Goblin&set=tdom&format=image&version=normal',
    );
  });

  it('uses the version param on the token path too', () => {
    const url = scryfallImageUrl(
      makeCard({
        name: 'Goblin',
        expansionSetCode: 'DOM',
        cardNumber: '0',
        isToken: true,
      }),
      'art_crop',
    );
    expect(url).toBe(
      'https://api.scryfall.com/cards/named?exact=Goblin&set=tdom&format=image&version=art_crop',
    );
  });

  it('URL-encodes spaces in the name', () => {
    const url = scryfallImageUrl(
      makeCard({
        name: 'Karox Bladewing',
        expansionSetCode: 'DOM',
        isToken: true,
      }),
    );
    expect(url).toContain('exact=Karox%20Bladewing');
    expect(url).toContain('set=tdom');
  });

  it('handles apostrophes and commas in the name', () => {
    // Critic NIT 2026-05-08 — apostrophe + comma names appear in
    // legendary tokens. encodeURIComponent passes apostrophes through
    // unencoded per RFC 3986 (single quote is a sub-delim, not
    // reserved); spaces become %20. Scryfall's named-lookup endpoint
    // accepts both encoded and raw apostrophes, so the unencoded
    // form is the spec-correct + simpler output.
    const url = scryfallImageUrl(
      makeCard({
        name: "Saheeli's Lattice",
        expansionSetCode: 'DOM',
        isToken: true,
      }),
    );
    expect(url).toContain("exact=Saheeli's%20Lattice");
  });

  it('handles the double-t prefix for token-of-T-set codes (e.g. THB)', () => {
    // Set codes starting with T (THB, THS, TLA, etc.) must produce
    // double-t prefixed token-set codes (TTHB, TTHS, TTLA) which is
    // Scryfall's correct convention for those tokens. Verified via
    // /sets/tthb returning "Theros Beyond Death Tokens" distinct
    // from /sets/thb's "Theros Beyond Death".
    const url = scryfallImageUrl(
      makeCard({
        name: 'Goat',
        expansionSetCode: 'THB',
        isToken: true,
      }),
    );
    expect(url).toContain('set=tthb');
  });

  it('returns null for a token with empty name', () => {
    expect(
      scryfallImageUrl(
        makeCard({ name: '', expansionSetCode: 'DOM', isToken: true }),
      ),
    ).toBeNull();
  });

  it('returns null for a token with empty setCode', () => {
    expect(
      scryfallImageUrl(
        makeCard({ name: 'Goblin', expansionSetCode: '', isToken: true }),
      ),
    ).toBeNull();
  });

  it('does not require cardNumber on the token path', () => {
    // Tokens with empty image-number column on the engine side arrive
    // with cardNumber="0" or "" — the named-lookup path uses name+set,
    // so missing cardNumber is fine.
    const url = scryfallImageUrl(
      makeCard({
        name: 'Goblin',
        expansionSetCode: 'DOM',
        cardNumber: '',
        isToken: true,
      }),
    );
    expect(url).not.toBeNull();
    expect(url).toContain('exact=Goblin');
  });
});
