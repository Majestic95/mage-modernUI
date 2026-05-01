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
  WebCommandObjectView,
  WebDialogClear,
  WebGameClientMessage,
  WebGameEndView,
  WebGameView,
  WebSideboardInfo,
  WebStartGameInfo,
  WebStreamFrame,
} from '../api/schemas';

/** Maximum chat history retained per chatId. Older messages drop. */
const CHAT_HISTORY_CAP = 200;

/**
 * Maximum game-log entries retained. Engine fires
 * {@code GAME_UPDATE_AND_INFORM} once per state change ("alice plays
 * Forest", "Bolt deals 3 to bob", etc.); a 30-turn match can easily
 * exceed 1000. Keep the most recent 500 — about 15 turns of detail
 * — so the log isn't unbounded but the user has enough scrollback
 * to debug "what just happened".
 */
const GAME_LOG_CAP = 500;

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
  | 'gameError'
  // Slice 70-X.14 Wave 3 — pile-pick (Fact or Fiction, Steam Augury)
  // and multi-amount allocation (trample damage, counter removal).
  | 'gameChoosePile'
  | 'gameSelectMultiAmount';

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
  'gameChoosePile',
  'gameSelectMultiAmount',
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

/**
 * One entry in the game log strip. Captures the message text from a
 * {@code gameInform} / {@code gameOver} frame plus turn metadata for
 * display ordering. ADR 0008 §B3 / §6.3.
 *
 * <p>Slice 18: turn / phase pulled from the gameView snapshot the
 * {@code gameInform} carries (which is the post-event state). The
 * webclient renders these in the chat panel below user chat, with
 * the most recent at the bottom (chat-style).
 */
export interface GameLogEntry {
  /** Monotonic id derived from the inbound frame's messageId. */
  id: number;
  /** The upstream message text (may contain {@code <font color>} markup). */
  message: string;
  /** Turn number at the moment of dispatch. 0 if no gameView available. */
  turn: number;
  /** Phase / step label, e.g. "PRECOMBAT_MAIN". Empty if unavailable. */
  phase: string;
}

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

  /**
   * Pending {@code startGame} frame waiting to be picked up by the
   * router. Set by {@link applyFrame} when upstream's
   * {@code User.ccGameStarted} fires (table moves from waiting to
   * running); cleared by {@link consumeStartGame} once the App has
   * navigated into the game window. Stays null in the steady state
   * — both before any game starts and after navigation completes.
   */
  pendingStartGame: WebStartGameInfo | null;

  /**
   * Game-log strip — accumulates {@code gameInform.message} text
   * across the match for the user's "what just happened?" view.
   * Capped at {@link GAME_LOG_CAP} (oldest evicted FIFO).
   * Slice 18 / ADR 0008 B3.
   */
  gameLog: GameLogEntry[];

  /**
   * True when a {@code gameOver} frame is the most recent state
   * push and the next game (in a best-of-N match) has not yet
   * started. Drives the in-between-games banner overlay. Cleared
   * by {@code gameInit} (next game starts) and by {@link reset}.
   * Slice 19 / ADR 0008 B5.
   */
  gameOverPending: boolean;

  /**
   * Slice 70-X.14 (Wave A item 4 — Bug 4) — per-player commander
   * identity snapshot that SURVIVES zone changes. Pre-Wave-A,
   * PlayerPortrait + PlayerFrame read commander from
   * {@code player.commandList.find(...)} which empties when the
   * commander is cast and leaves the command zone — the portrait
   * went blank.
   *
   * <p>The store accumulates UNIQUE commanders by name across every
   * gameView frame. Once a commander has been observed in any
   * frame's commandList for a player, it stays in the snapshot for
   * the rest of the game (cleared only by {@link reset}). Partner /
   * Background commanders accumulate naturally — each gets its own
   * entry keyed by name.
   *
   * <p>Keyed by {@code playerId}.
   */
  commanderSnapshots: Record<string, WebCommandObjectView[]>;

  /**
   * Slice 70-O — UI-only state: whether the side panel is collapsed.
   * Toggled by the header's layout/zoom icon (picture-catalog §1.3).
   * When true, GameTable renders the battlefield + hand at full
   * viewport width; the side panel column is removed from the grid.
   * Default false (panel visible). Persists across the session
   * (until reset / page refresh) — short-term preference, not
   * a long-term setting in localStorage. A future polish slice may
   * persist if user feedback warrants it.
   */
  sidePanelCollapsed: boolean;

  /**
   * Pending {@code sideboard} frame. Set when upstream fires
   * {@code User.ccSideboard} (between games of a sideboarded match,
   * or at the start of a draft constructing window). The webclient
   * renders a SideboardModal driven off this state; cleared by
   * {@link clearSideboard} when the user submits or the server
   * advances past the sideboarding window.
   */
  pendingSideboard: WebSideboardInfo | null;

  /**
   * Slice 70-O — toggle side-panel collapse. Header icon click handler
   * dispatches this; GameTable subscribes via selector to re-render
   * the grid template when the value flips.
   */
  toggleSidePanel: () => void;
  /**
   * Slice 70-O — explicit setter (for tests + programmatic restoration
   * if a future slice persists collapse state across sessions).
   */
  setSidePanelCollapsed: (collapsed: boolean) => void;

  /** Connection lifecycle setters (called by GameStream). */
  setConnection: (s: ConnectionState, reason?: string) => void;
  /** Apply an inbound frame. Returns true if the frame was handled. */
  applyFrame: (frame: WebStreamFrame, validatedData: unknown) => boolean;
  /** Clear the pending dialog — called when the player submits a response. */
  clearDialog: () => void;
  /**
   * Read and clear the pending startGame frame in one step. Returns
   * the previous value (or null when none). Single-shot — a second
   * call without a fresh startGame returns null.
   */
  consumeStartGame: () => WebStartGameInfo | null;
  /** Clear the pending sideboard prompt — called after submit or dismiss. */
  clearSideboard: () => void;
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
  | 'pendingStartGame'
  | 'pendingSideboard'
  | 'gameLog'
  | 'gameOverPending'
  | 'sidePanelCollapsed'
  | 'commanderSnapshots'
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
  pendingStartGame: null,
  pendingSideboard: null,
  gameLog: [],
  gameOverPending: false,
  sidePanelCollapsed: false,
  commanderSnapshots: {},
};

