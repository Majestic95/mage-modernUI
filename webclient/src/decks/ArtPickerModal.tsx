/**
 * Modal that lists every engine-known printing of a card and lets the
 * user pick which one their saved deck should use. The chosen
 * setCode + cardNumber are written back to the deck via store.update;
 * because the in-game wire emits the same setCode + cardNumber the
 * engine instantiated from, the picked art renders end-to-end —
 * deck list → lobby seat preview → in-game card render.
 *
 * <p>Printings come from {@code GET /api/cards/printings?name=X}.
 * Each tile is a Scryfall image fetched by setCode + cardNumber,
 * with a placeholder fallback when Scryfall doesn't have that exact
 * printing (xmage promo sets, non-standard collector numbers).
 */
import { useEffect, useRef, useState } from 'react';
import { ApiError, request } from '../api/client';
import { webCardListingSchema, type WebCardInfo } from '../api/schemas';
import { useAuthStore } from '../auth/store';
import { useModalA11y } from '../util/useModalA11y';

interface Props {
  cardName: string;
  /** Currently-selected printing — highlighted in the grid. */
  currentSetCode: string;
  currentCardNumber: string;
  onClose: () => void;
  onSelect: (setCode: string, cardNumber: string) => void;
}

const PRINTINGS_LIMIT = 60;

export function ArtPickerModal({
  cardName,
  currentSetCode,
  currentCardNumber,
  onClose,
  onSelect,
}: Props) {
  const token = useAuthStore((s) => s.session?.token ?? null);
  const [printings, setPrintings] = useState<WebCardInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const modalRootRef = useRef<HTMLDivElement>(null);
  useModalA11y(modalRootRef, { onClose });

  useEffect(() => {
    if (!token) {
      setError('Not signed in.');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const result = await request(
          `/api/cards/printings?name=${encodeURIComponent(cardName)}&limit=${PRINTINGS_LIMIT}`,
          webCardListingSchema,
          { token },
        );
        if (cancelled) return;
        setPrintings(result.cards);
        setTruncated(result.truncated);
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof ApiError ? err.message : 'Failed to load printings.',
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cardName, token]);

  return (
    <div
      ref={modalRootRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="art-picker-heading"
      data-testid="art-picker-modal"
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg max-w-5xl w-full max-h-[90vh] flex flex-col">
        <header className="flex items-baseline justify-between p-4 border-b border-zinc-800">
          <div>
            <h2 id="art-picker-heading" className="text-lg font-semibold">
              Choose art — <span className="text-fuchsia-300">{cardName}</span>
            </h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              Click a printing to use its art in your deck and in-game.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-100 text-2xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-4">
          {error && (
            <p role="alert" className="text-sm text-status-danger">
              {error}
            </p>
          )}
          {!error && printings === null && (
            <p data-testid="art-picker-loading" className="text-sm text-zinc-500 italic">
              Loading printings…
            </p>
          )}
          {printings && printings.length === 0 && (
            <p className="text-sm text-zinc-500 italic">
              No printings found for this card.
            </p>
          )}
          {printings && printings.length > 0 && (
            <ul
              data-testid="art-picker-grid"
              className="grid gap-3"
              style={{
                gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
              }}
            >
              {printings.map((p) => {
                const isCurrent =
                  p.setCode === currentSetCode
                  && p.cardNumber === currentCardNumber;
                return (
                  <li key={`${p.setCode}-${p.cardNumber}`}>
                    <PrintingTile
                      printing={p}
                      isCurrent={isCurrent}
                      onSelect={() => {
                        onSelect(p.setCode, p.cardNumber);
                        onClose();
                      }}
                    />
                  </li>
                );
              })}
            </ul>
          )}
          {truncated && (
            <p className="text-xs text-zinc-500 italic mt-3">
              Showing first {PRINTINGS_LIMIT} printings — narrow your deck-build
              to a different card name to see more.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function PrintingTile({
  printing,
  isCurrent,
  onSelect,
}: {
  printing: WebCardInfo;
  isCurrent: boolean;
  onSelect: () => void;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const url = scryfallNormalUrl(printing.setCode, printing.cardNumber);
  return (
    <button
      type="button"
      data-testid="art-picker-tile"
      data-current={isCurrent || undefined}
      data-set={printing.setCode}
      data-number={printing.cardNumber}
      onClick={onSelect}
      className={
        'group flex flex-col gap-1 w-full rounded-lg overflow-hidden border transition-all '
        + (isCurrent
          ? 'border-fuchsia-400 ring-2 ring-fuchsia-400'
          : 'border-zinc-700 hover:border-zinc-500')
      }
    >
      <div
        className="w-full bg-zinc-800 overflow-hidden"
        style={{ aspectRatio: '5 / 7' }}
      >
        {url && !imgFailed ? (
          <img
            src={url}
            alt={`${printing.setCode} #${printing.cardNumber}`}
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
          <div className="flex h-full w-full items-center justify-center p-2 text-center text-xs text-zinc-500">
            {printing.setCode} #{printing.cardNumber}
          </div>
        )}
      </div>
      <p className="px-2 pb-1.5 pt-0.5 text-xs text-zinc-300 text-center">
        <span className="font-mono uppercase">{printing.setCode}</span>{' '}
        <span className="text-zinc-500">#{printing.cardNumber}</span>
        {isCurrent && (
          <span className="ml-1 text-fuchsia-300 font-medium">(current)</span>
        )}
      </p>
    </button>
  );
}

function scryfallNormalUrl(setCode: string, cardNumber: string): string | null {
  if (!setCode || !cardNumber) return null;
  const set = setCode.toLowerCase();
  const num = encodeURIComponent(cardNumber);
  return `https://api.scryfall.com/cards/${set}/${num}?format=image&version=normal`;
}
