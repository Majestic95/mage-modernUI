import { useEffect, useMemo, useRef, useState } from 'react';
import { request } from '../api/client';
import { webRoomRefSchema } from '../api/schemas';
import { useAuthStore } from '../auth/store';
import { useGameStore } from '../game/store';
import { GameStream } from '../game/stream';

/**
 * Lobby chat panel — subscribes to the main-room chat WebSocket
 * (slice 8 server route {@code /api/rooms/{roomId}/stream}) on mount
 * and renders incoming {@code chatMessage} frames + an input box.
 *
 * <p>The component owns one {@link GameStream} (in {@code 'room'}
 * mode) for its lifetime. Chat history is held in
 * {@link useGameStore#chatMessages} keyed by chatId; this component
 * filters to the main-room chatId resolved at mount time.
 *
 * <p>Slice 8 scope: text-only chat, no presence indicator, no chat
 * history before connect (only frames received during the session
 * appear). Slice 9+ may add: persisted history via REST,
 * online-users panel, /commands.
 */
export function LobbyChat() {
  const session = useAuthStore((s) => s.session);
  const chatBuckets = useGameStore((s) => s.chatMessages);
  const [chatId, setChatId] = useState<string | null>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<GameStream | null>(null);

  // Discover the main-room ids once per session. The cost of a
  // duplicate fetch on remounts is one HTTP round-trip; cheap enough
  // that we don't bother caching globally.
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    (async () => {
      try {
        const room = await request('/api/server/main-room', webRoomRefSchema, {
          token: session.token,
        });
        if (cancelled) return;
        setRoomId(room.roomId);
        setChatId(room.chatId);
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : 'failed to load main-room';
          setError(message);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session]);

  // Open the room WebSocket when both session and roomId are known.
  useEffect(() => {
    if (!session || !roomId) return;
    const stream = new GameStream({
      gameId: roomId,
      token: session.token,
      endpoint: 'room',
    });
    streamRef.current = stream;
    stream.open();
    return () => {
      stream.close();
      streamRef.current = null;
    };
  }, [session, roomId]);

  const messages = useMemo(
    () => (chatId ? chatBuckets[chatId] ?? [] : []),
    [chatBuckets, chatId],
  );

  if (!session) return null;

  return (
    <section
      data-testid="lobby-chat"
      className="rounded border border-zinc-800 bg-zinc-900/40 p-3 flex flex-col"
      style={{ minHeight: '12rem', maxHeight: '20rem' }}
    >
      <header className="text-xs text-zinc-500 uppercase tracking-wide mb-2 flex items-baseline justify-between">
        <span>Lobby chat</span>
        {!chatId && !error && <span className="text-zinc-600">connecting…</span>}
        {error && (
          <span className="text-red-400 normal-case lowercase" role="alert">
            {error}
          </span>
        )}
      </header>
      <ChatLog messages={messages} />
      <ChatInput
        chatId={chatId}
        disabled={!chatId}
        send={(message) => streamRef.current?.sendChat(chatId!, message)}
      />
    </section>
  );
}

/* ---------- subcomponents ---------- */

function ChatLog({ messages }: { messages: ReturnType<typeof useGameStore>['chatMessages'][string] }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Stick to the bottom on each new message. No-op if the user has
    // scrolled up (we're just reading scrollTop's last value).
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div
        ref={scrollRef}
        data-testid="chat-log"
        className="flex-1 overflow-y-auto text-xs text-zinc-600 italic flex items-center justify-center"
      >
        No messages yet.
      </div>
    );
  }
  return (
    <div
      ref={scrollRef}
      data-testid="chat-log"
      className="flex-1 overflow-y-auto space-y-1 mb-2"
    >
      {messages.map((m, i) => (
        <div
          key={`${m.time}-${i}`}
          data-testid="chat-line"
          className="text-sm"
        >
          <span className="text-zinc-500 text-xs mr-1">
            {m.username || 'system'}:
          </span>
          <span className="text-zinc-200">{m.message}</span>
        </div>
      ))}
    </div>
  );
}

function ChatInput({
  chatId,
  disabled,
  send,
}: {
  chatId: string | null;
  disabled: boolean;
  send: (message: string) => void;
}) {
  const [draft, setDraft] = useState('');
  const trimmed = draft.trim();
  const canSend = !disabled && !!chatId && trimmed.length > 0 && trimmed.length <= 4096;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSend) return;
    send(trimmed);
    setDraft('');
  };

  return (
    <form onSubmit={submit} className="flex gap-2">
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        disabled={disabled}
        placeholder={disabled ? 'Connecting…' : 'Type a message'}
        className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-zinc-100 text-sm disabled:opacity-50"
        maxLength={4096}
        data-testid="chat-input"
      />
      <button
        type="submit"
        disabled={!canSend}
        className="px-3 py-1 rounded bg-fuchsia-600 hover:bg-fuchsia-500 disabled:bg-zinc-700 text-white text-sm"
      >
        Send
      </button>
    </form>
  );
}
