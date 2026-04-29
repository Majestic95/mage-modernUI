/**
 * Slice 70-A (ADR 0011 D1) — pure path-matcher for the spectator
 * placeholder route. Lives in its own module so
 * `SpectatorPlaceholder.tsx` can stay component-only (react-refresh
 * requires that to fast-reload cleanly).
 *
 * Match `/spectate/<uuid>` paths and return the gameId
 * **normalized to lowercase**, or null when the path doesn't match.
 * The UUID regex matches v1-v5 forms case-insensitively; permissive
 * enough that a manually-pasted gameId in any common form passes.
 * Lowercase normalization is load-bearing because UUIDs are
 * case-insensitive per RFC 4122 but downstream server-side
 * comparisons are case-sensitive — pinning lowercase here means a
 * paste of an uppercase UUID still resolves to the same game on the
 * server.
 *
 * App.tsx's tiny route matcher consumes this; the unit tests in
 * `SpectatorPlaceholder.test.tsx` cover its semantics. No
 * dependencies on React or DOM — pure string-in, string-out.
 */
export function matchSpectatePath(pathname: string): string | null {
  const match = pathname.match(
    /^\/spectate\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i,
  );
  return match ? match[1]!.toLowerCase() : null;
}
