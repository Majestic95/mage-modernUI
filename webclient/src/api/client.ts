/**
 * Typed fetch wrapper for the Mage WebApi. Every response is parsed
 * through a Zod schema before reaching component code (per ADR 0002 D5
 * — drift surfaces here, not deep in component logic).
 *
 * <p>Errors:
 * <ul>
 *   <li>HTTP 4xx/5xx with a {@link WebError}-shaped body becomes an
 *       {@link ApiError} carrying the {@code code}, {@code message},
 *       and {@code status}.</li>
 *   <li>Network failures, JSON parse failures, and Zod schema
 *       mismatches all surface as {@link ApiError} with appropriate
 *       synthetic codes ({@code NETWORK}, {@code BAD_RESPONSE},
 *       {@code SCHEMA_MISMATCH}).</li>
 * </ul>
 */
import type { z } from 'zod';
import {
  EXPECTED_SCHEMA_MAJOR,
  parseSchemaVersion,
  webErrorSchema,
  type WebDeckValidationError,
} from './schemas';

const DEFAULT_BASE_URL = 'http://localhost:18080';

const baseUrl = (
  (import.meta.env['VITE_XMAGE_WEBAPI_URL'] as string | undefined) ??
  DEFAULT_BASE_URL
).replace(/\/+$/, '');

/**
 * Thrown for every non-2xx response and every transport / parse
 * failure. {@code code} is a machine-parseable string (e.g.
 * {@code "MISSING_TOKEN"}, {@code "DECK_INVALID"}) safe for
 * {@code switch}-on; {@code message} is the human-friendly text.
 *
 * <p>Slice 72-B — when the server sends {@code WebError.validationErrors}
 * (the {@code DECK_INVALID} path), the array is forwarded onto
 * {@link #validationErrors}. Null on every other code, including
 * pre-1.21 servers that never populated the field.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly validationErrors: readonly WebDeckValidationError[] | null;

  constructor(
    status: number,
    code: string,
    message: string,
    validationErrors: readonly WebDeckValidationError[] | null = null,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.validationErrors = validationErrors;
  }
}

export interface RequestOptions {
  /** Bearer token; injected as {@code Authorization} header when set. */
  token?: string;
  /** JSON body for POST/PUT/PATCH. */
  body?: unknown;
  /** Override the request method. Default: GET when no body, POST when body present. */
  method?: string;
  /** Per-request abort signal. */
  signal?: AbortSignal;
}

interface ResponseEnvelopeFields {
  schemaVersion?: string;
}

/**
 * Send a request and parse the response body through {@code schema}.
 * Pass {@code null} for {@code schema} when the endpoint returns
 * {@code 204 No Content} (e.g. logout, leave seat).
 */
export async function request<S extends z.ZodTypeAny>(
  path: string,
  schema: S,
  options?: RequestOptions,
): Promise<z.infer<S>>;
export async function request(
  path: string,
  schema: null,
  options?: RequestOptions,
): Promise<void>;
export async function request<S extends z.ZodTypeAny>(
  path: string,
  schema: S | null,
  options: RequestOptions = {},
): Promise<z.infer<S> | void> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  // ngrok-free-tier playtest tunnels serve a browser-targeted HTML
  // interstitial ("you are about to visit...") on the FIRST request
  // from any User-Agent that looks like Chrome/Firefox/Safari. The
  // SPA's fetch() then JSON.parse-fails on the HTML body and
  // surfaces as "Failed to fetch" / BAD_RESPONSE. ngrok documents
  // this header as the explicit bypass for API clients —
  // https://ngrok.com/docs/network-edge/domains-and-tcp-addresses/#warning-page
  //
  // P2 audit fix — gate the header on whether the resolved API URL
  // actually points at ngrok. Pre-fix it was sent unconditionally,
  // which leaked the infra hint to anyone inspecting prod requests
  // even after we move off ngrok to a real backend domain. Auto-
  // detect keeps the header working today AND silently drops it
  // once the API URL stops containing "ngrok".
  if (baseUrl.includes('ngrok')) {
    headers['ngrok-skip-browser-warning'] = '1';
  }
  if (options.token) {
    headers['Authorization'] = `Bearer ${options.token}`;
  }
  let body: BodyInit | undefined;
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  const method =
    options.method ?? (options.body !== undefined ? 'POST' : 'GET');

  let response: Response;
  try {
    const fetchInit: RequestInit = { method, headers };
    if (body !== undefined) {
      fetchInit.body = body;
    }
    if (options.signal !== undefined) {
      fetchInit.signal = options.signal;
    }
    response = await fetch(`${baseUrl}${path}`, fetchInit);
  } catch (err) {
    throw new ApiError(0, 'NETWORK',
      err instanceof Error ? err.message : 'Network request failed');
  }

  if (response.status === 204) {
    return;
  }

  const text = await response.text();
  let json: unknown = null;
  if (text.length > 0) {
    try {
      json = JSON.parse(text);
    } catch {
      throw new ApiError(response.status, 'BAD_RESPONSE',
        `Server returned non-JSON body (status ${response.status}).`);
    }
  }

  if (!response.ok) {
    const parsed = webErrorSchema.safeParse(json);
    if (parsed.success) {
      // Slice 72-B — forward validationErrors when present (DECK_INVALID
      // path). Null on every other code; the caller can safely
      // switch-on err.code and only read validationErrors in the
      // DECK_INVALID branch.
      throw new ApiError(
        response.status,
        parsed.data.code,
        parsed.data.message,
        parsed.data.validationErrors,
      );
    }
    throw new ApiError(response.status, 'BAD_RESPONSE',
      `Server returned ${response.status} with non-WebError body.`);
  }

  if (schema === null) {
    return;
  }

  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new ApiError(response.status, 'SCHEMA_MISMATCH',
      `Response failed validation: ${parsed.error.message}`);
  }

  // Best-effort schema-version major-mismatch detection. Major bump =
  // breaking change; refuse. Minor bump = additive; warn but continue.
  const sv = (parsed.data as ResponseEnvelopeFields).schemaVersion;
  if (typeof sv === 'string') {
    const parts = parseSchemaVersion(sv);
    if (parts && parts.major !== EXPECTED_SCHEMA_MAJOR) {
      throw new ApiError(response.status, 'SCHEMA_MISMATCH',
        `Wire-format major version ${parts.major} ≠ expected ${EXPECTED_SCHEMA_MAJOR}.`);
    }
  }

  return parsed.data;
}

export const apiBaseUrl = baseUrl;
