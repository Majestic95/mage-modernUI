import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameStream } from './stream';
import { useGameStore } from './store';

/**
 * Minimal in-memory WebSocket double that satisfies the subset of
 * the standard API we use: addEventListener, close, readyState +
 * the static OPEN constant. Tests drive lifecycle via the helper
 * methods {@code _open}, {@code _message}, {@code _close}.
 */
class FakeWebSocket {
  static OPEN = 1;
  static CLOSED = 3;

  url: string;
  readyState = 0;
  private listeners = new Map<string, Set<(ev: unknown) => void>>();

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.lastUrl = url;
    FakeWebSocket.instances.push(this);
  }

  static lastUrl = '';
  static instances: FakeWebSocket[] = [];
  static reset() {
    FakeWebSocket.lastUrl = '';
    FakeWebSocket.instances = [];
  }

  addEventListener(event: string, fn: (ev: unknown) => void): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(fn);
  }

  close(code = 1000, reason = ''): void {
    this.readyState = FakeWebSocket.CLOSED;
    this._close(code, reason);
  }

  sent: string[] = [];
  send(data: string): void {
    this.sent.push(data);
  }

  _open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.listeners.get('open')?.forEach((fn) => fn({}));
  }

  _message(text: string): void {
    this.listeners.get('message')?.forEach((fn) => fn({ data: text }));
  }

  _close(code = 1000, reason = 'normal'): void {
    this.listeners.get('close')?.forEach((fn) => fn({ code, reason }));
  }

  _error(): void {
    this.listeners.get('error')?.forEach((fn) => fn({}));
  }
}

const FAKE_GAME_ID = '550e8400-e29b-41d4-a716-446655440000';

