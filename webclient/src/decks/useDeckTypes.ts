/**
 * Slice 72-B — fetches the canonical deckType list once and caches it
 * across the page lifetime. Used by the Decks-page format picker.
 *
 * <p>Lifted out of the Decks page so the JoinTableModal renderer (and
 * any future legality UI) can share one canonical source. Avoids
 * coupling the picker to {@code Lobby.tsx}'s server-state cache,
 * which has a different invalidation lifecycle.
 *
 * <p>Trade-off vs. a global Zustand store: a one-page mount + cleanup
 * keeps the slice surface tight; if a third caller appears we lift to
 * a store. Today there are only two consumers and neither shares
 * state.
 */
import { useEffect, useState } from 'react';
import { ApiError, request } from '../api/client';
import { webServerStateSchema } from '../api/schemas';

export interface DeckTypeGroup {
  /** The {@code " - "}-prefix shared by every entry in the group. */
  label: string;
  options: string[];
}

export interface DeckTypesState {
  loading: boolean;
  error: string | null;
  /** Raw flat list as returned by the server. */
  flat: string[];
  /**
   * Optgroup-friendly partition. Entries split on the first
   * {@code " - "} into label + suffix; entries without a separator
   * fall into a single trailing group with empty {@code label}.
   */
  grouped: DeckTypeGroup[];
}

const INITIAL: DeckTypesState = {
  loading: true,
  error: null,
  flat: [],
  grouped: [],
};

export function useDeckTypes(token: string | undefined): DeckTypesState {
  const [state, setState] = useState<DeckTypesState>(INITIAL);

  useEffect(() => {
    if (!token) {
      setState({ loading: false, error: 'Not signed in.', flat: [], grouped: [] });
      return;
    }
    const controller = new AbortController();
    setState(INITIAL);
    request('/api/server/state', webServerStateSchema, {
      token,
      signal: controller.signal,
    })
      .then((s) => {
        // Critic technical-I1 — guard the .then path too. If the token
        // changes (sign-out / re-login) after the fetch resolves but
        // before .then runs, abort fires on the controller and we drop
        // the stale data instead of stomping the post-token state.
        if (controller.signal.aborted) return;
        setState({
          loading: false,
          error: null,
          flat: s.deckTypes,
          grouped: groupDeckTypes(s.deckTypes),
        });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        const message =
          err instanceof ApiError
            ? `${err.code}: ${err.message}`
            : err instanceof Error
              ? err.message
              : 'Could not load deck formats.';
        setState({ loading: false, error: message, flat: [], grouped: [] });
      });
    return () => controller.abort();
  }, [token]);

  return state;
}

/**
 * Partition the raw deckType list into UX-friendly groups by splitting
 * on the first {@code " - "} separator. Entries without the separator
 * (e.g. {@code "Limited"}) fall into the {@code label: ""} bucket so
 * the consumer can render them as a flat tail.
 *
 * <p>Exposed for unit testing; the hook itself is the single in-tree
 * consumer.
 */
export function groupDeckTypes(flat: readonly string[]): DeckTypeGroup[] {
  const buckets = new Map<string, string[]>();
  for (const entry of flat) {
    const sepIdx = entry.indexOf(' - ');
    const label = sepIdx === -1 ? '' : entry.slice(0, sepIdx);
    const list = buckets.get(label);
    if (list) {
      list.push(entry);
    } else {
      buckets.set(label, [entry]);
    }
  }
  // Preserve insertion order — the server returns deckTypes in the
  // order they were registered (config.xml order), which already
  // groups related formats. Map iteration matches that order.
  return Array.from(buckets, ([label, options]) => ({ label, options }));
}
