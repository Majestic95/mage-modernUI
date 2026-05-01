import { describe, expect, it } from 'vitest';
import {
  bucketBattlefield,
  classifyPermanent,
  groupWithAttachments,
  rowOrder,
} from './battlefieldRows';
import type { WebPermanentView } from '../api/schemas';

/**
 * Slice 53 / 70-Z.1 — classifier coverage. Every battlefield permanent
 * renders into exactly one of three rows; getting the bucket wrong
 * means a card visibly appears in the wrong row.
 *
 * <p>Slice 70-Z.1 reshaped the buckets — `other` was renamed to
 * `artifacts`, planeswalkers moved from `other` → `creatures`, and
 * the artifacts bucket became the default for any unknown type.
 */

function permWithTypes(types: string[]): WebPermanentView {
  return {
    card: {
      id: 'card-id',
      cardId: 'card-id',
      name: 'Test',
      displayName: 'Test',
      expansionSetCode: 'TEST',
      cardNumber: '1',
      manaCost: '',
      manaValue: 0,
      typeLine: '',
      supertypes: [],
      types,
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
    },
    controllerName: 'alice',
    tapped: false,
    flipped: false,
    transformed: false,
    phasedIn: true,
    summoningSickness: false,
    damage: 0,
    attachments: [],
    attachedTo: '',
    attachedToPermanent: false,
  };
}

describe('classifyPermanent', () => {
  it.each([
    [['CREATURE'], 'creatures'],
    [['LAND'], 'lands'],
    [['ARTIFACT'], 'artifacts'],
    [['ENCHANTMENT'], 'artifacts'],
    // Slice 70-Z.1 — planeswalkers moved to the creatures lane
    // (battle participants read together).
    [['PLANESWALKER'], 'creatures'],
    [['BATTLE'], 'artifacts'],
    // Animated land — creature precedence wins.
    [['LAND', 'CREATURE'], 'creatures'],
    // Land artifact (treasure-like). Not a "pure" land; routes to
    // artifacts. Dominant non-land type wins lands-row placement.
    [['LAND', 'ARTIFACT'], 'artifacts'],
    // Land enchantment (e.g. Urza's Saga in some printings).
    [['LAND', 'ENCHANTMENT'], 'artifacts'],
    // Artifact creature is a creature.
    [['ARTIFACT', 'CREATURE'], 'creatures'],
    // Enchantment creature (god-eternal-style) is a creature.
    [['ENCHANTMENT', 'CREATURE'], 'creatures'],
    // Slice 70-Z.1 — unknown type falls through to the artifacts
    // bucket as the default (user direction: "any question about
    // a card type, it would, by default, go into the artifact
    // zone"). Defends against future engine type introductions.
    [['SOME_FUTURE_TYPE'], 'artifacts'],
    [[], 'artifacts'],
  ] as const)(
    'types=%j → row=%s',
    (types, expected) => {
      expect(classifyPermanent(permWithTypes([...types]))).toBe(expected);
    },
  );
});

describe('bucketBattlefield', () => {
  it('preserves insertion order within each bucket', () => {
    const a = permWithTypes(['CREATURE']);
    a.card = { ...a.card, name: 'CreatureA' };
    const b = permWithTypes(['CREATURE']);
    b.card = { ...b.card, name: 'CreatureB' };
    const c = permWithTypes(['LAND']);
    c.card = { ...c.card, name: 'LandC' };
    const buckets = bucketBattlefield([a, b, c]);
    expect(buckets.creatures.map((p) => p.card.name)).toEqual([
      'CreatureA',
      'CreatureB',
    ]);
    expect(buckets.lands.map((p) => p.card.name)).toEqual(['LandC']);
    expect(buckets.artifacts).toEqual([]);
  });

  it('returns empty arrays for empty input', () => {
    const buckets = bucketBattlefield([]);
    expect(buckets.creatures).toEqual([]);
    expect(buckets.artifacts).toEqual([]);
    expect(buckets.lands).toEqual([]);
  });

  it('routes planeswalker + creature mixed board correctly', () => {
    // Slice 70-Z.1 — both creatures and planeswalkers cluster in
    // the creatures lane. Order preserved per insertion.
    const c1 = permWithTypes(['CREATURE']);
    c1.card = { ...c1.card, name: 'BearCub' };
    const pw = permWithTypes(['PLANESWALKER']);
    pw.card = { ...pw.card, name: 'Liliana' };
    const c2 = permWithTypes(['CREATURE']);
    c2.card = { ...c2.card, name: 'Wolverine' };
    const a = permWithTypes(['ARTIFACT']);
    a.card = { ...a.card, name: 'SolRing' };
    const buckets = bucketBattlefield([c1, pw, c2, a]);
    expect(buckets.creatures.map((p) => p.card.name)).toEqual([
      'BearCub',
      'Liliana',
      'Wolverine',
    ]);
    expect(buckets.artifacts.map((p) => p.card.name)).toEqual(['SolRing']);
  });
});

describe('rowOrder', () => {
  it('puts lands at bottom for self (creatures face the focal zone)', () => {
    // Slice 70-Z.1 — main rows are creatures + lands only;
    // artifacts render as a SIDE box (positioned per pod by
    // PlayerArea). rowOrder no longer includes 'artifacts'.
    expect(rowOrder('self')).toEqual(['creatures', 'lands']);
  });

  it('puts lands at top for opponent (mirror)', () => {
    expect(rowOrder('opponent')).toEqual(['lands', 'creatures']);
  });
});

