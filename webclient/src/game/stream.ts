/**
 * Thin client wrapper around the browser {@code WebSocket} API,
 * specialized for the {@code /api/games/:gameId/stream} protocol from
 * ADR 0007. Validates inbound envelopes against
 * {@link webStreamFrameSchema}, dispatches by {@code method} into
 * {@link useGameStore}, and surfaces connection lifecycle + protocol
 * errors as store state for the React tree to consume.
 *
 * <p>Auto-reconnect: on unexpected close (close code other than the
 * caller-initiated 1000 and the permanent-failure codes 4001/4003),
 * the stream retries with exponential backoff (500/1000/2000/4000ms,
 * 4 attempts max). On the game endpoint the resume URL carries
 * {@code ?since=<lastMessageId>}; the server replays buffered frames
 * past that point. Caller-initiated close cancels any pending retry.
 */
import {
  webAbilityPickerViewSchema,
  webChatMessageSchema,
  webDialogClearSchema,
  webGameClientMessageSchema,
  webGameEndViewSchema,
  EXPECTED_SCHEMA_MAJOR,
  parseSchemaVersion,
  webGameViewSchema,
  webSideboardInfoSchema,
  webStartGameInfoSchema,
  webStreamErrorSchema,
  webStreamFrameSchema,
  webStreamHelloSchema,
  type WebStreamFrame,
} from '../api/schemas';
import { useGameStore } from './store';
import { useAuthStore } from '../auth/store';

const DEFAULT_BASE_URL = 'http://localhost:18080';

/**
 * Handshake protocol version this client speaks. Slice 69a (ADR 0010
 * v2 D12) introduced server-side {@code ?protocolVersion=} validation.
 * v2 is the multiplayer surface: N-player layout, eliminated-player
 * semantics, schema 1.20 wire fields. A server still on v1 only will
 * reject this client with close 4400 + reason
 * {@code PROTOCOL_VERSION_UNSUPPORTED} — explicit failure beats a
 * silent semantics drift. Bumped together with
 * {@code mage.webapi.ProtocolVersion#CURRENT}.
 */
const PROTOCOL_VERSION = 2;

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
  // Slice 70-X.14 Wave 3 — pile-pick + multi-amount frames now wired.
  // Both reuse WebGameClientMessage (cardsView2 + multiAmount fields
  // added in schema 1.25).
  gameChoosePile: (raw) => webGameClientMessageSchema.parse(raw),
  gameSelectMultiAmount: (raw) => webGameClientMessageSchema.parse(raw),
  // Distinct shape — WebAbilityPickerView, not GameClientMessage.
  gameChooseAbility: (raw) => webAbilityPickerViewSchema.parse(raw),
  // Slice 13: post-game-1 sideboarding prompt.
  sideboard: (raw) => webSideboardInfoSchema.parse(raw),
  // Slice 69c (ADR 0010 v2 D11b): synthetic teardown signal when a
  // player leaves. Consumer (slice 69d) dismisses any open dialog
  // targeting the leaver. Validated here so a malformed frame is
  // surfaced as a parse error rather than silently swallowed.
  dialogClear: (raw) => webDialogClearSchema.parse(raw),
};

/**
 * Endpoint kind. {@code 'game'} → {@code /api/games/{id}/stream};
 * {@code 'room'} → {@code /api/rooms/{id}/stream}. Both share the
 * envelope contract; different server-side handlers wire the
 * specifics (game-state dispatch vs lobby chat). Defaults to
 * {@code 'game'} when unspecified, preserving the slice 5A constructor
 * shape for callers that don't care.
 */
export type StreamEndpoint = 'game' | 'room';

export interface GameStreamOptions {
  gameId: string;
  token: string;
  /**
   * Which WS route to connect to. {@code 'game'} (default) hits the
   * game-stream handler at {@code /api/games/{gameId}/stream}.
   * {@code 'room'} hits the lobby/room handler at
   * {@code /api/rooms/{gameId}/stream} — the {@code gameId} field
   * carries the roomId in that case (overloaded for symmetry).
   */
  endpoint?: StreamEndpoint;
  /**
   * Disable auto-reconnect. Defaults to {@code true} (reconnect on
   * unexpected close). Tests that drive lifecycle manually pass
   * {@code false} to keep close events terminal.
   */
  autoReconnect?: boolean;
  /** Test-only WebSocket constructor injection. Defaults to global. */
  webSocketCtor?: typeof WebSocket;
  /**
   * Test-only timer hook. Defaults to {@link setTimeout} /
   * {@link clearTimeout} on globalThis. Tests can advance Vitest fake
   * timers without monkey-patching globals.
   */
  scheduler?: {
    set: (cb: () => void, ms: number) => unknown;
    clear: (handle: unknown) => void;
  };
}

