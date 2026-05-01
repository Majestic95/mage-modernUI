import { describe, expect, it, vi } from 'vitest';
import {
  MANA_COLOR_TO_ENUM,
  buildOnSpendMana,
} from './manaPaymentAdapter';
import type { GameStream } from './stream';
import type { PendingDialog } from './store';

const fakeStream = () => ({
  sendObjectClick: vi.fn(),
  sendPlayerResponse: vi.fn(),
  sendChat: vi.fn(),
  sendPlayerAction: vi.fn(),
}) as unknown as GameStream & {
  sendPlayerResponse: ReturnType<typeof vi.fn>;
};

const playManaDialog: PendingDialog = {
  method: 'gamePlayMana',
  messageId: 42,
  data: {
    gameView: null,
    message: 'Pay {1}{R}',
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
      possibleBlockers: [],
      specialButton: '',
    },
  },
};

describe('manaPaymentAdapter', () => {
  it('color→enum table covers all six ManaOrb codes', () => {
    expect(Object.keys(MANA_COLOR_TO_ENUM).sort()).toEqual(
      ['B', 'C', 'G', 'R', 'U', 'W'],
    );
    expect(MANA_COLOR_TO_ENUM.W).toBe('WHITE');
    expect(MANA_COLOR_TO_ENUM.U).toBe('BLUE');
    expect(MANA_COLOR_TO_ENUM.B).toBe('BLACK');
    expect(MANA_COLOR_TO_ENUM.R).toBe('RED');
    expect(MANA_COLOR_TO_ENUM.G).toBe('GREEN');
    expect(MANA_COLOR_TO_ENUM.C).toBe('COLORLESS');
  });

  it('returns undefined when stream is null', () => {
    expect(buildOnSpendMana(null, playManaDialog)).toBeUndefined();
  });

  it('returns undefined when dialog is null', () => {
    expect(buildOnSpendMana(fakeStream(), null)).toBeUndefined();
  });

  it('returns undefined for non-mana dialog methods', () => {
    const dialog: PendingDialog = {
      ...playManaDialog,
      method: 'gameTarget',
    };
    expect(buildOnSpendMana(fakeStream(), dialog)).toBeUndefined();
  });

  it('returns a dispatcher for gamePlayMana', () => {
    expect(buildOnSpendMana(fakeStream(), playManaDialog)).toBeDefined();
  });

  it('returns a dispatcher for gamePlayXMana', () => {
    const dialog: PendingDialog = {
      ...playManaDialog,
      method: 'gamePlayXMana',
    };
    expect(buildOnSpendMana(fakeStream(), dialog)).toBeDefined();
  });

  it('dispatcher forwards messageId + correct manaType enum string', () => {
    const stream = fakeStream();
    const dispatch = buildOnSpendMana(stream, playManaDialog)!;
    dispatch('R');
    expect(stream.sendPlayerResponse).toHaveBeenCalledWith(
      42,
      'manaType',
      { manaType: 'RED' },
    );
  });

  it('dispatcher routes each ManaOrbColor to the matching upstream enum', () => {
    const stream = fakeStream();
    const dispatch = buildOnSpendMana(stream, playManaDialog)!;
    for (const color of ['W', 'U', 'B', 'R', 'G', 'C'] as const) {
      dispatch(color);
    }
    const seen = stream.sendPlayerResponse.mock.calls.map(
      (c) => (c[2] as { manaType: string }).manaType,
    );
    expect(seen).toEqual(['WHITE', 'BLUE', 'BLACK', 'RED', 'GREEN', 'COLORLESS']);
  });

  it('captures messageId at build time (engine-correlated)', () => {
    const stream = fakeStream();
    const dispatch = buildOnSpendMana(stream, {
      ...playManaDialog,
      messageId: 99,
    })!;
    dispatch('R');
    expect(stream.sendPlayerResponse).toHaveBeenCalledWith(
      99,
      'manaType',
      { manaType: 'RED' },
    );
  });
});
