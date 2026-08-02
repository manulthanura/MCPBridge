/**
 * Infrastructure: reads back the JSONL audit trail written by
 * JsonlAuditLogger. Includes the single rotated ".1" file so a detection
 * window spanning a rotation doesn't silently lose entries.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { AuditReader } from '../application/AuditReader.js';
import { AuditEntry } from '../domain/AuditEntry.js';

export class JsonlAuditReader implements AuditReader {
  private readonly path: string;

  constructor(path: string) {
    this.path = resolve(path);
  }

  async readSince(since: Date): Promise<AuditEntry[]> {
    const sinceMs = since.getTime();
    const entries = [...(await this.readFile(`${this.path}.1`)), ...(await this.readFile(this.path))];
    return entries
      .filter((entry) => {
        const ms = Date.parse(entry.timestamp);
        return !Number.isNaN(ms) && ms >= sinceMs;
      })
      .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  }

  private async readFile(path: string): Promise<AuditEntry[]> {
    let text: string;
    try {
      text = await readFile(path, 'utf8');
    } catch {
      return [];
    }
    const entries: AuditEntry[] = [];
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      try {
        entries.push(JSON.parse(trimmed) as AuditEntry);
      } catch {
        // Skip a partially-written trailing line rather than fail the whole read.
      }
    }
    return entries;
  }
}
