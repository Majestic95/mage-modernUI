import { beforeEach, describe, expect, it, vi } from 'vitest';
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
    schemaVersion: '1.15',
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

  it('a fresh gameUpdate preserves pendingDialog (slice 16: combat informs mid-flow)', () => {
    // Slice 16 reversal of prior behavior. Combat fires gameUpdate
    // frames between declare-attackers toggles; clearing the dialog
    // on update would lose the "Select attackers" prompt. Trust the
    // engine's next dialog frame (or explicit clearDialog from a
    // commit handler) to manage the prompt lifetime.
    const dialog = dialogPayload();
    useGameStore.getState().applyFrame(frame('gameAsk', dialog, 1), dialog);
    expect(useGameStore.getState().pendingDialog).not.toBeNull();
    const gv = buildGameView(2);
    useGameStore.getState().applyFrame(frame('gameUpdate', gv, 2), gv);
    expect(useGameStore.getState().pendingDialog).not.toBeNull();
    expect(useGameStore.getState().gameView?.turn).toBe(2);
  });

  it('a fresh gameOver preserves pendingDialog (banner overlays stale dialog)', () => {
    // Slice 16: gameOver no longer nukes pendingDialog. The banner
    // (slice B5, planned) renders over whatever was on screen.
    // reset() handles cleanup when the user clicks Leave.
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
    expect(useGameStore.getState().pendingDialog).not.toBeNull();
    expect(useGameStore.getState().lastWrapped?.message).toBe('GG');
  });

  /* ---------- slice 69d: dialogClear consumer (ADR 0010 v2 D11b) ---------- */

  function dialogPayloadWithTargets(targets: string[], message = 'Choose target') {
    return webGameClientMessageSchema.parse({
      gameView: null,
      message,
      targets,
      cardsView1: {},
      min: 0,
      max: 1,
      flag: false,
      choice: null,
    });
  }

  it('dialogClear dismisses an open dialog whose targets include the leaver', () => {
    // Canonical ADR D11(b) flow. 4p FFA: alice has cast Council's
    // Judgment naming bob/carol/dave as targets. Carol concedes
    // mid-vote. Engine skips her server-side; the synthetic
    // dialogClear announces this so alice's modal goes away
    // (otherwise stuck on "waiting for carol's vote").
    const bob = 'aaaaaaaa-1111-1111-1111-111111111111';
    const carol = 'bbbbbbbb-2222-2222-2222-222222222222';
    const dave = 'cccccccc-3333-3333-3333-333333333333';
    const dialog = dialogPayloadWithTargets([bob, carol, dave]);
    useGameStore.getState().applyFrame(frame('gameTarget', dialog, 50), dialog);
    expect(useGameStore.getState().pendingDialog).not.toBeNull();

    const clear = { playerId: carol, reason: 'PLAYER_LEFT' };
    useGameStore.getState().applyFrame(frame('dialogClear', clear, 51), clear);
    expect(useGameStore.getState().pendingDialog).toBeNull();
  });

  // Slice 70-X.13 (Wave 3) — server/client semantic agreement. The
  // server's broadcastDialogClearToGame fires ONLY on player-leave,
  // never speculatively, so the client's narrow "leaver in targets"
  // gate was missing yes/no gameAsk dialogs (e.g. multi-player vote
  // prompts with no targets array) where the leaver was the responder
  // but not a target. Pre-Wave-3 those dialogs hung indefinitely.
  // Wave-3 widens the client to clear ANY non-gameChooseAbility
  // dialog when dialogClear arrives — the engine re-fires if a fresh
  // prompt is needed, and a one-frame stutter beats a permanent stuck
  // modal.
  it('dialogClear clears any non-gameChooseAbility dialog (widened in Wave 3)', () => {
    const bob = 'aaaaaaaa-1111-1111-1111-111111111111';
    const carol = 'bbbbbbbb-2222-2222-2222-222222222222';
    const dave = 'cccccccc-3333-3333-3333-333333333333';
    // The dialog's targets do NOT include carol — but the server-
    // side broadcast contract is "this is a stale-prompt signal,"
    // not "your specific targets are gone." So the client clears.
    const dialog = dialogPayloadWithTargets([bob, dave]);
    useGameStore.getState().applyFrame(frame('gameTarget', dialog, 60), dialog);
    expect(useGameStore.getState().pendingDialog).not.toBeNull();

    const clear = { playerId: carol, reason: 'PLAYER_LEFT' };
    useGameStore.getState().applyFrame(frame('dialogClear', clear, 61), clear);
    expect(useGameStore.getState().pendingDialog).toBeNull();
  });

  it('dialogClear clears a yes/no gameAsk with no targets (Wave 3 vote-prompt fix)', () => {
    // Multi-player vote: engine fires gameAsk to each surviving
    // player simultaneously. There's no targets array — each prompt
    // is a per-player yes/no. When ANY player leaves, the others
    // must teardown so the engine can re-fire with the surviving
    // player set. Pre-Wave-3 this was the canonical stuck-modal bug.
    const carol = 'bbbbbbbb-2222-2222-2222-222222222222';
    const dialog = dialogPayloadWithTargets([], 'Vote yes/no');
    useGameStore.getState().applyFrame(frame('gameAsk', dialog, 80), dialog);
    expect(useGameStore.getState().pendingDialog).not.toBeNull();

    const clear = { playerId: carol, reason: 'PLAYER_LEFT' };
    useGameStore.getState().applyFrame(frame('dialogClear', clear, 81), clear);
    expect(useGameStore.getState().pendingDialog).toBeNull();
  });

  it('dialogClear with no open dialog is a no-op', () => {
    // Defensive — server may emit dialogClear after a leaver concedes
    // even if no dialog is open on this client (because dialogClear
    // is broadcast to every client, not just those with stuck modals).
    expect(useGameStore.getState().pendingDialog).toBeNull();
    const clear = {
      playerId: 'aaaaaaaa-1111-1111-1111-111111111111',
      reason: 'PLAYER_LEFT',
    };
    useGameStore.getState().applyFrame(frame('dialogClear', clear, 70), clear);
    expect(useGameStore.getState().pendingDialog).toBeNull();
  });

  it('dialogClear does NOT touch a gameChooseAbility dialog', () => {
    // gameChooseAbility uses WebAbilityPickerView (no targets array).
    // It can't reference players as targets by construction, so the
    // dialogClear signal is irrelevant. Per ADR D11(b): clients only
    // dismiss when the leaver is in targets.
    const payload = {
      gameView: null,
      message: 'Pick an ability',
      choices: { 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa': 'Activate A' },
    };
    useGameStore.getState().applyFrame(
      frame('gameChooseAbility', payload, 80),
      payload,
    );
    expect(useGameStore.getState().pendingDialog).not.toBeNull();

    const clear = {
      playerId: 'aaaaaaaa-1111-1111-1111-111111111111',
      reason: 'PLAYER_LEFT',
    };
    useGameStore.getState().applyFrame(frame('dialogClear', clear, 81), clear);
    expect(useGameStore.getState().pendingDialog).not.toBeNull();
  });

  it('dialogClear after endGameInfo is a no-op (defensive)', () => {
    // endGameInfo nulls pendingDialog (store.ts:397). A late-arriving
    // dialogClear (e.g., last-loser-concedes synthesized after the
    // engine's gameOver path resolved) finds no dialog and exits
    // cleanly. Lock the early-return so a future refactor can't
    // regress into a null-deref or unwanted state mutation.
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
    useGameStore.getState().applyFrame(frame('gameOver', wrap, 1), wrap);
    useGameStore.getState().applyFrame(
      frame('endGameInfo', { gameInfo: 'done', matchInfo: '', additionalInfo: '', hasWon: true, wins: 1, winsNeeded: 1, players: [] }, 2),
      { gameInfo: 'done', matchInfo: '', additionalInfo: '', hasWon: true, wins: 1, winsNeeded: 1, players: [] },
    );
    expect(useGameStore.getState().pendingDialog).toBeNull();

    // Late dialogClear arrives — must not throw, must leave gameEnd
    // intact (the gameOver banner / endGame summary stay on screen).
    useGameStore.getState().applyFrame(
      frame('dialogClear', {
        playerId: 'aaaaaaaa-1111-1111-1111-111111111111',
        reason: 'PLAYER_LEFT',
      }, 3),
      {
        playerId: 'aaaaaaaa-1111-1111-1111-111111111111',
        reason: 'PLAYER_LEFT',
      },
    );
    expect(useGameStore.getState().pendingDialog).toBeNull();
    expect(useGameStore.getState().gameEnd).not.toBeNull();
  });

  it('multiple dialogClear frames in succession all act independently', () => {
    // Cascading concession scenario — alice and carol both leave in
    // the same turn (concede + game-loss trigger). Each dialogClear
    // is evaluated against the current dialog state at the time it
    // arrives.
    const alice = 'aaaaaaaa-1111-1111-1111-111111111111';
    const bob = 'bbbbbbbb-2222-2222-2222-222222222222';
    const carol = 'cccccccc-3333-3333-3333-333333333333';

    const dialog1 = dialogPayloadWithTargets([alice, bob, carol]);
    useGameStore.getState().applyFrame(frame('gameTarget', dialog1, 90), dialog1);

    // Alice leaves → dismiss (alice is in targets).
    useGameStore.getState().applyFrame(
      frame('dialogClear', { playerId: alice, reason: 'PLAYER_LEFT' }, 91),
      { playerId: alice, reason: 'PLAYER_LEFT' },
    );
    expect(useGameStore.getState().pendingDialog).toBeNull();

    // Engine re-prompts with bob+carol only.
    const dialog2 = dialogPayloadWithTargets([bob, carol]);
    useGameStore.getState().applyFrame(frame('gameTarget', dialog2, 92), dialog2);
    expect(useGameStore.getState().pendingDialog).not.toBeNull();

    // Carol leaves → dismiss again.
    useGameStore.getState().applyFrame(
      frame('dialogClear', { playerId: carol, reason: 'PLAYER_LEFT' }, 93),
      { playerId: carol, reason: 'PLAYER_LEFT' },
    );
    expect(useGameStore.getState().pendingDialog).toBeNull();
  });

  /* ---------- slice 18: gameLog ---------- */

  it('gameInform appends to gameLog with turn/phase metadata', () => {
    const gv = buildGameView(3);
    const wrap = webGameClientMessageSchema.parse({
      gameView: gv,
      message: 'alice plays Forest',
      targets: [],
      cardsView1: {},
      min: 0,
      max: 0,
      flag: false,
      choice: null,
    });
    useGameStore.getState().applyFrame(frame('gameInform', wrap, 17), wrap);
    const log = useGameStore.getState().gameLog;
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      id: 17,
      message: 'alice plays Forest',
      turn: 3,
      phase: 'PRECOMBAT_MAIN',
    });
  });

  it('gameInform with empty message does not pollute the log', () => {
    const gv = buildGameView(1);
    const wrap = webGameClientMessageSchema.parse({
      gameView: gv,
      message: '',
      targets: [],
      cardsView1: {},
      min: 0,
      max: 0,
      flag: false,
      choice: null,
    });
    useGameStore.getState().applyFrame(frame('gameInform', wrap, 1), wrap);
    expect(useGameStore.getState().gameLog).toHaveLength(0);
  });

  it('gameOver appends to gameLog (winner banner record)', () => {
    const wrap = webGameClientMessageSchema.parse({
      gameView: null,
      message: 'alice has won the game',
      targets: [],
      cardsView1: {},
      min: 0,
      max: 0,
      flag: false,
      choice: null,
    });
    useGameStore.getState().applyFrame(frame('gameOver', wrap, 99), wrap);
    expect(useGameStore.getState().gameLog).toHaveLength(1);
    expect(useGameStore.getState().gameLog[0]?.message).toContain('won the game');
  });

  it('gameLog evicts oldest entries past the 500-entry cap', () => {
    // Push 510 messages, assert head is no longer the first one.
    for (let i = 0; i < 510; i++) {
      const wrap = webGameClientMessageSchema.parse({
        gameView: null,
        message: `event ${i}`,
        targets: [],
        cardsView1: {},
        min: 0,
        max: 0,
        flag: false,
        choice: null,
      });
      useGameStore.getState().applyFrame(frame('gameInform', wrap, i), wrap);
    }
    const log = useGameStore.getState().gameLog;
    expect(log).toHaveLength(500);
    // Oldest 10 evicted; head should be event 10.
    expect(log[0]?.message).toBe('event 10');
    expect(log[log.length - 1]?.message).toBe('event 509');
  });

  it('reset clears gameLog along with everything else', () => {
    const wrap = webGameClientMessageSchema.parse({
      gameView: null,
      message: 'something',
      targets: [],
      cardsView1: {},
      min: 0,
      max: 0,
      flag: false,
      choice: null,
    });
    useGameStore.getState().applyFrame(frame('gameInform', wrap, 1), wrap);
    expect(useGameStore.getState().gameLog).toHaveLength(1);
    useGameStore.getState().reset();
    expect(useGameStore.getState().gameLog).toHaveLength(0);
  });

  /* ---------- slice 19: game-over banner state ---------- */

  it('gameOver sets gameOverPending true', () => {
    const wrap = webGameClientMessageSchema.parse({
      gameView: null,
      message: 'alice has won the game',
      targets: [],
      cardsView1: {},
      min: 0,
      max: 0,
      flag: false,
      choice: null,
    });
    expect(useGameStore.getState().gameOverPending).toBe(false);
    useGameStore.getState().applyFrame(frame('gameOver', wrap, 1), wrap);
    expect(useGameStore.getState().gameOverPending).toBe(true);
  });

  it('gameInform does not set gameOverPending', () => {
    const wrap = webGameClientMessageSchema.parse({
      gameView: null,
      message: 'alice plays Forest',
      targets: [],
      cardsView1: {},
      min: 0,
      max: 0,
      flag: false,
      choice: null,
    });
    useGameStore.getState().applyFrame(frame('gameInform', wrap, 1), wrap);
    expect(useGameStore.getState().gameOverPending).toBe(false);
  });

  it('gameInit clears gameOverPending (next game in best-of-N)', () => {
    const over = webGameClientMessageSchema.parse({
      gameView: null,
      message: 'alice has won game 1',
      targets: [],
      cardsView1: {},
      min: 0,
      max: 0,
      flag: false,
      choice: null,
    });
    useGameStore.getState().applyFrame(frame('gameOver', over, 1), over);
    expect(useGameStore.getState().gameOverPending).toBe(true);
    const gv = buildGameView(1);
    useGameStore.getState().applyFrame(frame('gameInit', gv, 2), gv);
    expect(useGameStore.getState().gameOverPending).toBe(false);
  });

  it('gameInit still clears pendingDialog (fresh game / reconnect catch-up)', () => {
    const dialog = dialogPayload();
    useGameStore.getState().applyFrame(frame('gameAsk', dialog, 1), dialog);
    const gv = buildGameView(1);
    useGameStore.getState().applyFrame(frame('gameInit', gv, 2), gv);
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
      schemaVersion: '1.15',
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
      schemaVersion: '1.15',
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

  /* ---------- slice 12: startGame auto-nav ---------- */

  it('startGame frame stashes a pendingStartGame entry', () => {
    const info = {
      tableId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      gameId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      playerId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
    };
    useGameStore.getState().applyFrame(frame('startGame', info), info);
    expect(useGameStore.getState().pendingStartGame).toEqual(info);
  });

  it('consumeStartGame clears the pending entry and returns the prior value', () => {
    const info = {
      tableId: 't',
      gameId: 'g',
      playerId: 'p',
    };
    useGameStore.getState().applyFrame(frame('startGame', info), info);

    expect(useGameStore.getState().consumeStartGame()).toEqual(info);
    expect(useGameStore.getState().pendingStartGame).toBeNull();
    // Idempotent — second consume returns null.
    expect(useGameStore.getState().consumeStartGame()).toBeNull();
  });

  it('a fresh startGame replaces a still-pending one', () => {
    const a = { tableId: 't1', gameId: 'g1', playerId: 'p1' };
    const b = { tableId: 't2', gameId: 'g2', playerId: 'p2' };
    useGameStore.getState().applyFrame(frame('startGame', a), a);
    useGameStore.getState().applyFrame(frame('startGame', b), b);
    expect(useGameStore.getState().pendingStartGame).toEqual(b);
  });

  it('reset clears pendingStartGame', () => {
    const info = { tableId: 't', gameId: 'g', playerId: 'p' };
    useGameStore.getState().applyFrame(frame('startGame', info), info);
    useGameStore.getState().reset();
    expect(useGameStore.getState().pendingStartGame).toBeNull();
  });

  /* ---------- slice 13: sideboard ---------- */

  function sideboardInfo() {
    return {
      deck: {
        name: 'Mono-green',
        mainList: [
          {
            id: '11111111-1111-1111-1111-111111111111',
            name: 'Forest',
            expansionSetCode: 'M21',
            cardNumber: '281',
            usesVariousArt: true,
          },
        ],
        sideboard: [
          {
            id: '22222222-2222-2222-2222-222222222222',
            name: 'Naturalize',
            expansionSetCode: 'M21',
            cardNumber: '199',
            usesVariousArt: false,
          },
        ],
      },
      tableId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      parentTableId: '',
      time: 600,
      limited: false,
    };
  }

  it('sideboard frame stashes pendingSideboard with full deck shape', () => {
    const info = sideboardInfo();
    useGameStore.getState().applyFrame(frame('sideboard', info), info);
    const pending = useGameStore.getState().pendingSideboard;
    expect(pending).not.toBeNull();
    expect(pending?.tableId).toBe(info.tableId);
    expect(pending?.deck.mainList).toHaveLength(1);
    expect(pending?.deck.mainList[0]?.name).toBe('Forest');
    expect(pending?.deck.sideboard).toHaveLength(1);
  });

  it('clearSideboard resets pendingSideboard to null', () => {
    const info = sideboardInfo();
    useGameStore.getState().applyFrame(frame('sideboard', info), info);
    useGameStore.getState().clearSideboard();
    expect(useGameStore.getState().pendingSideboard).toBeNull();
  });

  it('reset clears pendingSideboard', () => {
    const info = sideboardInfo();
    useGameStore.getState().applyFrame(frame('sideboard', info), info);
    useGameStore.getState().reset();
    expect(useGameStore.getState().pendingSideboard).toBeNull();
  });

  /* ---------- Slice 70-X.14 (Bug 4): commander snapshot ---------- */

  function buildGameViewWithCommanders(
    playerId: string,
    commanderNames: string[],
  ) {
    const player = webPlayerViewSchema.parse({
      playerId,
      name: 'alice',
      life: 40, wins: 0, winsNeeded: 1, libraryCount: 99, handCount: 7,
      graveyard: {}, exile: {}, sideboard: {}, battlefield: {},
      manaPool: { red: 0, green: 0, blue: 0, white: 0, black: 0, colorless: 0 },
      controlled: true, isHuman: true, isActive: true, hasPriority: true,
      hasLeft: false, monarch: false, initiative: false, designationNames: [],
      commandList: commanderNames.map((name) => ({
        id: `id-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        kind: 'commander',
        name,
        expansionSetCode: 'CMR',
        imageFileName: '',
        imageNumber: 0,
        cardNumber: '281',
        rules: [],
      })),
    });
    return webGameViewSchema.parse({
      turn: 1,
      phase: 'PRECOMBAT_MAIN',
      step: 'PRECOMBAT_MAIN',
      activePlayerName: 'alice',
      priorityPlayerName: 'alice',
      special: false,
      rollbackTurnsAllowed: false,
      totalErrorsCount: 0,
      totalEffectsCount: 0,
      gameCycle: 0,
      myPlayerId: playerId,
      myHand: {},
      stack: {},
      combat: [],
      players: [player],
    });
  }

  it('gameInit seeds commanderSnapshots from initial commandList', () => {
    const pid = '22222222-2222-2222-2222-222222222222';
    const gv = buildGameViewWithCommanders(pid, ['Atraxa, Praetors\' Voice']);
    useGameStore.getState().applyFrame(frame('gameInit', gv, 1), gv);
    const snap = useGameStore.getState().commanderSnapshots[pid];
    expect(snap).toBeDefined();
    expect(snap.length).toBe(1);
    expect(snap[0].name).toBe('Atraxa, Praetors\' Voice');
  });

  it('gameUpdate retains commander when commandList becomes empty (cast)', () => {
    const pid = '22222222-2222-2222-2222-222222222222';
    const initial = buildGameViewWithCommanders(pid, ['Atraxa, Praetors\' Voice']);
    useGameStore.getState().applyFrame(frame('gameInit', initial, 1), initial);
    // Commander cast — commandList is now empty
    const empty = buildGameViewWithCommanders(pid, []);
    useGameStore.getState().applyFrame(frame('gameUpdate', empty, 2), empty);
    const snap = useGameStore.getState().commanderSnapshots[pid];
    expect(snap).toBeDefined();
    expect(snap.length).toBe(1);
    expect(snap[0].name).toBe('Atraxa, Praetors\' Voice');
  });

  it('Partner: snapshot accumulates both commanders and retains them through casts', () => {
    const pid = '22222222-2222-2222-2222-222222222222';
    const both = buildGameViewWithCommanders(pid, [
      'Tymna the Weaver',
      'Thrasios, Triton Hero',
    ]);
    useGameStore.getState().applyFrame(frame('gameInit', both, 1), both);
    // Cast Tymna — only Thrasios remains in command zone
    const onlyThrasios = buildGameViewWithCommanders(pid, [
      'Thrasios, Triton Hero',
    ]);
    useGameStore.getState().applyFrame(
      frame('gameUpdate', onlyThrasios, 2),
      onlyThrasios,
    );
    // Cast Thrasios — neither in command zone
    const empty = buildGameViewWithCommanders(pid, []);
    useGameStore.getState().applyFrame(frame('gameUpdate', empty, 3), empty);
    const snap = useGameStore.getState().commanderSnapshots[pid];
    expect(snap).toBeDefined();
    expect(snap.length).toBe(2);
    expect(snap.map((c) => c.name).sort()).toEqual([
      'Thrasios, Triton Hero',
      'Tymna the Weaver',
    ]);
  });

  it('non-commander entries (emblem, dungeon) are not snapshotted', () => {
    const pid = '22222222-2222-2222-2222-222222222222';
    const player = webPlayerViewSchema.parse({
      playerId: pid,
      name: 'alice',
      life: 40, wins: 0, winsNeeded: 1, libraryCount: 99, handCount: 7,
      graveyard: {}, exile: {}, sideboard: {}, battlefield: {},
      manaPool: { red: 0, green: 0, blue: 0, white: 0, black: 0, colorless: 0 },
      controlled: true, isHuman: true, isActive: true, hasPriority: true,
      hasLeft: false, monarch: false, initiative: false, designationNames: [],
      commandList: [
        {
          id: 'id-emblem-elspeth',
          kind: 'emblem',
          name: 'Elspeth, Sun\'s Champion emblem',
          expansionSetCode: '',
          imageFileName: '',
          imageNumber: 1,
          cardNumber: '',
          rules: [],
        },
      ],
    });
    const gv = webGameViewSchema.parse({
      turn: 5,
      phase: 'PRECOMBAT_MAIN',
      step: 'PRECOMBAT_MAIN',
      activePlayerName: 'alice',
      priorityPlayerName: 'alice',
      special: false,
      rollbackTurnsAllowed: false,
      totalErrorsCount: 0,
      totalEffectsCount: 0,
      gameCycle: 0,
      myPlayerId: pid,
      myHand: {},
      stack: {},
      combat: [],
      players: [player],
    });
    useGameStore.getState().applyFrame(frame('gameInit', gv, 1), gv);
    expect(useGameStore.getState().commanderSnapshots[pid] ?? []).toEqual([]);
  });

  it('reset wipes commanderSnapshots', () => {
    const pid = '22222222-2222-2222-2222-222222222222';
    const gv = buildGameViewWithCommanders(pid, ['Atraxa, Praetors\' Voice']);
    useGameStore.getState().applyFrame(frame('gameInit', gv, 1), gv);
    expect(useGameStore.getState().commanderSnapshots[pid]).toBeDefined();
    useGameStore.getState().reset();
    expect(useGameStore.getState().commanderSnapshots).toEqual({});
  });

  // P0 audit fix — chatMessages targeted clear so LobbyChat can drop
  // its bucket on unmount without nuking the rest of the store.
  it('clearChatBucket removes only the named chatId, leaves others intact', () => {
    const chatA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const chatB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    useGameStore.setState({
      chatMessages: {
        [chatA]: [{ chatId: chatA, username: 'alice', message: 'hi' } as never],
        [chatB]: [{ chatId: chatB, username: 'bob', message: 'hey' } as never],
      },
    });
    useGameStore.getState().clearChatBucket(chatA);
    const state = useGameStore.getState();
    expect(state.chatMessages[chatA]).toBeUndefined();
    expect(state.chatMessages[chatB]).toHaveLength(1);
  });

  it('clearChatBucket is a no-op when the chatId is not present', () => {
    useGameStore.setState({ chatMessages: {} });
    const before = useGameStore.getState().chatMessages;
    useGameStore.getState().clearChatBucket('not-a-real-chat');
    expect(useGameStore.getState().chatMessages).toBe(before);
  });

  // P0 audit fix — applyFrame for an unknown method returns false AND
  // logs a console.warn so a server-ships-new-method scenario doesn't
  // get silently dropped during a rolling upgrade.
  it('applyFrame returns false and warns for an unknown method', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = useGameStore.getState().applyFrame(
      {
        method: 'someUnknownFutureMethod',
        messageId: 1,
        objectId: null,
        data: null,
      } as never,
      null,
    );
    expect(result).toBe(false);
    expect(warnSpy).toHaveBeenCalled();
    expect(warnSpy.mock.calls[0]?.[0]).toMatch(/unknown method/i);
    warnSpy.mockRestore();
  });
});
