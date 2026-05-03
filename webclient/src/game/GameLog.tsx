import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import type { WebCardView, WebPlayerView } from '../api/schemas';
import { REDESIGN } from '../featureFlags';
import { HoverCardDetail } from './HoverCardDetail';
import { PlayerPortrait } from './PlayerPortrait';
import { useGameStore } from './store';

/* ---------- game log (slice 18) ---------- */

/**
 * Right-side strip showing the engine's running commentary —
 * "alice plays Forest", "Bolt deals 3 to bob", "alice's turn", etc.
 * Each entry is a {@code gameInform} message accumulated by the
 * store (see {@link useGameStore.gameLog}). Auto-scrolls to bottom
 * on new entries.
 *
 * <p>Slice 18 / ADR 0008 B3. Closes the largest debugging gap in
 * 1v1 play: previously the user had no record of what just
 * happened beyond the live board state.
 *
 * <p>Slice 70-L (redesign push, picture-catalog §5.A) — when
 * {@code VITE_FEATURE_REDESIGN=true}, each entry renders as
 * portrait avatar + 2-line text instead of plain prose. Card
 * name highlights via the engine's {@code <font color>} tokens
 * are preserved (same {@link renderUpstreamMarkup} that
 * GameDialog uses). The legacy plain-text rendering is preserved
 * verbatim under flag-off.
 */
export function GameLog({
  players,
}: {
  /**
   * Slice 70-L — list of players in the current game. Used to
   * resolve actor names from log messages to a WebPlayerView so
   * each entry can render the actor's commander portrait. Optional
   * for back-compat with existing tests + the legacy code path
   * (which doesn't render portraits at all). When omitted under
   * the redesign flag, entries fall back to a stylized initial-
   * letter avatar.
   */
  players?: readonly WebPlayerView[];
} = {}) {
  const entries = useGameStore((s) => s.gameLog);
  const myPlayerId = useGameStore((s) => s.gameView?.myPlayerId);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries]);

  // Slice 70-L — name → player lookup map for fast actor
  // resolution. Computed once per render; the players prop
  // changes infrequently (only when a player joins / leaves /
  // reconnects), so memoization here is mostly defensive against
  // tight render loops on rapid log churn.
  const playerByName = useMemo(() => {
    const map = new Map<string, WebPlayerView>();
    for (const p of players ?? []) {
      if (p.name) {
        map.set(p.name.toLowerCase(), p);
      }
    }
    return map;
  }, [players]);

  return (
    // Slice 70-E critic UI-Nice-9 — was <aside> but GameTable's
    // side-panel container is also <aside>; nested landmarks confuse
    // SR users. Demoted to <section> (still navigable via heading
    // landmarks; the parent <aside> is the actual complementary
    // landmark for SR traversal).
    <section
      data-testid="game-log"
      // Slice 70-E (technical critic I5) — width comes from the
      // GameTable side-panel column (clamp(280px, 22vw, 360px)).
      className="flex-1 min-h-0 flex flex-col"
      aria-label="Game log"
    >
      <header className="text-xs text-zinc-500 uppercase tracking-wide px-3 py-2 border-b border-zinc-800">
        Game log ({entries.length})
      </header>
      <div
        ref={scrollRef}
        data-testid="game-log-entries"
        className={
          'flex-1 overflow-y-auto p-2 text-xs ' +
          (REDESIGN ? 'space-y-2' : 'space-y-1')
        }
      >
        {entries.length === 0 ? (
          <p className="text-zinc-600 italic">No events yet.</p>
        ) : REDESIGN ? (
          entries.map((e) => (
            <RedesignedEntry
              key={`${e.id}-${e.turn}`}
              text={e.message}
              cardsByName={e.cardsByName}
              playerByName={playerByName}
              myPlayerId={myPlayerId}
            />
          ))
        ) : (
          entries.map((e) => (
            <div
              key={`${e.id}-${e.turn}`}
              data-testid="game-log-entry"
              className="text-zinc-300 leading-snug"
            >
              {/* 2026-05-03 directive — no turn/phase pill in the
                  game log. Rendering only the card-played + life-
                  change content per the user's "tell me who played
                  what card and report life gain or life lost" spec. */}
              {renderLogMarkup(e.message, e.cardsByName)}
            </div>
          ))
        )}
      </div>
    </section>
  );
}

