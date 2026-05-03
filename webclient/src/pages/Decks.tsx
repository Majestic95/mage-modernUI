import { Fragment, useMemo, useState, type FormEvent } from 'react';
import { parseDeckText, totalCount } from '../decks/parse';
import { resolveDeckLists } from '../decks/resolve';
import { useDecksStore, toRequestBody, type SavedDeck } from '../decks/store';
import { useDeckTypes, type DeckTypeGroup } from '../decks/useDeckTypes';
import { useDeckLegality, type LegalityStatus } from '../decks/useDeckLegality';
import { ValidationErrorList } from '../decks/ValidationErrorList';
import { useAuthStore } from '../auth/store';
import { DeckEditor } from './DeckEditor';

/**
 * Decks tab — paste a textual deck list, resolve every card name to a
 * specific printing via /api/cards, save the result locally. List the
 * saved decks; each row carries a per-row format picker (slice 72-B)
 * that fires {@code POST /api/decks/validate} and renders an inline
 * legality badge + error breakdown.
 *
 * <p>Slice 72-B intentionally keeps legality "diagnose only" — no
 * auto-fix actions on the page itself. The user picks a format,
 * sees what's wrong, and decides whether to edit the deck.
 */
export function Decks() {
  const session = useAuthStore((s) => s.session);
  const decks = useDecksStore((s) => s.decks);
  const addDeck = useDecksStore((s) => s.add);
  const removeDeck = useDecksStore((s) => s.remove);

  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Per-page state — when set, the editor takes over the Decks tab
  // content. Local-state route (no URL) keeps it consistent with the
  // existing modal/tab patterns elsewhere in the app.
  const [editingDeckId, setEditingDeckId] = useState<string | null>(null);

  const deckTypes = useDeckTypes(session?.token);

  const onImport = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!session) {
      setError('Not signed in.');
      return;
    }
    const parsed = parseDeckText(text);
    if (parsed.errors.length > 0) {
      setError(parsed.errors.join('\n'));
      return;
    }
    if (parsed.cards.length === 0 && parsed.sideboard.length === 0) {
      setError('No cards parsed. Use one "<count> <card name>" line per entry.');
      return;
    }

    setImporting(true);
    try {
      const result = await resolveDeckLists(
        parsed.cards,
        parsed.sideboard,
        session.token,
      );
      if (result.missing.length > 0) {
        setError(
          'Could not find these cards in the server DB ' +
            '(check exact spelling, including capitalization):\n  ' +
            result.missing.join('\n  '),
        );
        return;
      }
      addDeck(name, result.cards, result.sideboard);
      setName('');
      setText('');
    } catch (err) {
      // Slice 72-B critic C1 — restore the error-surfacing path.
      // resolveDeckLists can throw ApiError (NETWORK, SCHEMA_MISMATCH,
      // 5xx from /api/cards). Without this branch the form silently
      // re-enables with no feedback that anything failed.
      setError(err instanceof Error ? err.message : 'Import failed.');
    } finally {
      setImporting(false);
    }
  };

  if (editingDeckId) {
    return (
      <DeckEditor
        deckId={editingDeckId}
        onClose={() => setEditingDeckId(null)}
      />
    );
  }

  return (
    <div className="space-y-6">
      <ImportForm
        name={name}
        text={text}
        importing={importing}
        error={error}
        onName={setName}
        onText={setText}
        onSubmit={onImport}
      />
      <SavedList
        decks={decks}
        deckTypeGroups={deckTypes.grouped}
        deckTypesError={deckTypes.error}
        deckTypesLoading={deckTypes.loading}
        token={session?.token}
        onRemove={removeDeck}
        onEdit={setEditingDeckId}
      />
    </div>
  );
}

interface ImportFormProps {
  name: string;
  text: string;
  importing: boolean;
  error: string | null;
  onName: (v: string) => void;
  onText: (v: string) => void;
  onSubmit: (e: FormEvent) => void;
}

