import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useDialogTargets } from './useDialogTargets';
import { useGameStore } from './store';
import {
  webGameClientMessageSchema,
  webGameViewSchema,
  webPlayerViewSchema,
  webStreamFrameSchema,
} from '../api/schemas';
import type { GameStream } from './stream';

const fakeStream = (): GameStream =>
  ({
    sendObjectClick: vi.fn(),
    sendPlayerResponse: vi.fn(),
    sendChat: vi.fn(),
    sendPlayerAction: vi.fn(),
  }) as unknown as GameStream;

const HAND_CARD_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const HAND_CARD = {
  id: HAND_CARD_ID,
  name: 'Forest',
  displayName: 'Forest',
  expansionSetCode: 'LEA',
  cardNumber: '253',
  manaCost: '',
  manaValue: 0,
  typeLine: 'Basic Land — Forest',
  supertypes: ['BASIC'],
  types: ['LAND'],
  subtypes: ['FOREST'],
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
};

const LIBRARY_CARD_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const LIBRARY_CARD = { ...HAND_CARD, id: LIBRARY_CARD_ID, name: 'Demonic Tutor' };

function gvWithHand() {
  const me = webPlayerViewSchema.parse({
    playerId: '11111111-1111-1111-1111-111111111111',
    name: 'alice',
    life: 20,
    wins: 0,
    winsNeeded: 1,
    libraryCount: 53,
    handCount: 1,
    graveyard: {},
    exile: {},
    sideboard: {},
    battlefield: {},
    manaPool: {
      red: 0,
      green: 0,
      blue: 0,
      white: 0,
      black: 0,
      colorless: 0,
    },
    controlled: true,
    isHuman: true,
    isActive: true,
    hasPriority: true,
    hasLeft: false,
    monarch: false,
    initiative: false,
    designationNames: [],
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
    myPlayerId: me.playerId,
    myHand: { [HAND_CARD_ID]: HAND_CARD },
    stack: {},
    combat: [],
    players: [me],
  });
}

function dialog(method: string, cards: Record<string, unknown>, optional = true) {
  const data = webGameClientMessageSchema.parse({
    gameView: null,
    message: 'Discard a card.',
    targets: [],
    cardsView1: cards,
    min: 1,
    max: 1,
    flag: !optional,
    choice: null,
  });
  return {
    method,
    messageId: 7,
    data,
    frame: webStreamFrameSchema.parse({
      schemaVersion: '1.15',
      method,
      messageId: 7,
      objectId: null,
      data,
    }),
  };
}

