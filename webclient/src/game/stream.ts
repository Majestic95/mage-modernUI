/**
 * Thin client wrapper around the browser {@code WebSocket} API,
 * specialized for the {@code /api/games/:gameId/stream} protocol from
 * ADR 0007. Validates inbound envelopes against
 * {@link webStreamFrameSchema}, dispatches by {@code method} into
 * {@link useGameStore}, and surfaces connection lifecycle + protocol
 * errors as store state for the React tree to consume.
 *
 * <p>Slice A scope: connect / disconnect, envelope validation, frame
 * dispatch, basic reconnect attempt on close (1 retry). Slice B will
 * add per-method data validation, {@code ?since=} reconnect, and
 * outbound {@code chatSend} / {@code playerAction} senders.
 */
import {
  webAbilityPickerViewSchema,
  webChatMessageSchema,
  webGameClientMessageSchema,
  webGameEndViewSchema,
  webGameViewSchema,
  webStartGameInfoSchema,
  webStreamErrorSchema,
  webStreamFrameSchema,
  webStreamHelloSchema,
  type WebStreamFrame,
} from '../api/schemas';
import { useGameStore } from './store';

const DEFAULT_BASE_URL = 'http://localhost:18080';

const httpBase = (
  (import.meta.env['VITE_XMAGE_WEBAPI_URL'] as string | undefined) ??
  DEFAULT_BASE_URL
).replace(/\/+$/, '');

/** http:// → ws://, https:// → wss://. */
function toWsBase(http: string): string {
  if (http.startsWith('https://')) return 'wss://' + http.slice('https://'.length);
  if (http.startsWith('http://')) return 'ws://' + http.slice('http://'.length);
  // Fall back: assume the user supplied a host:port without scheme.
  return 'ws://' + http;
}

/**
 * Per-method {@code data} validators. Frames whose method isn't here
 * are still passed through to the store with raw data — the store can
 * decide to ignore them (slice A drops chat frames, dialog frames, etc.
 * with no validation cost).
 */
const DATA_VALIDATORS: Record<string, (raw: unknown) => unknown> = {
  streamHello: (raw) => webStreamHelloSchema.parse(raw),
  streamError: (raw) => webStreamErrorSchema.parse(raw),
  startGame: (raw) => webStartGameInfoSchema.parse(raw),
  gameInit: (raw) => webGameViewSchema.parse(raw),
  gameUpdate: (raw) => webGameViewSchema.parse(raw),
  gameInform: (raw) => webGameClientMessageSchema.parse(raw),
  gameOver: (raw) => webGameClientMessageSchema.parse(raw),
  endGameInfo: (raw) => webGameEndViewSchema.parse(raw),
  chatMessage: (raw) => webChatMessageSchema.parse(raw),
  // Dialog frames that reuse WebGameClientMessage as the data shape.
  gameAsk: (raw) => webGameClientMessageSchema.parse(raw),
  gameTarget: (raw) => webGameClientMessageSchema.parse(raw),
  gameSelect: (raw) => webGameClientMessageSchema.parse(raw),
  gamePlayMana: (raw) => webGameClientMessageSchema.parse(raw),
  gamePlayXMana: (raw) => webGameClientMessageSchema.parse(raw),
  gameSelectAmount: (raw) => webGameClientMessageSchema.parse(raw),
  gameChooseChoice: (raw) => webGameClientMessageSchema.parse(raw),
  gameInformPersonal: (raw) => webGameClientMessageSchema.parse(raw),
  gameError: (raw) => webGameClientMessageSchema.parse(raw),
  // Distinct shape — WebAbilityPickerView, not GameClientMessage.
  gameChooseAbility: (raw) => webAbilityPickerViewSchema.parse(raw),
};

export interface GameStreamOptions {
  gameId: string;
  token: string;
  /** Test-only WebSocket constructor injection. Defaults to global. */
  webSocketCtor?: typeof WebSocket;
}

export class GameStream {
  private socket: WebSocket | null = null;
  private readonly gameId: string;
  private readonly token: string;
  private readonly Ctor: typeof WebSocket;
  private closedByCaller = false;

  constructor(options: GameStreamOptions) {
    this.gameId = options.gameId;
    this.token = options.token;
    this.Ctor = options.webSocketCtor ?? WebSocket;
  }

