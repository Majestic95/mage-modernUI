import { describe, expect, it } from 'vitest';
import { groupDeckTypes } from './useDeckTypes';

/**
 * Slice 72-B — pins the {@code " - "}-separator partitioning so the
 * Decks-page format picker can render optgroup-friendly buckets
 * without server-side support. The server returns a flat string
 * array; this is the client-side UX-only transformation.
 */
describe('groupDeckTypes', () => {
  it('splits Constructed / Variant Magic / Block Constructed groups', () => {
    const result = groupDeckTypes([
      'Constructed - Standard',
      'Constructed - Modern',
      'Variant Magic - Commander',
      'Variant Magic - Brawl',
      'Block Constructed - Innistrad',
      'Limited',
    ]);
    expect(result).toEqual([
      {
        label: 'Constructed',
        options: ['Constructed - Standard', 'Constructed - Modern'],
      },
      {
        label: 'Variant Magic',
        options: ['Variant Magic - Commander', 'Variant Magic - Brawl'],
      },
      {
        label: 'Block Constructed',
        options: ['Block Constructed - Innistrad'],
      },
      // Entries without the separator land in the trailing empty-label
      // bucket so the consumer can render them as a flat tail.
      { label: '', options: ['Limited'] },
    ]);
  });

  it('only splits on the FIRST " - " separator', () => {
    // Real entries: "Constructed - Old School 93/94 - Italian Rules"
    // — the second " - " is part of the option label, not a sub-group.
    const result = groupDeckTypes([
      'Constructed - Old School 93/94',
      'Constructed - Old School 93/94 - Italian Rules',
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]?.label).toBe('Constructed');
    expect(result[0]?.options).toEqual([
      'Constructed - Old School 93/94',
      'Constructed - Old School 93/94 - Italian Rules',
    ]);
  });

  it('preserves server insertion order across groups', () => {
    // Server returns deckTypes in config.xml order; group iteration
    // must preserve that. Map iteration in JS is insertion order.
    const result = groupDeckTypes([
      'Variant Magic - Commander',
      'Constructed - Standard',
      'Variant Magic - Brawl',
    ]);
    expect(result.map((g) => g.label)).toEqual(['Variant Magic', 'Constructed']);
  });

  it('empty input returns empty array', () => {
    expect(groupDeckTypes([])).toEqual([]);
  });
});
