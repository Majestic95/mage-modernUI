import type { WebDeckValidationError } from '../api/schemas';

/**
 * Slice 72-B — shared renderer for {@link WebDeckValidationError}
 * lists. One component covers both surfaces:
 *
 * <ul>
 *   <li>Decks page pre-flight (success-shape via
 *       {@code WebDeckValidationResult.errors})</li>
 *   <li>Table-join failure ({@code ApiError.validationErrors} on
 *       {@code DECK_INVALID})</li>
 * </ul>
 *
 * <p>Visual contract:
 * <ul>
 *   <li>{@code partlyLegal} entries — amber dot, "legal once finished"
 *       semantic. Today only DECK_SIZE qualifies.</li>
 *   <li>Real (non-synthetic, non-partly-legal) entries — red dot,
 *       hard error.</li>
 *   <li>{@code synthetic} entries — muted footer styling, not a
 *       clickable / actionable row.</li>
 *   <li>Entries with {@code cardName != null} — render the card name
 *       in monospace as a "click-this-card" affordance hook (the click
 *       handler itself is deferred — slice 72-B is "diagnose only" per
 *       the user's product call).</li>
 * </ul>
 *
 * <p>Server pre-sorts by error type (PRIMARY → DECK_SIZE → BANNED →
 * WRONG_SET → OTHER), so we render in array order without re-sorting.
 */
interface Props {
  errors: readonly WebDeckValidationError[];
  /**
   * Optional accessible label for the wrapper. Defaults to
   * "Deck validation errors". Override for context-specific phrasing
   * (e.g. "Join failed — deck validation errors").
   */
  ariaLabel?: string;
}

export function ValidationErrorList({ errors, ariaLabel }: Props) {
  if (errors.length === 0) {
    return null;
  }

  const real = errors.filter((e) => !e.synthetic);
  const synthetic = errors.filter((e) => e.synthetic);

  return (
    <ul
      className="space-y-1.5 text-sm"
      role="list"
      aria-label={ariaLabel ?? 'Deck validation errors'}
    >
      {real.map((err, i) => (
        <ValidationRow key={`${err.errorType}-${err.group}-${i}`} err={err} />
      ))}
      {synthetic.map((err, i) => (
        <li
          key={`synthetic-${i}`}
          // pl-4 (16px) aligns the synthetic text under the real-row
          // text column: real rows render `dot(w-2)+gap-2` = 16px from
          // the wrapper edge before the message starts.
          className="text-xs italic text-text-muted pl-4"
        >
          {err.message}
        </li>
      ))}
    </ul>
  );
}

function ValidationRow({ err }: { err: WebDeckValidationError }) {
  const isAmber = err.partlyLegal;
  const dotClass = isAmber
    ? 'bg-status-warning'
    : 'bg-status-danger';
  const textClass = isAmber
    ? 'text-status-warning'
    : 'text-text-primary';

  return (
    <li className="flex items-start gap-2">
      <span
        aria-hidden="true"
        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dotClass}`}
      />
      <span className={`leading-snug ${textClass}`}>
        {err.cardName ? (
          <>
            <span className="font-mono text-text-primary">{err.cardName}</span>
            <span className="text-text-secondary"> — {err.message}</span>
          </>
        ) : (
          <>
            {err.group && err.group !== err.message && (
              <span className="text-text-secondary">{err.group}: </span>
            )}
            <span>{err.message}</span>
          </>
        )}
      </span>
    </li>
  );
}
