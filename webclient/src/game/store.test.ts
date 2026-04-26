import { beforeEach, describe, expect, it } from 'vitest';
import {
  webCardViewSchema,
  webGameClientMessageSchema,
  webGameViewSchema,
  webPlayerViewSchema,
  webStreamFrameSchema,
} from '../api/schemas';
import { useGameStore } from './store';

const FOREST = webCardViewSchema.parse({
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Forest',
  displayName: 'Forest',
  expansionSetCode: 'M21',
  cardNumber: '281',
  manaCost: '',
  manaValue: 0,
  typeLine: 'Basic Land — Forest',
  supertypes: ['BASIC'],
  types: ['LAND'],
  subtypes: ['Forest'],
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
});

function buildGameView(turn = 1) {
  const me = webPlayerViewSchema.parse({
    playerId: '22222222-2222-2222-2222-222222222222',
    name: 'alice',
    life: 20, wins: 0, winsNeeded: 1, libraryCount: 53, handCount: 7,
    graveyard: {}, exile: {}, sideboard: {}, battlefield: {},
    manaPool: { red: 0, green: 0, blue: 0, white: 0, black: 0, colorless: 0 },
    controlled: true, isHuman: true, isActive: true, hasPriority: true,
    hasLeft: false, monarch: false, initiative: false, designationNames: [],
  });
  return webGameViewSchema.parse({
    turn,
    phase: 'PRECOMBAT_MAIN',
    step: 'PRECOMBAT_MAIN',
    activePlayerName: 'alice',
    priorityPlayerName: 'alice',
    special: false,
    rollbackTurnsAllowed: false,
    totalErrorsCount: 0,
    totalEffectsCount: 0,
    gameCycle: 0,
    myPlayerId: me.playerId,
    myHand: { [FOREST.id]: FOREST },
    stack: {},
    combat: [],
    players: [me],
  });
}

function frame(method: string, data: unknown, messageId = 1) {
  return webStreamFrameSchema.parse({
    schemaVersion: '1.13',
    method,
    messageId,
    objectId: null,
    data,
  });
}

