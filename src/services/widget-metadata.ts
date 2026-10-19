import { BadRequestException } from '@nestjs/common';

/**
 * Host parameters an embedding page sends with a widget ticket or chat
 * (order number, plan, account id, the page URL, ...). They come from the
 * visitor's browser, so only a flat map of short scalar values is kept.
 */
export type WidgetMetadata = Record<string, string | number | boolean>;

export const WIDGET_METADATA_MAX_KEYS = 50;
export const WIDGET_METADATA_MAX_ENTRIES = 25;
export const WIDGET_METADATA_MAX_VALUE_LENGTH = 500;
export const WIDGET_METADATA_MAX_URL_LENGTH = 2048;

const KEY = /^[A-Za-z0-9_.:-]{1,64}$/;

function isWebUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > WIDGET_METADATA_MAX_URL_LENGTH) return false;
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

/**
 * Clean the `metadata` a widget request sent. Returns null when nothing is
 * left. Throws 400 only when `metadata` is present but not an object, or has
 * more than 50 keys; anything else that does not fit is dropped.
 *
 * `embedded_on` is never taken from the page: it is set to `embedOrigin`, the
 * allowed cross-origin site the request came from, when there is one.
 */
export function sanitizeWidgetMetadata(raw: unknown, embedOrigin?: string): WidgetMetadata | null {
  if (raw !== undefined && raw !== null) {
    if (typeof raw !== 'object' || Array.isArray(raw)) {
      throw new BadRequestException('metadata must be an object');
    }
    if (Object.keys(raw).length > WIDGET_METADATA_MAX_KEYS) {
      throw new BadRequestException(
        `metadata may have at most ${WIDGET_METADATA_MAX_KEYS} entries`,
      );
    }
  }

  const clean: WidgetMetadata = {};
  let kept = 0;
  for (const [key, value] of Object.entries((raw as Record<string, unknown>) ?? {})) {
    if (kept >= WIDGET_METADATA_MAX_ENTRIES) break;
    if (!KEY.test(key) || key === '__proto__') continue;

    if (typeof value === 'string') {
      // Cut by code point so a surrogate pair is never split.
      clean[key] = Array.from(value.trim()).slice(0, WIDGET_METADATA_MAX_VALUE_LENGTH).join('');
    } else if (
      (typeof value === 'number' && Number.isFinite(value)) ||
      typeof value === 'boolean'
    ) {
      clean[key] = value;
    } else {
      continue;
    }
    kept++;
  }

  if ('page_url' in clean && !isWebUrl(clean.page_url)) delete clean.page_url;

  // Recorded by the server from the request's Origin, so a page cannot claim another site.
  delete clean.embedded_on;
  if (embedOrigin) clean.embedded_on = embedOrigin;

  return Object.keys(clean).length === 0 ? null : clean;
}