/**
 * Slice 70-X.14 (Bug 4) — accumulate per-player commanders into the
 * snapshot. Adds any commander entry seen in {@code gameView.players[].commandList}
 * to the per-player list (keyed by name dedupe). Returns the new map
 * if anything changed, or the existing reference if no-op (so React
 * subscribers don't re-render when nothing's new).
 */
function accumulateCommanderSnapshots(
  prev: Record<string, WebCommandObjectView[]>,
  gv: WebGameView,
): Record<string, WebCommandObjectView[]> {
  let changed = false;
  const next: Record<string, WebCommandObjectView[]> = { ...prev };
  for (const p of gv.players) {
    const playerId = p.playerId;
    if (!playerId) continue;
    const seen = next[playerId] ?? [];
    const seenNames = new Set(seen.map((c) => c.name));
    let merged = seen;
    for (const co of p.commandList) {
      if (co.kind !== 'commander') continue;
      if (seenNames.has(co.name)) continue;
      if (merged === seen) merged = [...seen];
      merged.push(co);
      seenNames.add(co.name);
      changed = true;
    }
    if (merged !== seen) {
      next[playerId] = merged;
    }
  }
  return changed ? next : prev;
}

/**
 * Slice 70-X.13 (Wave 4) — extracted reducers for the two
 * heaviest cases in {@code applyFrame}'s switch. The dispatcher stays
 * a switch (right shape for a 12-case discriminated union of method
 * names — TypeScript exhaustiveness checking + clear control flow),
 * but each case body is a single function call so the per-method
 * mutation logic doesn't bloat the dispatcher into a 200-line wall.
 *
 * <p>Pure on the inputs: receives the current state plus the frame +
 * validated data, returns a {@code Partial<GameState>} for the store
 * to merge. {@code null} means "no state change."
 *
 * <p>Did NOT extract per-method reducers wholesale (the agent
 * reviewer's max-ambition recommendation). The switch is the right
 * shape for this surface — it's not big enough to justify a
 * {@code Record<Method, Reducer>} dispatch table, and TypeScript's
 * narrowing on a literal-string discriminated union gives us
 * exhaustiveness for free.
 */
