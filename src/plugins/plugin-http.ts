import type { PluginRequest } from './plugin-definition';

/** Browser and proxy credentials of the caller never reach plugin code. */
const WITHHELD = new Set(['cookie', 'authorization', 'x-xsrf-token', 'x-csrf-token']);

const BLOCKED_RESPONSE_HEADERS = new Set([
  'connection',
  'content-length',
  'transfer-encoding',
  'keep-alive',
  'upgrade',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'set-cookie',
]);

function scalarRecord(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, entry] of Object.entries(value)) {
      if (Array.isArray(entry)) out[key] = entry.map(String).join(',');
      else if (entry !== undefined && entry !== null && typeof entry !== 'object') {
        out[key] = String(entry);
      }
    }
  }
  return out;
}

/**
 * The request a plugin handler receives, as escalated-laravel's PluginHttp
 * builds it for the HTTP contract version 1: lowercase scalar headers without
 * the caller's credentials, the route params of the manifest path, the query,
 * the parsed body, and the exact bytes when the app keeps them
 * (`NestFactory.create(AppModule, { rawBody: true })`).
 */
export function pluginRequest(request: any, params: Record<string, string>): PluginRequest {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(request?.headers ?? {})) {
    const lower = name.toLowerCase();
    if (WITHHELD.has(lower) || lower.startsWith('proxy-')) continue;
    headers[lower] = Array.isArray(value) ? value.join(', ') : String(value ?? '');
  }
  const raw = request?.rawBody;
  return {
    httpContract: 1,
    body: request?.body ?? null,
    params,
    query: scalarRecord(request?.query),
    headers,
    ...(raw instanceof Uint8Array ? { rawBody: new Uint8Array(raw) } : {}),
    ...(typeof request?.ip === 'string' ? { clientIp: request.ip } : {}),
  };
}

/** What to write back: status, headers and the body as a string. */
export interface PluginReply {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export class InvalidPluginResponse extends Error {}

/**
 * A handler's result as an HTTP response. An SDK `httpResponse()` envelope
 * chooses the status, format and headers, and is validated independently of
 * the SDK; anything else is JSON with 200.
 */
export function pluginReply(result: unknown): PluginReply {
  const json = { 'content-type': 'application/json; charset=utf-8' };
  if (!result || typeof result !== 'object' || !('__escalated_http' in result)) {
    return { status: 200, headers: json, body: JSON.stringify(result ?? null) };
  }
  const envelope = result as Record<string, unknown>;
  const status = envelope.status;
  if (
    envelope.__escalated_http !== 1 ||
    typeof status !== 'number' ||
    !Number.isInteger(status) ||
    status < 200 ||
    status > 599 ||
    (envelope.format !== 'json' && envelope.format !== 'text') ||
    !envelope.headers ||
    typeof envelope.headers !== 'object' ||
    Array.isArray(envelope.headers) ||
    !('body' in envelope)
  ) {
    throw new InvalidPluginResponse('Invalid plugin HTTP response.');
  }
  if (envelope.format === 'text' && typeof envelope.body !== 'string') {
    throw new InvalidPluginResponse('Invalid plugin text response.');
  }
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(envelope.headers as Record<string, unknown>)) {
    const lower = name.toLowerCase();
    if (
      !/^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(lower) ||
      BLOCKED_RESPONSE_HEADERS.has(lower) ||
      Object.prototype.hasOwnProperty.call(headers, lower) ||
      typeof value !== 'string' ||
      /[\x00-\x1f\x7f]/.test(value)
    ) {
      throw new InvalidPluginResponse('Invalid plugin response header.');
    }
    headers[lower] = value;
  }
  if (envelope.format === 'json') {
    return {
      status,
      headers: { ...json, ...headers },
      body: JSON.stringify(envelope.body ?? null),
    };
  }
  return {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', ...headers },
    body: envelope.body as string,
  };
}
