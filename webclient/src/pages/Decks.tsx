import { useState, type FormEvent } from 'react';
import { parseDeckText, totalCount } from '../decks/parse';
import { resolveDeckLists } from '../decks/resolve';
import { useDecksStore, type SavedDeck } from '../decks/store';
import { useAuthStore } from '../auth/store';

/**
 * Decks tab — paste a textual deck list, resolve every card name to a
 * specific printing via /api/cards, save the result locally. List the
 * saved decks; each row has a delete button.
 *
 * <p>Slice 4.4 — mainboard only; sideboard parsing comes later.
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
        setImporting(false);
        return;
      }
      addDeck(name, result.cards, result.sideboard);
      setName('');
      setText('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed.');
    } finally {
      setImporting(false);
    }
  };

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
      <SavedList decks={decks} onRemove={removeDeck} />
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
        <pre role="alert" className="text-sm text-red-400 whitespace-pre-wrap font-sans">
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

function SavedList({
  decks,
  onRemove,
}: {
  decks: SavedDeck[];
  onRemove: (id: string) => void;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold">Saved decks</h2>
      {decks.length === 0 ? (
        <p className="text-zinc-500 italic">No decks yet. Paste one above.</p>
      ) : (
        <ul className="divide-y divide-zinc-800 border border-zinc-800 rounded">
          {decks.map((deck) => (
            <li key={deck.id} className="p-3 flex items-center justify-between gap-4">
              <div className="space-y-1 min-w-0">
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
              <button
                type="button"
                onClick={() => onRemove(deck.id)}
                className="text-sm text-zinc-400 hover:text-red-400"
                aria-label={`Delete ${deck.name}`}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
