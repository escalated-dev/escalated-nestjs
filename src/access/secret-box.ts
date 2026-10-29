import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

const PREFIX = 'v1:';

/**
 * Seals short secrets at rest with AES-256-GCM (a random IV per value, and
 * the tag checked on open, so a value changed in the database is refused).
 * The key is derived from the configured secret with SHA-256.
 */
export class SecretBox {
  private readonly key: Buffer;

  constructor(secret: string) {
    this.key = createHash('sha256').update(`escalated-secret-box:${secret}`).digest();
  }

  seal(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
  }

  /** The plain value; throws when the value was not sealed with this key. */
  open(sealed: string): string {
    if (!sealed.startsWith(PREFIX)) throw new Error('Not a sealed value');
    const raw = Buffer.from(sealed.slice(PREFIX.length), 'base64');
    const decipher = createDecipheriv('aes-256-gcm', this.key, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
  }
}
