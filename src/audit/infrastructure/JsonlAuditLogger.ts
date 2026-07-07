/**
 * Infrastructure: JSONL audit trail — one JSON object per line, append-only,
 * with size-based rotation so a busy server cannot fill the disk (spec R-07).
 */
import { appendFile, mkdir, rename, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { AuditLogger } from '../application/AuditLogger.js';
import { AuditEntry } from '../domain/AuditEntry.js';
import { redactSecrets } from '../../platform/config/Config.js';

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;

export class JsonlAuditLogger implements AuditLogger {
  private readonly path: string;
  private dirReady = false;

  constructor(
    path: string,
    private readonly secrets: string[],
    private readonly maxBytes: number = DEFAULT_MAX_BYTES,
  ) {
    this.path = resolve(path);
  }

  async log(entry: AuditEntry): Promise<void> {
    if (!this.dirReady) {
      await mkdir(dirname(this.path), { recursive: true });
      this.dirReady = true;
    }
    await this.rotateIfNeeded();

    const sanitized: AuditEntry = {
      ...entry,
      ...(entry.sql !== undefined ? { sql: redactSecrets(entry.sql, this.secrets) } : {}),
      ...(entry.detail !== undefined ? { detail: redactSecrets(entry.detail, this.secrets) } : {}),
    };
    await appendFile(this.path, JSON.stringify(sanitized) + '\n', 'utf8');
  }

  private async rotateIfNeeded(): Promise<void> {
    try {
      const info = await stat(this.path);
      if (info.size >= this.maxBytes) {
        await rename(this.path, `${this.path}.1`);
      }
    } catch {
      // File does not exist yet — nothing to rotate.
    }
  }
}