/**
 * Render an upstream log message with card-name highlights wrapped
 * in {@link HoverCardDetail} so the user can hover any highlighted
 * card to see its full art + oracle text — the same affordance the
 * hand fan and battlefield tiles offer.
 *
 * <p>Tokenizer mirrors {@code renderUpstreamMarkup} (font-color +
 * br + strip-other-tags) so security guarantees are identical: no
 * {@code dangerouslySetInnerHTML}; arbitrary CSS can't slip into
 * the {@code style} attribute (the regex constrains color values
 * to a 3-or-6-char hex). The only change is the {@code <font>}
 * arm, which looks the highlighted text up in {@code cardsByName}
 * (frozen on the entry at emit time, see store.buildCardsByName)
 * and renders {@code HoverCardDetail} when found. Misses fall back
 * to a plain colored span — never broken text, never a hover stub
 * that does nothing.
 *
 * <p>Lookup keys are lowercased to match {@code buildCardsByName}'s
 * normalization. Engine-side log names sometimes include extra
 * suffixes (e.g. {@code "Lightning Bolt (a)"}) — we strip a
 * trailing parenthesized suffix before the lookup, then fall back
 * to the un-stripped form if that misses.
 */
function renderLogMarkup(
  text: string,
  cardsByName: Record<string, WebCardView>,
): ReactNode {
  const tokenRe =
    /<font\s+color=(#[0-9a-fA-F]{3,6})>([\s\S]*?)<\/font>|<br\s*\/?>|<[^>]+>/g;
  const parts: ReactNode[] = [];
  let lastIdx = 0;
  let key = 0;
  let match: RegExpExecArray | null;
  while ((match = tokenRe.exec(text)) !== null) {
    if (match.index > lastIdx) {
      parts.push(text.slice(lastIdx, match.index));
    }
    if (match[0].toLowerCase().startsWith('<br')) {
      parts.push(<br key={`br-${key++}`} />);
    } else if (match[0].toLowerCase().startsWith('<font')) {
      const color = match[1]!;
      const inner = match[2] ?? '';
      const card = lookupCard(inner, cardsByName);
      const colored = (
        <span style={{ color }}>{stripTags(inner)}</span>
      );
      if (card) {
        parts.push(
          <HoverCardDetail key={`f-${key++}`} card={card}>
            <span
              data-testid="game-log-card-hover"
              data-card-name={card.name}
              className="cursor-help underline decoration-dotted underline-offset-2"
            >
              {colored}
            </span>
          </HoverCardDetail>,
        );
      } else {
        parts.push(<span key={`f-${key++}`}>{colored}</span>);
      }
    }
    // Any other tag (the third arm of the regex) is intentionally
    // dropped — strips out unhandled markup without leaking it.
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < text.length) {
    parts.push(text.slice(lastIdx));
  }
  return parts.length === 1 ? parts[0] : <>{parts}</>;
}

/**
 * Resolve a highlighted card name against the entry's frozen
 * cards-by-name index. Tries the stripped form (no nested tags, no
 * trailing parenthesized suffix) first, then a few permutations
 * because engine log names occasionally include them.
 */
function lookupCard(
  rawInner: string,
  cardsByName: Record<string, WebCardView> | undefined,
): WebCardView | null {
  if (!cardsByName) return null;
  const plain = stripTags(rawInner).trim();
  if (!plain) return null;
  const lower = plain.toLowerCase();
  if (cardsByName[lower]) return cardsByName[lower];
  // Try stripping a trailing " (a)" / " (b)" disambiguator (common
  // when the engine emits a token-vs-source distinction).
  const noParen = lower.replace(/\s*\([^)]*\)\s*$/, '');
  if (cardsByName[noParen]) return cardsByName[noParen];
  return null;
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, '');
}

