/**
 * Application port: read access to the audit trail, for the anomaly
 * detector. The JSONL file implementation lives in infrastructure; tests use
 * an in-memory fake.
 */
import { AuditEntry } from '../domain/AuditEntry.js';

export interface AuditReader {
  /** Returns audit entries with timestamp >= since, oldest first. */
  readSince(since: Date): Promise<AuditEntry[]>;
}
