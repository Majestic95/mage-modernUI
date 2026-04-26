/**
 * Zustand store for the active game window. Holds the latest
 * {@link WebGameView} snapshot, connection state, and any in-flight
 * dialog frame the server is asking the player to answer.
 *
 * <p>The store does not own the WebSocket — that's {@link GameStream}'s
 * job. The store is the React-facing state surface that the stream
 * pushes into.
 */
import { create } from 'zustand';
import type {
  WebAbilityPickerView,
  WebChatMessage,
  WebGameClientMessage,
  WebGameEndView,
  WebGameView,
  WebStreamFrame,
} from '../api/schemas';

/** Maximum chat history retained per chatId. Older messages drop. */
const CHAT_HISTORY_CAP = 200;

export type ConnectionState =
  | 'idle'
  | 'connecting'
  | 'open'
  | 'closed'
  | 'error';

/**
 * Outbound dialog method names that prompt for a {@code playerResponse}.
 * Slice B renders these as modal overlays. {@code gameInformPersonal}
 * and {@code gameError} are also dialog-like (server pushes them at
 * the player) but require no response — the modal just shows an OK
 * button.
 *
 * <p>{@code gameChooseAbility} is the only dialog whose data shape is
 * {@link WebAbilityPickerView} rather than {@link WebGameClientMessage};
 * the {@link PendingDialog} type discriminates so renderers narrow
 * automatically.
 */
export type DialogMethod =
  | 'gameAsk'
  | 'gameTarget'
  | 'gameSelect'
  | 'gamePlayMana'
  | 'gamePlayXMana'
  | 'gameSelectAmount'
  | 'gameChooseChoice'
  | 'gameChooseAbility'
  | 'gameInformPersonal'
  | 'gameError';

const DIALOG_METHODS = new Set<string>([
  'gameAsk',
  'gameTarget',
  'gameSelect',
  'gamePlayMana',
  'gamePlayXMana',
  'gameSelectAmount',
  'gameChooseChoice',
  'gameChooseAbility',
  'gameInformPersonal',
  'gameError',
]);

/**
 * Discriminated union over dialog method. The 9 GameClientMessage-
 * shaped dialogs land in the first variant; gameChooseAbility (which
 * upstream emits as a separate AbilityPickerView class) lands in the
 * second. Renderers narrow on {@code dialog.method}.
 */
export type PendingDialogClientMessage = {
  method: Exclude<DialogMethod, 'gameChooseAbility'>;
  messageId: number;
  data: WebGameClientMessage;
};

export type PendingDialogAbilityPicker = {
  method: 'gameChooseAbility';
  messageId: number;
  data: WebAbilityPickerView;
};

export type PendingDialog = PendingDialogClientMessage | PendingDialogAbilityPicker;

interface GameState {
  /** Connection lifecycle. {@code 'idle'} before any connect attempt. */
  connection: ConnectionState;
  /** Last WebSocket close reason, if any. */
  closeReason: string;
  /** Last protocol-level error (streamError frame), if any. */
  protocolError: string | null;

  /** Latest game-state snapshot. */
  gameView: WebGameView | null;
  /** Last gameInform / gameOver wrapper. */
  lastWrapped: WebGameClientMessage | null;
  /** Match-end summary, set when endGameInfo arrives. */
  gameEnd: WebGameEndView | null;
  /** Largest messageId seen — feeds reconnect via ?since=. */
  lastMessageId: number;

  /**
   * The dialog frame currently awaiting a player response, if any.
   * Set by {@link applyFrame} when a {@code DialogMethod} arrives;
   * cleared by {@link clearDialog} when the player submits a response
   * (or dismisses an info-only dialog).
   *
   * <p>Server-side, upstream waits on the response before issuing the
   * next callback — so a new dialog never arrives while one is
   * pending. Defensively, if it does, the latest replaces the prior.
   */
  pendingDialog: PendingDialog | null;

  /**
   * Chat history keyed by chatId. The Lobby page filters to the
   * main-room chatId; the Game page filters to the game's chatId.
   * Each entry's array is capped at {@link CHAT_HISTORY_CAP}; older
   * messages drop when the cap is hit.
   *
   * <p>The {@code chatId} key comes from {@code WebStreamFrame.objectId}
   * on incoming {@code chatMessage} frames. Sender-side, the webclient
   * passes the chatId on the {@code chatSend} envelope so the upstream
   * broadcast lands in the right chat session.
   */
  chatMessages: Record<string, WebChatMessage[]>;

