/**
 * Slice L8 review (UX HIGH #7 + architecture HIGH #3) — single owner
 * for the main-room WebSocket. Previously LobbyChat AND
 * LiveLobby (in NewLobbyScreen) each opened their own room
 * connection, with the connection tied to whichever component was
 * mounted at the moment. The lobby→game transition closed the
 * LiveLobby stream before the Game window mounted, dropping any
 * room-level frames (chat, "X rejoined", etc.) that fired in
 * between.
 *
 * <p>This module is the single source of truth: App.tsx opens the
 * stream when {@code session && roomId} are known and keeps it open
 * for the whole authenticated session. Consumers
 * ({@link LobbyChat#send}) read it via {@link getRoomStream}.
 */
import { GameStream } from '../game/stream';

interface OpenArgs {
  token: string;
  roomId: string;
}

let stream: GameStream | null = null;
let openedFor: OpenArgs | null = null;

/**
 * Open the singleton stream for the given session+room. Idempotent:
 * a second call with the same args is a no-op. A call with different
 * args closes the previous and opens a fresh stream (token rotation).
 */
export function openRoomStream(args: OpenArgs): void {
  if (
    stream
    && openedFor
    && openedFor.token === args.token
    && openedFor.roomId === args.roomId
  ) {
    return;
  }
  closeRoomStream();
  const next = new GameStream({
    gameId: args.roomId,
    token: args.token,
    endpoint: 'room',
  });
  next.open();
  stream = next;
  openedFor = args;
}

export function closeRoomStream(): void {
  if (stream) {
    try {
      stream.close();
    } catch {
      // best-effort
    }
  }
  stream = null;
  openedFor = null;
}

/** Current stream for callers that need to send (e.g. chat). */
export function getRoomStream(): GameStream | null {
  return stream;
}
