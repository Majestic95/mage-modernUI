/**
 * Lobby helper — fetch Scryfall card data for the commander preview's
 * oracle-text panel. Caches per name in a module-level Map so the same
 * commander only hits the network once per session; subsequent selects
 * resolve synchronously from cache.
 *
 * <p>Scryfall's exact-match endpoint:
 * {@code https://api.scryfall.com/cards/named?exact=NAME} returns the
 * full card JSON (oracle_text, mana_cost, type_line, power, toughness,
 * image_uris.normal). Same-origin? No — but Scryfall sets permissive
 * CORS headers, so a browser fetch works without a server proxy.
 *
 * <p>Rate-limit posture: Scryfall's docs suggest 50-100 ms between
 * requests; for our use (one fetch per commander selection) this is a
 * non-issue. The cache prevents repeat requests for the same name even
 * across deck reselection cycles.
 */
import { useEffect, useState } from 'react';

export interface ScryfallCard {
  name: string;
  manaCost: string;
  typeLine: string;
  oracleText: string;
  power: string | null;
  toughness: string | null;
  loyalty: string | null;
  imageUrl: string | null;
  /**
   * For double-faced cards: the back face's data, mirroring the front.
   * Null when the card is single-faced. Only the first face is shown
   * by default; the panel exposes a flip control if non-null.
   */
  backFace: ScryfallFace | null;
}

interface ScryfallFace {
  name: string;
  manaCost: string;
  typeLine: string;
  oracleText: string;
  power: string | null;
  toughness: string | null;
  loyalty: string | null;
  imageUrl: string | null;
}

interface State {
  card: ScryfallCard | null;
  loading: boolean;
  error: string | null;
}

const cache = new Map<string, ScryfallCard>();
const inflight = new Map<string, Promise<ScryfallCard>>();

function pickImage(uris: Record<string, string> | undefined): string | null {
  if (!uris) return null;
  return uris['normal'] ?? uris['large'] ?? uris['png'] ?? null;
}

function faceFromJson(json: Record<string, unknown>): ScryfallFace {
  const imageUris = json['image_uris'] as Record<string, string> | undefined;
  return {
    name: String(json['name'] ?? ''),
    manaCost: String(json['mana_cost'] ?? ''),
    typeLine: String(json['type_line'] ?? ''),
    oracleText: String(json['oracle_text'] ?? ''),
    power: json['power'] != null ? String(json['power']) : null,
    toughness: json['toughness'] != null ? String(json['toughness']) : null,
    loyalty: json['loyalty'] != null ? String(json['loyalty']) : null,
    imageUrl: pickImage(imageUris),
  };
}

async function fetchScryfall(name: string): Promise<ScryfallCard> {
  const url =
    `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name)}`;
  const r = await fetch(url, {
    headers: { Accept: 'application/json' },
  });
  if (!r.ok) {
    throw new Error(`Scryfall HTTP ${r.status}`);
  }
  const json = (await r.json()) as Record<string, unknown>;
  // Double-faced cards have card_faces[0] / card_faces[1]; the top-
  // level image_uris is absent. Single-faced cards have image_uris
  // at the top level and no card_faces.
  const faces = json['card_faces'] as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(faces) && faces.length >= 1) {
    const front = faceFromJson(faces[0]!);
    const back = faces.length >= 2 ? faceFromJson(faces[1]!) : null;
    return { ...front, backFace: back };
  }
  const front = faceFromJson(json);
  return { ...front, backFace: null };
}

export function useScryfallCard(name: string | null): State {
  const [state, setState] = useState<State>(() => {
    if (!name) return { card: null, loading: false, error: null };
    const cached = cache.get(name);
    if (cached) return { card: cached, loading: false, error: null };
    return { card: null, loading: true, error: null };
  });

  useEffect(() => {
    // Synchronizing local state to the (cached or fetched) Scryfall
    // card for the current name. The setStates below intentionally
    // run inside the effect — they reflect external (network) state
    // changes, not derivable-in-render values.
    if (!name) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState({ card: null, loading: false, error: null });
      return;
    }
    const cached = cache.get(name);
    if (cached) {
      setState({ card: cached, loading: false, error: null });
      return;
    }
    let cancelled = false;
    setState({ card: null, loading: true, error: null });
    let promise = inflight.get(name);
    if (!promise) {
      promise = fetchScryfall(name)
        .then((card) => {
          cache.set(name, card);
          return card;
        })
        .finally(() => {
          inflight.delete(name);
        });
      inflight.set(name, promise);
    }
    promise
      .then((card) => {
        if (!cancelled) setState({ card, loading: false, error: null });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState({
            card: null,
            loading: false,
            error: err instanceof Error ? err.message : 'Scryfall fetch failed',
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [name]);

  return state;
}
