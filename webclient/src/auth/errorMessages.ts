/**
 * Slice F20 (2026-05-04, audit follow-up UX C1 / C3 / C4) — friendly
 * error-message mapping for the auth surface. The WebApi returns
 * machine-readable error codes ({@link import('../api/client').ApiError#code})
 * which are useful for tests and clients but unfriendly when shown
 * to a user verbatim.
 *
 * <p>This helper covers every code the auth flow can produce
 * (login + register + the synthetic transport codes). Unknown codes
 * fall back to the original server message (or a generic
 * "Something went wrong" if there isn't one).
 */
import { ApiError } from '../api/client';

/**
 * Map a server error to a single user-readable sentence. Pure;
 * returns the same string for the same input.
 */
export function authErrorToMessage(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      // Transport-level codes (synthesized client-side in `request`)
      case 'NETWORK':
        return "Can't reach the server. Check your connection and try again.";
      case 'BAD_RESPONSE':
        return 'The server returned an unexpected response. Please try again.';
      case 'SCHEMA_MISMATCH':
        return 'The server is running an incompatible version. Reload the page.';

      // Generic server-side codes
      case 'RATE_LIMITED':
        return 'Too many attempts from your network. Please wait a moment.';
      case 'MISSING_TOKEN':
        return 'Your session expired. Please sign in again.';
      case 'INVALID_TOKEN':
        return 'Your session is invalid. Please sign in again.';

      // Login-specific
      case 'INVALID_CREDENTIALS':
        return 'Sign-in failed. Check your username and password.';
      case 'PASSWORD_REQUIRED':
        return 'This username is registered. Sign in with the password you set, or pick a different name to play as a guest.';

      // Register-specific
      case 'REGISTRATION_DISABLED':
        return 'Account registration is currently disabled on this server.';
      case 'INVALID_USERNAME':
        return 'Usernames must be 1–32 characters using letters, numbers, hyphens, or underscores.';
      case 'INVALID_PASSWORD':
        return 'Password must be at least 8 characters.';
      case 'INVALID_EMAIL':
        return 'Please enter a valid email address.';
      case 'USERNAME_TAKEN':
        return 'That username is already registered. Try another name or sign in.';
      case 'RESERVED_PREFIX':
      case 'RESERVED_USERNAME':
        return 'That username is reserved. Please choose another.';

      // Server hiccups — generic
      case 'UPSTREAM_ERROR':
        return 'The server hit a problem completing the request. Please try again.';
      case 'NOT_FOUND':
        return 'That resource is no longer available.';
      case 'BAD_REQUEST':
        return 'The request was malformed. Please try again.';

      default:
        // Fall back to server message if it looks user-readable;
        // otherwise a generic. Server messages with regex / paths /
        // upstream-error shapes look ugly so we hide anything with
        // characters typical of internal text.
        if (looksUserReadable(err.message)) return err.message;
        return 'Something went wrong. Please try again.';
    }
  }
  return 'Something went wrong. Please try again.';
}

/**
 * Heuristic: does a server-supplied error message look fit for end-
 * user display? Rejects regex literals, file paths, multi-line
 * dumps. Conservative — better to fall back to the generic than
 * leak something ugly.
 */
function looksUserReadable(message: string | undefined): boolean {
  if (!message) return false;
  if (message.length > 200) return false;
  if (message.includes('\n')) return false;
  // Regex / path patterns commonly leak from server errors.
  if (/[\\\\\[\]{}<>]/.test(message)) return false;
  return true;
}

/**
 * Extract a Retry-After hint from a {@link ApiError}. Server-side
 * 429 responses don't currently carry a Retry-After header through
 * the WebApi layer, but if that lands later this helper picks it
 * up. For now we use a fixed 60-second fallback for RATE_LIMITED.
 */
export function rateLimitedCooldownSeconds(err: unknown): number {
  if (err instanceof ApiError && err.code === 'RATE_LIMITED') {
    // The WebApi rate limiter ticks per 60-second window per IP,
    // so 60 seconds is the safe minimum cooldown — by then a fresh
    // bucket is guaranteed.
    return 60;
  }
  return 0;
}
