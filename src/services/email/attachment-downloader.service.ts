import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Attachment } from '../../entities/attachment.entity';

/**
 * Minimal contract for writing attachment bytes to a backend.
 * Implementations can persist to local filesystem, S3, GCS,
 * Azure Blob, etc.
 *
 * Host apps wire their preferred storage via
 * {@code ATTACHMENT_STORAGE} DI token.
 */
export interface AttachmentStorage {
  /**
   * Short identifier for the storage backend (e.g. `"local"`,
   * `"s3"`). Currently informational — stored nowhere but useful
   * for logs.
   */
  readonly name: string;

  /**
   * Persist the content and return a backend-specific path/key.
   */
  put(filename: string, content: Buffer, contentType: string): Promise<string>;
}

/** DI token for the {@link AttachmentStorage} implementation. */
export const ATTACHMENT_STORAGE = 'ATTACHMENT_STORAGE';

/**
 * Runtime configuration for {@link AttachmentDownloader}.
 */
export interface AttachmentDownloaderOptions {
  /**
   * Reject attachments larger than this size (in bytes). Zero or
   * undefined disables the check.
   */
  maxBytes?: number;

  /**
   * Optional HTTP basic auth credentials attached to every download
   * request. Typical use for Mailgun:
   * `{ username: 'api', password: mailgunApiKey }`.
   */
  basicAuth?: { username: string; password: string };

  /**
   * Optional custom fetch implementation (primarily for testing). If
   * omitted, the global {@link fetch} is used — Node 18+ ships it
   * natively.
   */
  fetch?: typeof fetch;
}

/** DI token for the {@link AttachmentDownloaderOptions}. */
export const ATTACHMENT_DOWNLOADER_OPTIONS = 'ATTACHMENT_DOWNLOADER_OPTIONS';

/**
 * Thrown when a downloaded attachment exceeds the configured size
 * limit. The partial body is not persisted.
 */
export class AttachmentTooLargeError extends Error {
  constructor(
    public readonly attachmentName: string,
    public readonly actualBytes: number,
    public readonly maxBytes: number,
  ) {
    super(`Attachment '${attachmentName}' is ${actualBytes} bytes, exceeds limit ${maxBytes}.`);
    this.name = 'AttachmentTooLargeError';
  }
}

/**
 * Outcome of a single download attempt inside
 * {@link AttachmentDownloader.downloadAll}.
 */
export interface AttachmentDownloadResult {
  readonly pending: PendingAttachment;
  readonly persisted: Attachment | null;
  readonly error: Error | null;
}

/**
 * Descriptor for a provider-hosted attachment the host app should
 * fetch out-of-band. Surfaced by the inbound pipeline (Mailgun
 * hosts its larger files behind a URL instead of inlining).
 */
export interface PendingAttachment {
  name: string;
  contentType: string;
  sizeBytes?: number;
  downloadUrl: string;
}

/**
 * Fetches provider-hosted attachments and persists them as
 * {@link Attachment} rows tied to a ticket (and optionally a
 * reply).
 *
 * Mirrors the per-framework downloaders in escalated-go#35 /
 * escalated-dotnet#29 / escalated-spring#32 / escalated-phoenix#41 /
 * escalated-symfony#37. Run this from a background worker after the
 * inbound pipeline returns, so the webhook response goes back to
 * the provider without waiting for the download.
 *
 * Host apps with durable cloud storage implement
 * {@link AttachmentStorage} themselves and bind it to the
 * {@code ATTACHMENT_STORAGE} DI token. Without a binding, callers
 * must construct the service directly.
 */
@Injectable()
export class AttachmentDownloader {
  private readonly logger = new Logger(AttachmentDownloader.name);

  constructor(
    @InjectRepository(Attachment)
    private readonly attachmentRepo: Repository<Attachment>,
    // The storage + options tokens are host-provided; see the
    // module docstring for wiring.
    private readonly storage: AttachmentStorage,
    private readonly options: AttachmentDownloaderOptions = {},
  ) {}

  async download(
    pending: PendingAttachment,
    ticketId: number,
    replyId?: number | null,
  ): Promise<Attachment> {
    if (!pending.downloadUrl) {
      throw new Error('Pending attachment has no download URL.');
    }

    const fetchImpl = this.options.fetch ?? fetch;

    const headers: Record<string, string> = {};
    if (this.options.basicAuth) {
      const token = Buffer.from(
        `${this.options.basicAuth.username}:${this.options.basicAuth.password}`,
      ).toString('base64');
      headers.Authorization = `Basic ${token}`;
    }

    const response = await fetchImpl(pending.downloadUrl, { headers });
    if (!response.ok) {
      throw new Error(
        `Attachment download failed: ${pending.downloadUrl} → HTTP ${response.status}`,
      );
    }

    const arrayBuf = await response.arrayBuffer();
    const body = Buffer.from(arrayBuf);

    if (this.options.maxBytes && body.length > this.options.maxBytes) {
      throw new AttachmentTooLargeError(pending.name, body.length, this.options.maxBytes);
    }

    const contentType =
      pending.contentType || response.headers.get('content-type') || 'application/octet-stream';
    const filename = AttachmentDownloader.safeFilename(pending.name);

    const path = await this.storage.put(filename, body, contentType);

    const attachment = this.attachmentRepo.create({
      ticketId,
      replyId: replyId ?? undefined,
      fileName: filename,
      filePath: path,
      mimeType: contentType,
      fileSize: body.length,
    });
    const saved = await this.attachmentRepo.save(attachment);

    this.logger.log(`Persisted ${filename} (${body.length} bytes) for ticket #${ticketId}`);

    return saved;
  }

  /**
   * Download a batch of pending attachments. Continues past
   * per-attachment failures so a single bad URL doesn't block the
   * rest. Returns a result record per input.
   */
  async downloadAll(
    pending: PendingAttachment[],
    ticketId: number,
    replyId?: number | null,
  ): Promise<AttachmentDownloadResult[]> {
    const results: AttachmentDownloadResult[] = [];
    for (const p of pending) {
      try {
        const persisted = await this.download(p, ticketId, replyId);
        results.push({ pending: p, persisted, error: null });
      } catch (err) {
        this.logger.warn(`Failed to download ${p.downloadUrl}: ${(err as Error).message}`);
        results.push({ pending: p, persisted: null, error: err as Error });
      }
    }
    return results;
  }

  /**
   * Strip path separators so crafted attachment names like
   * `"../../etc/passwd"` can't escape the storage root. Falls back
   * to `"attachment"` when the input is unusable.
   */
  static safeFilename(name: string | undefined): string {
    if (!name || !name.trim()) return 'attachment';
    const normalized = name.replace(/\\/g, '/').trim();
    const parts = normalized.split('/');
    const base = parts[parts.length - 1] ?? '';
    if (!base || base === '.' || base === '..') return 'attachment';
    return base;
  }
}
