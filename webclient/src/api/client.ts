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
} from './schemas';

const DEFAULT_BASE_URL = 'http://localhost:18080';

const baseUrl = (
  (import.meta.env['VITE_XMAGE_WEBAPI_URL'] as string | undefined) ??
  DEFAULT_BASE_URL
).replace(/\/+$/, '');

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
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
      throw new ApiError(response.status, parsed.data.code, parsed.data.message);
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