function ImportForm({
  name, text, importing, error, onName, onText, onSubmit,
}: ImportFormProps) {
  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <h2 className="text-xl font-semibold">Import a deck</h2>
      <input
        type="text"
        value={name}
        onChange={(e) => onName(e.target.value)}
        placeholder="Deck name"
        className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-fuchsia-500"
      />
      <textarea
        value={text}
        onChange={(e) => onText(e.target.value)}
        rows={12}
        spellCheck={false}
        placeholder={
          '4 Lightning Bolt\n' +
          '4 Counterspell\n' +
          '20 Island\n' +
          '\n' +
          'Sideboard\n' +
          '2 Negate'
        }
        className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-fuchsia-500 font-mono text-sm"
      />
      <p className="text-xs text-zinc-500">
        Accepts MTGA / MTGO / Moxfield / Archidekt exports. Sideboard
        starts after a blank line or a <code>Sideboard</code> header.
        Trailing <code>(SET) NUM</code> annotations are stripped.
      </p>
      {error && (
        <pre role="alert" className="text-sm text-status-danger whitespace-pre-wrap font-sans">
          {error}
        </pre>
      )}
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={importing}
          className="bg-fuchsia-600 hover:bg-fuchsia-500 disabled:bg-zinc-700 text-white font-medium rounded px-4 py-2"
        >
          {importing ? 'Resolving…' : 'Import deck'}
        </button>
      </div>
    </form>
  );
}

interface SavedListProps {
  decks: SavedDeck[];
  deckTypeGroups: DeckTypeGroup[];
  deckTypesError: string | null;
  deckTypesLoading: boolean;
  token: string | undefined;
  onRemove: (id: string) => void;
  onEdit: (id: string) => void;
}

