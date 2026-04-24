import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import type { AttachmentStorage } from './attachment-downloader.service';

/**
 * Reference {@link AttachmentStorage} for hosts without cloud
 * storage — writes to the local filesystem under a configured root.
 * Files are prefixed with a UTC timestamp plus a random suffix so
 * concurrent uploads with the same original filename don't collide.
 *
 * Host apps with S3 / GCS / Azure needs should implement
 * {@link AttachmentStorage} themselves and bind it to the
 * {@code ATTACHMENT_STORAGE} DI token instead of using this class.
 */
export class LocalFileAttachmentStorage implements AttachmentStorage {
  readonly name = 'local';

  constructor(private readonly root: string) {
    if (!root || !root.trim()) {
      throw new Error('Local file storage root is required.');
    }
  }

  async put(filename: string, content: Buffer, _contentType: string): Promise<string> {
    await mkdir(this.root, { recursive: true });

    const now = new Date();
    const stamp =
      now.toISOString().replace(/[-:TZ.]/g, '').slice(0, 17)
      + '-'
      + Math.floor(Math.random() * 1_000_000).toString(36);
    const storedName = `${stamp}-${filename}`;
    const fullPath = join(this.root, storedName);

    await writeFile(fullPath, content);
    return fullPath;
  }
}
