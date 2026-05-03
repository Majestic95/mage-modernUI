/**
 * Substring card-name search bar that lives at the top of the deck
 * editor. Users type → 300ms debounce → server returns up to 50
 * deduplicated cards (one row per card name, whatever printing the
 * DB returned first). Each result has an "+ Add" button that calls
 * the parent's onAdd with a {@link WebDeckCardInfo} entry.
 *
 * <p>The parent (DeckEditor) decides whether to bump an existing
 * entry's qty or insert a new one — this panel just emits the card's
 * name + setCode + cardNumber. The user can swap to a different
 * printing later via the existing {@link ArtPickerModal}.
 *
 * <p>Server-side enforces a 2-char minimum query length; we mirror
 * the gate here so the network request isn't even fired below it.
 */
import { useEffect, useState } from 'react';
import { ApiError, request } from '../api/client';
import { webCardListingSchema, type WebCardInfo } from '../api/schemas';
import { useAuthStore } from '../auth/store';

interface Props {
  /**
   * Called when the user clicks "+ Add" on a result. Parent decides
   * whether to bump an existing entry or insert a new one.
   */
  onAdd: (card: WebCardInfo) => void;
}

const SEARCH_DEBOUNCE_MS = 300;
const SEARCH_MIN_LENGTH = 2;
const SEARCH_LIMIT = 50;
const SEARCH_INPUT_MAX_LENGTH = 128;

