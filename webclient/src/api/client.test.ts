import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, request } from './client';
import { z } from 'zod';

/**
 * Slice 72-B — pin the ApiError widening contract. Earlier slices
 * relied on the implicit "validationErrors === undefined" path; now
 * client code reads err.validationErrors after every catch, so a
 * regression in the parse-and-forward path would silently break the
 * DECK_INVALID surface.
 */
describe('ApiError construction', () => {
  it('legacy 3-arg construction leaves validationErrors null', () => {
    const err = new ApiError(401, 'MISSING_TOKEN', 'Auth required.');
    expect(err.validationErrors).toBeNull();
    expect(err.code).toBe('MISSING_TOKEN');
    expect(err.status).toBe(401);
  });
  it('4-arg construction stores the validationErrors array', () => {
    const errors = [
      {
        errorType: 'BANNED',
        group: 'Sol Ring',
        message: 'Banned',
        cardName: 'Sol Ring',
        partlyLegal: false,
        synthetic: false,
      },
    ];
    const err = new ApiError(422, 'DECK_INVALID', 'Deck invalid.', errors);
    expect(err.validationErrors).toEqual(errors);
  });
});

describe('request error handling', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('forwards validationErrors onto ApiError on DECK_INVALID', async () => {
    const body = {
      schemaVersion: '1.21',
      code: 'DECK_INVALID',
      message: 'Deck failed validation.',
      validationErrors: [
        {
          errorType: 'BANNED',
          group: 'Mana Crypt',
          message: 'Banned',
          cardName: 'Mana Crypt',
          partlyLegal: false,
          synthetic: false,
        },
      ],
    };
    vi.stubGlobal('fetch', () =>
      Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 422,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    let caught: unknown;
    try {
      await request('/api/anything', z.object({}), {
        token: 'tok',
        method: 'POST',
        body: {},
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ApiError);
    const err = caught as ApiError;
    expect(err.code).toBe('DECK_INVALID');
    expect(err.validationErrors).not.toBeNull();
    expect(err.validationErrors).toHaveLength(1);
    expect(err.validationErrors?.[0]?.cardName).toBe('Mana Crypt');
  });

  it('leaves validationErrors null on non-DECK_INVALID errors', async () => {
    const body = {
      schemaVersion: '1.21',
      code: 'UPSTREAM_REJECTED',
      message: 'Wrong password.',
    };
    vi.stubGlobal('fetch', () =>
      Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 422,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    let caught: unknown;
    try {
      await request('/api/anything', z.object({}), { token: 'tok' });
    } catch (e) {
      caught = e;
    }
    const err = caught as ApiError;
    expect(err.code).toBe('UPSTREAM_REJECTED');
    expect(err.validationErrors).toBeNull();
  });

  it('legacy 1.20 server (no validationErrors field) — null fallback', async () => {
    // Older servers never populated the field; the schema's default
    // keeps the parse clean and the ApiError carries null.
    const body = {
      schemaVersion: '1.20',
      code: 'NOT_FOUND',
      message: 'Route not found.',
    };
    vi.stubGlobal('fetch', () =>
      Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    let caught: unknown;
    try {
      await request('/api/anything', z.object({}), { token: 'tok' });
    } catch (e) {
      caught = e;
    }
    const err = caught as ApiError;
    expect(err.validationErrors).toBeNull();
  });
});
