/**
 * Service-worker registration for the Scryfall image cache (slice
 * 35). Production-only — in dev we rely on Vite + the browser's
 * native HTTP cache so HMR keeps working cleanly across SW updates.
 *
 * <p>Failure is silent: a missing or 404 sw.js, denied permissions,
 * or browsers without service-worker support all cause the cache
 * layer to disappear; the app still works because slice 34's
 * <img> tag with onError fallback handles every per-card outcome
 * locally.
 */
export function registerImageCache(): void {
  if (typeof navigator === 'undefined') return;
  if (!('serviceWorker' in navigator)) return;
  if (!import.meta.env.PROD) return;
  navigator.serviceWorker.register('/sw.js').catch(() => {
    // Swallow — no-op fallback is acceptable here.
  });
}
