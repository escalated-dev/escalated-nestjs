import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  AttachmentDownloader,
  AttachmentTooLargeError,
  type AttachmentStorage,
  type PendingAttachment,
} from '../../../src/services/email/attachment-downloader.service';
import { LocalFileAttachmentStorage } from '../../../src/services/email/local-file-attachment-storage.service';
import { Attachment } from '../../../src/entities/attachment.entity';

function makeFetch(
  handler: (
    url: string,
    init?: RequestInit,
  ) => { status: number; body: string; headers?: Record<string, string> },
): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    const { status, body, headers } = handler(url, init);
    const buf = Buffer.from(body);
    // Need a standalone ArrayBuffer; Buffer.from(str) returns a Buffer
    // that shares the Node pool's underlying ArrayBuffer, so slicing
    // it gives unrelated bytes. Copy into a fresh ArrayBuffer.
    const ab = new ArrayBuffer(buf.length);
    new Uint8Array(ab).set(buf);
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers(headers ?? {}),
      async arrayBuffer() {
        return ab;
      },
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

class RecordingStorage implements AttachmentStorage {
  readonly name = 'memory';
  public puts: Array<{ filename: string; content: Buffer; contentType: string }> = [];
  public returnPath = '/stored/path';

  async put(filename: string, content: Buffer, contentType: string): Promise<string> {
    this.puts.push({ filename, content, contentType });
    return this.returnPath;
  }
}

describe('AttachmentDownloader', () => {
  let attachmentRepo: {
    create: jest.Mock;
    save: jest.Mock;
  };
  let storage: RecordingStorage;

  beforeEach(() => {
    storage = new RecordingStorage();
    attachmentRepo = {
      create: jest.fn((data) => ({ id: 0, ...data })),
      save: jest.fn(async (row) => ({ ...row, id: 101 })),
    };
  });

  function build(
    options: {
      maxBytes?: number;
      basicAuth?: { username: string; password: string };
      fetch?: typeof fetch;
    } = {},
  ) {
    return new AttachmentDownloader(attachmentRepo as any, storage, options);
  }

  const pending = (overrides: Partial<PendingAttachment> = {}): PendingAttachment => ({
    name: 'report.pdf',
    contentType: 'application/pdf',
    downloadUrl: 'https://provider/att/1',
    ...overrides,
  });

  it('downloads, stores, and persists an attachment on the happy path', async () => {
    const downloader = build({
      fetch: makeFetch(() => ({
        status: 200,
        body: 'hello pdf',
        headers: { 'content-type': 'application/pdf' },
      })),
    });

    const a = await downloader.download(pending(), 42, null);

    expect(a.id).toBe(101);
    expect(a.ticketId).toBe(42);
    expect(a.fileName).toBe('report.pdf');
    expect(a.mimeType).toBe('application/pdf');
    expect(a.fileSize).toBe(9);
    expect(storage.puts).toHaveLength(1);
    expect(storage.puts[0].content.toString()).toBe('hello pdf');
  });

  it('sets replyId when provided', async () => {
    const downloader = build({
      fetch: makeFetch(() => ({ status: 200, body: 'x' })),
    });

    const a = await downloader.download(pending(), 42, 7);

    expect(a.replyId).toBe(7);
  });

  it('throws when the URL returns 404 and does not persist', async () => {
    const downloader = build({
      fetch: makeFetch(() => ({ status: 404, body: 'not found' })),
    });

    await expect(downloader.download(pending(), 1, null)).rejects.toThrow(/HTTP 404/);
    expect(storage.puts).toHaveLength(0);
    expect(attachmentRepo.save).not.toHaveBeenCalled();
  });

  it('throws AttachmentTooLargeError when body exceeds max_bytes', async () => {
    const downloader = build({
      maxBytes: 10,
      fetch: makeFetch(() => ({ status: 200, body: 'x'.repeat(100) })),
    });

    await expect(downloader.download(pending(), 1, null)).rejects.toThrow(AttachmentTooLargeError);
    expect(storage.puts).toHaveLength(0);
  });

  it('sends Basic auth header when configured', async () => {
    let capturedAuth: string | undefined;
    const downloader = build({
      basicAuth: { username: 'api', password: 'key-secret' },
      fetch: makeFetch((_, init) => {
        const headers = init?.headers as Record<string, string>;
        capturedAuth = headers?.Authorization;
        return { status: 200, body: 'ok' };
      }),
    });

    await downloader.download(pending(), 1, null);

    expect(capturedAuth).toBe('Basic ' + Buffer.from('api:key-secret').toString('base64'));
  });

  it('throws on a missing download URL', async () => {
    const downloader = build();

    await expect(downloader.download(pending({ downloadUrl: '' }), 1, null)).rejects.toThrow(
      /has no download URL/,
    );
  });

  it('falls back to response Content-Type when pending contentType is empty', async () => {
    const downloader = build({
      fetch: makeFetch(() => ({
        status: 200,
        body: 'png bytes',
        headers: { 'content-type': 'image/png' },
      })),
    });

    const a = await downloader.download(pending({ contentType: '' }), 1, null);

    expect(a.mimeType).toBe('image/png');
  });

  describe('safeFilename', () => {
    it.each([
      ['../../etc/passwd', 'passwd'],
      ['/tmp/evil.txt', 'evil.txt'],
      ['', 'attachment'],
      [undefined, 'attachment'],
      ['..', 'attachment'],
      ['.', 'attachment'],
    ])('neutralizes %j → %j', (input, expected) => {
      expect(AttachmentDownloader.safeFilename(input as string | undefined)).toBe(expected);
    });
  });

  it('downloadAll continues past per-attachment failures', async () => {
    let callCount = 0;
    const downloader = build({
      fetch: makeFetch(() => {
        callCount++;
        if (callCount === 2) {
          return { status: 500, body: 'boom' };
        }
        return { status: 200, body: 'ok' };
      }),
    });

    const results = await downloader.downloadAll(
      [
        pending({ name: 'a', downloadUrl: 'https://x/1' }),
        pending({ name: 'b', downloadUrl: 'https://x/2' }),
        pending({ name: 'c', downloadUrl: 'https://x/3' }),
      ],
      1,
      null,
    );

    expect(results).toHaveLength(3);
    expect(results[0].persisted).not.toBeNull();
    expect(results[0].error).toBeNull();
    expect(results[1].persisted).toBeNull();
    expect(results[1].error).not.toBeNull();
    expect(results[2].persisted).not.toBeNull();
  });
});

describe('LocalFileAttachmentStorage', () => {
  it('writes the file under the configured root', async () => {
    const root = mkdtempSync(join(tmpdir(), 'esc-attachments-'));
    const storage = new LocalFileAttachmentStorage(root);

    const path = await storage.put('hello.txt', Buffer.from('payload'), 'text/plain');

    expect(path.startsWith(root)).toBe(true);
    expect(path.endsWith('hello.txt')).toBe(true);
    expect(readFileSync(path, 'utf-8')).toBe('payload');
  });

  it('rejects empty root', () => {
    expect(() => new LocalFileAttachmentStorage('')).toThrow();
  });

  it('produces unique paths for consecutive calls', async () => {
    const root = mkdtempSync(join(tmpdir(), 'esc-attachments-'));
    const storage = new LocalFileAttachmentStorage(root);

    const p1 = await storage.put('x.txt', Buffer.from('a'), 'text/plain');
    const p2 = await storage.put('x.txt', Buffer.from('b'), 'text/plain');

    expect(p1).not.toBe(p2);
  });
});
