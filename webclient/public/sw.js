/* eslint-disable no-restricted-globals */
/**
 * Service Worker — Scryfall image cache (slice 35).
 *
 * Cache-first for any GET against Scryfall's card-image endpoints.
 * Native browser HTTP cache already covers the happy path, but a
 * SW gives us:
 *  - durable persistence across cache evictions
 *  - one cache entry per (set, number) regardless of redirect hops
 *  - the ability to bump CACHE_NAME to force a refresh
 *
 * Per ADR 0002 / PATH_C_PLAN.md "Image strategy", this is the
 * service-worker overlay deferred from slice 34.
 *
 * Scope: only requests to {@code api.scryfall.com/cards/.../*format=image*}
 * (the redirect endpoint we use) and {@code cards.scryfall.io/*}
 * (the CDN it redirects to) are cached. Every other fetch falls
 * through to the network untouched — the SW never sees app code,
 * API calls, or WebSocket frames.
 *
 * TTL: 7 days. Entries older than that re-fetch on next access.
 */

const CACHE_NAME = 'xmage-scryfall-images-v1';
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

self.addEventListener('install', (event) => {
  // Take effect on next page load instead of waiting for every
  // tab to close — the cache rules are additive and safe to swap
  // in immediately.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Drop any older versions of our cache (CACHE_NAME bump).
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((n) => n.startsWith('xmage-scryfall-images-') && n !== CACHE_NAME)
          .map((n) => caches.delete(n)),
      );
      await self.clients.claim();
    })(),
  );
});

function isScryfallImageRequest(url) {
  if (url.hostname === 'cards.scryfall.io') return true;
  if (url.hostname === 'api.scryfall.com' && url.pathname.startsWith('/cards/')) {
    // ?format=image is what slice-34's scryfallImageUrl emits.
    return url.searchParams.get('format') === 'image';
  }
  return false;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (!isScryfallImageRequest(url)) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request);
      if (cached) {
        const cachedAt = Number(cached.headers.get('x-xmage-cached-at') || '0');
        if (Date.now() - cachedAt < TTL_MS) {
          return cached;
        }
        // Stale — fall through to refetch.
      }
      try {
        const response = await fetch(request);
        if (response.ok) {
          // Stamp the entry with our own header so we can age it
          // out without trusting the upstream's cache-control. We
          // can't mutate Headers on a Response directly; clone with
          // an extended headers map.
          const blob = await response.clone().blob();
          const stamped = new Response(blob, {
            status: response.status,
            statusText: response.statusText,
            headers: new Headers([
              ...response.headers,
              ['x-xmage-cached-at', String(Date.now())],
            ]),
          });
          cache.put(request, stamped.clone()).catch(() => {});
          return stamped;
        }
        // Non-OK — return network response, don't cache the failure.
        return response;
      } catch (err) {
        // Network error: serve a stale cache entry if we have one,
        // otherwise propagate.
        if (cached) return cached;
        throw err;
      }
    })(),
  );
});
