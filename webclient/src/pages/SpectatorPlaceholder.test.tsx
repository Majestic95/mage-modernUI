import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SpectatorPlaceholder } from './SpectatorPlaceholder';
import { matchSpectatePath } from './spectatorPath';

/**
 * Slice 70-A (ADR 0011 D1) — spectator placeholder route + UUID
 * matcher. The placeholder ships before the client-side spectator
 * UI lands so a user pasting a spectate URL sees an explicit
 * "shipping in v2.x" message rather than a generic 404.
 */
describe('matchSpectatePath (slice 70-A)', () => {
  const SAMPLE_UUID = 'a1b2c3d4-1111-2222-3333-444455556666';

  it('matches /spectate/<uuid> and returns the gameId', () => {
    expect(matchSpectatePath(`/spectate/${SAMPLE_UUID}`)).toBe(SAMPLE_UUID);
  });

  it('matches with a trailing slash', () => {
    expect(matchSpectatePath(`/spectate/${SAMPLE_UUID}/`)).toBe(SAMPLE_UUID);
  });

  it('matches uppercase UUIDs and normalizes to lowercase', () => {
    // UUIDs are case-insensitive per RFC 4122; users may paste
    // either form. Ours upstream produces lowercase but accept both
    // on input. The matcher normalizes to lowercase so downstream
    // server-side comparisons (which ARE case-sensitive string
    // compares) resolve to the same game regardless of the user's
    // paste form.
    const upper = SAMPLE_UUID.toUpperCase();
    expect(matchSpectatePath(`/spectate/${upper}`)).toBe(SAMPLE_UUID);
  });

  it('returns null on the lobby root', () => {
    expect(matchSpectatePath('/')).toBeNull();
  });

  it('returns null on auth-related paths', () => {
    expect(matchSpectatePath('/login')).toBeNull();
    expect(matchSpectatePath('/decks')).toBeNull();
  });

  it('returns null on a malformed gameId', () => {
    // Defense-in-depth — a typoed UUID shouldn't render the
    // placeholder with garbage echoed back. Better to fall through
    // to the lobby than misleadingly confirm "yes, this is a game."
    expect(matchSpectatePath('/spectate/not-a-uuid')).toBeNull();
    expect(matchSpectatePath('/spectate/12345')).toBeNull();
    expect(matchSpectatePath('/spectate/')).toBeNull();
    expect(matchSpectatePath('/spectate')).toBeNull();
  });

  it('returns null on a path containing /spectate/<uuid>/extra', () => {
    // The matcher is anchored — extra path segments after the UUID
    // mean this isn't the placeholder route.
    expect(
      matchSpectatePath(`/spectate/${SAMPLE_UUID}/something`),
    ).toBeNull();
  });

  it('returns null on a query string after the UUID', () => {
    // matchSpectatePath consumes pathname only, not search. App.tsx
    // calls window.location.pathname which excludes query string.
    // This test pins that contract — query-stringed paths from a
    // direct call to matchSpectatePath would already be invalid input.
    expect(
      matchSpectatePath(`/spectate/${SAMPLE_UUID}?foo=bar`),
    ).toBeNull();
  });

  it('returns null on a hash fragment after the UUID', () => {
    // Same defensive contract as the query-string case — pathname
    // excludes hash fragment in production. Direct call to the
    // matcher with a hash-suffixed path is invalid input.
    expect(
      matchSpectatePath(`/spectate/${SAMPLE_UUID}#section`),
    ).toBeNull();
  });
});

describe('SpectatorPlaceholder render (slice 70-A)', () => {
  const SAMPLE_UUID = 'a1b2c3d4-1111-2222-3333-444455556666';

  it('echoes the gameId in monospace so the user can confirm the link', () => {
    render(<SpectatorPlaceholder gameId={SAMPLE_UUID} />);
    const idDisplay = screen.getByTestId('spectator-placeholder-game-id');
    expect(idDisplay.textContent).toBe(SAMPLE_UUID);
  });

  it('renders the "shipping in v2.x" deferral message', () => {
    render(<SpectatorPlaceholder gameId={SAMPLE_UUID} />);
    expect(screen.getByText(/shipping in v2\.x/i)).toBeInTheDocument();
  });

  it('renders a "Return to lobby" link back to the root', () => {
    render(<SpectatorPlaceholder gameId={SAMPLE_UUID} />);
    const link = screen.getByRole('link', { name: /return to lobby/i });
    expect(link).toBeInTheDocument();
    expect(link.getAttribute('href')).toBe('/');
  });

  it('renders the heading "Spectator mode"', () => {
    render(<SpectatorPlaceholder gameId={SAMPLE_UUID} />);
    expect(
      screen.getByRole('heading', { name: /spectator mode/i }),
    ).toBeInTheDocument();
  });
});