describe('GameStream', () => {
  beforeEach(() => {
    FakeWebSocket.reset();
    useGameStore.getState().reset();
  });

  afterEach(() => {
    FakeWebSocket.reset();
  });

  it('open() builds the ws:// URL and sets connecting state', () => {
    const stream = new GameStream({
      gameId: FAKE_GAME_ID,
      token: 'tok-1',
      webSocketCtor: FakeWebSocket as unknown as typeof WebSocket,
    });
    stream.open();

    expect(FakeWebSocket.lastUrl).toContain('/api/games/' + FAKE_GAME_ID + '/stream');
    expect(FakeWebSocket.lastUrl).toContain('token=tok-1');
    // Slice 69a — ADR 0010 v2 D12: webclient pins to protocolVersion=2
    // on every WS upgrade so a v1-only server rejects cleanly with
    // close 4400 instead of silently speaking the wrong contract.
    expect(FakeWebSocket.lastUrl).toContain('protocolVersion=2');
    expect(FakeWebSocket.lastUrl.startsWith('ws://')).toBe(true);
    expect(useGameStore.getState().connection).toBe('connecting');
  });

  it('open event transitions to open state', () => {
    const stream = new GameStream({
      gameId: FAKE_GAME_ID,
      token: 'tok-1',
      webSocketCtor: FakeWebSocket as unknown as typeof WebSocket,
    });
    stream.open();
    FakeWebSocket.instances[0]!._open();
    expect(useGameStore.getState().connection).toBe('open');
  });

  it('valid streamHello frame is parsed and acknowledged', () => {
    const stream = new GameStream({
      gameId: FAKE_GAME_ID,
      token: 'tok-1',
      webSocketCtor: FakeWebSocket as unknown as typeof WebSocket,
    });
    stream.open();
    FakeWebSocket.instances[0]!._open();
    FakeWebSocket.instances[0]!._message(
      JSON.stringify({
        schemaVersion: '1.15',
        method: 'streamHello',
        messageId: 0,
        objectId: FAKE_GAME_ID,
        data: { gameId: FAKE_GAME_ID, username: 'alice', mode: 'live' },
      }),
    );
    expect(useGameStore.getState().lastMessageId).toBe(0);
    expect(useGameStore.getState().gameView).toBeNull();
  });

  it('streamError frame surfaces protocolError on the store', () => {
    const stream = new GameStream({
      gameId: FAKE_GAME_ID,
      token: 'tok-1',
      webSocketCtor: FakeWebSocket as unknown as typeof WebSocket,
    });
    stream.open();
    FakeWebSocket.instances[0]!._open();
    FakeWebSocket.instances[0]!._message(
      JSON.stringify({
        schemaVersion: '1.15',
        method: 'streamError',
        messageId: 0,
        objectId: null,
        data: { code: 'BAD_REQUEST', message: 'malformed' },
      }),
    );
    expect(useGameStore.getState().protocolError).toContain('BAD_REQUEST');
  });

  it('malformed envelope JSON sets connection to error', () => {
    const stream = new GameStream({
      gameId: FAKE_GAME_ID,
      token: 'tok-1',
      webSocketCtor: FakeWebSocket as unknown as typeof WebSocket,
    });
    stream.open();
    FakeWebSocket.instances[0]!._open();
    FakeWebSocket.instances[0]!._message('this is not json');
    expect(useGameStore.getState().connection).toBe('error');
    expect(useGameStore.getState().closeReason).toContain('bad frame');
  });

  it('close() flags closedByCaller and closes the socket', () => {
    const stream = new GameStream({
      gameId: FAKE_GAME_ID,
      token: 'tok-1',
      webSocketCtor: FakeWebSocket as unknown as typeof WebSocket,
    });
    stream.open();
    FakeWebSocket.instances[0]!._open();
    stream.close();
    expect(stream.wasClosedByCaller()).toBe(true);
    expect(useGameStore.getState().connection).toBe('closed');
  });

  it('encodes special characters in gameId and token', () => {
    const stream = new GameStream({
      gameId: 'a/b',
      token: 'a b',
      webSocketCtor: FakeWebSocket as unknown as typeof WebSocket,
    });
    stream.open();
    expect(FakeWebSocket.lastUrl).toContain('a%2Fb');
    expect(FakeWebSocket.lastUrl).toContain('a%20b');
  });

  it('endpoint=room hits /api/rooms/{id}/stream instead of /api/games/...', () => {
    const stream = new GameStream({
      gameId: FAKE_GAME_ID, // overloaded as roomId for room mode
      token: 'tok-1',
      endpoint: 'room',
      webSocketCtor: FakeWebSocket as unknown as typeof WebSocket,
    });
    stream.open();
    expect(FakeWebSocket.lastUrl).toContain('/api/rooms/' + FAKE_GAME_ID + '/stream');
    expect(FakeWebSocket.lastUrl).not.toContain('/api/games/');
  });

  it('endpoint defaults to game when unspecified', () => {
    const stream = new GameStream({
      gameId: FAKE_GAME_ID,
      token: 'tok-1',
      webSocketCtor: FakeWebSocket as unknown as typeof WebSocket,
    });
    stream.open();
    expect(FakeWebSocket.lastUrl).toContain('/api/games/' + FAKE_GAME_ID + '/stream');
  });

  /* ---------- slice B: outbound sends ---------- */

  it('sendPlayerAction serializes the envelope and writes to the socket', () => {
    const stream = new GameStream({
      gameId: FAKE_GAME_ID,
      token: 'tok-1',
      webSocketCtor: FakeWebSocket as unknown as typeof WebSocket,
    });
    stream.open();
    const fake = FakeWebSocket.instances[0]!;
    fake._open();
    const sendSpy = vi.spyOn(fake, 'send' as never);
    stream.sendPlayerAction('PASS_PRIORITY_UNTIL_NEXT_TURN');
    expect(sendSpy).toHaveBeenCalledTimes(1);
    const body = JSON.parse(sendSpy.mock.calls[0]![0] as string);
    expect(body).toEqual({
      type: 'playerAction',
      action: 'PASS_PRIORITY_UNTIL_NEXT_TURN',
      data: null,
    });
  });

  it('sendPlayerResponse encodes kind + value + messageId', () => {
    const stream = new GameStream({
      gameId: FAKE_GAME_ID,
      token: 'tok-1',
      webSocketCtor: FakeWebSocket as unknown as typeof WebSocket,
    });
    stream.open();
    const fake = FakeWebSocket.instances[0]!;
    fake._open();
    const sendSpy = vi.spyOn(fake, 'send' as never);
    stream.sendPlayerResponse(42, 'boolean', true);
    const body = JSON.parse(sendSpy.mock.calls[0]![0] as string);
    expect(body).toEqual({
      type: 'playerResponse',
      messageId: 42,
      kind: 'boolean',
      value: true,
    });
  });

  it('sendChat encodes chatId and message', () => {
    const stream = new GameStream({
      gameId: FAKE_GAME_ID,
      token: 'tok-1',
      webSocketCtor: FakeWebSocket as unknown as typeof WebSocket,
    });
    stream.open();
    const fake = FakeWebSocket.instances[0]!;
    fake._open();
    const sendSpy = vi.spyOn(fake, 'send' as never);
    stream.sendChat('00000000-0000-0000-0000-000000000000', 'gg');
    const body = JSON.parse(sendSpy.mock.calls[0]![0] as string);
    expect(body).toEqual({
      type: 'chatSend',
      chatId: '00000000-0000-0000-0000-000000000000',
      message: 'gg',
    });
  });

  it('send drops silently when socket is not open', () => {
    const stream = new GameStream({
      gameId: FAKE_GAME_ID,
      token: 'tok-1',
      webSocketCtor: FakeWebSocket as unknown as typeof WebSocket,
    });
    stream.open();
    // Note: never call _open() — readyState stays 0 (CONNECTING).
    const fake = FakeWebSocket.instances[0]!;
    const sendSpy = vi.spyOn(fake, 'send' as never);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    stream.sendPlayerAction('CONCEDE');
    expect(sendSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
  });

  /* ---------- slice 9: auto-reconnect ---------- */

  /**
   * Test scheduler that records pending timers and lets us fire them
   * synchronously. Vitest fake timers would also work, but the
   * injected scheduler keeps the test isolated from any global timer
   * state and matches the production injection contract.
   */
  function makeFakeScheduler() {
    const queued: { cb: () => void; ms: number; cancelled: boolean }[] = [];
    return {
      queued,
      // Slice 38: keepalive uses the same scheduler now (one extra
      // entry per open()). Helpers below filter it out so the
      // reconnect-flow assertions stay focused.
      reconnectTimer: () =>
        queued.find((q) => !q.cancelled && q.ms !== KEEPALIVE_MS),
      activeReconnectQueue: () =>
        queued.filter((q) => !q.cancelled && q.ms !== KEEPALIVE_MS),
      scheduler: {
        set: (cb: () => void, ms: number) => {
          const entry = { cb, ms, cancelled: false };
          queued.push(entry);
          return entry;
        },
        clear: (handle: unknown) => {
          (handle as { cancelled: boolean }).cancelled = true;
        },
      },
      fireNext: () => {
        // Skip cancelled and skip keepalive — fireNext is only used
        // to advance reconnect-driven flow.
        const next = queued.find(
          (q) => !q.cancelled && q.ms !== KEEPALIVE_MS,
        );
        if (!next) throw new Error('No pending timer to fire');
        next.cancelled = true;
        next.cb();
      },
    };
  }
  const KEEPALIVE_MS = 30_000;

  it('auto-reconnects on unexpected close with backoff', () => {
    const sched = makeFakeScheduler();
    const stream = new GameStream({
      gameId: FAKE_GAME_ID,
      token: 'tok-1',
      webSocketCtor: FakeWebSocket as unknown as typeof WebSocket,
      scheduler: sched.scheduler,
    });
    stream.open();
    FakeWebSocket.instances[0]!._open();
    expect(useGameStore.getState().connection).toBe('open');

    // Server-side close (not caller-initiated, not auth code).
    FakeWebSocket.instances[0]!._close(1006, 'connection lost');
    expect(useGameStore.getState().connection).toBe('closed');
    expect(sched.activeReconnectQueue()).toHaveLength(1);
    expect(sched.reconnectTimer()!.ms).toBe(500);

    sched.fireNext();
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(useGameStore.getState().connection).toBe('connecting');
  });

  it('reconnect URL carries ?since=<lastMessageId> on game endpoint', () => {
    const sched = makeFakeScheduler();
    const stream = new GameStream({
      gameId: FAKE_GAME_ID,
      token: 'tok-1',
      webSocketCtor: FakeWebSocket as unknown as typeof WebSocket,
      scheduler: sched.scheduler,
    });
    stream.open();
    const first = FakeWebSocket.instances[0]!;
    first._open();
    // Slice 70-X.13 (Wave 3) — lastMessageId still advances on
    // validation failure (so reconnect resumes at the next frame, not
    // re-receives the broken one). Send a malformed gameUpdate and
    // assert the cursor advances even though the frame's data is
    // dropped.
    first._message(
      JSON.stringify({
        schemaVersion: '1.15',
        method: 'gameUpdate',
        messageId: 7,
        objectId: FAKE_GAME_ID,
        data: {},
      }),
    );
    expect(useGameStore.getState().lastMessageId).toBe(7);
    // Frame was dropped (gameView is still null) but the cursor
    // advanced for reconnect purposes.
    expect(useGameStore.getState().gameView).toBeNull();

    first._close(1011, 'server crash');
    sched.fireNext();
    expect(FakeWebSocket.lastUrl).toContain('since=7');
  });

  // Slice 70-X.13 (Wave 4) — symmetry with HTTP envelope's major-
  // version check. A server with a bumped major schemaVersion (still
  // speaking our protocolVersion) would slip through silently
  // pre-Wave-4 — per-method validators with .default() limped along
  // but the contract semantics could drift arbitrarily. Now we refuse.
  it('major-version mismatch on a frame surfaces connection error and drops the frame', () => {
    const stream = new GameStream({
      gameId: FAKE_GAME_ID,
      token: 'tok-1',
      webSocketCtor: FakeWebSocket as unknown as typeof WebSocket,
    });
    stream.open();
    const sock = FakeWebSocket.instances[0]!;
    sock._open();
    // Reset to known state.
    useGameStore.getState().setConnection('open', null);
    // Send a frame with major-version 99 — well above EXPECTED.
    sock._message(
      JSON.stringify({
        schemaVersion: '99.0',
        method: 'gameUpdate',
        messageId: 5,
        objectId: FAKE_GAME_ID,
        data: {},
      }),
    );
    expect(useGameStore.getState().connection).toBe('error');
    expect(useGameStore.getState().closeReason ?? '').toMatch(
      /major version/i,
    );
  });

  // Slice 70-X.13 (Wave 3) — fail-closed contract. A frame whose data
  // fails per-method validation MUST be dropped (no applyFrame call,
  // no half-validated state), but lastMessageId STILL advances so
  // reconnect doesn't redeliver. Pre-Wave-3 the frame was passed
  // through with raw data → applyFrame cast `unknown` to typed shapes
  // → downstream `dialog.data.targets` access threw at runtime.
  it('validation failure drops the frame but advances lastMessageId', () => {
    const stream = new GameStream({
      gameId: FAKE_GAME_ID,
      token: 'tok-1',
      webSocketCtor: FakeWebSocket as unknown as typeof WebSocket,
    });
    stream.open();
    const sock = FakeWebSocket.instances[0]!;
    sock._open();
    // Suppress the expected console.error so the suite output stays
    // clean — the fail-closed path logs at error level by design.
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      sock._message(
        JSON.stringify({
          schemaVersion: '1.15',
          method: 'gameTarget',
          messageId: 11,
          objectId: FAKE_GAME_ID,
          // gameTarget data must be a WebGameClientMessage; this is not.
          data: { totally: 'wrong-shape' },
        }),
      );
      // Cursor advanced (reconnect contract).
      expect(useGameStore.getState().lastMessageId).toBe(11);
      // Dialog NOT applied — pendingDialog stays null.
      expect(useGameStore.getState().pendingDialog).toBeNull();
      // The fail-closed path logged the drop.
      expect(errSpy).toHaveBeenCalled();
    } finally {
      errSpy.mockRestore();
    }
  });

  it('does not retry on 4001 auth-failure close', () => {
    const sched = makeFakeScheduler();
    const stream = new GameStream({
      gameId: FAKE_GAME_ID,
      token: 'tok-1',
      webSocketCtor: FakeWebSocket as unknown as typeof WebSocket,
      scheduler: sched.scheduler,
    });
    stream.open();
    FakeWebSocket.instances[0]!._open();
    FakeWebSocket.instances[0]!._close(4001, 'INVALID_TOKEN');

    expect(sched.activeReconnectQueue()).toHaveLength(0);
    expect(useGameStore.getState().connection).toBe('error');
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('caller-initiated close cancels pending reconnect', () => {
    const sched = makeFakeScheduler();
    const stream = new GameStream({
      gameId: FAKE_GAME_ID,
      token: 'tok-1',
      webSocketCtor: FakeWebSocket as unknown as typeof WebSocket,
      scheduler: sched.scheduler,
    });
    stream.open();
    FakeWebSocket.instances[0]!._open();
    FakeWebSocket.instances[0]!._close(1006, 'lost');
    expect(sched.activeReconnectQueue()).toHaveLength(1);

    stream.close();
    // Pending reconnect cancelled — firing it would no-op via the
    // cancel flag, but we also expect attemptCount to reset; the
    // safer assertion is that no live reconnect timer remains.
    expect(sched.activeReconnectQueue()).toHaveLength(0);
  });

  it('autoReconnect=false suppresses reconnect attempts', () => {
    const sched = makeFakeScheduler();
    const stream = new GameStream({
      gameId: FAKE_GAME_ID,
      token: 'tok-1',
      autoReconnect: false,
      webSocketCtor: FakeWebSocket as unknown as typeof WebSocket,
      scheduler: sched.scheduler,
    });
    stream.open();
    FakeWebSocket.instances[0]!._open();
    FakeWebSocket.instances[0]!._close(1006, 'lost');
    expect(sched.activeReconnectQueue()).toHaveLength(0);
  });

  it('successful reopen resets attempt counter (next failure starts at 500ms)', () => {
    const sched = makeFakeScheduler();
    const stream = new GameStream({
      gameId: FAKE_GAME_ID,
      token: 'tok-1',
      webSocketCtor: FakeWebSocket as unknown as typeof WebSocket,
      scheduler: sched.scheduler,
    });
    stream.open();
    FakeWebSocket.instances[0]!._open();
    FakeWebSocket.instances[0]!._close(1006, 'lost');
    expect(sched.reconnectTimer()!.ms).toBe(500);

    sched.fireNext();
    FakeWebSocket.instances[1]!._open();
    expect(useGameStore.getState().connection).toBe('open');

    FakeWebSocket.instances[1]!._close(1006, 'lost again');
    // Counter reset on successful open — next backoff starts at 500ms.
    expect(sched.reconnectTimer()!.ms).toBe(500);
  });

  /* ---------- slice 38: keepalive heartbeat ---------- */

  it('schedules a keepalive timer at 30s after the socket opens', () => {
    const sched = makeFakeScheduler();
    const stream = new GameStream({
      gameId: FAKE_GAME_ID,
      token: 'tok-1',
      webSocketCtor: FakeWebSocket as unknown as typeof WebSocket,
      scheduler: sched.scheduler,
    });
    stream.open();
    FakeWebSocket.instances[0]!._open();
    const keepalive = sched.queued.find((q) => q.ms === KEEPALIVE_MS);
    expect(keepalive).toBeDefined();
    expect(keepalive!.cancelled).toBe(false);
  });

  it('firing the keepalive timer sends a {type:"keepalive"} frame', () => {
    const sched = makeFakeScheduler();
    const stream = new GameStream({
      gameId: FAKE_GAME_ID,
      token: 'tok-1',
      webSocketCtor: FakeWebSocket as unknown as typeof WebSocket,
      scheduler: sched.scheduler,
    });
    stream.open();
    const sock = FakeWebSocket.instances[0]!;
    sock._open();
    const keepalive = sched.queued.find(
      (q) => q.ms === KEEPALIVE_MS && !q.cancelled,
    )!;
    keepalive.cancelled = true;
    keepalive.cb();
    expect(sock.sent.some((s) => s.includes('"keepalive"'))).toBe(true);
  });

  it('keepalive cancels on socket close and does not send afterwards', () => {
    const sched = makeFakeScheduler();
    const stream = new GameStream({
      gameId: FAKE_GAME_ID,
      token: 'tok-1',
      autoReconnect: false,
      webSocketCtor: FakeWebSocket as unknown as typeof WebSocket,
      scheduler: sched.scheduler,
    });
    stream.open();
    const sock = FakeWebSocket.instances[0]!;
    sock._open();
    sock._close(1006, 'lost');
    const liveKeepalive = sched.queued.find(
      (q) => q.ms === KEEPALIVE_MS && !q.cancelled,
    );
    expect(liveKeepalive).toBeUndefined();
  });

  /**
   * React 19 StrictMode dev runs effects setup → cleanup → setup in
   * quick succession. The Game component uses a ref to one
   * GameStream instance per (session, gameId), so close() and
   * open() can fire on the same instance back-to-back without the
   * stream actually unmounting. The OS-level close on the first
   * socket fires async — without listener guards, that stale event
   * would clobber the connection state of the freshly-opened
   * second socket and leave the user staring at "Connection closed."
   */
  it('StrictMode-style close+open keeps the new connection live (no stale close)', () => {
    const sched = makeFakeScheduler();
    const stream = new GameStream({
      gameId: FAKE_GAME_ID,
      token: 'tok-1',
      webSocketCtor: FakeWebSocket as unknown as typeof WebSocket,
      scheduler: sched.scheduler,
    });

    stream.open();
    expect(FakeWebSocket.instances).toHaveLength(1);
    const first = FakeWebSocket.instances[0]!;

    // StrictMode-cleanup: close() before the first socket's open
    // event has fired. close() requests a deferred close on the
    // socket, but our caller-close path immediately transitions
    // connection state synchronously.
    stream.close();
    expect(useGameStore.getState().connection).toBe('closed');

    // StrictMode-setup #2: open() again. New socket spawned.
    stream.open();
    expect(FakeWebSocket.instances).toHaveLength(2);
    const second = FakeWebSocket.instances[1]!;
    expect(useGameStore.getState().connection).toBe('connecting');

    // The first socket's deferred close finally fires asynchronously
    // (FakeWebSocket.close calls _close immediately, but we'll
    // simulate the post-cleanup ordering by firing it now after the
    // second open). The stale-listener guard must silence this.
    first._close(1000, 'late');
    expect(useGameStore.getState().connection).toBe('connecting');

    // Second socket connects successfully → connection goes 'open'
    // and stays there.
    second._open();
    expect(useGameStore.getState().connection).toBe('open');
  });

  it('gives up after 8 attempts', () => {
    // Auditor #3 fix (2026-04-29): RECONNECT_BACKOFF_MS extended from
    // 4 attempts (~7.5s) to 8 attempts (~67.5s) so a moderate Wi-Fi
    // blip doesn't permanently disconnect the game. This test pins
    // the new cap.
    const sched = makeFakeScheduler();
    const stream = new GameStream({
      gameId: FAKE_GAME_ID,
      token: 'tok-1',
      webSocketCtor: FakeWebSocket as unknown as typeof WebSocket,
      scheduler: sched.scheduler,
    });
    stream.open();
    // Loop 8 retries: each one fires immediately on close, never
    // reaches _open(), so the attempt counter keeps climbing.
    for (let i = 0; i < 8; i += 1) {
      FakeWebSocket.instances[i]!._close(1006, 'fail');
      sched.fireNext();
    }
    // 9th close: 8 retries already used, no further timer scheduled.
    FakeWebSocket.instances[8]!._close(1006, 'final');
    const activePending = sched.queued.filter((q) => !q.cancelled);
    expect(activePending).toHaveLength(0);
  });

  // P1 audit fix — when the auto-reconnect cap is exhausted the
  // store's connection state should flip to 'error' with a clear
  // message so the UI can render a manual "Reconnect" button.
  it('reconnect cap exhaustion sets connection error with a clear message', () => {
    const sched = makeFakeScheduler();
    const stream = new GameStream({
      gameId: FAKE_GAME_ID,
      token: 't',
      webSocketCtor: FakeWebSocket as unknown as typeof WebSocket,
      scheduler: sched.scheduler,
    });
    stream.open();
    // Burn through all 8 retries — same shape as the test above.
    for (let i = 0; i < 8; i++) {
      FakeWebSocket.instances[i]!._close(1006, 'fail');
      sched.fireNext();
    }
    FakeWebSocket.instances[8]!._close(1006, 'final');
    expect(useGameStore.getState().connection).toBe('error');
    expect(useGameStore.getState().closeReason ?? '').toMatch(
      /reconnect|gave up/i,
    );
  });

  // P1 audit fix — manualReconnect resets the attempt counter and
  // re-opens the socket so a user past the auto-reconnect cap can
  // recover without a full page refresh.
  it('manualReconnect after cap exhaustion fires a fresh open', () => {
    const sched = makeFakeScheduler();
    const stream = new GameStream({
      gameId: FAKE_GAME_ID,
      token: 't',
      webSocketCtor: FakeWebSocket as unknown as typeof WebSocket,
      scheduler: sched.scheduler,
    });
    stream.open();
    for (let i = 0; i < 8; i++) {
      FakeWebSocket.instances[i]!._close(1006, 'fail');
      sched.fireNext();
    }
    FakeWebSocket.instances[8]!._close(1006, 'final');
    const before = FakeWebSocket.instances.length;
    stream.manualReconnect();
    expect(FakeWebSocket.instances.length).toBe(before + 1);
  });
});