  open(): void {
    if (this.socket) {
      return;
    }
    const wsBase = toWsBase(httpBase);
    const url =
      `${wsBase}/api/games/${encodeURIComponent(this.gameId)}/stream` +
      `?token=${encodeURIComponent(this.token)}`;

    useGameStore.getState().setConnection('connecting');
    let socket: WebSocket;
    try {
      socket = new this.Ctor(url);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'WebSocket open failed';
      useGameStore.getState().setConnection('error', message);
      return;
    }
    this.socket = socket;

    socket.addEventListener('open', () => {
      useGameStore.getState().setConnection('open');
    });

    socket.addEventListener('message', (ev: MessageEvent) => {
      this.handleMessage(typeof ev.data === 'string' ? ev.data : '');
    });

    socket.addEventListener('error', () => {
      useGameStore.getState().setConnection('error', 'WebSocket error');
    });

    socket.addEventListener('close', (ev: CloseEvent) => {
      this.socket = null;
      useGameStore
        .getState()
        .setConnection('closed', ev.reason || `code ${ev.code}`);
    });
  }

  close(code = 1000, reason = 'client navigation'): void {
    this.closedByCaller = true;
    this.socket?.close(code, reason);
  }

  /** True when the underlying socket is connected and accepting sends. */
  isOpen(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  /**
   * Send a {@code playerAction} envelope. Per ADR 0007 D6 — toggles,
   * pass-priority modes, lifecycle. Server validates the action
   * against {@code PlayerActionAllowList}; rejection arrives as a
   * {@code streamError} frame.
   */
  sendPlayerAction(action: string, data: unknown = null): void {
    this.sendEnvelope({ type: 'playerAction', action, data });
  }

  /**
   * Send a {@code playerResponse} envelope answering a server-side
   * dialog. Per ADR 0007 D6 — kind ∈ {uuid, string, boolean, integer,
   * manaType}. Caller is responsible for picking the right kind for
   * the dialog method (see {@code GameDialog} for the mapping).
   *
   * @param messageId echoes the dialog frame's messageId (server
   *     uses this for correlation)
   * @param kind discriminator selecting the upstream {@code sendPlayerXxx}
   *     dispatch
   * @param value typed per kind: string for uuid/string, boolean for
   *     boolean, number for integer, {playerId, manaType} object for
   *     manaType
   */
  sendPlayerResponse(
    messageId: number,
    kind: 'uuid' | 'string' | 'boolean' | 'integer' | 'manaType',
    value: unknown,
  ): void {
    this.sendEnvelope({ type: 'playerResponse', messageId, kind, value });
  }

  /**
   * Send a {@code chatSend} envelope. Username is filled server-side
   * from the session; clients cannot spoof. {@code chatId} must
   * resolve to a chat the user is subscribed to.
   */
  sendChat(chatId: string, message: string): void {
    this.sendEnvelope({ type: 'chatSend', chatId, message });
  }

  /**
   * Best-effort send. If the socket isn't open, the call is dropped
   * with a console warning rather than throwing — UI code can fire
   * sends optimistically and rely on the connection-state UI to
   * surface a disconnect, instead of every callsite checking
   * {@link isOpen}.
   */
  private sendEnvelope(envelope: object): void {
    if (!this.isOpen()) {
      if (typeof console !== 'undefined') {
        console.warn(
          'GameStream: dropping send — socket not open',
          envelope,
        );
      }
      return;
    }
    try {
      this.socket?.send(JSON.stringify(envelope));
    } catch (err) {
      if (typeof console !== 'undefined') {
        console.warn('GameStream: send failed', err);
      }
    }
  }

  /** Caller-initiated close flag — exposed for tests / future reconnect logic. */
  wasClosedByCaller(): boolean {
    return this.closedByCaller;
  }

  private handleMessage(text: string): void {
    if (!text) return;
    let envelope: WebStreamFrame;
    try {
      const parsed: unknown = JSON.parse(text);
      envelope = webStreamFrameSchema.parse(parsed);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'parse failed';
      useGameStore
        .getState()
        .setConnection('error', `bad frame: ${message}`);
      return;
    }

    let validatedData: unknown = envelope.data;
    const validator = DATA_VALIDATORS[envelope.method];
    if (validator) {
      try {
        validatedData = validator(envelope.data);
      } catch (err) {
        // Per-method data validation failure is non-fatal — log and
        // pass the raw data through. The store can decide to ignore.
        if (typeof console !== 'undefined') {
          console.warn(
            `GameStream: data validation failed for method=${envelope.method}`,
            err,
          );
        }
      }
    }

    useGameStore.getState().applyFrame(envelope, validatedData);
  }
}