type GameInformReduce = Pick<
  GameState,
  'lastWrapped' | 'gameView' | 'gameLog' | 'gameOverPending'
>;

function reduceGameInformOrOver(
  state: GameState,
  frame: WebStreamFrame,
  wrapped: WebGameClientMessage,
): GameInformReduce {
  const nextGv = wrapped.gameView ?? state.gameView;
  // Slice 18: append to the game log if there's a non-empty
  // message. Empty-message gameInform frames (engine pushes
  // these for state-only updates) don't add log noise.
  let nextLog = state.gameLog;
  if (wrapped.message && wrapped.message.length > 0) {
    const entry: GameLogEntry = {
      id: frame.messageId,
      message: wrapped.message,
      turn: nextGv?.turn ?? 0,
      phase: nextGv?.step || nextGv?.phase || '',
    };
    nextLog = nextLog.length >= GAME_LOG_CAP
      ? [...nextLog.slice(nextLog.length - GAME_LOG_CAP + 1), entry]
      : [...nextLog, entry];
  }
  const isGameOver = frame.method === 'gameOver';
  return {
    lastWrapped: wrapped,
    gameView: nextGv,
    gameLog: nextLog,
    // Slice 19: flag the gameOver-pending state so the banner
    // renders. Cleared on the next gameInit (best-of-N next game)
    // or on reset (user leaves).
    gameOverPending: isGameOver || state.gameOverPending,
    // Slice 16: do NOT clear pendingDialog on gameInform — engine
    // fires informs mid-combat ("alice attacks with Grizzly Bears")
    // while declare-attackers is still active. Clearing would nuke
    // the prompt. gameOver wants the banner to overlay any stale
    // dialog so we don't clear there either; reset() handles cleanup.
  };
}

function reduceChatMessage(
  state: GameState,
  frame: WebStreamFrame,
  msg: WebChatMessage,
): Pick<GameState, 'chatMessages'> | null {
  // chatId comes from the envelope's objectId (per slice 2). Server
  // pushes the same chatId on every chat callback for a given chat.
  // If a frame arrives without a chatId we drop it — there's no
  // sensible bucket to file it under.
  const chatId = frame.objectId;
  if (!chatId) {
    return null;
  }
  const buckets = state.chatMessages;
  const prior = buckets[chatId] ?? [];
  const next = prior.length >= CHAT_HISTORY_CAP
    ? [...prior.slice(prior.length - CHAT_HISTORY_CAP + 1), msg]
    : [...prior, msg];
  return {
    chatMessages: { ...buckets, [chatId]: next },
  };
}

