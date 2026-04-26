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
    schemaVersion: '1.11',
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
    const handled = useGameStore.getState().applyFrame(
      frame('chatMessage', { username: 'alice', message: 'hi', time: '', turnInfo: '', color: '', messageType: '', soundToPlay: '' }),
      null,
    );
    expect(handled).toBe(false);
  });
});