function SavedList({
  decks, deckTypeGroups, deckTypesError, deckTypesLoading, token, onRemove, onEdit,
}: SavedListProps) {
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold">Saved decks</h2>
      {decks.length === 0 ? (
        <p className="text-zinc-500 italic">No decks yet. Paste one above.</p>
      ) : (
        <ul className="divide-y divide-zinc-800 border border-zinc-800 rounded">
          {decks.map((deck) => (
            <DeckRow
              key={deck.id}
              deck={deck}
              deckTypeGroups={deckTypeGroups}
              deckTypesError={deckTypesError}
              deckTypesLoading={deckTypesLoading}
              token={token}
              onRemove={onRemove}
              onEdit={onEdit}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

interface DeckRowProps {
  deck: SavedDeck;
  deckTypeGroups: DeckTypeGroup[];
  deckTypesError: string | null;
  deckTypesLoading: boolean;
  token: string | undefined;
  onRemove: (id: string) => void;
  onEdit: (id: string) => void;
}

function DeckRow({
  deck, deckTypeGroups, deckTypesError, deckTypesLoading, token, onRemove, onEdit,
}: DeckRowProps) {
  // Format pick is per-deck, in-memory only. Persisting across page
  // reloads is a slice 72-B follow-up — most users will pick the same
  // format every time on the same deck, but for now the cost of a
  // re-pick is tiny (one dropdown click + one debounced fetch).
  const [deckType, setDeckType] = useState('');

  const deckBody = useMemo(
    () => (deck ? toRequestBody(deck, '') : null),
    [deck],
  );
  const status = useDeckLegality({ deck: deckBody, deckType, token });

  return (
    <li className="p-3 space-y-2">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-1 min-w-0 flex-1">
          <p className="font-medium truncate">{deck.name}</p>
          <p className="text-xs text-zinc-400">
            {totalCount(
              deck.cards.map((c) => ({
                count: c.amount,
                cardName: c.cardName,
              })),
            )}{' '}
            cards
            {(deck.sideboard?.length ?? 0) > 0 && (
              <>
                {' '}/{' '}
                {totalCount(
                  deck.sideboard.map((c) => ({
                    count: c.amount,
                    cardName: c.cardName,
                  })),
                )}{' '}
                sideboard
              </>
            )}
            &nbsp;·&nbsp;
            imported {new Date(deck.createdAt).toLocaleDateString()}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <button
            type="button"
            data-testid="deck-row-edit"
            onClick={() => onEdit(deck.id)}
            className="text-sm text-fuchsia-300 hover:text-fuchsia-200"
            aria-label={`Edit ${deck.name}`}
          >
            Edit
          </button>
          <button
            type="button"
            onClick={() => onRemove(deck.id)}
            className="text-sm text-zinc-400 hover:text-red-400"
            aria-label={`Delete ${deck.name}`}
          >
            Delete
          </button>
        </div>
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        <label className="flex items-center gap-2 text-xs text-zinc-400">
          <span>Check legality:</span>
          <select
            value={deckType}
            onChange={(e) => setDeckType(e.target.value)}
            disabled={deckTypesLoading || !token}
            className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-100 disabled:opacity-50"
            aria-label={`Format for ${deck.name}`}
          >
            <option value="">— pick a format —</option>
            {deckTypeGroups.map((group, i) => (
              <Fragment key={group.label || `flat-${i}`}>
                {group.label ? (
                  // Critic UX-C2: separator-stripped optgroup — strips the
                  // redundant "Group - " prefix so labels like "Constructed
                  // - Modern" render as just "Modern" under the optgroup
                  // header.
                  <optgroup label={group.label}>
                    {group.options.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt.startsWith(`${group.label} - `)
                          ? opt.slice(group.label.length + 3)
                          : opt}
                      </option>
                    ))}
                  </optgroup>
                ) : (
                  // Flat-tail entries (e.g. "Limited") get their own
                  // labeled optgroup so they're visually separated from
                  // the named groups above. Without this, the flat tail
                  // appears to extend the last named group.
                  <optgroup label="Other">
                    {group.options.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </optgroup>
                )}
              </Fragment>
            ))}
          </select>
        </label>
        <LegalityBadge status={status} />
      </div>
      {deckTypesError && (
        <p className="text-xs text-status-danger">{deckTypesError}</p>
      )}
      {status.kind === 'error' && (
        <p className="text-xs text-status-danger">
          {status.code}: {status.message}
        </p>
      )}
      {status.kind === 'verdict' && status.errors.length > 0 && (
        <div className="pt-1 pl-1">
          <ValidationErrorList
            errors={status.errors}
            ariaLabel={`Validation errors for ${deck.name}`}
          />
        </div>
      )}
    </li>
  );
}

/**
 * Slice 72-B — single-element badge so screen readers announce state
 * transitions cleanly (the prior implementation swapped between five
 * separate spans, which some SRs do not re-announce). Same dot+text
 * pattern with consistent width across all five states (the
 * "Checking…" state carries a muted dot placeholder so the row
 * doesn't reflow when the state changes).
 *
 * <p>Critic-folded fixes:
 * <ul>
 *   <li>UX-C1 — non-legal verdicts include the actual error count so
 *       the user knows the scale before scanning the list.</li>
 *   <li>UI-I4 — "Could not check" uses amber, not red, so transient
 *       infra failures don't read as a hard verdict.</li>
 *   <li>UI-I5 — "Checking…" carries a muted dot so the badge width
 *       stays stable across state transitions.</li>
 * </ul>
 */
function LegalityBadge({ status }: { status: LegalityStatus }) {
  if (status.kind === 'idle') {
    return null;
  }
  const { dotClass, textClass, label } = badgeAppearance(status);
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-medium ${textClass}`}
      aria-live="polite"
    >
      <span aria-hidden="true" className={`h-2 w-2 rounded-full ${dotClass}`} />
      {label}
    </span>
  );
}

function badgeAppearance(status: Exclude<LegalityStatus, { kind: 'idle' }>): {
  dotClass: string;
  textClass: string;
  label: string;
} {
  if (status.kind === 'loading') {
    return {
      dotClass: 'bg-text-muted',
      textClass: 'text-text-muted italic',
      label: 'Checking…',
    };
  }
  if (status.kind === 'error') {
    return {
      dotClass: 'bg-status-warning',
      textClass: 'text-status-warning',
      label: 'Could not check',
    };
  }
  if (status.valid) {
    return {
      dotClass: 'bg-status-success',
      textClass: 'text-status-success',
      label: 'Legal',
    };
  }
  // Real (non-synthetic) errors drive the count — the synthetic
  // overflow row is a footer affordance, not a "real" error.
  const realCount = status.errors.filter((e) => !e.synthetic).length;
  const issueWord = realCount === 1 ? 'issue' : 'issues';
  if (status.partlyLegal) {
    return {
      dotClass: 'bg-status-warning',
      textClass: 'text-status-warning',
      label: `Legal once finished · ${realCount} ${issueWord}`,
    };
  }
  return {
    dotClass: 'bg-status-danger',
    textClass: 'text-status-danger',
    label: `Not legal · ${realCount} ${issueWord}`,
  };
}