export const useGameStore = create<GameState>()((set, get) => ({
  ...INITIAL,

  toggleSidePanel: () =>
    set((state) => ({ sidePanelCollapsed: !state.sidePanelCollapsed })),
  setSidePanelCollapsed: (collapsed) =>
    set({ sidePanelCollapsed: collapsed }),

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

      case 'startGame': {
        // Server fires this when a table moves from waiting to
        // running (upstream's User.ccGameStarted). Stash for the
        // router to pick up — App.tsx will auto-navigate into the
        // Game window. Don't open the game stream here — that's
        // the Game component's job once it mounts.
        const info = validatedData as WebStartGameInfo;
        set({ pendingStartGame: info });
        return true;
      }

      case 'sideboard': {
        // Post-game-1 sideboarding window. App-level subscriber
        // mounts the SideboardModal off this state; user submits
        // via POST /api/tables/{tableId}/deck which clears the
        // pending entry on success.
        const info = validatedData as WebSideboardInfo;
        set({ pendingSideboard: info });
        return true;
      }

      case 'streamError': {
        const err = validatedData as { code: string; message: string };
        set({ protocolError: `${err.code}: ${err.message}` });
        return true;
      }

      case 'gameInit': {
        const gv = validatedData as WebGameView;
        // Slice 70-X.14 — gameInit is a fresh game OR a reconnect
        // catch-up. For fresh games, snapshots will start empty
        // (cleared on reset()) and gameInit's commandList seeds them.
        // For reconnects mid-game, the engine ships whatever's
        // currently in the command zone; if commanders have been cast
        // pre-reconnect, commandList may be empty and the snapshot
        // stays empty until the next time those commanders return to
        // the command zone (or until they appear again somewhere).
        // The reconnect-without-snapshot edge is rare in playtest;
        // documented as a limitation, addressed by W-A future server
        // field if needed.
        set({
          gameView: gv,
          protocolError: null,
          pendingDialog: null,
          gameOverPending: false,
          commanderSnapshots: accumulateCommanderSnapshots(
            get().commanderSnapshots,
            gv,
          ),
        });
        return true;
      }

      case 'gameUpdate': {
        const gv = validatedData as WebGameView;
        // Slice 16: do NOT clear pendingDialog on gameUpdate. The
        // engine fires gameUpdate frames mid-prompt during combat
        // (after each declare-attackers toggle, between blocker
        // assignments, etc.). Clearing the dialog on update would
        // wipe the "Select attackers" prompt and the user would
        // lose their combat-mode signal. The next gameSelect /
        // gameTarget that arrives will replace the dialog if the
        // prompt has changed; if not, the same prompt persists.
        // The user explicitly clears via clearDialog() on commit.
        set({
          gameView: gv,
          protocolError: null,
          commanderSnapshots: accumulateCommanderSnapshots(
            get().commanderSnapshots,
            gv,
          ),
        });
        return true;
      }

      case 'gameInform':
      case 'gameOver':
        set(reduceGameInformOrOver(get(), frame, validatedData as WebGameClientMessage));
        return true;

      case 'endGameInfo':
        set({
          gameEnd: validatedData as WebGameEndView,
          pendingDialog: null,
        });
        return true;

      case 'dialogClear': {
        // Slice 69d (ADR 0010 v2 D11b) — synthetic teardown signal
        // emitted when a player leaves. Engine already skips leavers
        // server-side (VoteHandler.doVotes etc.); this signal closes
        // the visual loop on the client so a stuck modal goes away.
        //
        // Slice 70-X.13 (Wave 3) — server/client semantic agreement.
        // Pre-Wave-3 the client only cleared if the leaver was in
        // {@code current.data.targets} — works for gameTarget /
        // gameSelect but misses yes/no gameAsk (no targets array, e.g.
        // multi-player vote prompts) where the leaver is the responder
        // but isn't a "target" of the prompt. Result: the OTHER
        // waiting players' UIs hung. Server's broadcast contract is
        // already narrowly scoped — it only fires on a player-leave
        // event, never speculatively. So when this signal arrives, any
        // non-{@code gameChooseAbility} pending dialog is potentially
        // stale; clearing unconditionally aligns the client semantics
        // with the server's intent (close the visual loop). The
        // engine re-fires gameAsk / gameTarget / gameSelect if a
        // fresh prompt is needed for the surviving players — a
        // spurious clear is a one-frame stutter; a stuck modal is a
        // permanent stranding. {@code gameChooseAbility} uses
        // {@link WebAbilityPickerView} (no targets array; can't
        // reference the leaver by construction) — left alone.
        const clear = validatedData as WebDialogClear;
        const current = get().pendingDialog;
        if (current && current.method !== 'gameChooseAbility') {
          set({ pendingDialog: null });
        }
        // Guard for unused-var lint when the targets-based check is
        // pulled out — `clear` now intentionally unread.
        void clear;
        return true;
      }

      case 'chatMessage': {
        const next = reduceChatMessage(get(), frame, validatedData as WebChatMessage);
        if (next) set(next);
        return true;
      }

      default:
        return false;
    }
  },

  clearDialog: () => set({ pendingDialog: null }),

  consumeStartGame: () => {
    const pending = get().pendingStartGame;
    if (pending !== null) {
      set({ pendingStartGame: null });
    }
    return pending;
  },

  clearSideboard: () => set({ pendingSideboard: null }),

  reset: () => set(INITIAL),
}));
