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
  // Dialog frames (gameAsk / gameTarget / ...) reuse
  // WebGameClientMessage. Slice C adds explicit dispatch.
  gameAsk: (raw) => webGameClientMessageSchema.parse(raw),
  gameTarget: (raw) => webGameClientMessageSchema.parse(raw),
  gameSelect: (raw) => webGameClientMessageSchema.parse(raw),
  gamePlayMana: (raw) => webGameClientMessageSchema.parse(raw),
  gameSelectAmount: (raw) => webGameClientMessageSchema.parse(raw),
  gameInformPersonal: (raw) => webGameClientMessageSchema.parse(raw),
  gameError: (raw) => webGameClientMessageSchema.parse(raw),
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
