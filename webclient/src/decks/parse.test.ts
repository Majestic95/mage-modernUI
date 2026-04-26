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

  it('skips empty lines and comments', () => {
    const result = parseDeckText(
      [
        '// my burn deck',
        '',
        '# another comment',
        '4 Lightning Bolt',
        '',
        '20 Mountain',
      ].join('\n'),
    );
    expect(result.errors).toEqual([]);
    expect(result.cards).toHaveLength(2);
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
});
