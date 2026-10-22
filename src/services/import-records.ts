/**
 * The checks imported attachments and satisfaction ratings go through, as a
 * live upload or rating would.
 */

/**
 * The extensions Laravel's live uploads accept (`mimes:` on
 * CreateTicketRequest / ReplyToTicketRequest), with the type each is stored
 * as: taken from the extension, never from the source's claim.
 */
const ATTACHMENT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
  txt: 'text/plain',
  zip: 'application/zip',
  mp4: 'video/mp4',
  mp3: 'audio/mpeg',
};

/** Content a browser would read as markup, refused whatever the file is called. */
const MARKUP = ['<!doctype html', '<html', '<head', '<body', '<script', '<iframe', '<svg', '<?xml'];

export function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot < 0 ? '' : fileName.slice(dot + 1).toLowerCase();
}

/** The stored type for an allowed file name, or null when its type is not allowed. */
export function importAttachmentType(fileName: string): string | null {
  return Object.prototype.hasOwnProperty.call(ATTACHMENT_TYPES, extensionOf(fileName))
    ? ATTACHMENT_TYPES[extensionOf(fileName)]
    : null;
}

/** The base name of a source file name, without control characters. */
export function importFilename(name: string | null): string {
  if (!name) return 'attachment';
  const normalized = name.replace(/\\/g, '/');
  const base = (normalized.split('/').pop() ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!base || base === '.' || base === '..') return 'attachment';
  return base.length > 255 ? base.slice(base.length - 255) : base;
}

/** A record's file bytes: a Buffer / Uint8Array, or a base64 string. */
export function attachmentContent(value: unknown): Buffer | null {
  if (value === null || value === undefined) return null;
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value !== 'string') {
    throw new Error('Attachment content must be bytes or a base64 string.');
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed) || trimmed.length % 4 !== 0) {
    throw new Error('Attachment content is not valid base64.');
  }
  return Buffer.from(trimmed, 'base64');
}

export function isMarkup(content: Buffer): boolean {
  const head = content
    .subarray(0, 512)
    .toString('latin1')
    .replace(/^ï»¿/, '')
    .trimStart()
    .toLowerCase();
  return MARKUP.some((prefix) => head.startsWith(prefix));
}

/** A 1-5 integer rating, or null. */
export function importRating(value: unknown): number | null {
  if (typeof value === 'boolean' || value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!/^\d+(\.0+)?$/.test(text)) return null;
  const n = Number(text);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
}

/** The first message of a validation error (UiValidationException), or its message. */
export function validationMessage(error: any): string {
  const errors = error?.errors;
  if (errors && typeof errors === 'object') {
    const first = Object.values(errors)[0];
    if (typeof first === 'string') return first;
  }
  return error?.message ?? String(error);
}