/* ---------- Slice 70-Y / Bug 3: attachment co-location ---------- */

function permWithIdAndTypes(
  id: string,
  types: string[],
  attachedTo = '',
): WebPermanentView {
  const p = permWithTypes(types);
  p.card = { ...p.card, id, cardId: id, name: `Perm-${id}` };
  p.attachedTo = attachedTo;
  return p;
}

describe('bucketBattlefield — attachment co-location (Bug 3)', () => {
  it('places an aura in the host creature row, not the artifacts row', () => {
    const creature = permWithIdAndTypes('host-1', ['CREATURE']);
    const aura = permWithIdAndTypes('aura-1', ['ENCHANTMENT'], 'host-1');
    const buckets = bucketBattlefield([creature, aura]);
    expect(buckets.creatures.map((p) => p.card.id)).toEqual([
      'host-1',
      'aura-1',
    ]);
    expect(buckets.artifacts).toEqual([]);
  });

  it('places equipment in the host creature row', () => {
    const creature = permWithIdAndTypes('host-2', ['CREATURE']);
    const equip = permWithIdAndTypes('equip-1', ['ARTIFACT'], 'host-2');
    const buckets = bucketBattlefield([creature, equip]);
    expect(buckets.creatures.map((p) => p.card.id)).toEqual([
      'host-2',
      'equip-1',
    ]);
    expect(buckets.artifacts).toEqual([]);
  });

  it('falls back to the perm own row when host is absent (cross-controller / mid-resolve)', () => {
    const aura = permWithIdAndTypes('aura-2', ['ENCHANTMENT'], 'gone-host');
    const buckets = bucketBattlefield([aura]);
    expect(buckets.artifacts.map((p) => p.card.id)).toEqual(['aura-2']);
    expect(buckets.creatures).toEqual([]);
  });

  it('multiple auras on one host all join the host row', () => {
    const creature = permWithIdAndTypes('host-3', ['CREATURE']);
    const aura1 = permWithIdAndTypes('aura-3a', ['ENCHANTMENT'], 'host-3');
    const aura2 = permWithIdAndTypes('aura-3b', ['ENCHANTMENT'], 'host-3');
    const buckets = bucketBattlefield([creature, aura1, aura2]);
    expect(buckets.creatures.map((p) => p.card.id)).toEqual([
      'host-3',
      'aura-3a',
      'aura-3b',
    ]);
  });
});

describe('groupWithAttachments', () => {
  it('returns each non-attached perm as a host with empty attachments', () => {
    const a = permWithIdAndTypes('a', ['CREATURE']);
    const b = permWithIdAndTypes('b', ['CREATURE']);
    const groups = groupWithAttachments([a, b]);
    expect(groups).toHaveLength(2);
    expect(groups[0].host.card.id).toBe('a');
    expect(groups[0].attachments).toEqual([]);
    expect(groups[1].host.card.id).toBe('b');
    expect(groups[1].attachments).toEqual([]);
  });

  it('groups attachments under their host within the row', () => {
    const host = permWithIdAndTypes('host', ['CREATURE']);
    const aura = permWithIdAndTypes('aura', ['ENCHANTMENT'], 'host');
    const groups = groupWithAttachments([host, aura]);
    expect(groups).toHaveLength(1);
    expect(groups[0].host.card.id).toBe('host');
    expect(groups[0].attachments.map((a) => a.card.id)).toEqual(['aura']);
  });

  it('preserves attachment order across multiple attachments on one host', () => {
    const host = permWithIdAndTypes('host', ['CREATURE']);
    const a1 = permWithIdAndTypes('a1', ['ENCHANTMENT'], 'host');
    const a2 = permWithIdAndTypes('a2', ['ENCHANTMENT'], 'host');
    const a3 = permWithIdAndTypes('a3', ['ENCHANTMENT'], 'host');
    const groups = groupWithAttachments([host, a1, a2, a3]);
    expect(groups).toHaveLength(1);
    expect(groups[0].attachments.map((a) => a.card.id)).toEqual([
      'a1',
      'a2',
      'a3',
    ]);
  });

  it('treats a perm whose host is NOT in this row as a standalone', () => {
    // Cross-row case (e.g. host moved between rows mid-frame). The
    // attachment renders standalone rather than disappearing.
    const aura = permWithIdAndTypes('aura', ['ENCHANTMENT'], 'absent-host');
    const groups = groupWithAttachments([aura]);
    expect(groups).toHaveLength(1);
    expect(groups[0].host.card.id).toBe('aura');
    expect(groups[0].attachments).toEqual([]);
  });

  it('handles multiple hosts with their own attachments interleaved', () => {
    const h1 = permWithIdAndTypes('h1', ['CREATURE']);
    const h2 = permWithIdAndTypes('h2', ['CREATURE']);
    const a1 = permWithIdAndTypes('a1', ['ENCHANTMENT'], 'h1');
    const a2 = permWithIdAndTypes('a2', ['ENCHANTMENT'], 'h2');
    const groups = groupWithAttachments([h1, a1, h2, a2]);
    expect(groups).toHaveLength(2);
    expect(groups[0].host.card.id).toBe('h1');
    expect(groups[0].attachments.map((a) => a.card.id)).toEqual(['a1']);
    expect(groups[1].host.card.id).toBe('h2');
    expect(groups[1].attachments.map((a) => a.card.id)).toEqual(['a2']);
  });
});