describe('useGameStore', () => {
  beforeEach(() => {
    useGameStore.getState().reset();
  });

  it('starts in idle state with no game view', () => {
    const s = useGameStore.getState();
    expect(s.connection).toBe('idle');
    expect(s.gameView).toBeNull();
    expect(s.lastMessageId).toBe(0);
  });

  it('setConnection transitions lifecycle', () => {
    useGameStore.getState().setConnection('connecting');
    expect(useGameStore.getState().connection).toBe('connecting');
    useGameStore.getState().setConnection('open');
    expect(useGameStore.getState().connection).toBe('open');
    useGameStore.getState().setConnection('closed', 'normal');
    expect(useGameStore.getState().connection).toBe('closed');
    expect(useGameStore.getState().closeReason).toBe('normal');
  });

  it('streamHello is acknowledged but does not set gameView', () => {
    useGameStore.getState().applyFrame(
      frame('streamHello', { gameId: 'g', username: 'alice', mode: 'live' }),
      { gameId: 'g', username: 'alice', mode: 'live' },
    );
    expect(useGameStore.getState().gameView).toBeNull();
  });

  it('streamError surfaces via protocolError', () => {
    useGameStore.getState().applyFrame(
      frame('streamError', { code: 'BAD_REQUEST', message: 'oops' }),
      { code: 'BAD_REQUEST', message: 'oops' },
    );
    expect(useGameStore.getState().protocolError).toContain('BAD_REQUEST');
  });

  it('gameInit sets the initial snapshot', () => {
    const gv = buildGameView(1);
    useGameStore.getState().applyFrame(frame('gameInit', gv, 1), gv);
    expect(useGameStore.getState().gameView?.turn).toBe(1);
  });

  it('gameUpdate replaces the snapshot', () => {
    const init = buildGameView(1);
    useGameStore.getState().applyFrame(frame('gameInit', init, 1), init);
    const update = buildGameView(3);
    useGameStore.getState().applyFrame(frame('gameUpdate', update, 2), update);
    expect(useGameStore.getState().gameView?.turn).toBe(3);
  });

  it('lastMessageId tracks the largest seen messageId', () => {
    useGameStore.getState().applyFrame(
      frame('gameInit', buildGameView(), 5),
      buildGameView(),
    );
    useGameStore.getState().applyFrame(
      frame('gameUpdate', buildGameView(), 12),
      buildGameView(),
    );
    expect(useGameStore.getState().lastMessageId).toBe(12);
    // Lower messageId doesn't go backwards.
    useGameStore.getState().applyFrame(
      frame('gameUpdate', buildGameView(), 8),
      buildGameView(),
    );
    expect(useGameStore.getState().lastMessageId).toBe(12);
  });

  it('gameInform updates both lastWrapped and gameView', () => {
    const gv = buildGameView(2);
    const wrap = webGameClientMessageSchema.parse({
      gameView: gv,
      message: 'Lightning Bolt resolves',
      targets: [],
      cardsView1: {},
      min: 0,
      max: 0,
      flag: false,
      choice: null,
    });
    useGameStore.getState().applyFrame(frame('gameInform', wrap, 1), wrap);
    expect(useGameStore.getState().gameView?.turn).toBe(2);
    expect(useGameStore.getState().lastWrapped?.message).toContain('resolves');
  });

  it('gameInform with null gameView keeps the previous snapshot', () => {
    const init = buildGameView(1);
    useGameStore.getState().applyFrame(frame('gameInit', init, 1), init);
    const wrap = webGameClientMessageSchema.parse({
      gameView: null,
      message: 'text only',
      targets: [],
      cardsView1: {},
      min: 0,
      max: 0,
      flag: false,
      choice: null,
    });
    useGameStore.getState().applyFrame(frame('gameInform', wrap, 2), wrap);
    expect(useGameStore.getState().gameView?.turn).toBe(1);
    expect(useGameStore.getState().lastWrapped?.message).toBe('text only');
  });

  it('reset returns to initial state', () => {
    const gv = buildGameView(1);
    useGameStore.getState().applyFrame(frame('gameInit', gv, 1), gv);
    useGameStore.getState().setConnection('open');
    useGameStore.getState().reset();
    const s = useGameStore.getState();
    expect(s.gameView).toBeNull();
    expect(s.connection).toBe('idle');
    expect(s.lastMessageId).toBe(0);
  });

  it('unknown method returns false from applyFrame', () => {
    // chatMessage became a known method in slice 8; pick something
    // that genuinely isn't routed yet.
    const handled = useGameStore.getState().applyFrame(
      frame('replayUpdate', null),
      null,
    );
    expect(handled).toBe(false);
  });

  /* ---------- slice B: dialog frames ---------- */

  function dialogPayload(message = 'Q?') {
    return webGameClientMessageSchema.parse({
      gameView: null,
      message,
      targets: [],
      cardsView1: {},
      min: 0,
      max: 0,
      flag: false,
      choice: null,
    });
  }

  it.each([
    'gameAsk',
    'gameTarget',
    'gameSelect',
    'gamePlayMana',
    'gamePlayXMana',
    'gameSelectAmount',
    'gameChooseChoice',
    'gameInformPersonal',
    'gameError',
  ])('%s captures pendingDialog with method, messageId, and data', (method) => {
    const payload = dialogPayload(`${method} prompt`);
    useGameStore.getState().applyFrame(frame(method, payload, 99), payload);
    const pending = useGameStore.getState().pendingDialog;
    expect(pending).not.toBeNull();
    expect(pending?.method).toBe(method);
    expect(pending?.messageId).toBe(99);
    expect(pending?.data.message).toBe(`${method} prompt`);
  });

  it('gameChooseAbility captures the AbilityPickerView shape (not GameClientMessage)', () => {
    const payload = {
      gameView: null,
      message: 'Pick an ability',
      choices: { 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa': 'Activate A' },
    };
    useGameStore.getState().applyFrame(frame('gameChooseAbility', payload, 100), payload);
    const pending = useGameStore.getState().pendingDialog;
    expect(pending?.method).toBe('gameChooseAbility');
    expect(pending?.messageId).toBe(100);
    if (pending?.method === 'gameChooseAbility') {
      // Discriminated-union narrowing: data is WebAbilityPickerView here.
      expect(pending.data.message).toBe('Pick an ability');
      expect(Object.keys(pending.data.choices)).toHaveLength(1);
    }
  });

  it('a fresh gameUpdate clears any pending dialog', () => {
    const dialog = dialogPayload();
    useGameStore.getState().applyFrame(frame('gameAsk', dialog, 1), dialog);
    expect(useGameStore.getState().pendingDialog).not.toBeNull();
    const gv = buildGameView(2);
    useGameStore.getState().applyFrame(frame('gameUpdate', gv, 2), gv);
    expect(useGameStore.getState().pendingDialog).toBeNull();
  });

  it('a fresh gameOver clears any pending dialog', () => {
    const dialog = dialogPayload();
    useGameStore.getState().applyFrame(frame('gameAsk', dialog, 1), dialog);
    const wrap = webGameClientMessageSchema.parse({
      gameView: null,
      message: 'GG',
      targets: [],
      cardsView1: {},
      min: 0,
      max: 0,
      flag: false,
      choice: null,
    });
    useGameStore.getState().applyFrame(frame('gameOver', wrap, 2), wrap);
    expect(useGameStore.getState().pendingDialog).toBeNull();
  });

  it('clearDialog() removes the pending dialog without touching gameView', () => {
    const gv = buildGameView(1);
    useGameStore.getState().applyFrame(frame('gameInit', gv, 1), gv);
    const dialog = dialogPayload();
    useGameStore.getState().applyFrame(frame('gameAsk', dialog, 2), dialog);
    expect(useGameStore.getState().pendingDialog).not.toBeNull();
    useGameStore.getState().clearDialog();
    expect(useGameStore.getState().pendingDialog).toBeNull();
    expect(useGameStore.getState().gameView).not.toBeNull();
  });

  it('a new dialog while one is pending replaces the prior one', () => {
    const a = dialogPayload('first');
    const b = dialogPayload('second');
    useGameStore.getState().applyFrame(frame('gameAsk', a, 1), a);
    useGameStore.getState().applyFrame(frame('gameAsk', b, 2), b);
    expect(useGameStore.getState().pendingDialog?.data.message).toBe('second');
  });

  /* ---------- slice 8: chatMessage buffer ---------- */

  function chatPayload(message: string, username = 'alice') {
    return {
      username,
      message,
      time: '',
      turnInfo: '',
      color: '',
      messageType: 'TALK',
      soundToPlay: '',
    };
  }

  function chatFrame(chatId: string, payload: ReturnType<typeof chatPayload>, messageId = 1) {
    return webStreamFrameSchema.parse({
      schemaVersion: '1.13',
      method: 'chatMessage',
      messageId,
      objectId: chatId,
      data: payload,
    });
  }

  it('chatMessage frame appends to chatMessages keyed by chatId', () => {
    const chatId = '11111111-1111-1111-1111-111111111111';
    const payload = chatPayload('hello');
    useGameStore.getState().applyFrame(chatFrame(chatId, payload), payload);
    const buckets = useGameStore.getState().chatMessages;
    expect(buckets[chatId]).toHaveLength(1);
    expect(buckets[chatId]?.[0]?.message).toBe('hello');
  });

  it('chat from different chatIds is buffered separately', () => {
    const lobbyChat = '22222222-2222-2222-2222-222222222222';
    const gameChat = '33333333-3333-3333-3333-333333333333';
    useGameStore.getState().applyFrame(chatFrame(lobbyChat, chatPayload('lobby msg')), chatPayload('lobby msg'));
    useGameStore.getState().applyFrame(chatFrame(gameChat, chatPayload('game msg')), chatPayload('game msg'));
    const buckets = useGameStore.getState().chatMessages;
    expect(buckets[lobbyChat]?.[0]?.message).toBe('lobby msg');
    expect(buckets[gameChat]?.[0]?.message).toBe('game msg');
    expect(buckets[lobbyChat]).toHaveLength(1);
    expect(buckets[gameChat]).toHaveLength(1);
  });

  it('chatMessage with null objectId is dropped (no chatId bucket)', () => {
    const f = webStreamFrameSchema.parse({
      schemaVersion: '1.13',
      method: 'chatMessage',
      messageId: 1,
      objectId: null,
      data: chatPayload('orphan'),
    });
    useGameStore.getState().applyFrame(f, chatPayload('orphan'));
    expect(Object.keys(useGameStore.getState().chatMessages)).toHaveLength(0);
  });

  it('chatMessage history caps at 200 entries per chatId (older drop)', () => {
    const chatId = '44444444-4444-4444-4444-444444444444';
    for (let i = 0; i < 250; i++) {
      const p = chatPayload(`msg-${i}`);
      useGameStore.getState().applyFrame(chatFrame(chatId, p, i), p);
    }
    const bucket = useGameStore.getState().chatMessages[chatId] ?? [];
    expect(bucket).toHaveLength(200);
    expect(bucket[0]?.message).toBe('msg-50');
    expect(bucket[bucket.length - 1]?.message).toBe('msg-249');
  });

  it('reset clears chatMessages along with everything else', () => {
    const chatId = '55555555-5555-5555-5555-555555555555';
    useGameStore.getState().applyFrame(chatFrame(chatId, chatPayload('hi')), chatPayload('hi'));
    expect(useGameStore.getState().chatMessages[chatId]).toHaveLength(1);
    useGameStore.getState().reset();
    expect(Object.keys(useGameStore.getState().chatMessages)).toHaveLength(0);
  });
});