export function CardSearchPanel({ onAdd }: Props) {
  const token = useAuthStore((s) => s.session?.token ?? null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<WebCardInfo[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < SEARCH_MIN_LENGTH) {
      setResults(null);
      setTruncated(false);
      setLoading(false);
      setError(null);
      return;
    }
    if (!token) {
      // Audit fix — clear stale results when the session goes away
      // mid-search. Pre-fix the panel kept showing rows whose "+ Add"
      // would 401 once clicked.
      setResults(null);
      setTruncated(false);
      setLoading(false);
      setError('Not signed in.');
      return;
    }
    // Audit fix — surface the spinner immediately on keystroke instead
    // of waiting for the debounce timer to fire. The panel previously
    // looked frozen for 300ms after every keystroke.
    setLoading(true);
    setError(null);
    // Audit fix — abort the in-flight HTTP request when the user keeps
    // typing OR unmounts. Pre-fix every keystroke spawned a request
    // that ran to completion regardless; the visible state was filtered
    // via a ref but the network + setState-on-unmount were wasted.
    const controller = new AbortController();
    const handle = window.setTimeout(async () => {
      try {
        const resp = await request(
          `/api/cards/search?q=${encodeURIComponent(trimmed)}&limit=${SEARCH_LIMIT}`,
          webCardListingSchema,
          { token, signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        setResults(resp.cards);
        setTruncated(resp.truncated);
        setLoading(false);
      } catch (err) {
        if (controller.signal.aborted) return;
        // Don't surface AbortError as a user-visible failure.
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(err instanceof ApiError ? err.message : 'Search failed.');
        setResults([]);
        setLoading(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(handle);
      controller.abort();
    };
  }, [query, token]);

  return (
    <section
      data-testid="card-search-panel"
      className="rounded-md border border-zinc-800 bg-zinc-900/60 p-3 space-y-2"
    >
      <div className="flex items-center gap-2">
        <input
          type="text"
          data-testid="card-search-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search cards to add (min 2 chars)…"
          aria-label="Search cards to add to this deck"
          aria-controls="card-search-status"
          maxLength={SEARCH_INPUT_MAX_LENGTH}
          className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-fuchsia-500 focus-visible:ring-2 focus-visible:ring-fuchsia-400"
        />
        {query && (
          <button
            type="button"
            data-testid="card-search-clear"
            onClick={() => setQuery('')}
            className="text-sm text-zinc-400 hover:text-zinc-100 px-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400 rounded"
            aria-label="Clear search"
          >
            ×
          </button>
        )}
      </div>

      {/* Audit fix — aria-live region announces result counts +
          loading + error states to screen readers. */}
      <p
        id="card-search-status"
        className="sr-only"
        role="status"
        aria-live="polite"
      >
        {error
          ? `Search error: ${error}`
          : loading && results === null
          ? 'Searching…'
          : results !== null && results.length === 0
          ? 'No matches.'
          : results !== null
          ? `${results.length} match${results.length === 1 ? '' : 'es'}${truncated ? ', showing first 50' : ''}.`
          : ''}
      </p>

      {error && (
        <p
          role="alert"
          data-testid="card-search-error"
          className="text-xs text-status-danger"
        >
          {error}
        </p>
      )}

      {loading && results === null && (
        <p
          data-testid="card-search-loading"
          className="text-xs text-zinc-500 italic"
        >
          Searching…
        </p>
      )}

      {results !== null && results.length === 0 && !loading && !error && (
        <p
          data-testid="card-search-empty"
          className="text-xs text-zinc-500 italic"
        >
          No cards match "{query.trim()}".
        </p>
      )}

      {results !== null && results.length > 0 && (
        <>
          <ul
            data-testid="card-search-results"
            className="grid gap-2 max-h-64 overflow-y-auto pr-1"
            style={{
              gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            }}
          >
            {results.map((card, idx) => (
              // Audit fix — include idx as a tiebreaker so two rows
              // missing setCode/cardNumber (malformed DB rows) don't
              // collide on the same React key.
              <li
                key={`${card.setCode}|${card.cardNumber}|${card.name}|${idx}`}
              >
                <SearchResultRow card={card} onAdd={onAdd} />
              </li>
            ))}
          </ul>
          {truncated && (
            <p className="text-xs text-zinc-500 italic">
              Showing the first {SEARCH_LIMIT} matches — refine your query
              for a more specific match.
            </p>
          )}
        </>
      )}
    </section>
  );
}

function SearchResultRow({
  card,
  onAdd,
}: {
  card: WebCardInfo;
  onAdd: (card: WebCardInfo) => void;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const artUrl = scryfallArtCropUrl(card.setCode, card.cardNumber);
  const typeLine = formatTypeLine(card);
  return (
    <div
      data-testid="card-search-result"
      data-card={card.name}
      className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900 p-1.5"
    >
      <div
        className="h-12 w-12 flex-shrink-0 overflow-hidden rounded bg-zinc-800"
        title={`${card.setCode} #${card.cardNumber}`}
      >
        {artUrl && !imgFailed ? (
          <img
            src={artUrl}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setImgFailed(true)}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              display: 'block',
            }}
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-[9px] text-zinc-500 px-1 text-center">
            {card.setCode || '—'}
          </span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p
          className="text-sm font-medium text-zinc-100 truncate"
          title={card.name}
        >
          {card.name}
        </p>
        <p className="text-[11px] text-zinc-500 truncate">
          {typeLine}
          {card.manaValue ? ` · CMC ${card.manaValue}` : ''}
        </p>
      </div>
      <button
        type="button"
        data-testid="card-search-add"
        onClick={() => onAdd(card)}
        className="flex-shrink-0 px-2 py-1 rounded bg-fuchsia-600 hover:bg-fuchsia-500 text-white text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-300"
        aria-label={`Add ${card.name} to deck`}
      >
        + Add
      </button>
    </div>
  );
}

function scryfallArtCropUrl(setCode: string, cardNumber: string): string | null {
  if (!setCode || !cardNumber) return null;
  return `https://api.scryfall.com/cards/${setCode.toLowerCase()}/${encodeURIComponent(cardNumber)}?format=image&version=art_crop`;
}

function formatTypeLine(card: WebCardInfo): string {
  // Wire types are UPPERCASE per CardInfoMapper.toDto. Title-case
  // for display and join with subtypes via " — " (mtg convention).
  const types = card.types.map(titleCase).join(' ');
  const subs = card.subtypes.join(' ');
  return subs ? `${types} — ${subs}` : types;
}

function titleCase(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}