/**
 * Slice 70-L — redesigned log entry per picture-catalog §5.A:
 *   - Left column: small circular portrait avatar (~32px) of the
 *     actor's commander.
 *   - Right column: 2 lines of text — actor name (semibold) +
 *     action text (with card-name highlights preserved via
 *     renderUpstreamMarkup).
 *
 * <p>Actor resolution heuristic: strip HTML tokens, take the
 * first word, and look it up in the playerByName map. The engine
 * emits player names as the leading word of most action messages
 * ("alice played Forest", "alice draws a card", etc.) so this
 * catches the canonical patterns. Misses (event narrations like
 * "Bolt deals 3 to bob") fall back to a no-avatar layout that
 * preserves the per-entry vertical rhythm.
 *
 * <p>"You" affordance (picture-catalog §5.A): when the resolved
 * actor's playerId matches the local player, the displayed name
 * is "You" rather than the username. Mirrors the picture's
 * "You cast The Locust God" treatment.
 */
function RedesignedEntry({
  text,
  cardsByName,
  playerByName,
  myPlayerId,
}: {
  text: string;
  cardsByName: Record<string, WebCardView>;
  playerByName: Map<string, WebPlayerView>;
  myPlayerId: string | undefined;
}) {
  const stripped = useMemo(() => text.replace(/<[^>]+>/g, ''), [text]);
  // Pull the first word as the candidate actor — engine messages
  // typically start with the player name. Strip trailing
  // punctuation / possessive ("alice's" → "alice") so the lookup
  // catches both forms.
  // Slice 70-L — strip the possessive suffix ("alice's" → "alice")
  // and trailing punctuation (",", ".") before lowercasing for the
  // playerByName lookup. The first regex catches an apostrophe
  // (straight or curly) optionally followed by a single letter and
  // then end-of-word — covers "alice's" and rare typographic
  // "alice’s" both. The second strips remaining punctuation.
  const firstWord = stripped
    .trimStart()
    .split(/\s+/, 1)[0]
    ?.replace(/['’].*$/, '')
    .replace(/[:,.]+$/, '')
    .toLowerCase();
  const actor =
    firstWord !== undefined ? playerByName.get(firstWord) : undefined;
  const isMe = !!actor && !!myPlayerId && actor.playerId === myPlayerId;
  const displayName = actor ? (isMe ? 'You' : actor.name) : null;

  // Strip the actor name from the message text since it's
  // displayed separately as a heading. "alice played Blood Crypt"
  // → "played Blood Crypt" (with the highlight markup preserved
  // for "Blood Crypt"). When we couldn't resolve an actor, leave
  // the text intact (the fallback layout shows full text).
  const actionText = useMemo(() => {
    if (!actor) return text;
    // Match the leading actor-word at the start of the message,
    // including any trailing punctuation we already trimmed for
    // the lookup. Allow optional <font> wrapping around the name.
    const namePattern = new RegExp(
      `^(<font[^>]*>)?\\s*${escapeRegex(actor.name)}[':,.]?(</font>)?\\s*`,
      'i',
    );
    return text.replace(namePattern, '');
  }, [text, actor]);

  return (
    <div
      data-testid="game-log-entry"
      data-redesign="true"
      className="flex items-start gap-2"
    >
      {actor ? (
        <PlayerPortrait
          player={actor}
          size="small"
          haloVariant="none"
          ariaLabel={`${displayName} log avatar`}
        />
      ) : (
        // No actor resolved — keep a fixed-width gutter so all
        // entries line up vertically regardless of resolution
        // success. 32px matches the small portrait diameter.
        <span
          aria-hidden="true"
          data-testid="game-log-entry-no-avatar"
          className="block flex-shrink-0"
          style={{ width: 32, height: 32 }}
        />
      )}
      <div className="flex flex-col min-w-0 flex-1 leading-snug">
        {displayName && (
          <span className="font-semibold text-zinc-100 text-xs">
            {displayName}
          </span>
        )}
        {/* 2026-05-03 directive — no turn/phase pill on game-log
            entries. Highlights inside the message become hoverable
            card previews (see renderLogMarkup). */}
        <span className="text-zinc-300 text-xs">
          {renderLogMarkup(actionText, cardsByName)}
        </span>
      </div>
    </div>
  );
}

/**
 * Slice 70-L — escape regex metacharacters in a player-name string
 * before splicing into the actor-strip RegExp. Player names go
 * through the slice-64 alphanumeric+underscore+hyphen validator
 * (USERNAME_PATTERN), so most names are regex-safe — but defense
 * in depth costs nothing here, and a future username-policy
 * change could introduce special chars.
 */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
