import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
        schemaVersion: '1.11',
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
        schemaVersion: '1.11',
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
});
