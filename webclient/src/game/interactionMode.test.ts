import { describe, expect, it } from 'vitest';
import { deriveInteractionMode } from './interactionMode';
import type { PendingDialog } from './store';
import { webGameClientMessageSchema } from '../api/schemas';

function clientData(data: Parameters<typeof webGameClientMessageSchema.parse>[0]) {
  return webGameClientMessageSchema.parse(data);
}

const CARD = {
  id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  name: 'Lightning Bolt',
  displayName: 'Lightning Bolt',
  expansionSetCode: 'LEA',
  cardNumber: '161',
  manaCost: '{R}',
  manaValue: 1,
  typeLine: 'Instant',
  supertypes: [],
  types: ['INSTANT'],
  subtypes: [],
  colors: ['R'],
  rarity: 'COMMON',
  power: '',
  toughness: '',
  startingLoyalty: '',
  rules: ['Lightning Bolt deals 3 damage to any target.'],
  faceDown: false,
  counters: {},
  transformable: false,
  transformed: false,
  secondCardFace: null,
};

describe('deriveInteractionMode', () => {
  it('returns free when no dialog is pending', () => {
    expect(deriveInteractionMode(null)).toEqual({ kind: 'free' });
  });

  it('maps gameTarget with options.isTriggerOrder=true to orderTriggers mode (slice 26)', () => {
    const dialog: PendingDialog = {
      method: 'gameTarget',
      messageId: 99,
      data: clientData({
        gameView: null,
        message: 'Pick triggered ability (goes to the stack first)',
        targets: [],
        cardsView1: {
          'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa': CARD,
          'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb': {
            ...CARD,
            id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
          },
        },
        min: 0,
        max: 0,
        flag: true,
        choice: null,
        options: {
          leftBtnText: '',
          rightBtnText: '',
          possibleAttackers: [],
          possibleBlockers: [],
          specialButton: '',
          isTriggerOrder: true,
        },
      }),
    };
    const mode = deriveInteractionMode(dialog);
    expect(mode.kind).toBe('orderTriggers');
    if (mode.kind !== 'orderTriggers') return;
    expect(mode.messageId).toBe(99);
    expect(mode.abilityIds.has('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')).toBe(true);
    expect(mode.abilityIds.has('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')).toBe(true);
  });

  it('maps gameTarget to target mode with eligible IDs from cardsView1 + targets', () => {
    const dialog: PendingDialog = {
      method: 'gameTarget',
      messageId: 7,
      data: clientData({
        gameView: null,
        message: 'Pick a target',
        targets: ['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'],
        cardsView1: {
          'cccccccc-cccc-cccc-cccc-cccccccccccc': {
            ...CARD,
            id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
          },
        },
        min: 0,
        max: 0,
        flag: true,
        choice: null,
      }),
    };
    const mode = deriveInteractionMode(dialog);
    expect(mode.kind).toBe('target');
    if (mode.kind !== 'target') return;
    expect(mode.messageId).toBe(7);
    expect(mode.eligibleIds).toContain('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    expect(mode.eligibleIds).toContain('cccccccc-cccc-cccc-cccc-cccccccccccc');
    expect(mode.optional).toBe(false); // flag=true → required → not optional
  });

  it('marks optional when gameTarget flag is false', () => {
    const dialog: PendingDialog = {
      method: 'gameTarget',
      messageId: 8,
      data: clientData({
        gameView: null,
        message: 'Pick a target (optional)',
        targets: [],
        cardsView1: {},
        min: 0,
        max: 0,
        flag: false,
        choice: null,
      }),
    };
    const mode = deriveInteractionMode(dialog);
    expect(mode.kind).toBe('target');
    if (mode.kind !== 'target') return;
    expect(mode.optional).toBe(true);
  });

  it('maps gameSelect "Select attackers" to declareAttackers (heuristic fallback)', () => {
    const dialog: PendingDialog = {
      method: 'gameSelect',
      messageId: 11,
      data: clientData({
        gameView: null,
        message: 'Select attackers',
        targets: [],
        cardsView1: {},
        min: 0,
        max: 0,
        flag: false,
        choice: null,
      }),
    };
    const mode = deriveInteractionMode(dialog);
    expect(mode.kind).toBe('declareAttackers');
    if (mode.kind !== 'declareAttackers') return;
    expect(mode.messageId).toBe(11);
    expect(mode.possibleIds?.size).toBe(0);
  });

  it('maps gameSelect "Select blockers" to declareBlockers (heuristic fallback)', () => {
    const dialog: PendingDialog = {
      method: 'gameSelect',
      messageId: 12,
      data: clientData({
        gameView: null,
        message: 'Select blockers',
        targets: [],
        cardsView1: {},
        min: 0,
        max: 0,
        flag: false,
        choice: null,
      }),
    };
    const mode = deriveInteractionMode(dialog);
    expect(mode.kind).toBe('declareBlockers');
    if (mode.kind !== 'declareBlockers') return;
    expect(mode.messageId).toBe(12);
    expect(mode.possibleIds?.size).toBe(0);
  });

  it('prefers structured POSSIBLE_ATTACKERS over message text for declareAttackers', () => {
    const dialog: PendingDialog = {
      method: 'gameSelect',
      messageId: 14,
      data: clientData({
        gameView: null,
        // Deliberately NOT the heuristic phrase — proves we read options.
        message: 'unrelated',
        targets: [],
        cardsView1: {},
        min: 0,
        max: 0,
        flag: false,
        choice: null,
        options: {
          leftBtnText: '',
          rightBtnText: '',
          possibleAttackers: [
            'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
          ],
          possibleBlockers: [],
          specialButton: '',
        },
      }),
    };
    const mode = deriveInteractionMode(dialog);
    expect(mode.kind).toBe('declareAttackers');
    if (mode.kind !== 'declareAttackers') return;
    expect(mode.possibleIds?.size).toBe(2);
    expect(mode.possibleIds?.has('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')).toBe(true);
  });

  it('prefers structured POSSIBLE_BLOCKERS over message text for declareBlockers', () => {
    const dialog: PendingDialog = {
      method: 'gameSelect',
      messageId: 15,
      data: clientData({
        gameView: null,
        message: 'unrelated',
        targets: [],
        cardsView1: {},
        min: 0,
        max: 0,
        flag: false,
        choice: null,
        options: {
          leftBtnText: '',
          rightBtnText: '',
          possibleAttackers: [],
          possibleBlockers: ['cccccccc-cccc-cccc-cccc-cccccccccccc'],
          specialButton: '',
        },
      }),
    };
    const mode = deriveInteractionMode(dialog);
    expect(mode.kind).toBe('declareBlockers');
    if (mode.kind !== 'declareBlockers') return;
    expect(mode.possibleIds?.has('cccccccc-cccc-cccc-cccc-cccccccccccc')).toBe(true);
  });

  it('maps gameSelect with any other message to free mode', () => {
    const dialog: PendingDialog = {
      method: 'gameSelect',
      messageId: 13,
      data: clientData({
        gameView: null,
        message: 'Pass priority',
        targets: [],
        cardsView1: {},
        min: 0,
        max: 0,
        flag: false,
        choice: null,
      }),
    };
    expect(deriveInteractionMode(dialog)).toEqual({ kind: 'free' });
  });

  it('maps non-combat gameSelect with cardsView1 to modal mode', () => {
    const dialog: PendingDialog = {
      method: 'gameSelect',
      messageId: 16,
      data: clientData({
        gameView: null,
        message: 'Choose a card from your library',
        targets: [],
        cardsView1: {
          'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa': {
            ...CARD,
            id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          },
        },
        min: 1,
        max: 1,
        flag: true,
        choice: null,
      }),
    };
    expect(deriveInteractionMode(dialog)).toEqual({
      kind: 'modal',
      messageId: 16,
      method: 'gameSelect',
    });
  });

  it('maps gamePlayMana to manaPay mode (isXMana=false)', () => {
    const dialog: PendingDialog = {
      method: 'gamePlayMana',
      messageId: 21,
      data: clientData({
        gameView: null,
        message: 'Pay {1}{R}',
        targets: [],
        cardsView1: {},
        min: 0,
        max: 0,
        flag: false,
        choice: null,
      }),
    };
    const mode = deriveInteractionMode(dialog);
    expect(mode).toEqual({
      kind: 'manaPay',
      messageId: 21,
      message: 'Pay {1}{R}',
      isXMana: false,
    });
  });

  it('maps gamePlayXMana to manaPay mode with isXMana=true', () => {
    const dialog: PendingDialog = {
      method: 'gamePlayXMana',
      messageId: 22,
      data: clientData({
        gameView: null,
        message: 'Pay X mana',
        targets: [],
        cardsView1: {},
        min: 0,
        max: 0,
        flag: false,
        choice: null,
      }),
    };
    const mode = deriveInteractionMode(dialog);
    expect(mode.kind).toBe('manaPay');
    if (mode.kind !== 'manaPay') return;
    expect(mode.isXMana).toBe(true);
  });

  it.each([
    'gameAsk',
    'gameSelectAmount',
    'gameChooseChoice',
    'gameInformPersonal',
    'gameError',
  ] as const)('maps %s to modal mode', (method) => {
    const dialog: PendingDialog = {
      method,
      messageId: 33,
      data: clientData({
        gameView: null,
        message: 'm',
        targets: [],
        cardsView1: {},
        min: 0,
        max: 0,
        flag: false,
        choice: null,
      }),
    };
    expect(deriveInteractionMode(dialog)).toEqual({
      kind: 'modal',
      messageId: 33,
      method,
    });
  });

  it('maps gameChooseAbility to modal mode (separate AbilityPickerView shape)', () => {
    const dialog: PendingDialog = {
      method: 'gameChooseAbility',
      messageId: 44,
      data: {
        gameView: null,
        message: 'Pick an ability',
        choices: { 'a-id': 'do thing' },
      },
    };
    expect(deriveInteractionMode(dialog)).toEqual({
      kind: 'modal',
      messageId: 44,
      method: 'gameChooseAbility',
    });
  });
});
