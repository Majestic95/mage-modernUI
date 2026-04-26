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

  send(data: string): void {
    // Stub — spied on by send-related tests. Reference data so the
    // arg isn't optimized out / flagged unused-vars.
    void data;
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
        schemaVersion: '1.13',
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
        schemaVersion: '1.13',
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
        const next = queued.find((q) => !q.cancelled);
        if (!next) throw new Error('No pending timer to fire');
        next.cancelled = true;
        next.cb();
      },
    };
  }

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
    expect(sched.queued).toHaveLength(1);
    expect(sched.queued[0]!.ms).toBe(500);

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
    // Simulate a few frames so lastMessageId advances. We send a
    // streamHello (messageId 0) and a synthetic gameUpdate at id 7.
    first._message(
      JSON.stringify({
        schemaVersion: '1.13',
        method: 'gameUpdate',
        messageId: 7,
        objectId: FAKE_GAME_ID,
        data: { /* gameUpdate validation may fail; ok — store still bumps id */ },
      }),
    );
    expect(useGameStore.getState().lastMessageId).toBe(7);

    first._close(1011, 'server crash');
    sched.fireNext();
    expect(FakeWebSocket.lastUrl).toContain('since=7');
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

    expect(sched.queued).toHaveLength(0);
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
    expect(sched.queued).toHaveLength(1);

    stream.close();
    // Pending timer cancelled — firing it would no-op via the cancel
    // flag, but we also expect attemptCount to reset; the safer
    // assertion is that no new socket is created after caller close.
    expect(sched.queued[0]!.cancelled).toBe(true);
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
    expect(sched.queued).toHaveLength(0);
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
    expect(sched.queued[0]!.ms).toBe(500);

    sched.fireNext();
    FakeWebSocket.instances[1]!._open();
    expect(useGameStore.getState().connection).toBe('open');

    FakeWebSocket.instances[1]!._close(1006, 'lost again');
    // Counter reset on successful open — next backoff starts at 500ms.
    expect(sched.queued[1]!.ms).toBe(500);
  });

  it('gives up after 4 attempts', () => {
    const sched = makeFakeScheduler();
    const stream = new GameStream({
      gameId: FAKE_GAME_ID,
      token: 'tok-1',
      webSocketCtor: FakeWebSocket as unknown as typeof WebSocket,
      scheduler: sched.scheduler,
    });
    stream.open();
    // Loop 4 retries: each one fires immediately on close, never
    // reaches _open(), so the attempt counter keeps climbing.
    for (let i = 0; i < 4; i += 1) {
      FakeWebSocket.instances[i]!._close(1006, 'fail');
      sched.fireNext();
    }
    // 5th close: 4 retries already used, no further timer scheduled.
    FakeWebSocket.instances[4]!._close(1006, 'final');
    const activePending = sched.queued.filter((q) => !q.cancelled);
    expect(activePending).toHaveLength(0);
  });
});
