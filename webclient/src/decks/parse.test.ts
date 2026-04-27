import { describe, it, expect } from 'vitest';
import { parseDeckText, totalCount } from './parse';

describe('parseDeckText', () => {
  it('parses well-formed entries', () => {
    const result = parseDeckText('4 Lightning Bolt\n4 Counterspell\n20 Island');
    expect(result.errors).toEqual([]);
    expect(result.cards).toEqual([
      { count: 4, cardName: 'Lightning Bolt' },
      { count: 4, cardName: 'Counterspell' },
      { count: 20, cardName: 'Island' },
    ]);
  });

  it('accepts the optional x after count', () => {
    const result = parseDeckText('4x Forest\n4X Mountain');
    expect(result.errors).toEqual([]);
    expect(result.cards.map((c) => c.cardName)).toEqual(['Forest', 'Mountain']);
  });

  it('skips comment-only blank lines and pre-card blanks', () => {
    // Blanks before any card line don't trigger the sideboard flip;
    // both entries land in the mainboard. Slice 33: the flip only
    // kicks in for a blank line AFTER ≥1 mainboard entry.
    const result = parseDeckText(
      [
        '// my burn deck',
        '',
        '# another comment',
        '4 Lightning Bolt',
        '20 Mountain',
      ].join('\n'),
    );
    expect(result.errors).toEqual([]);
    expect(result.cards).toHaveLength(2);
    expect(result.sideboard).toHaveLength(0);
  });

  it('reports malformed lines with line numbers', () => {
    const result = parseDeckText('garbage line\n4 Lightning Bolt\nnot-a-count Forest');
    expect(result.cards).toHaveLength(1);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]).toContain('Line 1');
    expect(result.errors[1]).toContain('Line 3');
  });

  it('rejects out-of-range counts', () => {
    const result = parseDeckText('100 Forest\n0 Mountain');
    expect(result.cards).toEqual([]);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]).toMatch(/count must be 1..99/);
  });

  it('handles cards with apostrophes and commas', () => {
    const result = parseDeckText("1 Jace, the Mind Sculptor\n4 Sword of Fire and Ice");
    expect(result.errors).toEqual([]);
    expect(result.cards[0]?.cardName).toBe('Jace, the Mind Sculptor');
    expect(result.cards[1]?.cardName).toBe('Sword of Fire and Ice');
  });

  it('handles split-card names with double slash', () => {
    const result = parseDeckText('1 Fire // Ice');
    expect(result.errors).toEqual([]);
    expect(result.cards[0]?.cardName).toBe('Fire // Ice');
  });

  it('handles CRLF line endings', () => {
    const result = parseDeckText('4 Forest\r\n4 Mountain\r\n');
    expect(result.errors).toEqual([]);
    expect(result.cards).toHaveLength(2);
  });

  it('totalCount sums counts', () => {
    expect(totalCount([])).toBe(0);
    expect(
      totalCount([
        { count: 4, cardName: 'X' },
        { count: 20, cardName: 'Y' },
      ]),
    ).toBe(24);
  });

  /* ---------- slice 33: sideboard + MTGA suffix ---------- */

  it('strips MTGA-style "(SET) NUM" trailing annotations', () => {
    const result = parseDeckText(
      [
        '4 Lightning Bolt (M21) 162',
        '4 Forest (UNF)',
        '1 Jace, the Mind Sculptor (WWK) 31',
      ].join('\n'),
    );
    expect(result.errors).toEqual([]);
    expect(result.cards.map((c) => c.cardName)).toEqual([
      'Lightning Bolt',
      'Forest',
      'Jace, the Mind Sculptor',
    ]);
  });

  it('flips to sideboard on a blank line after main entries', () => {
    const result = parseDeckText(
      [
        '4 Lightning Bolt',
        '4 Counterspell',
        '',
        '2 Negate',
        '3 Pyroblast',
      ].join('\n'),
    );
    expect(result.errors).toEqual([]);
    expect(result.cards.map((c) => c.cardName)).toEqual([
      'Lightning Bolt',
      'Counterspell',
    ]);
    expect(result.sideboard.map((c) => c.cardName)).toEqual([
      'Negate',
      'Pyroblast',
    ]);
  });

  it('flips to sideboard on an explicit Sideboard header', () => {
    const result = parseDeckText(
      [
        '4 Lightning Bolt',
        'Sideboard',
        '2 Negate',
      ].join('\n'),
    );
    expect(result.cards.map((c) => c.cardName)).toEqual(['Lightning Bolt']);
    expect(result.sideboard.map((c) => c.cardName)).toEqual(['Negate']);
  });

  it('uses only the first blank-line flip; subsequent blanks are skipped', () => {
    const result = parseDeckText(
      [
        '4 Lightning Bolt',
        '',
        '2 Negate',
        '',
        '3 Pyroblast',
      ].join('\n'),
    );
    // 2 Negate flipped to sideboard at the first blank; the second
    // blank is just a separator. 3 Pyroblast stays in sideboard.
    expect(result.cards.map((c) => c.cardName)).toEqual(['Lightning Bolt']);
    expect(result.sideboard.map((c) => c.cardName)).toEqual([
      'Negate',
      'Pyroblast',
    ]);
  });

  it('respects MTGO inline "SB:" prefix even before the section flip', () => {
    const result = parseDeckText(
      [
        '4 Lightning Bolt',
        'SB: 2 Negate',
        '4 Mountain',
      ].join('\n'),
    );
    // Only the SB-prefixed line goes to sideboard; the rest stays
    // in main.
    expect(result.cards.map((c) => c.cardName)).toEqual([
      'Lightning Bolt',
      'Mountain',
    ]);
    expect(result.sideboard.map((c) => c.cardName)).toEqual(['Negate']);
  });

  it('treats Deck / Mainboard headers as switches back to main', () => {
    const result = parseDeckText(
      [
        'Deck',
        '4 Lightning Bolt',
        'Sideboard',
        '2 Negate',
        'Mainboard',
        '4 Counterspell',
      ].join('\n'),
    );
    expect(result.cards.map((c) => c.cardName)).toEqual([
      'Lightning Bolt',
      'Counterspell',
    ]);
    expect(result.sideboard.map((c) => c.cardName)).toEqual(['Negate']);
  });
});
