import { AsyncLocalStorage } from 'async_hooks';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

/**
 * A source the admin Import wizard can import from, as escalated-laravel's
 * `Contracts\ImportAdapter`. Escalated ships none: the host lists its adapters
 * (or a plugin package's -- a Zendesk or Freshdesk one, say) in the module
 * option `importAdapters`.
 *
 * `extract` returns records already normalized (`source_id`, `title`,
 * `requester_source_id`, `tag_source_ids`, `ticket_source_id`, ...), as
 * Laravel's adapters do.
 */
export interface ImportAdapter {
  /** Unique slug, e.g. "zendesk". */
  name(): string;
  /** Human-readable name, e.g. "Zendesk". */
  displayName(): string;
  /** The credential form: `name`, `label`, `type` (text, password or url) and `help`. */
  credentialFields(): Array<Record<string, unknown>>;
  /** Validate credentials with a test call. A thrown error's message is shown. */
  testConnection(credentials: Record<string, string>): boolean | Promise<boolean>;
  /** Importable entity types, in dependency order. */
  entityTypes(): string[];
  /** Default mappings for an entity type: source field to Escalated field. */
  defaultFieldMappings(entityType: string): Record<string, string>;
  /** Source fields as the Mapping screen lists them: `name`, `label`, `escalated_options`. */
  availableSourceFields(
    entityType: string,
    credentials: Record<string, string>,
  ): Array<Record<string, unknown>> | Promise<Array<Record<string, unknown>>>;
  /** One batch of records; a null `cursor` means the type is exhausted. */
  extract(
    entityType: string,
    credentials: Record<string, string>,
    cursor: string | null,
  ): ImportExtractResult | Promise<ImportExtractResult>;
}

export interface ImportExtractResult {
  records: Array<Record<string, unknown>>;
  cursor: string | null;
  totalCount?: number | null;
}

const importMode = new AsyncLocalStorage<true>();

/**
 * Import mode, as escalated-laravel's `ImportContext`: while a run writes,
 * SLA policy attachment and breach checks, escalation rules and automations
 * stand down, so imported history does not fire as if it were new. It lives
 * in the run's own async context, so live requests are never in it.
 */
export const ImportContext = {
  isImporting(): boolean {
    return importMode.getStore() === true;
  },
  suppress<T>(work: () => Promise<T>): Promise<T> {
    return importMode.run(true, work);
  },
};

/**
 * Seals a source's credentials (AES-256-GCM) for where they rest: a cookie
 * scoped to the import paths, from a tested connection until the import
 * starts, and the import job's `credentials` column until the run ends or is
 * cancelled.
 */
export class ImportCredentials {
  private readonly key: Buffer;

  constructor(secret: string) {
    this.key = createHash('sha256').update(`escalated import credentials\0${secret}`).digest();
  }

  seal(credentials: Record<string, string>): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const body = Buffer.concat([
      cipher.update(JSON.stringify(credentials), 'utf8'),
      cipher.final(),
    ]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
  }

  /** The credentials, or null when absent, tampered with or sealed under another secret. */
  open(sealed: string | null | undefined): Record<string, string> | null {
    if (!sealed) return null;
    try {
      const raw = Buffer.from(sealed, 'base64url');
      if (raw.length < 29) return null;
      const decipher = createDecipheriv('aes-256-gcm', this.key, raw.subarray(0, 12));
      decipher.setAuthTag(raw.subarray(12, 28));
      const plain = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]);
      const value = JSON.parse(plain.toString('utf8'));
      return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
    } catch {
      return null;
    }
  }
}