  /** Connection lifecycle setters (called by GameStream). */
  setConnection: (s: ConnectionState, reason?: string) => void;
  /** Apply an inbound frame. Returns true if the frame was handled. */
  applyFrame: (frame: WebStreamFrame, validatedData: unknown) => boolean;
  /** Clear the pending dialog — called when the player submits a response. */
  clearDialog: () => void;
  /** Reset back to the pre-connect state — for navigating away. */
  reset: () => void;
}

const INITIAL: Pick<
  GameState,
  | 'connection'
  | 'closeReason'
  | 'protocolError'
  | 'gameView'
  | 'lastWrapped'
  | 'gameEnd'
  | 'lastMessageId'
  | 'pendingDialog'
  | 'chatMessages'
> = {
  connection: 'idle',
  closeReason: '',
  protocolError: null,
  gameView: null,
  lastWrapped: null,
  gameEnd: null,
  lastMessageId: 0,
  pendingDialog: null,
  chatMessages: {},
};

export const useGameStore = create<GameState>()((set, get) => ({
  ...INITIAL,

  setConnection: (s, reason) =>
    set({
      connection: s,
      closeReason: reason ?? get().closeReason,
    }),

  applyFrame: (frame, validatedData) => {
    // Bump messageId tracker on every frame regardless of method so
    // reconnect-via-?since= picks up where we left off.
    if (frame.messageId > get().lastMessageId) {
      set({ lastMessageId: frame.messageId });
    }

    if (DIALOG_METHODS.has(frame.method)) {
      // gameChooseAbility uses WebAbilityPickerView; every other dialog
      // uses WebGameClientMessage. Both shapes carry an optional
      // gameView nested field, so the snapshot-update path is uniform
      // — read .gameView from whichever shape arrived.
      const isAbilityPicker = frame.method === 'gameChooseAbility';
      const pending: PendingDialog = isAbilityPicker
        ? {
            method: 'gameChooseAbility',
            messageId: frame.messageId,
            data: validatedData as WebAbilityPickerView,
          }
        : {
            method: frame.method as Exclude<
              DialogMethod,
              'gameChooseAbility'
            >,
            messageId: frame.messageId,
            data: validatedData as WebGameClientMessage,
          };
      const wrappedGv = (validatedData as { gameView?: WebGameView | null })
        .gameView;
      set({
        pendingDialog: pending,
        gameView: wrappedGv ?? get().gameView,
      });
      return true;
    }

    switch (frame.method) {
      case 'streamHello':
        // Confirms auth at the WS layer; no game-state change.
        return true;

      case 'streamError': {
        const err = validatedData as { code: string; message: string };
        set({ protocolError: `${err.code}: ${err.message}` });
        return true;
      }

      case 'gameInit':
      case 'gameUpdate':
        set({
          gameView: validatedData as WebGameView,
          // Clear any stale dialog state on a fresh non-dialog push —
          // the server has moved on, any previously open dialog has
          // been resolved.
          protocolError: null,
          pendingDialog: null,
        });
        return true;

      case 'gameInform':
      case 'gameOver': {
        const wrapped = validatedData as WebGameClientMessage;
        set({
          lastWrapped: wrapped,
          gameView: wrapped.gameView ?? get().gameView,
          pendingDialog: null,
        });
        return true;
      }

      case 'endGameInfo':
        set({
          gameEnd: validatedData as WebGameEndView,
          pendingDialog: null,
        });
        return true;

      case 'chatMessage': {
        const msg = validatedData as WebChatMessage;
        // chatId comes from the envelope's objectId (per slice 2).
        // Server pushes the same chatId on every chat callback for a
        // given chat. If a frame arrives without a chatId we drop it
        // — there's no sensible bucket to file it under.
        const chatId = frame.objectId;
        if (!chatId) {
          return true;
        }
        const buckets = get().chatMessages;
        const prior = buckets[chatId] ?? [];
        const next = prior.length >= CHAT_HISTORY_CAP
          ? [...prior.slice(prior.length - CHAT_HISTORY_CAP + 1), msg]
          : [...prior, msg];
        set({
          chatMessages: { ...buckets, [chatId]: next },
        });
        return true;
      }

      default:
        return false;
    }
  },

  clearDialog: () => set({ pendingDialog: null }),

  reset: () => set(INITIAL),
}));
