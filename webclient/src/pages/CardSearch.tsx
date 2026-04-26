import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, request } from '../api/client';
import { webCardListingSchema, type WebCardInfo } from '../api/schemas';
import { useAuthStore } from '../auth/store';

/**
 * Look up a single card by exact name. Hits {@code GET /api/cards}.
 * Phase 4.1 first cut — no autocomplete; later slices will add prefix
 * search via a printings endpoint.
 */
export function CardSearch() {
  const session = useAuthStore((s) => s.session);
  const [name, setName] = useState('Lightning Bolt');
  const [submitted, setSubmitted] = useState<string | null>('Lightning Bolt');
  const [card, setCard] = useState<WebCardInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!session || !submitted) {
      return;
    }
    const token = session.token;
    const query = submitted;
    let cancelled = false;

    const run = async () => {
      try {
        const result = await request(
          `/api/cards?name=${encodeURIComponent(query)}`,
          webCardListingSchema,
          { token },
        );
        if (cancelled) return;
        setCard(result.cards[0] ?? null);
      } catch (err) {
        if (cancelled) return;
        setCard(null);
        setError(err instanceof ApiError ? err.message : 'Search failed.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [session, submitted]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const next = name.trim() || null;
    setSubmitted(next);
    if (next) {
      setLoading(true);
      setError(null);
    }
  };

  return (
    <div className="space-y-4">
      <form onSubmit={onSubmit} className="flex gap-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Exact card name"
          className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-fuchsia-500"
        />
        <button
          type="submit"
          disabled={loading}
          className="bg-fuchsia-600 hover:bg-fuchsia-500 disabled:bg-zinc-700 text-white font-medium rounded px-4 py-2"
        >
          {loading ? 'Searching…' : 'Search'}
        </button>
      </form>

      {error && (
        <p role="alert" className="text-sm text-red-400">{error}</p>
      )}

      {!error && submitted && !loading && !card && (
        <p className="text-zinc-500 italic">No card named "{submitted}".</p>
      )}

      {card && <CardCard card={card} />}
    </div>
  );
}

function CardCard({ card }: { card: WebCardInfo }) {
  return (
    <article className="border border-zinc-800 rounded p-4 space-y-3 bg-zinc-900">
      <header className="flex items-baseline justify-between gap-3">
        <h3 className="text-lg font-semibold">{card.name}</h3>
        <span className="text-sm text-zinc-400 flex gap-1 items-center">
          {card.manaCosts.map((m, i) => (
            <code key={i} className="bg-zinc-800 px-1 rounded">{m}</code>
          ))}
        </span>
      </header>

      <p className="text-xs text-zinc-500">
        {card.types.join(' ')}
        {card.subtypes.length > 0 && ` — ${card.subtypes.join(' ')}`}
        {' · '}
        <span className="uppercase">{card.rarity}</span>
        {' · '}
        {card.setCode} #{card.cardNumber}
      </p>

      {card.power && card.toughness && (
        <p className="text-sm">
          <span className="font-mono">{card.power}/{card.toughness}</span>
        </p>
      )}
      {card.startingLoyalty && (
        <p className="text-sm">Loyalty {card.startingLoyalty}</p>
      )}

      <div className="text-sm space-y-1">
        {card.rules.map((line, i) => (
          <p key={i}>{line}</p>
        ))}
      </div>
    </article>
  );
}