// Auditor #3 (2026-04-29) flagged the previous 4-attempt / 7.5s cap
// as too short — a 30-second flaky-Wi-Fi blip permanently disconnects
// the game and the user must reload. Extended to 8 attempts totaling
// ~75.5s of retry window before giving up. Still bounded so the
// client doesn't retry forever on a genuine server outage.
//
// Values deliberately avoid 30000 to keep them distinct from
// KEEPALIVE_MS in the test scheduler's reconnect-vs-keepalive
// timer filter (stream.test.ts:312).
const RECONNECT_BACKOFF_MS = [500, 1000, 2000, 4000, 8000, 15000, 20000, 25000] as const;

/**
 * Slice 38: how often the client sends a {@code keepalive} frame
 * to keep the WS link from being idled out by the server (5min) or
 * intermediate proxies (often as low as 60s). 30s is well below
 * any common idle threshold and adds negligible bandwidth (~1
 * tiny JSON message per 30s).
 */
const KEEPALIVE_INTERVAL_MS = 30_000;

/**
 * Close codes that are permanent failures — retrying won't help and
 * usually re-attempts will hit the same wall (auth still bad,
 * gameId still malformed). Surface the close to the user instead.
 *
 * <p>{@code 4001} — auth failed at upgrade (token missing, unknown,
 * or expired). {@code 4003} — request well-formed but rejected
 * (gameId malformed, room chat not registered).
 */
// P2 audit fix — 4400 PROTOCOL_VERSION_UNSUPPORTED is a permanent
// reject (server speaks a different major version than this client);
// retrying the same handshake 8× over ~75s won't change the answer.
// Adding it here also surfaces the user-visible auth-error path
// instead of the silent retry storm.
const NO_RETRY_CLOSE_CODES = new Set<number>([4001, 4003, 4400]);

export class GameStream {
  private socket: WebSocket | null = null;
  private readonly gameId: string;
  private readonly token: string;
  private readonly endpoint: StreamEndpoint;
  private readonly autoReconnect: boolean;
  private readonly Ctor: typeof WebSocket;
  private readonly scheduler: NonNullable<GameStreamOptions['scheduler']>;
  private closedByCaller = false;
  private reconnectAttempt = 0;
  private reconnectTimer: unknown = null;
  /**
   * Slice 38: periodic keepalive timer. Server's WS idle timeout is
   * 5 minutes (GameStreamHandler.IDLE_TIMEOUT); intermediate proxies
   * (corporate, ISP, OS network stack) often drop idle WS earlier.
   * Sending a tiny "keepalive" frame every 30s keeps the link alive
   * across AFK windows. Server-side handlers no-op the frame; we
   * just need the bytes to reset everyone's idle timer.
   */
  private keepaliveTimer: unknown = null;
  /**
   * P1 audit fix — visibilitychange listener handle so we can detach
   * on close(). When the tab returns to foreground, force a fresh
   * close+open so the resume path (?since=lastMessageId) catches up
   * any frames the server emitted while the tab was frozen by the
   * OS (mobile backgrounding) or suspended by the browser.
   */
  private visibilityHandler: (() => void) | null = null;

  constructor(options: GameStreamOptions) {
    this.gameId = options.gameId;
    this.token = options.token;
    this.endpoint = options.endpoint ?? 'game';
    this.autoReconnect = options.autoReconnect ?? true;
    this.Ctor = options.webSocketCtor ?? WebSocket;
    this.scheduler = options.scheduler ?? {
      set: (cb, ms) => setTimeout(cb, ms),
      clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    };
  }