describe('useDialogTargets', () => {
  beforeEach(() => {
    useGameStore.getState().reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns inactive when no pendingDialog', () => {
    useGameStore.setState({ gameView: gvWithHand() });
    const { result } = renderHook(() => useDialogTargets(fakeStream()));
    expect(result.current.active).toBe(false);
  });

  it('returns inactive when stream is null (no dispatcher available)', () => {
    const d = dialog('gameTarget', { [HAND_CARD_ID]: HAND_CARD });
    useGameStore.setState({
      gameView: gvWithHand(),
      pendingDialog: { method: d.method, messageId: d.messageId, data: d.data } as never,
    });
    const { result } = renderHook(() => useDialogTargets(null));
    expect(result.current.active).toBe(false);
  });

  it('returns inactive for gameChooseAbility (no cardsView1, modal-only)', () => {
    useGameStore.setState({
      gameView: gvWithHand(),
      pendingDialog: {
        method: 'gameChooseAbility',
        messageId: 7,
        data: {
          gameView: null,
          message: 'Choose ability',
          choices: { 'aaa': 'Activate A' },
        },
      } as never,
    });
    const { result } = renderHook(() => useDialogTargets(fakeStream()));
    expect(result.current.active).toBe(false);
  });

  it('returns inactive when cardsView1 is empty (board-target dialog)', () => {
    const d = dialog('gameTarget', {});
    useGameStore.setState({
      gameView: gvWithHand(),
      pendingDialog: { method: d.method, messageId: d.messageId, data: d.data } as never,
    });
    const { result } = renderHook(() => useDialogTargets(fakeStream()));
    expect(result.current.active).toBe(false);
  });

  it('activates when cardsView1 cards are all in visible zones (hand discard)', () => {
    const d = dialog('gameTarget', { [HAND_CARD_ID]: HAND_CARD });
    useGameStore.setState({
      gameView: gvWithHand(),
      pendingDialog: { method: d.method, messageId: d.messageId, data: d.data } as never,
    });
    const { result } = renderHook(() => useDialogTargets(fakeStream()));
    expect(result.current.active).toBe(true);
    expect(result.current.eligibleCardIds.has(HAND_CARD_ID)).toBe(true);
    expect(result.current.message).toBe('Discard a card.');
    expect(result.current.min).toBe(1);
    expect(result.current.max).toBe(1);
  });

  it('returns inactive when cardsView1 cards are NOT in any visible zone (library search)', () => {
    // Demonic Tutor: cardsView1 carries library cards which aren't in
    // myHand / battlefield. Modal stays the right shape because
    // there's no clickable surface to pulse.
    const d = dialog('gameTarget', { [LIBRARY_CARD_ID]: LIBRARY_CARD });
    useGameStore.setState({
      gameView: gvWithHand(),
      pendingDialog: { method: d.method, messageId: d.messageId, data: d.data } as never,
    });
    const { result } = renderHook(() => useDialogTargets(fakeStream()));
    expect(result.current.active).toBe(false);
  });

  it('returns inactive for graveyard / exile picks (slice 70-Y.5 narrowing)', () => {
    // Pre-slice 70-Y.5 the visible-zone set included graveyard +
    // exile, so a "return card from graveyard" prompt would activate
    // the banner — but graveyard cards aren't rendered as clickable
    // card faces (they live behind a ZoneBrowser modal). User would
    // be stranded with the banner active and no clickable target.
    // Now: those zones drop out of the visible-zone set; the dialog
    // falls through to the modal CardChooserList grid which renders
    // graveyard cards as a proper card grid.
    const graveyardCardId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
    const graveyardCard = { ...HAND_CARD, id: graveyardCardId, name: 'Reanimate target' };
    // gameView with the card in player's graveyard, NOT in hand
    const me = webPlayerViewSchema.parse({
      playerId: '11111111-1111-1111-1111-111111111111',
      name: 'alice',
      life: 20, wins: 0, winsNeeded: 1, libraryCount: 53, handCount: 0,
      graveyard: { [graveyardCardId]: graveyardCard },
      exile: {}, sideboard: {}, battlefield: {},
      manaPool: { red: 0, green: 0, blue: 0, white: 0, black: 0, colorless: 0 },
      controlled: true, isHuman: true, isActive: true, hasPriority: true,
      hasLeft: false, monarch: false, initiative: false, designationNames: [],
    });
    const gv = webGameViewSchema.parse({
      turn: 1, phase: 'PRECOMBAT_MAIN', step: 'PRECOMBAT_MAIN',
      activePlayerName: 'alice', priorityPlayerName: 'alice',
      special: false, rollbackTurnsAllowed: false,
      totalErrorsCount: 0, totalEffectsCount: 0, gameCycle: 0,
      myPlayerId: me.playerId, myHand: {}, stack: {}, combat: [],
      players: [me],
    });
    const d = dialog('gameTarget', { [graveyardCardId]: graveyardCard });
    useGameStore.setState({
      gameView: gv,
      pendingDialog: { method: d.method, messageId: d.messageId, data: d.data } as never,
    });
    const { result } = renderHook(() => useDialogTargets(fakeStream()));
    expect(result.current.active).toBe(false);
  });

  it('pick dispatches via stream.sendPlayerResponse with the correct messageId + uuid', () => {
    const stream = fakeStream();
    const d = dialog('gameTarget', { [HAND_CARD_ID]: HAND_CARD });
    useGameStore.setState({
      gameView: gvWithHand(),
      pendingDialog: { method: d.method, messageId: d.messageId, data: d.data } as never,
    });
    const { result } = renderHook(() => useDialogTargets(stream));
    expect(result.current.active).toBe(true);
    result.current.pick!(HAND_CARD_ID);
    expect(stream.sendPlayerResponse).toHaveBeenCalledWith(7, 'uuid', HAND_CARD_ID);
  });

  it('cancel is null when dialog is mandatory (flag=true)', () => {
    const d = dialog('gameTarget', { [HAND_CARD_ID]: HAND_CARD }, /* optional */ false);
    useGameStore.setState({
      gameView: gvWithHand(),
      pendingDialog: { method: d.method, messageId: d.messageId, data: d.data } as never,
    });
    const { result } = renderHook(() => useDialogTargets(fakeStream()));
    expect(result.current.cancel).toBeNull();
  });

  it('cancel dispatches all-zeros UUID when dialog is optional', () => {
    const stream = fakeStream();
    const d = dialog('gameTarget', { [HAND_CARD_ID]: HAND_CARD }, /* optional */ true);
    useGameStore.setState({
      gameView: gvWithHand(),
      pendingDialog: { method: d.method, messageId: d.messageId, data: d.data } as never,
    });
    const { result } = renderHook(() => useDialogTargets(stream));
    result.current.cancel!();
    expect(stream.sendPlayerResponse).toHaveBeenCalledWith(
      7,
      'uuid',
      '00000000-0000-0000-0000-000000000000',
    );
  });
});
