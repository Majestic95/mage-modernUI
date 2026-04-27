import { describe, expect, it } from 'vitest';
import { deriveInteractionMode } from './interactionMode';
import type { PendingDialog } from './store';

describe('deriveInteractionMode', () => {
  it('returns free when no dialog is pending', () => {
    expect(deriveInteractionMode(null)).toEqual({ kind: 'free' });
  });

  it('maps gameTarget to target mode with eligible IDs from cardsView1 + targets', () => {
    const dialog: PendingDialog = {
      method: 'gameTarget',
      messageId: 7,
      data: {
        gameView: null,
        message: 'Pick a target',
        targets: ['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'],
        cardsView1: {
          'cccccccc-cccc-cccc-cccc-cccccccccccc': {
            id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
          } as never,
        },
        min: 0,
        max: 0,
        flag: true,
        choice: null,
      },
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
      data: {
        gameView: null,
        message: 'Pick a target (optional)',
        targets: [],
        cardsView1: {},
        min: 0,
        max: 0,
        flag: false,
        choice: null,
      },
    };
    const mode = deriveInteractionMode(dialog);
    expect(mode.kind).toBe('target');
    if (mode.kind !== 'target') return;
    expect(mode.optional).toBe(true);
  });

  it('maps gameSelect "Select attackers" to declareAttackers mode', () => {
    const dialog: PendingDialog = {
      method: 'gameSelect',
      messageId: 11,
      data: {
        gameView: null,
        message: 'Select attackers',
        targets: [],
        cardsView1: {},
        min: 0,
        max: 0,
        flag: false,
        choice: null,
      },
    };
    expect(deriveInteractionMode(dialog)).toEqual({
      kind: 'declareAttackers',
      messageId: 11,
    });
  });

  it('maps gameSelect "Select blockers" to declareBlockers mode', () => {
    const dialog: PendingDialog = {
      method: 'gameSelect',
      messageId: 12,
      data: {
        gameView: null,
        message: 'Select blockers',
        targets: [],
        cardsView1: {},
        min: 0,
        max: 0,
        flag: false,
        choice: null,
      },
    };
    expect(deriveInteractionMode(dialog)).toEqual({
      kind: 'declareBlockers',
      messageId: 12,
    });
  });

  it('maps gameSelect with any other message to free mode', () => {
    const dialog: PendingDialog = {
      method: 'gameSelect',
      messageId: 13,
      data: {
        gameView: null,
        message: 'Pass priority',
        targets: [],
        cardsView1: {},
        min: 0,
        max: 0,
        flag: false,
        choice: null,
      },
    };
    expect(deriveInteractionMode(dialog)).toEqual({ kind: 'free' });
  });

  it('maps gamePlayMana to manaPay mode (isXMana=false)', () => {
    const dialog: PendingDialog = {
      method: 'gamePlayMana',
      messageId: 21,
      data: {
        gameView: null,
        message: 'Pay {1}{R}',
        targets: [],
        cardsView1: {},
        min: 0,
        max: 0,
        flag: false,
        choice: null,
      },
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
      data: {
        gameView: null,
        message: 'Pay X mana',
        targets: [],
        cardsView1: {},
        min: 0,
        max: 0,
        flag: false,
        choice: null,
      },
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
      data: {
        gameView: null,
        message: 'm',
        targets: [],
        cardsView1: {},
        min: 0,
        max: 0,
        flag: false,
        choice: null,
      },
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