  open(): void {
    if (this.socket) {
      return;
    }
    // Reset the caller-close flag — open() is the explicit "I want a
    // live connection" signal, even after a previous close().
    this.closedByCaller = false;
    // P1 audit fix — install the visibilitychange listener once per
    // GameStream lifetime. When the OS freezes the tab or backgrounds
    // it, the WS may die silently (the close event might not fire
    // until the OS thaws the tab). On return-to-foreground, force a
    // close+open so the resume path catches any missed frames. The
    // handler self-guards against duplicate triggers (already-open
    // sockets are no-op via the early return at the top of open()).
    this.installVisibilityHandler();
    const wsBase = toWsBase(httpBase);
    const path = this.endpoint === 'room' ? 'rooms' : 'games';
    // Resume from the last seen messageId on the game endpoint —
    // server replays buffered frames past that point so dialogs and
    // late updates aren't lost across the disconnect window. The
    // room endpoint has no replay buffer, so the param is harmless
    // there but skipped to avoid noise in server logs.
    const since =
      this.endpoint === 'game' && this.reconnectAttempt > 0
        ? useGameStore.getState().lastMessageId
        : 0;
    const sinceQuery = since > 0 ? `&since=${since}` : '';
    // Slice 69a — ADR 0010 v2 D12: the webclient pins itself to v2 of
    // the handshake protocol. Server validates against
    // ProtocolVersion.SUPPORTED and closes 4400 on mismatch (so a
    // server still on v1 only would reject this client cleanly rather
    // than letting a silent semantics drift through). The query-param
    // shape is forward-compat for v3+: clients that need to declare a
    // higher version simply bump the literal here.
    const protocolQuery = `&protocolVersion=${PROTOCOL_VERSION}`;
    const url =
      `${wsBase}/api/${path}/${encodeURIComponent(this.gameId)}/stream` +
      `?token=${encodeURIComponent(this.token)}${sinceQuery}${protocolQuery}`;

    useGameStore.getState().setConnection('connecting');
    let socket: WebSocket;
    try {
      socket = new this.Ctor(url);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'WebSocket open failed';
      useGameStore.getState().setConnection('error', message);
      this.maybeScheduleReconnect();
      return;
    }
    this.socket = socket;

    // All event listeners guard on `this.socket === socket`. React 19
    // StrictMode dev runs effects setup → cleanup → setup, so a
    // freshly-opened stream may have its socket replaced before the
    // OS-level close of the prior socket actually fires its async
    // close event. Without the guard, that stale event would clobber
    // the new socket's connection state and leave the user staring
    // at "Connection closed."
    socket.addEventListener('open', () => {
      if (this.socket !== socket) return;
      this.reconnectAttempt = 0;
      useGameStore.getState().setConnection('open');
      this.startKeepalive(socket);
    });

    socket.addEventListener('message', (ev: MessageEvent) => {
      if (this.socket !== socket) return;
      this.handleMessage(typeof ev.data === 'string' ? ev.data : '');
    });

    socket.addEventListener('error', () => {
      if (this.socket !== socket) return;
      useGameStore.getState().setConnection('error', 'WebSocket error');
    });

    socket.addEventListener('close', (ev: CloseEvent) => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.cancelKeepalive();
      useGameStore
        .getState()
        .setConnection('closed', ev.reason || `code ${ev.code}`);
      if (this.closedByCaller) {
        return;
      }
      if (NO_RETRY_CLOSE_CODES.has(ev.code)) {
        // Permanent failure — surface as connection error so the UI
        // shows a clear message rather than 'closed' (which looks
        // like a normal hangup).
        useGameStore
          .getState()
          .setConnection('error', ev.reason || `auth failed (${ev.code})`);
        // P0 audit fix — propagate the auth failure into the auth
        // store so the SPA's auth gate kicks the user back to the
        // login page. Without this, a 4001 (UPSTREAM_NO_USER, e.g.
        // server bounced and the upstream session is gone) or 4003
        // (NOT_A_PLAYER_IN_GAME) leaves the user stuck with a stale
        // bearer token + a broken WS — no path forward except a
        // manual page refresh. Reproduced live earlier in the session
        // ("Server refused to create the table").
        //
        // logout() is async (DELETE /api/sessions); we fire-and-
        // forget. Local state clears synchronously (auth/store.ts
        // setSession(null)), which is what triggers the re-route.
        void useAuthStore.getState().logout();
        return;
      }
      this.maybeScheduleReconnect();
    });
  }

  close(code = 1000, reason = 'client navigation'): void {
    this.closedByCaller = true;
    this.cancelReconnect();
    this.cancelKeepalive();
    this.removeVisibilityHandler();
    // Null out our reference *before* requesting the OS close. A
    // subsequent open() in the same tick (StrictMode double-mount)
    // can then proceed without short-circuiting on `this.socket`.
    // The old socket's deferred close listener is silenced via the
    // `this.socket !== socket` guard installed above; we transition
    // user-facing connection state synchronously here so the UI
    // reflects the close immediately rather than waiting on the
    // (now-silent) async event.
    const oldSocket = this.socket;
    this.socket = null;
    if (oldSocket) {
      useGameStore.getState().setConnection('closed', reason);
    }
    oldSocket?.close(code, reason);
  }

  /**
   * Schedule the next reconnect attempt with exponential backoff.
   * No-op once the attempt cap is hit — the user must reload (or a
   * future "Reconnect" button trigger another open()) to retry past
   * that point. Auto-reconnect can be globally disabled via the
   * constructor option.
   *
   * <p>P1 audit fix — when the cap is reached, surface a terminal
   * error state (`reconnect-failed`) so the UI can show a manual
   * "Reconnect" button instead of leaving the user staring at a
   * frozen "closed" message. {@link manualReconnect} resets the
   * attempt counter and re-opens. Without this, a flaky wifi user
   * past ~75s of dropouts had no recovery affordance short of a
   * full page refresh (which loses unsubmitted clicks / draft state).
   */
  private maybeScheduleReconnect(): void {
    if (!this.autoReconnect || this.closedByCaller) {
      return;
    }
    if (this.reconnectAttempt >= RECONNECT_BACKOFF_MS.length) {
      useGameStore
        .getState()
        .setConnection(
          'error',
          'Connection lost — automatic reconnect gave up. Click reconnect to retry.',
        );
      return;
    }
    const delay = RECONNECT_BACKOFF_MS[this.reconnectAttempt] ?? 25_000;
    this.reconnectAttempt += 1;
    this.reconnectTimer = this.scheduler.set(() => {
      this.reconnectTimer = null;
      this.open();
    }, delay);
  }

  /**
   * P1 audit fix — public hook for the UI to manually retry the
   * connection after the auto-reconnect cap. Resets the attempt
   * counter so the full backoff ladder is available again, then
   * fires {@link open}. No-op when the socket is already open or
   * the caller has explicitly closed.
   */
  manualReconnect(): void {
    if (this.closedByCaller) return;
    if (this.socket && this.socket.readyState === WebSocket.OPEN) return;
    this.cancelReconnect();
    this.reconnectAttempt = 0;
    this.open();
  }

  /**
   * P1 audit fix — install a visibilitychange listener that forces
   * a reconnect when the tab returns to foreground. Idempotent: a
   * second call is a no-op. Removed in {@link close} so a closed
   * stream doesn't keep listening forever.
   */
  private installVisibilityHandler(): void {
    if (this.visibilityHandler) return;
    if (typeof document === 'undefined') return;
    const handler = () => {
      if (document.visibilityState !== 'visible') return;
      if (this.closedByCaller) return;
      // If socket is open and healthy, no-op. If closed/closing/null,
      // trigger an immediate reconnect (bypass backoff — the user
      // just returned and expects responsiveness).
      const socket = this.socket;
      if (socket && socket.readyState === WebSocket.OPEN) return;
      this.cancelReconnect();
      this.reconnectAttempt = 0;
      // Force a fresh socket via close + open so the resume path
      // (?since=lastMessageId) catches up any missed frames. If
      // socket is null, just open.
      if (socket) {
        try {
          socket.close(1000, 'tab returned');
        } catch {
          // ignore
        }
        this.socket = null;
      }
      this.open();
    };
    document.addEventListener('visibilitychange', handler);
    this.visibilityHandler = handler;
  }

  private removeVisibilityHandler(): void {
    if (!this.visibilityHandler) return;
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
    }
    this.visibilityHandler = null;
  }

  private cancelReconnect(): void {
    if (this.reconnectTimer != null) {
      this.scheduler.clear(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempt = 0;
  }

  /**
   * Slice 38: start the keepalive interval for a freshly-open
   * socket. Sends `{ "type": "keepalive" }` every 30s while the
   * socket is OPEN; cancels itself when the socket is replaced or
   * closed. The server's switch arms a no-op for this type — the
   * data on the wire is what matters.
   */
  private startKeepalive(socket: WebSocket): void {
    this.cancelKeepalive();
    this.keepaliveTimer = this.scheduler.set(() => {
      this.keepaliveTimer = null;
      if (this.socket !== socket || socket.readyState !== WebSocket.OPEN) {
        return;
      }
      try {
        socket.send(JSON.stringify({ type: 'keepalive' }));
      } catch {
        // Send may fail on a closing socket — close handler will
        // clean up; nothing to do here.
      }
      // Re-arm. Recursive scheduling instead of setInterval so we
      // align with the existing scheduler abstraction (test injects
      // its own setTimeout/clearTimeout).
      this.startKeepalive(socket);
    }, KEEPALIVE_INTERVAL_MS);
  }

  private cancelKeepalive(): void {
    if (this.keepaliveTimer != null) {
      this.scheduler.clear(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
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
   * Free-priority object click — used when the player clicks a card
   * in hand to cast it, or clicks a permanent on the battlefield to
   * tap/activate it. Routes through the same upstream
   * {@code sendPlayerUUID} method as a uuid dialog response, but
   * carries {@code messageId: 0} so the server doesn't try to
   * correlate it with an outstanding dialog frame.
   *
   * <p>Upstream's {@code Player.priorityPlay()} loop polls the latest
   * UUID via {@code getPlayerResponse()}; the same dispatch handles
   * both dialog answers and free-priority clicks.
   */
  sendObjectClick(objectId: string): void {
    this.sendPlayerResponse(0, 'uuid', objectId);
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
      // P2 audit fix — surface dropped sends in the store so the UI
      // can show a "your last action didn't reach the server" hint
      // instead of leaving the user wondering why their click did
      // nothing. Cleared automatically when the connection re-opens.
      const type =
        (envelope as { type?: unknown }).type === 'string' ||
        typeof (envelope as { type?: unknown }).type === 'string'
          ? String((envelope as { type: string }).type)
          : 'unknown';
      useGameStore.getState().noteSendDropped(type);
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

    // Slice 70-X.13 (Wave 4) — symmetry with HTTP envelope's major-
    // version check ({@link client.ts:184}). The HTTP path refused
    // mismatched majors; the WebSocket path silently accepted them
    // and relied on per-method Zod {@code .default()} fall-throughs
    // to limp along — heroic but invisible. A server with a major
    // schema bump that still speaks our protocolVersion would slip
    // through and produce cryptic per-frame parse errors. Now we
    // enforce the major contract at the envelope layer (one place
    // to keep correct) and surface a connection-level error if the
    // server steps outside.
    if (typeof envelope.schemaVersion === 'string') {
      const parts = parseSchemaVersion(envelope.schemaVersion);
      if (parts && parts.major !== EXPECTED_SCHEMA_MAJOR) {
        const errorMessage =
          `Wire-format major version ${parts.major} != expected `
            + `${EXPECTED_SCHEMA_MAJOR}; refusing frames.`;
        // P1 audit fix — close the socket on major mismatch FIRST,
        // then set the error state. close() calls setConnection
        // ('closed', ...) internally so the order matters: setting
        // error AFTER close ensures the user-visible state is the
        // explicit error message, not 'closed'. Without this fix,
        // the WS stayed open and a slow follow-up frame would reset
        // state, hiding the wire-rejection from the user.
        this.close(1011, 'schema mismatch');
        useGameStore.getState().setConnection('error', errorMessage);
        return;
      }
    }

    let validatedData: unknown = envelope.data;
    const validator = DATA_VALIDATORS[envelope.method];
    if (validator) {
      try {
        validatedData = validator(envelope.data);
      } catch (err) {
        // Slice 70-X.13 (Wave 3) — fail closed on validation error.
        // Pre-Wave-3 we logged + passed the raw envelope.data through;
        // the store then cast `unknown` → typed shape (WebGameClientMessage,
        // etc.) and any downstream `dialog.data.targets` access threw at
        // runtime against the unvalidated payload. Skipping the frame
        // localizes the failure: one frame is dropped, the next valid
        // gameUpdate replaces local state, and the user sees a one-frame
        // stutter instead of a crashed render. The error is loud
        // (console.error not warn) so a validator regression surfaces
        // immediately during dev / CI.
        //
        // Crucially, lastMessageId STILL advances — on reconnect we
        // want ?since=<this-id> so the server doesn't re-deliver the
        // broken frame. The data was lost; the position is not.
        if (typeof console !== 'undefined') {
          console.error(
            `GameStream: dropping frame — data validation failed for method=${envelope.method}`,
            err,
          );
        }
        if (envelope.messageId > useGameStore.getState().lastMessageId) {
          useGameStore.setState({ lastMessageId: envelope.messageId });
        }
        return;
      }
    }

    useGameStore.getState().applyFrame(envelope, validatedData);
  }
}
