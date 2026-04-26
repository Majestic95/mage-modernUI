import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LobbyChat } from './LobbyChat';
import { useAuthStore } from '../auth/store';
import { useGameStore } from '../game/store';

const ANON_SESSION = {
  schemaVersion: '1.12',
  token: 'tok-anon',
  username: 'alice',
  isAnonymous: true,
  isAdmin: false,
  expiresAt: '2026-04-27T00:00:00Z',
};

const ROOM_ID = '00000000-0000-0000-0000-000000000000';
const CHAT_ID = '11111111-1111-1111-1111-111111111111';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const MAIN_ROOM = {
  schemaVersion: '1.12',
  roomId: ROOM_ID,
  chatId: CHAT_ID,
};

/**
 * Captures the constructed WebSocket so tests can assert on the URL
 * and call .send() to verify outbound traffic. The wrapper's
 * sendChat() goes through the real GameStream → real WebSocket.send().
 */
let capturedWs: { url: string; sentMessages: string[] } | null = null;

class FakeWebSocket {
  static OPEN = 1;
  url: string;
  readyState = 1; // open immediately so sendEnvelope can write
  sentMessages: string[] = [];
  constructor(url: string) {
    this.url = url;
    capturedWs = { url, sentMessages: this.sentMessages };
  }
  addEventListener() {}
  close() {}
  send(data: string) {
    this.sentMessages.push(data);
  }
}

describe('LobbyChat', () => {
  beforeEach(() => {
    useAuthStore.setState({
      session: ANON_SESSION,
      loading: false,
      error: null,
      verifying: false,
    });
    useGameStore.getState().reset();
    capturedWs = null;
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      if (url.includes('/api/server/main-room')) {
        return jsonResponse(200, MAIN_ROOM);
      }
      return new Response(null, { status: 404 });
    }));
    vi.stubGlobal('WebSocket', FakeWebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows empty state before any messages arrive', async () => {
    render(<LobbyChat />);
    await waitFor(() => {
      expect(screen.getByTestId('chat-log')).toHaveTextContent(/no messages/i);
    });
  });

  it('opens a room WebSocket once the main-room fetch resolves', async () => {
    render(<LobbyChat />);
    await waitFor(() => {
      expect(capturedWs).not.toBeNull();
    });
    expect(capturedWs?.url).toContain('/api/rooms/' + ROOM_ID + '/stream');
    expect(capturedWs?.url).toContain('token=tok-anon');
  });

  it('renders chat-log entries from the store filtered by main-room chatId', async () => {
    render(<LobbyChat />);
    await waitFor(() => {
      expect(capturedWs).not.toBeNull();
    });
    act(() => {
      useGameStore.setState({
        chatMessages: {
          [CHAT_ID]: [
            {
              username: 'bob',
              message: 'gg lobby',
              time: '',
              turnInfo: '',
              color: 'BLACK',
              messageType: 'TALK',
              soundToPlay: '',
            },
          ],
        },
      });
    });
    expect(await screen.findByText(/gg lobby/)).toBeInTheDocument();
    expect(screen.getByTestId('chat-line')).toHaveTextContent('bob:');
  });

  it('Send button writes a chatSend envelope to the WebSocket', async () => {
    const user = userEvent.setup();
    render(<LobbyChat />);
    await waitFor(() => {
      expect(capturedWs).not.toBeNull();
    });
    await user.type(screen.getByTestId('chat-input'), 'hello world');
    await user.click(screen.getByRole('button', { name: /send/i }));
    expect(capturedWs?.sentMessages).toHaveLength(1);
    const body = JSON.parse(capturedWs!.sentMessages[0]!);
    expect(body).toEqual({
      type: 'chatSend',
      chatId: CHAT_ID,
      message: 'hello world',
    });
  });

  it('Send button is disabled on empty / whitespace-only input', async () => {
    const user = userEvent.setup();
    render(<LobbyChat />);
    await waitFor(() => {
      expect(capturedWs).not.toBeNull();
    });
    const button = screen.getByRole('button', { name: /send/i });
    expect(button).toBeDisabled();
    await user.type(screen.getByTestId('chat-input'), '   ');
    expect(button).toBeDisabled();
    await user.type(screen.getByTestId('chat-input'), 'real');
    expect(button).not.toBeDisabled();
  });

  it('chats from a foreign chatId are not shown', async () => {
    render(<LobbyChat />);
    await waitFor(() => {
      expect(capturedWs).not.toBeNull();
    });
    act(() => {
      useGameStore.setState({
        chatMessages: {
          'ffffffff-ffff-ffff-ffff-ffffffffffff': [
            {
              username: 'eve',
              message: 'foreign chat',
              time: '',
              turnInfo: '',
              color: '',
              messageType: 'TALK',
              soundToPlay: '',
            },
          ],
        },
      });
    });
    expect(screen.getByTestId('chat-log')).toHaveTextContent(/no messages/i);
  });

  it('surfaces a fetch failure as an alert in the header', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 500 })));
    render(<LobbyChat />);
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });
});
