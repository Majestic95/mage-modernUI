/**
 * Slice 72-B — per-deck legality state for the Decks page format
 * picker. Owns:
 *
 * <ul>
 *   <li>Currently-picked format (lifted from per-row state into a
 *       hook because the debounce timer + abort controller need to
 *       outlive the render cycle)</li>
 *   <li>Pre-flight result (valid / partlyLegal / errors)</li>
 *   <li>In-flight + error states</li>
 *   <li>250 ms debounce so a user spinning the dropdown doesn't fire
 *       a request per option (the server has a 250-entry CPU cap but
 *       we still want to be polite)</li>
 * </ul>
 *
 * <p>Returned shape is intentionally close to
 * {@link WebDeckValidationResult} so the consumer doesn't have to
 * re-derive {@code valid} / {@code partlyLegal} flags.
 */
import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../api/client';
import { validateDeck } from '../api/deckValidation';
import type { WebDeckCardLists, WebDeckValidationError } from '../api/schemas';

const DEBOUNCE_MS = 250;

export type LegalityStatus =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | {
      kind: 'verdict';
      valid: boolean;
      partlyLegal: boolean;
      errors: readonly WebDeckValidationError[];
    }
  | { kind: 'error'; code: string; message: string };

export interface UseDeckLegalityArgs {
  deck: WebDeckCardLists | null;
  deckType: string;
  token: string | undefined;
}

/**
 * Fires {@code POST /api/decks/validate} after a debounce window each
 * time {@code deckType} or {@code deck} changes. Results land in the
 * returned {@link LegalityStatus}. Cancels any in-flight request when
 * inputs change again before completion (an old verdict will never
 * overwrite a newer one).
 *
 * <p>{@code idle} is returned when the deckType is empty (user hasn't
 * picked a format) or the deck / token is missing — the consumer
 * should render a "pick a format" affordance, not a spinner.
 */
export function useDeckLegality({
  deck,
  deckType,
  token,
}: UseDeckLegalityArgs): LegalityStatus {
  const [status, setStatus] = useState<LegalityStatus>({ kind: 'idle' });
  const requestSeqRef = useRef(0);

  useEffect(() => {
    if (!token || !deck || !deckType) {
      setStatus({ kind: 'idle' });
      return;
    }
    const seq = ++requestSeqRef.current;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setStatus({ kind: 'loading' });
      validateDeck(deckType, deck, token, controller.signal)
        .then((result) => {
          if (seq !== requestSeqRef.current) return;
          setStatus({
            kind: 'verdict',
            valid: result.valid,
            partlyLegal: result.partlyLegal,
            errors: result.errors,
          });
        })
        .catch((err: unknown) => {
          if (seq !== requestSeqRef.current) return;
          if (controller.signal.aborted) return;
          if (err instanceof ApiError) {
            setStatus({
              kind: 'error',
              code: err.code,
              message: err.message,
            });
          } else if (err instanceof Error) {
            setStatus({ kind: 'error', code: 'UNKNOWN', message: err.message });
          } else {
            setStatus({
              kind: 'error',
              code: 'UNKNOWN',
              message: 'Validation request failed.',
            });
          }
        });
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [deck, deckType, token]);

  return status;
}
